from __future__ import annotations

from typing import Any
from uuid import UUID

from browserflow.api.deps import get_current_user, get_db
from browserflow.application.flow_service import FlowService
from browserflow.domain.errors import BrowserFlowError, NotFoundError
from browserflow.infrastructure.db.models import FlowDraft, User
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/flows", tags=["flows"])


class FlowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""


class DraftBody(BaseModel):
    definition: dict[str, Any]


def _svc(session: AsyncSession) -> FlowService:
    return FlowService(session)


@router.get("")
async def list_flows(
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    flows = await _svc(session).list_flows()
    return [
        {
            "id": str(f.id),
            "name": f.name,
            "description": f.description,
            "status": f.status,
            "updated_at": f.updated_at.isoformat(),
        }
        for f in flows
    ]


@router.post("")
async def create_flow(
    body: FlowCreate,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    flow = await _svc(session).create(
        name=body.name, description=body.description, actor=user.email
    )
    return {"id": str(flow.id), "name": flow.name}


@router.get("/{flow_id}")
async def get_flow(
    flow_id: UUID,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        flow = await _svc(session).get(flow_id)
    except NotFoundError as exc:
        raise HTTPException(404, exc.safe_message) from exc
    draft = await session.get(FlowDraft, flow_id)
    return {
        "id": str(flow.id),
        "name": flow.name,
        "description": flow.description,
        "status": flow.status,
        "draft": draft.definition if draft else None,
        "draft_checksum": draft.checksum if draft else None,
    }


@router.put("/{flow_id}/draft")
async def save_draft(
    flow_id: UUID,
    body: DraftBody,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    draft = await _svc(session).save_draft(flow_id, body.definition, actor=user.email)
    return {"checksum": draft.checksum}


@router.post("/{flow_id}/compile")
async def compile_flow(
    flow_id: UUID,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    plan = await _svc(session).compile_draft(flow_id)
    return plan.model_dump(mode="json")


@router.post("/{flow_id}/publish")
async def publish_flow(
    flow_id: UUID,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        version = await _svc(session).publish(flow_id, actor=user.email, actor_id=user.id)
    except BrowserFlowError as exc:
        raise HTTPException(400, exc.to_dict()) from exc
    return {
        "id": str(version.id),
        "version_number": version.version_number,
        "checksum": version.checksum,
    }


@router.post("/{flow_id}/run")
async def run_flow(
    flow_id: UUID,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    try:
        execution = await _svc(session).start_execution(flow_id, actor=user.email)
    except NotFoundError as exc:
        raise HTTPException(404, exc.safe_message) from exc
    return {"execution_id": str(execution.id), "status": execution.status}


@router.post("/{flow_id}/duplicate")
async def duplicate_flow(
    flow_id: UUID,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    flow = await _svc(session).duplicate(flow_id, actor=user.email)
    return {"id": str(flow.id), "name": flow.name}


@router.post("/{flow_id}/archive")
async def archive_flow(
    flow_id: UUID,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    flow = await _svc(session).archive(flow_id, actor=user.email)
    return {"id": str(flow.id), "status": flow.status}


@router.delete("/{flow_id}")
async def delete_flow(
    flow_id: UUID,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    await _svc(session).delete(flow_id, actor=user.email)
    return {"status": "ok"}
