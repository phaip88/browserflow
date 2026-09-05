from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

from browserflow.domain.enums import EdgeKind, ErrorPolicy, NodeExecutionStatus
from browserflow.domain.errors import CancellationError, NodeTimeoutError
from browserflow.execution_contracts.plan import CompiledFlowExecutionPlan, CompiledNode
from browserflow.infrastructure.config import get_settings
from browserflow.infrastructure.logging import get_logger
from browserflow.node_sdk.context import (
    CancellationToken,
    ExecutionContext,
    ExecutionScope,
    LoopScope,
)
from browserflow.node_sdk.registry import NodeRegistry, global_registry
from browserflow.node_sdk.result import NodeResult

logger = get_logger(__name__)

SinkFn = Callable[..., Awaitable[None]]


class EngineOutcome:
    def __init__(
        self,
        *,
        status: str,
        return_value: Any = None,
        error_code: str | None = None,
        error_message: str | None = None,
        node_statuses: dict[str, str] | None = None,
    ) -> None:
        self.status = status
        self.return_value = return_value
        self.error_code = error_code
        self.error_message = error_message
        self.node_statuses = node_statuses or {}


class FlowEngine:
    def __init__(self, registry: NodeRegistry | None = None) -> None:
        self.registry = registry or global_registry()
        self.settings = get_settings()

    async def execute(
        self,
        plan: CompiledFlowExecutionPlan,
        *,
        execution_id: UUID,
        attempt_id: UUID,
        flow_version_id: UUID,
        cancellation: CancellationToken | None = None,
        browser_session: Any | None = None,
        artifact_service: Any | None = None,
        secret_resolver: Any | None = None,
        sink: SinkFn | None = None,
    ) -> EngineOutcome:
        token = cancellation or CancellationToken()
        scope = ExecutionScope()
        outputs: dict[str, dict[str, Any]] = {}
        statuses: dict[str, str] = {nid: NodeExecutionStatus.PENDING.value for nid in plan.nodes}
        finally_done: set[str] = set()

        async def run_from(
            node_id: str | None, local_scope: ExecutionScope
        ) -> EngineOutcome | None:
            current = node_id
            while current:
                token.raise_if_cancelled()
                node = plan.nodes[current]
                if node.type == "control.foreach":
                    outcome = await self._run_foreach(
                        plan,
                        node,
                        local_scope,
                        outputs,
                        statuses,
                        execution_id,
                        attempt_id,
                        flow_version_id,
                        token,
                        browser_session,
                        artifact_service,
                        secret_resolver,
                        sink,
                    )
                    if outcome is not None:
                        return outcome
                    current = _pick_edge(node, EdgeKind.LOOP_DONE)
                    continue

                result = await self._run_node(
                    node,
                    local_scope,
                    outputs,
                    statuses,
                    execution_id,
                    attempt_id,
                    flow_version_id,
                    token,
                    browser_session,
                    artifact_service,
                    secret_resolver,
                    sink,
                )
                if result.did_return:
                    self._mark_rest(statuses, NodeExecutionStatus.NOT_REACHED)
                    return EngineOutcome(
                        status="SUCCEEDED",
                        return_value=result.return_value,
                        node_statuses=statuses,
                    )
                if not result.ok:
                    nxt = self._on_error(node, result, statuses)
                    if nxt is None:
                        self._mark_rest(statuses, NodeExecutionStatus.NOT_REACHED)
                        return EngineOutcome(
                            status="FAILED",
                            error_code=result.error_code,
                            error_message=result.error_message,
                            node_statuses=statuses,
                        )
                    current = nxt
                    continue
                if node.type == "control.end":
                    self._run_finally(node, finally_done)
                    self._mark_rest(statuses, NodeExecutionStatus.SKIPPED)
                    return EngineOutcome(status="SUCCEEDED", node_statuses=statuses)
                current = self._next_node(node, result, statuses)
            return None

        try:
            outcome = await run_from(plan.start_node_id, scope)
            if outcome is None:
                self._mark_rest(statuses, NodeExecutionStatus.SKIPPED)
                return EngineOutcome(status="SUCCEEDED", node_statuses=statuses)
            return outcome
        except CancellationError:
            self._mark_rest(statuses, NodeExecutionStatus.CANCELLED)
            return EngineOutcome(status="CANCELLED", node_statuses=statuses)
        except NodeTimeoutError as exc:
            self._mark_rest(statuses, NodeExecutionStatus.TIMED_OUT)
            return EngineOutcome(
                status="TIMED_OUT",
                error_code="BF-NODE",
                error_message=exc.safe_message,
                node_statuses=statuses,
            )

    async def _run_foreach(self, plan, node, scope, outputs, statuses, *args):
        (
            execution_id,
            attempt_id,
            flow_version_id,
            token,
            browser_session,
            artifact_service,
            secret_resolver,
            sink,
        ) = args
        result = await self._run_node(
            node,
            scope,
            outputs,
            statuses,
            execution_id,
            attempt_id,
            flow_version_id,
            token,
            browser_session,
            artifact_service,
            secret_resolver,
            sink,
        )
        if not result.ok:
            return EngineOutcome(
                status="FAILED",
                error_code=result.error_code,
                error_message=result.error_message,
                node_statuses=statuses,
            )
        items = result.outputs.get("items") or []
        if len(items) > self.settings.max_foreach_iterations:
            return EngineOutcome(
                status="FAILED",
                error_code="BF-FLOW",
                error_message="foreach exceeded max iterations",
                node_statuses=statuses,
            )
        body = _pick_edge(node, EdgeKind.LOOP_BODY)
        for index, item in enumerate(items):
            token.raise_if_cancelled()
            loop_scope = LoopScope(parent=scope, item=item, index=index, length=len(items))
            if body:
                nested = await self._run_linear(
                    plan,
                    body,
                    loop_scope,
                    outputs,
                    statuses,
                    execution_id,
                    attempt_id,
                    flow_version_id,
                    token,
                    browser_session,
                    artifact_service,
                    secret_resolver,
                    sink,
                    stop_types={"control.end"},
                )
                if nested is not None:
                    return nested
        return None

    async def _run_linear(self, plan, start, scope, outputs, statuses, *rest, stop_types: set[str]):
        current: str | None = start
        (
            execution_id,
            attempt_id,
            flow_version_id,
            token,
            browser_session,
            artifact_service,
            secret_resolver,
            sink,
        ) = rest
        while current:
            node = plan.nodes[current]
            if node.type in stop_types:
                return None
            if node.type == "control.foreach":
                outcome = await self._run_foreach(
                    plan,
                    node,
                    scope,
                    outputs,
                    statuses,
                    execution_id,
                    attempt_id,
                    flow_version_id,
                    token,
                    browser_session,
                    artifact_service,
                    secret_resolver,
                    sink,
                )
                if outcome is not None:
                    return outcome
                current = _pick_edge(node, EdgeKind.LOOP_DONE)
                continue
            result = await self._run_node(
                node,
                scope,
                outputs,
                statuses,
                execution_id,
                attempt_id,
                flow_version_id,
                token,
                browser_session,
                artifact_service,
                secret_resolver,
                sink,
            )
            if result.did_return:
                self._mark_rest(statuses, NodeExecutionStatus.NOT_REACHED)
                return EngineOutcome(
                    status="SUCCEEDED",
                    return_value=result.return_value,
                    node_statuses=statuses,
                )
            if not result.ok:
                nxt = self._on_error(node, result, statuses)
                if nxt is None:
                    return EngineOutcome(
                        status="FAILED",
                        error_code=result.error_code,
                        error_message=result.error_message,
                        node_statuses=statuses,
                    )
                current = nxt
                continue
            current = self._next_node(node, result, statuses)
        return None

    async def _run_node(
        self,
        node: CompiledNode,
        scope: ExecutionScope,
        outputs: dict[str, dict[str, Any]],
        statuses: dict[str, str],
        execution_id: UUID,
        attempt_id: UUID,
        flow_version_id: UUID,
        token: CancellationToken,
        browser_session: Any,
        artifact_service: Any,
        secret_resolver: Any,
        sink: SinkFn | None,
    ) -> NodeResult:
        statuses[node.id] = NodeExecutionStatus.RUNNING.value
        if sink:
            await sink("node_started", node_id=node.id, node_type=node.type)
        handler = self.registry.get(node.type)
        attempts = int(node.retry.get("max_attempts") or 0) + 1
        last: NodeResult | None = None
        for _attempt in range(attempts):
            token.raise_if_cancelled()
            ctx = ExecutionContext(
                execution_id=execution_id,
                attempt_id=attempt_id,
                flow_version_id=flow_version_id,
                node_id=node.id,
                node_type=node.type,
                config=node.config,
                inputs=node.inputs,
                scope=scope,
                cancellation=token,
                browser_session=browser_session,
                artifact_service=artifact_service,
                secret_resolver=secret_resolver,
                timeout_ms=node.timeout_ms,
                outputs=outputs,
            )
            try:
                last = await asyncio.wait_for(handler.run(ctx), timeout=node.timeout_ms / 1000)
            except TimeoutError:
                last = NodeResult.failure("BF-NODE", "node timed out")
            except CancellationError:
                raise
            except Exception:
                logger.warning("node_exception", node_id=node.id, error_code="BF-NODE")
                last = NodeResult.failure("BF-NODE", "node failed")
            if last.ok:
                break
        assert last is not None
        if last.ok:
            statuses[node.id] = NodeExecutionStatus.SUCCEEDED.value
            outputs[node.id] = last.outputs
            if "value" in last.outputs:
                scope.set_value(node.id, last.outputs["value"])
        else:
            statuses[node.id] = NodeExecutionStatus.FAILED.value
        if sink:
            await sink(
                "node_finished",
                node_id=node.id,
                ok=last.ok,
                outputs=_public_outputs(last.outputs),
                error_code=last.error_code,
                error_message=last.error_message,
            )
        return last

    def _next_node(
        self, node: CompiledNode, result: NodeResult, statuses: dict[str, str]
    ) -> str | None:
        if node.type == "control.if" or result.branch in {"TRUE", "FALSE"}:
            wanted = EdgeKind.TRUE if result.branch == "TRUE" else EdgeKind.FALSE
            chosen = _pick_edge(node, wanted)
            other = EdgeKind.FALSE if wanted == EdgeKind.TRUE else EdgeKind.TRUE
            skipped = _pick_edge(node, other)
            if skipped:
                statuses[skipped] = NodeExecutionStatus.SKIPPED.value
            return chosen
        return _pick_edge(node, EdgeKind.SUCCESS) or _pick_edge(node, EdgeKind.FINALLY)

    def _on_error(
        self, node: CompiledNode, result: NodeResult, statuses: dict[str, str]
    ) -> str | None:
        if node.error_policy == ErrorPolicy.FOLLOW_ERROR_EDGE:
            return _pick_edge(node, EdgeKind.ERROR)
        if node.error_policy == ErrorPolicy.CONTINUE:
            return _pick_edge(node, EdgeKind.SUCCESS)
        if node.error_policy == ErrorPolicy.USE_DEFAULT_VALUE:
            statuses[node.id] = NodeExecutionStatus.SUCCEEDED.value
            return _pick_edge(node, EdgeKind.SUCCESS)
        return None

    def _run_finally(self, node: CompiledNode, done: set[str]) -> None:
        edge = _pick_edge(node, EdgeKind.FINALLY)
        if edge and edge not in done:
            done.add(edge)

    def _mark_rest(self, statuses: dict[str, str], status: NodeExecutionStatus) -> None:
        for key, value in list(statuses.items()):
            if value == NodeExecutionStatus.PENDING.value:
                statuses[key] = status.value


def _pick_edge(node: CompiledNode, kind: EdgeKind) -> str | None:
    matches = [e for e in node.outgoing if e.kind == kind]
    if not matches:
        return None
    matches.sort(key=lambda e: (e.priority, e.id))
    return matches[0].target


def _public_outputs(outputs: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in outputs.items() if k != "private" and not str(k).startswith("_")}
