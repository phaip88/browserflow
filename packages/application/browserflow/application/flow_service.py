from __future__ import annotations

import copy
import hashlib
import json
from uuid import UUID, uuid4

from browserflow.application.event_service import append_event
from browserflow.domain.clock import utcnow
from browserflow.domain.enums import AuditAction, ExecutionStatus, FlowStatus
from browserflow.domain.errors import BrowserFlowError, ConflictError, ErrorCode, NotFoundError
from browserflow.flow_compiler.compiler import FlowCompiler, has_errors
from browserflow.flow_schema import NODE_REGISTRY_VERSION, FlowDefinition
from browserflow.infrastructure.db.models import (
    AuditEvent,
    Execution,
    Flow,
    FlowDraft,
    FlowVersion,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _checksum(payload: dict) -> str:
    blob = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()


class FlowService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.compiler = FlowCompiler()

    async def create(self, *, name: str, description: str = "", actor: str) -> Flow:
        empty = FlowDefinition(nodes=[], edges=[]).model_dump(mode="json")
        flow = Flow(name=name, description=description, status=FlowStatus.ACTIVE.value)
        self.session.add(flow)
        await self.session.flush()
        draft = FlowDraft(
            flow_id=flow.id,
            definition=empty,
            schema_version=1,
            checksum=_checksum(empty),
        )
        self.session.add(draft)
        self.session.add(
            AuditEvent(
                actor=actor,
                action=AuditAction.FLOW_CREATE.value,
                target_type="flow",
                target_id=str(flow.id),
            )
        )
        await self.session.flush()
        return flow

    async def get(self, flow_id: UUID) -> Flow:
        flow = await self.session.get(Flow, flow_id)
        if flow is None:
            raise NotFoundError("flow not found")
        return flow

    async def list_flows(self) -> list[Flow]:
        result = await self.session.scalars(select(Flow).order_by(Flow.updated_at.desc()))
        return list(result)

    async def save_draft(self, flow_id: UUID, definition: dict, *, actor: str) -> FlowDraft:
        flow = await self.get(flow_id)
        if flow.status == FlowStatus.ARCHIVED.value:
            raise ConflictError("archived flow cannot be edited")
        parsed = FlowDefinition.model_validate(definition)
        payload = parsed.model_dump(mode="json")
        draft = await self.session.get(FlowDraft, flow_id)
        if draft is None:
            draft = FlowDraft(flow_id=flow_id, definition=payload, schema_version=1)
            self.session.add(draft)
        else:
            draft.definition = payload
        draft.checksum = _checksum(payload)
        flow.updated_at = utcnow()
        await self.session.flush()
        return draft

    async def compile_draft(self, flow_id: UUID):
        draft = await self.session.get(FlowDraft, flow_id)
        if draft is None:
            raise NotFoundError("draft not found")
        return self.compiler.compile(draft.definition)

    async def publish(self, flow_id: UUID, *, actor: str, actor_id: UUID | None) -> FlowVersion:
        plan = await self.compile_draft(flow_id)
        if has_errors(plan):
            raise BrowserFlowError(ErrorCode.COMPILER, "cannot publish flow with compiler errors")
        draft = await self.session.get(FlowDraft, flow_id)
        assert draft is not None
        last = await self.session.scalar(
            select(FlowVersion.version_number)
            .where(FlowVersion.flow_id == flow_id)
            .order_by(FlowVersion.version_number.desc())
            .limit(1)
        )
        number = int(last or 0) + 1
        version = FlowVersion(
            flow_id=flow_id,
            version_number=number,
            definition=copy.deepcopy(draft.definition),
            compiled_plan=plan.model_dump(mode="json"),
            checksum=_checksum(draft.definition),
            compiled_plan_checksum=plan.checksum,
            node_registry_version=NODE_REGISTRY_VERSION,
            published_by=actor_id,
        )
        self.session.add(version)
        self.session.add(
            AuditEvent(
                actor=actor,
                action=AuditAction.FLOW_PUBLISH.value,
                target_type="flow_version",
                target_id=str(version.id),
            )
        )
        await self.session.flush()
        return version

    async def duplicate(self, flow_id: UUID, *, actor: str) -> Flow:
        src = await self.get(flow_id)
        draft = await self.session.get(FlowDraft, flow_id)
        flow = await self.create(name=f"{src.name} copy", description=src.description, actor=actor)
        if draft is not None:
            await self.save_draft(flow.id, draft.definition, actor=actor)
        return flow

    async def archive(self, flow_id: UUID, *, actor: str) -> Flow:
        flow = await self.get(flow_id)
        flow.status = FlowStatus.ARCHIVED.value
        flow.archived_at = utcnow()
        self.session.add(
            AuditEvent(
                actor=actor,
                action=AuditAction.FLOW_ARCHIVE.value,
                target_type="flow",
                target_id=str(flow.id),
            )
        )
        await self.session.flush()
        return flow

    async def delete(self, flow_id: UUID, *, actor: str) -> None:
        flow = await self.get(flow_id)
        await self.session.delete(flow)
        self.session.add(
            AuditEvent(
                actor=actor,
                action=AuditAction.FLOW_DELETE.value,
                target_type="flow",
                target_id=str(flow_id),
            )
        )
        await self.session.flush()

    async def start_execution(
        self,
        flow_id: UUID,
        *,
        actor: str,
        trigger: str = "manual",
        schedule_id: UUID | None = None,
    ) -> Execution:
        version = await self.session.scalar(
            select(FlowVersion)
            .where(FlowVersion.flow_id == flow_id)
            .order_by(FlowVersion.version_number.desc())
            .limit(1)
        )
        if version is None:
            raise NotFoundError("no published version")
        plan = version.compiled_plan
        execution = Execution(
            flow_id=flow_id,
            flow_version_id=version.id,
            flow_checksum=version.checksum,
            compiled_plan_checksum=version.compiled_plan_checksum,
            node_registry_version=version.node_registry_version,
            status=ExecutionStatus.CREATED.value,
            actor=actor,
            trigger=trigger,
            schedule_id=schedule_id,
            config_snapshot={"identity_ref": plan.get("identity_ref")},
            trace_id=uuid4().hex,
        )
        self.session.add(execution)
        await self.session.flush()
        execution.status = ExecutionStatus.VALIDATING.value
        execution.status = ExecutionStatus.QUEUED.value
        await append_event(
            self.session,
            execution_id=execution.id,
            flow_id=flow_id,
            flow_version_id=version.id,
            attempt_id=None,
            type="execution.queued",
            payload={"trigger": trigger},
            trace_id=execution.trace_id,
        )
        self.session.add(
            AuditEvent(
                actor=actor,
                action=AuditAction.EXECUTION_START.value,
                target_type="execution",
                target_id=str(execution.id),
            )
        )
        await self.session.flush()
        return execution
