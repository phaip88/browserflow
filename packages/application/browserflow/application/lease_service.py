from __future__ import annotations

import secrets
from datetime import timedelta
from uuid import UUID

from browserflow.domain.enums import ExecutionStatus, WorkerStatus
from browserflow.domain.errors import LeaseError
from browserflow.domain.state_machine import ExecutionStateMachine
from browserflow.infrastructure.config import get_settings
from browserflow.infrastructure.db.models import Execution, ExecutionAttempt, ExecutionLease, Worker
from browserflow.infrastructure.logging import get_logger
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

logger = get_logger(__name__)


class LeaseService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.settings = get_settings()

    async def register_worker(
        self,
        *,
        hostname: str,
        pid: int,
        playwright_version: str | None,
        chromium_version: str | None,
    ) -> Worker:
        worker = Worker(
            hostname=hostname,
            pid=pid,
            status=WorkerStatus.READY.value,
            capacity=self.settings.worker_capacity,
            playwright_version=playwright_version,
            chromium_version=chromium_version,
            last_heartbeat_at=await self._db_now(),
        )
        self.session.add(worker)
        await self.session.flush()
        return worker

    async def heartbeat(self, worker_id: UUID) -> None:
        now = await self._db_now()
        await self.session.execute(
            update(Worker)
            .where(Worker.id == worker_id)
            .values(last_heartbeat_at=now, status=WorkerStatus.READY.value)
        )

    async def claim(self, worker_id: UUID) -> tuple[Execution, ExecutionAttempt, str] | None:
        now = await self._db_now()
        stmt = (
            select(Execution)
            .where(Execution.status == ExecutionStatus.QUEUED.value)
            .order_by(Execution.created_at.asc())
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        execution = await self.session.scalar(stmt)
        if execution is None:
            return None
        ExecutionStateMachine.assert_transition(
            ExecutionStatus(execution.status), ExecutionStatus.LEASED
        )
        token = secrets.token_hex(16)
        attempt_number = 1
        last = await self.session.scalar(
            select(func.max(ExecutionAttempt.attempt_number)).where(
                ExecutionAttempt.execution_id == execution.id
            )
        )
        if last:
            attempt_number = int(last) + 1
        attempt = ExecutionAttempt(
            execution_id=execution.id,
            attempt_number=attempt_number,
            worker_id=worker_id,
            lease_token=token,
            status="LEASED",
            started_at=now,
        )
        self.session.add(attempt)
        await self.session.flush()
        execution.status = ExecutionStatus.LEASED.value
        execution.current_attempt_id = attempt.id
        execution.actor = "worker"
        lease = ExecutionLease(
            execution_id=execution.id,
            attempt_id=attempt.id,
            worker_id=worker_id,
            lease_token=token,
            acquired_at=now,
            expires_at=now + timedelta(seconds=self.settings.lease_ttl_seconds),
            heartbeat_at=now,
        )
        self.session.add(lease)
        await self.session.flush()
        logger.info(
            "lease_acquired",
            execution_id=str(execution.id),
            attempt_id=str(attempt.id),
            worker_id=str(worker_id),
        )
        return execution, attempt, token

    async def renew(
        self, *, execution_id: UUID, attempt_id: UUID, worker_id: UUID, lease_token: str
    ) -> bool:
        now = await self._db_now()
        result = await self.session.execute(
            update(ExecutionLease)
            .where(
                ExecutionLease.execution_id == execution_id,
                ExecutionLease.attempt_id == attempt_id,
                ExecutionLease.worker_id == worker_id,
                ExecutionLease.lease_token == lease_token,
                ExecutionLease.expires_at > now,
            )
            .values(
                heartbeat_at=now,
                expires_at=now + timedelta(seconds=self.settings.lease_ttl_seconds),
            )
        )
        return result.rowcount == 1  # type: ignore[no-any-return]

    async def guarded_update(
        self,
        *,
        execution_id: UUID,
        attempt_id: UUID,
        worker_id: UUID,
        lease_token: str,
        expected_version: int,
        **values: object,
    ) -> Execution:
        """Old workers cannot overwrite a new attempt or a completed execution."""
        now = await self._db_now()
        lease = await self.session.scalar(
            select(ExecutionLease).where(ExecutionLease.execution_id == execution_id)
        )
        if (
            lease is None
            or lease.attempt_id != attempt_id
            or lease.worker_id != worker_id
            or lease.lease_token != lease_token
            or lease.expires_at <= now
        ):
            raise LeaseError("lease is not valid for this worker/attempt")
        execution = await self.session.scalar(
            select(Execution).where(Execution.id == execution_id).with_for_update()
        )
        if execution is None:
            raise LeaseError("execution missing")
        if execution.current_attempt_id != attempt_id:
            raise LeaseError("stale worker cannot update a different attempt")
        if execution.version != expected_version:
            raise LeaseError("execution version conflict")
        if ExecutionStateMachine.is_terminal(ExecutionStatus(execution.status)):
            raise LeaseError("execution already terminal")
        for key, value in values.items():
            setattr(execution, key, value)
        await self.session.flush()
        return execution

    async def recover_expired(self) -> int:
        now = await self._db_now()
        expired = (
            await self.session.scalars(
                select(ExecutionLease).where(ExecutionLease.expires_at <= now)
            )
        ).all()
        count = 0
        for lease in expired:
            execution = await self.session.get(Execution, lease.execution_id)
            if execution is None:
                await self.session.delete(lease)
                continue
            status = ExecutionStatus(execution.status)
            if ExecutionStateMachine.is_terminal(status):
                await self.session.delete(lease)
                continue
            if execution.current_attempt_id != lease.attempt_id:
                await self.session.delete(lease)
                continue
            ExecutionStateMachine.assert_transition(status, ExecutionStatus.WORKER_LOST)
            execution.status = ExecutionStatus.WORKER_LOST.value
            execution.status_reason = "lease expired"
            execution.actor = "system"
            # requeue
            ExecutionStateMachine.assert_transition(
                ExecutionStatus.WORKER_LOST, ExecutionStatus.QUEUED
            )
            execution.status = ExecutionStatus.QUEUED.value
            execution.current_attempt_id = None
            await self.session.delete(lease)
            count += 1
        await self.session.flush()
        return count

    async def _db_now(self):
        value = await self.session.scalar(select(func.now()))
        return value
