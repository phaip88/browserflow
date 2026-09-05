from __future__ import annotations

from typing import Any
from uuid import UUID

from browserflow.api.deps import get_current_user, get_db
from browserflow.domain.clock import utcnow
from browserflow.domain.enums import AuditAction, ExecutionStatus
from browserflow.domain.state_machine import ExecutionStateMachine
from browserflow.infrastructure.db.models import (
    AuditEvent,
    Execution,
    ExecutionEvent,
    NodeExecution,
    User,
)
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/executions", tags=["executions"])


@router.get("")
async def list_executions(
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    rows = (
        await session.scalars(select(Execution).order_by(Execution.created_at.desc()).limit(200))
    ).all()
    return [
        {
            "id": str(r.id),
            "flow_id": str(r.flow_id),
            "status": r.status,
            "created_at": r.created_at.isoformat(),
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        }
        for r in rows
    ]


@router.get("/{execution_id}")
async def get_execution(
    execution_id: UUID,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = await session.get(Execution, execution_id)
    if row is None:
        raise HTTPException(404, "execution not found")
    nodes = (
        await session.scalars(
            select(NodeExecution).where(NodeExecution.execution_id == execution_id)
        )
    ).all()
    return {
        "id": str(row.id),
        "flow_id": str(row.flow_id),
        "flow_version_id": str(row.flow_version_id),
        "status": row.status,
        "error_code": row.error_code,
        "error_message": row.error_message,
        "playwright_version": row.playwright_version,
        "chromium_version": row.chromium_version,
        "created_at": row.created_at.isoformat(),
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
        "nodes": [
            {
                "node_id": n.node_id,
                "type": n.node_type,
                "status": n.status,
                "output": n.output_json,
                "error_code": n.error_code,
                "error_message": n.error_message,
            }
            for n in nodes
        ],
    }


@router.get("/{execution_id}/events")
async def list_events(
    execution_id: UUID,
    last_sequence: int = 0,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    rows = (
        await session.scalars(
            select(ExecutionEvent)
            .where(
                ExecutionEvent.execution_id == execution_id,
                ExecutionEvent.sequence > last_sequence,
            )
            .order_by(ExecutionEvent.sequence.asc())
        )
    ).all()
    return [
        {
            "eventId": str(e.id),
            "sequence": e.sequence,
            "type": e.type,
            "payload": e.payload,
            "timestamp": e.timestamp.isoformat(),
        }
        for e in rows
    ]


@router.post("/{execution_id}/cancel")
async def cancel_execution(
    execution_id: UUID,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    row = await session.get(Execution, execution_id)
    if row is None:
        raise HTTPException(404, "execution not found")
    status = ExecutionStatus(row.status)
    if ExecutionStateMachine.is_terminal(status):
        return {"status": row.status}
    if ExecutionStateMachine.can_transition(status, ExecutionStatus.CANCELLING):
        row.status = ExecutionStatus.CANCELLING.value
    row.cancel_requested_at = utcnow()
    session.add(
        AuditEvent(
            actor=user.email,
            action=AuditAction.EXECUTION_CANCEL.value,
            target_type="execution",
            target_id=str(row.id),
        )
    )
    await session.flush()
    return {"status": row.status}


@router.websocket("/{execution_id}/ws")
async def execution_ws(websocket: WebSocket, execution_id: UUID) -> None:
    await websocket.accept()
    last = 0
    try:
        msg = await websocket.receive_json()
        last = int(msg.get("lastSequence") or 0)
    except Exception:
        last = 0
    from browserflow.infrastructure.db.session import session_scope

    try:
        async with session_scope() as session:
            rows = (
                await session.scalars(
                    select(ExecutionEvent)
                    .where(
                        ExecutionEvent.execution_id == execution_id,
                        ExecutionEvent.sequence > last,
                    )
                    .order_by(ExecutionEvent.sequence.asc())
                )
            ).all()
            for e in rows:
                await websocket.send_json(
                    {
                        "eventId": str(e.id),
                        "sequence": e.sequence,
                        "type": e.type,
                        "payload": e.payload,
                    }
                )
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        return
