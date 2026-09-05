from __future__ import annotations

from uuid import uuid4

import pytest
from browserflow.application.engine import FlowEngine
from browserflow.flow_compiler.compiler import FlowCompiler
from browserflow.node_sdk.loading import load_release1_nodes
from browserflow.node_sdk.registry import NodeRegistry

pytestmark = pytest.mark.stability


def _plan():
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
                    "id": "c",
                    "type": "data.constant",
                    "version": "1",
                    "position": {"x": 0, "y": 0},
                    "config": {"value": 1},
                },
                {"id": "end", "type": "control.end", "version": "1", "position": {"x": 0, "y": 0}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "c", "kind": "SUCCESS"},
                {"id": "e2", "source": "c", "target": "end", "kind": "SUCCESS"},
            ],
        }
    )
    return registry, plan


@pytest.mark.asyncio
async def test_one_hundred_short_runs() -> None:
    registry, plan = _plan()
    engine = FlowEngine(registry)
    for _ in range(100):
        outcome = await engine.execute(
            plan, execution_id=uuid4(), attempt_id=uuid4(), flow_version_id=uuid4()
        )
        assert outcome.status == "SUCCEEDED"
