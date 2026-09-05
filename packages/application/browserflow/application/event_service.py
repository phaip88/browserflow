from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from browserflow.domain.clock import utcnow
from browserflow.infrastructure.db.models import EventSequence, ExecutionEvent, OutboxEvent
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def append_event(
    session: AsyncSession,
    *,
    execution_id: UUID,
    flow_id: UUID,
    flow_version_id: UUID,
    attempt_id: UUID | None,
    type: str,
    payload: dict[str, Any],
    trace_id: str = "",
) -> ExecutionEvent:
    seq_row = await session.scalar(
        select(EventSequence).where(EventSequence.execution_id == execution_id).with_for_update()
    )
    if seq_row is None:
        seq_row = EventSequence(execution_id=execution_id, next_sequence=1)
        session.add(seq_row)
        await session.flush()
    sequence = seq_row.next_sequence
    seq_row.next_sequence = sequence + 1
    event = ExecutionEvent(
        id=uuid4(),
        execution_id=execution_id,
        attempt_id=attempt_id,
        flow_id=flow_id,
        flow_version_id=flow_version_id,
        sequence=sequence,
        type=type,
        payload=payload,
        trace_id=trace_id,
        timestamp=utcnow(),
    )
    session.add(event)
    session.add(
        OutboxEvent(
            event_id=event.id,
            topic="execution.events",
            payload={
                "schemaVersion": 1,
                "eventId": str(event.id),
                "sequence": sequence,
                "timestamp": event.timestamp.isoformat(),
                "executionId": str(execution_id),
                "flowId": str(flow_id),
                "flowVersionId": str(flow_version_id),
                "attemptId": str(attempt_id) if attempt_id else None,
                "traceId": trace_id,
                "type": type,
                "payload": payload,
            },
        )
    )
    await session.flush()
    return event
