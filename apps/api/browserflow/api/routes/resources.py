from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from browserflow.api.deps import get_current_user, get_db, settings_dep
from browserflow.domain.clock import utcnow
from browserflow.domain.enums import AuditAction
from browserflow.infrastructure.config import Settings
from browserflow.infrastructure.crypto import SecretBox
from browserflow.infrastructure.db.models import (
    AuditEvent,
    Credential,
    Identity,
    Schedule,
    User,
    Worker,
)
from browserflow.infrastructure.templates import builtin_templates
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(tags=["resources"])


class CredentialIn(BaseModel):
    name: str
    kind: str
    payload: dict[str, Any]


class IdentityIn(BaseModel):
    name: str


class ScheduleIn(BaseModel):
    flow_id: UUID
    name: str
    kind: str = "cron"
    cron_expr: str | None = None
    timezone: str = "UTC"
    misfire_policy: str = "SKIP"
    overlap_policy: str = "SKIP"
    enabled: bool = True


@router.get("/credentials")
async def list_credentials(
    session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> list[dict[str, str]]:
    rows = (await session.scalars(select(Credential).order_by(Credential.name))).all()
    return [{"id": str(r.id), "name": r.name, "kind": r.kind} for r in rows]


@router.post("/credentials")
async def create_credential(
    body: CredentialIn,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(settings_dep),
) -> dict[str, str]:
    box = SecretBox(settings.master_key())
    nonce, ciphertext = box.encrypt(body.payload)
    row = Credential(name=body.name, kind=body.kind, nonce=nonce, ciphertext=ciphertext)
    session.add(row)
    session.add(
        AuditEvent(
            actor=user.email,
            action=AuditAction.CREDENTIAL_CREATE.value,
            target_type="credential",
            target_id=str(row.id),
        )
    )
    await session.flush()
    return {"id": str(row.id), "name": row.name}


@router.delete("/credentials/{credential_id}")
async def delete_credential(
    credential_id: UUID,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    row = await session.get(Credential, credential_id)
    if row is None:
        raise HTTPException(404, "not found")
    await session.delete(row)
    return {"status": "ok"}


@router.get("/identities")
async def list_identities(
    session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> list[dict[str, str]]:
    rows = (await session.scalars(select(Identity).order_by(Identity.name))).all()
    return [{"id": str(r.id), "name": r.name, "profile_dir": r.profile_dir} for r in rows]


@router.post("/identities")
async def create_identity(
    body: IdentityIn,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(settings_dep),
) -> dict[str, str]:
    ident_id = uuid4()
    profile_dir = f"data/identities/{ident_id}"
    from pathlib import Path

    Path(settings.data_dir, "identities", str(ident_id), "profile").mkdir(
        parents=True, exist_ok=True
    )
    row = Identity(id=ident_id, name=body.name, profile_dir=profile_dir)
    session.add(row)
    session.add(
        AuditEvent(
            actor=user.email,
            action=AuditAction.IDENTITY_CREATE.value,
            target_type="identity",
            target_id=str(ident_id),
        )
    )
    await session.flush()
    return {"id": str(row.id), "name": row.name}


@router.get("/schedules")
async def list_schedules(
    session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> list[dict[str, Any]]:
    rows = (await session.scalars(select(Schedule).order_by(Schedule.name))).all()
    return [
        {
            "id": str(r.id),
            "name": r.name,
            "flow_id": str(r.flow_id),
            "kind": r.kind,
            "cron_expr": r.cron_expr,
            "enabled": r.enabled,
            "next_run_at": r.next_run_at.isoformat() if r.next_run_at else None,
        }
        for r in rows
    ]


@router.post("/schedules")
async def create_schedule(
    body: ScheduleIn,
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    from datetime import datetime, timezone

    from croniter import croniter

    next_run = None
    if body.kind == "cron" and body.cron_expr:
        next_run = croniter(body.cron_expr, datetime.now(timezone.utc)).get_next(datetime)
    row = Schedule(
        flow_id=body.flow_id,
        name=body.name,
        kind=body.kind,
        cron_expr=body.cron_expr,
        timezone=body.timezone,
        misfire_policy=body.misfire_policy,
        overlap_policy=body.overlap_policy,
        enabled=body.enabled,
        next_run_at=next_run,
    )
    session.add(row)
    session.add(
        AuditEvent(
            actor=user.email,
            action=AuditAction.SCHEDULE_CREATE.value,
            target_type="schedule",
            target_id=str(row.id),
        )
    )
    await session.flush()
    return {"id": str(row.id)}


@router.get("/templates")
async def templates(user: User = Depends(get_current_user)) -> list[dict[str, Any]]:
    return builtin_templates()


@router.get("/settings")
async def get_settings_api(
    session: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(settings_dep),
) -> dict[str, Any]:
    return {
        "locale": user.locale,
        "max_browser_concurrency": settings.max_browser_concurrency,
        "ai_provider": settings.ai_provider,
        "env": settings.env,
    }


@router.get("/system/status")
async def system_status(
    session: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> dict[str, Any]:
    workers = (await session.scalars(select(Worker))).all()
    return {
        "workers": [
            {
                "id": str(w.id),
                "hostname": w.hostname,
                "status": w.status,
                "last_heartbeat_at": w.last_heartbeat_at.isoformat(),
                "playwright_version": w.playwright_version,
                "chromium_version": w.chromium_version,
            }
            for w in workers
        ],
        "time": utcnow().isoformat(),
    }
