from __future__ import annotations

from uuid import uuid4

import pytest
from browserflow.application.engine import FlowEngine
from browserflow.flow_compiler.compiler import FlowCompiler
from browserflow.node_sdk.loading import load_release1_nodes
from browserflow.node_sdk.registry import NodeRegistry

pytestmark = pytest.mark.e2e


@pytest.mark.asyncio
async def test_template_and_compare_flow() -> None:
    registry = NodeRegistry()
    load_release1_nodes(registry)
    plan = FlowCompiler(registry).compile(
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
                    "id": "set",
                    "type": "data.setVariable",
                    "version": "1",
                    "position": {"x": 0, "y": 0},
                    "config": {"name": "city", "value": "Ashburn"},
                },
                {
                    "id": "tpl",
                    "type": "data.template",
                    "version": "1",
                    "position": {"x": 0, "y": 0},
                    "config": {"template": "hello {{city}}"},
                },
                {"id": "end", "type": "control.end", "version": "1", "position": {"x": 0, "y": 0}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "set", "kind": "SUCCESS"},
                {"id": "e2", "source": "set", "target": "tpl", "kind": "SUCCESS"},
                {"id": "e3", "source": "tpl", "target": "end", "kind": "SUCCESS"},
            ],
        }
    )
    outcome = await FlowEngine(registry).execute(
        plan, execution_id=uuid4(), attempt_id=uuid4(), flow_version_id=uuid4()
    )
    assert outcome.status == "SUCCEEDED"
