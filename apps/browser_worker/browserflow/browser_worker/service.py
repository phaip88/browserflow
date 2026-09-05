from __future__ import annotations

import asyncio
import os
import socket
from uuid import UUID

from browserflow.application.engine import FlowEngine
from browserflow.application.event_service import append_event
from browserflow.application.lease_service import LeaseService
from browserflow.domain.clock import utcnow
from browserflow.domain.enums import ExecutionStatus, NodeExecutionStatus
from browserflow.execution_contracts.plan import CompiledFlowExecutionPlan
from browserflow.infrastructure.config import Settings, get_settings
from browserflow.infrastructure.db.models import Execution, FlowVersion, NodeExecution
from browserflow.infrastructure.db.session import session_scope
from browserflow.infrastructure.logging import get_logger
from browserflow.node_sdk.context import CancellationToken

logger = get_logger(__name__)


class BrowserWorker:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.engine = FlowEngine()
        self._stop = asyncio.Event()
        self.worker_id: UUID | None = None

    def request_stop(self) -> None:
        self._stop.set()

    async def run_forever(self) -> None:
        async with session_scope() as session:
            lease = LeaseService(session)
            worker = await lease.register_worker(
                hostname=socket.gethostname(),
                pid=os.getpid(),
                playwright_version="1.50.0",
                chromium_version="chromium",
            )
            self.worker_id = worker.id
        logger.info("worker_ready", worker_id=str(self.worker_id))
        while not self._stop.is_set():
            try:
                await self._tick()
            except Exception:
                logger.warning("worker_tick_failed", error_code="BF-WORKER")
            try:
                await asyncio.wait_for(
                    self._stop.wait(), timeout=self.settings.worker_poll_interval_seconds
                )
            except TimeoutError:
                continue

    async def _tick(self) -> None:
        assert self.worker_id is not None
        async with session_scope() as session:
            lease = LeaseService(session)
            await lease.heartbeat(self.worker_id)
            recovered = await lease.recover_expired()
            if recovered:
                logger.info("leases_recovered", count=recovered)
            claimed = await lease.claim(self.worker_id)
            if claimed is None:
                return
            execution, attempt, token = claimed
            execution_id = execution.id
            attempt_id = attempt.id
            expected_version = execution.version
        await self._execute(execution_id, attempt_id, token, expected_version)

    async def _execute(
        self, execution_id: UUID, attempt_id: UUID, token: str, expected_version: int
    ) -> None:
        assert self.worker_id is not None
        browser = None
        cancellation = CancellationToken()
        try:
            async with session_scope() as session:
                lease = LeaseService(session)
                execution = await lease.guarded_update(
                    execution_id=execution_id,
                    attempt_id=attempt_id,
                    worker_id=self.worker_id,
                    lease_token=token,
                    expected_version=expected_version,
                    status=ExecutionStatus.STARTING.value,
                    started_at=utcnow(),
                )
                expected_version = execution.version
                version = await session.get(FlowVersion, execution.flow_version_id)
                assert version is not None
                plan = CompiledFlowExecutionPlan.model_validate(version.compiled_plan)
                await lease.guarded_update(
                    execution_id=execution_id,
                    attempt_id=attempt_id,
                    worker_id=self.worker_id,
                    lease_token=token,
                    expected_version=expected_version,
                    status=ExecutionStatus.RUNNING.value,
                )
                expected_version = execution.version
                flow_id = execution.flow_id
                flow_version_id = execution.flow_version_id
                needs_browser = plan.resource_estimate.requires_browser

            if needs_browser:
                from browserflow.infrastructure.browser.session import BrowserSession

                browser = BrowserSession(execution_id=execution_id)
                await browser.start()

            async def sink(kind: str, **payload: object) -> None:
                async with session_scope() as session:
                    if kind == "node_started":
                        session.add(
                            NodeExecution(
                                execution_id=execution_id,
                                attempt_id=attempt_id,
                                node_id=str(payload["node_id"]),
                                node_type=str(payload.get("node_type") or ""),
                                status=NodeExecutionStatus.RUNNING.value,
                                started_at=utcnow(),
                            )
                        )
                    elif kind == "node_finished":
                        from sqlalchemy import select

                        row = await session.scalar(
                            select(NodeExecution).where(
                                NodeExecution.execution_id == execution_id,
                                NodeExecution.attempt_id == attempt_id,
                                NodeExecution.node_id == str(payload["node_id"]),
                            )
                        )
                        if row is not None:
                            ok = bool(payload.get("ok"))
                            row.status = (
                                NodeExecutionStatus.SUCCEEDED.value
                                if ok
                                else NodeExecutionStatus.FAILED.value
                            )
                            row.output_json = payload.get("outputs")  # type: ignore[assignment]
                            row.error_code = payload.get("error_code")  # type: ignore[assignment]
                            row.error_message = payload.get("error_message")  # type: ignore[assignment]
                            row.finished_at = utcnow()
                    await append_event(
                        session,
                        execution_id=execution_id,
                        flow_id=flow_id,
                        flow_version_id=flow_version_id,
                        attempt_id=attempt_id,
                        type=kind,
                        payload=dict(payload),
                    )

            outcome = await self.engine.execute(
                plan,
                execution_id=execution_id,
                attempt_id=attempt_id,
                flow_version_id=flow_version_id,
                cancellation=cancellation,
                browser_session=browser,
                sink=sink,
            )
            terminal = {
                "SUCCEEDED": ExecutionStatus.SUCCEEDED,
                "FAILED": ExecutionStatus.FAILED,
                "CANCELLED": ExecutionStatus.CANCELLED,
                "TIMED_OUT": ExecutionStatus.TIMED_OUT,
            }[outcome.status]
            async with session_scope() as session:
                lease = LeaseService(session)
                execution = await session.get(Execution, execution_id)
                assert execution is not None
                try:
                    await lease.guarded_update(
                        execution_id=execution_id,
                        attempt_id=attempt_id,
                        worker_id=self.worker_id,
                        lease_token=token,
                        expected_version=execution.version,
                        status=terminal.value,
                        finished_at=utcnow(),
                        error_code=outcome.error_code,
                        error_message=outcome.error_message,
                        return_value=outcome.return_value,
                        playwright_version=browser.playwright_version if browser else None,
                        chromium_version=browser.chromium_version if browser else None,
                    )
                except Exception:
                    logger.warning("stale_worker_ignored", execution_id=str(execution_id))
                from browserflow.infrastructure.db.models import ExecutionLease

                row = await session.get(ExecutionLease, execution_id)
                if row is not None:
                    await session.delete(row)
        finally:
            if browser is not None:
                await browser.close()
