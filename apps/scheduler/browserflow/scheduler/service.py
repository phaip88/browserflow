from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from browserflow.application.flow_service import FlowService
from browserflow.domain.clock import utcnow
from browserflow.domain.enums import ExecutionStatus
from browserflow.infrastructure.config import Settings, get_settings
from browserflow.infrastructure.db.models import Execution, Schedule, ScheduleFire
from browserflow.infrastructure.db.session import session_scope
from browserflow.infrastructure.logging import get_logger
from croniter import croniter
from sqlalchemy import select

logger = get_logger(__name__)


class SchedulerService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._stop = asyncio.Event()

    def request_stop(self) -> None:
        self._stop.set()

    async def run_forever(self) -> None:
        while not self._stop.is_set():
            try:
                await self.tick()
            except Exception:
                logger.warning("scheduler_tick_failed", error_code="BF-SCHEDULER")
            try:
                await asyncio.wait_for(
                    self._stop.wait(), timeout=self.settings.scheduler_poll_interval_seconds
                )
            except TimeoutError:
                continue

    async def tick(self) -> int:
        now = utcnow()
        fired = 0
        async with session_scope() as session:
            due = (
                await session.scalars(
                    select(Schedule).where(
                        Schedule.enabled.is_(True),
                        Schedule.next_run_at.is_not(None),
                        Schedule.next_run_at <= now,
                    )
                )
            ).all()
            for schedule in due:
                planned = schedule.next_run_at
                assert planned is not None
                existing = await session.scalar(
                    select(ScheduleFire).where(
                        ScheduleFire.schedule_id == schedule.id,
                        ScheduleFire.planned_fire_time == planned,
                    )
                )
                if existing is not None:
                    self._advance(schedule, planned)
                    continue
                if schedule.overlap_policy == "SKIP":
                    running = await session.scalar(
                        select(Execution.id).where(
                            Execution.schedule_id == schedule.id,
                            Execution.status.in_(
                                [
                                    ExecutionStatus.QUEUED.value,
                                    ExecutionStatus.LEASED.value,
                                    ExecutionStatus.RUNNING.value,
                                    ExecutionStatus.STARTING.value,
                                ]
                            ),
                        )
                    )
                    if running is not None:
                        fire = ScheduleFire(
                            schedule_id=schedule.id,
                            planned_fire_time=planned,
                            status="skipped_overlap",
                        )
                        session.add(fire)
                        self._advance(schedule, planned)
                        continue
                svc = FlowService(session)
                execution = await svc.start_execution(
                    schedule.flow_id,
                    actor="scheduler",
                    trigger="schedule",
                    schedule_id=schedule.id,
                )
                session.add(
                    ScheduleFire(
                        schedule_id=schedule.id,
                        planned_fire_time=planned,
                        execution_id=execution.id,
                        status="fired",
                    )
                )
                schedule.last_run_at = now
                self._advance(schedule, planned)
                fired += 1
        return fired

    def _advance(self, schedule: Schedule, last_planned: datetime) -> None:
        if schedule.kind == "once":
            schedule.enabled = False
            schedule.next_run_at = None
            return
        if schedule.cron_expr:
            itr = croniter(schedule.cron_expr, last_planned)
            schedule.next_run_at = itr.get_next(datetime)
            if schedule.next_run_at.tzinfo is None:
                schedule.next_run_at = schedule.next_run_at.replace(tzinfo=timezone.utc)
