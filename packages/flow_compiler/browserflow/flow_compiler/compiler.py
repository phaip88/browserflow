from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict, deque
from typing import Any

from browserflow.domain.enums import EdgeKind
from browserflow.execution_contracts.plan import (
    CompiledEdge,
    CompiledFlowExecutionPlan,
    CompiledNode,
    Diagnostic,
    ResourceEstimate,
)
from browserflow.flow_schema import NODE_REGISTRY_VERSION, FlowDefinition
from browserflow.node_sdk.registry import NodeRegistry, global_registry
from pydantic import ValidationError

_SAFE_EXPR = re.compile(r"^[\w.\[\]'\" -]*$")
_CRED_REF = re.compile(r"^cred:[0-9a-fA-F-]{36}$")
_ID_REF = re.compile(r"^identity:[0-9a-fA-F-]{36}$")
_MAX_NODES = 200
_BROWSER_PREFIXES = ("page.", "locator.", "element.")


class FlowCompiler:
    def __init__(self, registry: NodeRegistry | None = None) -> None:
        self.registry = registry or global_registry()

    def compile(self, raw: dict[str, Any] | FlowDefinition) -> CompiledFlowExecutionPlan:
        diagnostics: list[Diagnostic] = []
        definition = self._parse(raw, diagnostics)
        if definition is None:
            return self._fail(diagnostics)

        nodes = {n.id: n for n in definition.nodes}
        if len(nodes) != len(definition.nodes):
            diagnostics.append(_err("BF-COMPILER-ID", "duplicate node id"))
        edges_by_id = {e.id: e for e in definition.edges}
        if len(edges_by_id) != len(definition.edges):
            diagnostics.append(_err("BF-COMPILER-ID", "duplicate edge id"))

        if len(definition.nodes) > _MAX_NODES:
            diagnostics.append(_err("BF-COMPILER-LIMIT", f"more than {_MAX_NODES} nodes"))

        start_nodes = [n for n in definition.nodes if n.type == "control.start"]
        end_nodes = [n for n in definition.nodes if n.type == "control.end"]
        if len(start_nodes) != 1:
            diagnostics.append(
                _err("BF-COMPILER-ENTRY", "flow must contain exactly one control.start")
            )
        if len(end_nodes) < 1:
            diagnostics.append(
                _err("BF-COMPILER-ENTRY", "flow must contain at least one control.end")
            )

        for node in definition.nodes:
            if not self.registry.has(node.type):
                diagnostics.append(
                    _err("BF-COMPILER-TYPE", f"unknown node type {node.type}", node.id)
                )
                continue
            spec = self.registry.get(node.type).spec
            if node.version != spec.version:
                diagnostics.append(
                    _err(
                        "BF-COMPILER-VERSION",
                        f"node version {node.version} != registry {spec.version}",
                        node.id,
                    )
                )
            self._check_config_refs(node.config, diagnostics, node.id)

        outgoing: dict[str, list[CompiledEdge]] = defaultdict(list)
        incoming: dict[str, int] = defaultdict(int)
        for edge in definition.edges:
            if edge.source not in nodes or edge.target not in nodes:
                diagnostics.append(
                    _err("BF-COMPILER-EDGE", "edge references missing node", edge_id=edge.id)
                )
                continue
            if edge.source == edge.target:
                diagnostics.append(
                    _err("BF-COMPILER-EDGE", "self-loop is not allowed", edge_id=edge.id)
                )
                continue
            compiled = CompiledEdge(
                id=edge.id,
                source=edge.source,
                target=edge.target,
                kind=edge.kind,
                priority=edge.priority,
                source_handle=edge.source_handle,
                target_handle=edge.target_handle,
                condition=edge.condition,
            )
            outgoing[edge.source].append(compiled)
            incoming[edge.target] += 1
            if edge.condition and not _SAFE_EXPR.match(edge.condition):
                diagnostics.append(
                    _err("BF-COMPILER-EXPR", "unsafe edge condition", edge_id=edge.id)
                )

        for src, edges in outgoing.items():
            edges.sort(key=lambda e: (e.kind.value, e.priority, e.id))
            if nodes[src].type == "control.if":
                kinds = [e.kind for e in edges]
                if kinds.count(EdgeKind.TRUE) > 1 or kinds.count(EdgeKind.FALSE) > 1:
                    diagnostics.append(
                        _err("BF-COMPILER-BRANCH", "if must have at most one TRUE and FALSE", src)
                    )
            if nodes[src].type == "control.foreach":
                if sum(1 for e in edges if e.kind == EdgeKind.LOOP_BODY) != 1:
                    diagnostics.append(
                        _err("BF-COMPILER-LOOP", "foreach requires exactly one LOOP_BODY edge", src)
                    )

        if start_nodes:
            reachable = self._reachable(start_nodes[0].id, outgoing)
            for node in definition.nodes:
                if node.id not in reachable:
                    diagnostics.append(
                        Diagnostic(
                            severity="WARNING",
                            code="BF-COMPILER-UNREACHABLE",
                            message="node is unreachable from start",
                            node_id=node.id,
                        )
                    )
            if self._has_illegal_cycle(start_nodes[0].id, outgoing, nodes):
                diagnostics.append(_err("BF-COMPILER-CYCLE", "illegal cycle in flow graph"))

        errors = [d for d in diagnostics if d.severity == "ERROR"]
        if errors or not start_nodes:
            return self._fail(diagnostics)

        compiled_nodes: dict[str, CompiledNode] = {}
        requires_browser = False
        for node in definition.nodes:
            spec = self.registry.get(node.type).spec
            timeout = node.timeout_ms or spec.default_timeout_ms
            compiled_nodes[node.id] = CompiledNode(
                id=node.id,
                type=node.type,
                version=node.version,
                label=node.label,
                config=node.config,
                inputs={k: v.model_dump() for k, v in node.inputs.items()},
                timeout_ms=timeout,
                retry=node.retry.model_dump(),
                error_policy=node.error_policy,
                outgoing=outgoing.get(node.id, []),
            )
            if node.type.startswith(_BROWSER_PREFIXES):
                requires_browser = True

        estimate = ResourceEstimate(
            node_count=len(compiled_nodes),
            estimated_duration_ms=sum(n.timeout_ms for n in compiled_nodes.values()),
            pages=1 if requires_browser else 0,
            requires_browser=requires_browser,
            requires_identity=bool(definition.identity_ref),
        )
        plan = CompiledFlowExecutionPlan(
            start_node_id=start_nodes[0].id,
            nodes=compiled_nodes,
            checksum="",
            node_registry_version=NODE_REGISTRY_VERSION,
            resource_estimate=estimate,
            diagnostics=diagnostics,
            identity_ref=definition.identity_ref,
        )
        plan.checksum = _checksum(plan.model_dump(mode="json", exclude={"checksum", "diagnostics"}))
        return plan

    def _parse(
        self, raw: dict[str, Any] | FlowDefinition, diagnostics: list[Diagnostic]
    ) -> FlowDefinition | None:
        if isinstance(raw, FlowDefinition):
            return raw
        try:
            return FlowDefinition.model_validate(raw)
        except ValidationError as exc:
            diagnostics.append(
                _err("BF-COMPILER-SCHEMA", exc.errors()[0]["msg"] if exc.errors() else "invalid")
            )
            return None

    def _check_config_refs(self, value: Any, diagnostics: list[Diagnostic], node_id: str) -> None:
        if isinstance(value, dict):
            for k, v in value.items():
                if (
                    k in {"credential_ref", "credentialRef"}
                    and isinstance(v, str)
                    and not _CRED_REF.match(v)
                ):
                    diagnostics.append(_err("BF-COMPILER-CRED", "invalid CredentialRef", node_id))
                if (
                    k in {"identity_ref", "identityRef"}
                    and isinstance(v, str)
                    and not _ID_REF.match(v)
                ):
                    diagnostics.append(_err("BF-COMPILER-IDENT", "invalid IdentityRef", node_id))
                self._check_config_refs(v, diagnostics, node_id)
        elif isinstance(value, list):
            for item in value:
                self._check_config_refs(item, diagnostics, node_id)
        elif isinstance(value, str) and value.startswith("{{") and value.endswith("}}"):
            inner = value[2:-2].strip()
            if inner and not _SAFE_EXPR.match(inner):
                diagnostics.append(_err("BF-COMPILER-EXPR", "unsafe variable expression", node_id))

    def _reachable(self, start: str, outgoing: dict[str, list[CompiledEdge]]) -> set[str]:
        seen: set[str] = set()
        q: deque[str] = deque([start])
        while q:
            cur = q.popleft()
            if cur in seen:
                continue
            seen.add(cur)
            for edge in outgoing.get(cur, []):
                q.append(edge.target)
        return seen

    def _has_illegal_cycle(
        self,
        start: str,
        outgoing: dict[str, list[CompiledEdge]],
        nodes: dict[str, Any],
    ) -> bool:
        WHITE, GRAY, BLACK = 0, 1, 2
        color: dict[str, int] = defaultdict(int)

        def dfs(node_id: str) -> bool:
            color[node_id] = GRAY
            for edge in outgoing.get(node_id, []):
                if edge.kind == EdgeKind.LOOP_BODY:
                    continue
                if (
                    nodes.get(node_id)
                    and nodes[node_id].type == "control.foreach"
                    and edge.kind == EdgeKind.LOOP_DONE
                ):
                    pass
                nxt = edge.target
                if color[nxt] == GRAY:
                    return True
                if color[nxt] == WHITE and dfs(nxt):
                    return True
            color[node_id] = BLACK
            return False

        return dfs(start)

    def _fail(self, diagnostics: list[Diagnostic]) -> CompiledFlowExecutionPlan:
        return CompiledFlowExecutionPlan(
            start_node_id="",
            nodes={},
            checksum="",
            node_registry_version=NODE_REGISTRY_VERSION,
            resource_estimate=ResourceEstimate(node_count=0, estimated_duration_ms=0),
            diagnostics=diagnostics,
        )


def _err(
    code: str, message: str, node_id: str | None = None, edge_id: str | None = None
) -> Diagnostic:
    return Diagnostic(
        severity="ERROR", code=code, message=message, node_id=node_id, edge_id=edge_id
    )


def _checksum(payload: Any) -> str:
    blob = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def has_errors(plan: CompiledFlowExecutionPlan) -> bool:
    return any(d.severity == "ERROR" for d in plan.diagnostics) or not plan.start_node_id
