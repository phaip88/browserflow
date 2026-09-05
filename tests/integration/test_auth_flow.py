from __future__ import annotations

import pytest
from browserflow.application.auth_service import AuthService
from browserflow.application.flow_service import FlowService
from browserflow.domain.errors import AuthError, ConflictError

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_admin_init_login_and_flow(db_session) -> None:
    auth = AuthService(db_session, session_ttl_seconds=3600)
    user = await auth.create_initial_admin(
        email="admin@example.com", password="correct-horse-battery"
    )
    with pytest.raises(ConflictError):
        await auth.create_initial_admin(email="other@example.com", password="correct-horse-battery")
    issued = await auth.authenticate(
        email="admin@example.com",
        password="correct-horse-battery",
        ip="127.0.0.1",
        user_agent="test",
    )
    assert issued.user.id == user.id
    with pytest.raises(AuthError):
        await auth.authenticate(
            email="admin@example.com", password="nope-nope-nope", ip="127.0.0.1", user_agent="t"
        )

    flows = FlowService(db_session)
    flow = await flows.create(name="Demo", actor=user.email)
    await flows.save_draft(
        flow.id,
        {
            "schema_version": 1,
            "nodes": [
                {
                    "id": "start",
                    "type": "control.start",
                    "version": "1",
                    "position": {"x": 0, "y": 0},
                },
                {
                    "id": "c",
                    "type": "data.constant",
                    "version": "1",
                    "position": {"x": 0, "y": 0},
                    "config": {"value": "ok"},
                },
                {"id": "end", "type": "control.end", "version": "1", "position": {"x": 0, "y": 0}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "c", "kind": "SUCCESS"},
                {"id": "e2", "source": "c", "target": "end", "kind": "SUCCESS"},
            ],
        },
        actor=user.email,
    )
    version = await flows.publish(flow.id, actor=user.email, actor_id=user.id)
    assert version.version_number == 1
    execution = await flows.start_execution(flow.id, actor=user.email)
    assert execution.status == "QUEUED"
