from __future__ import annotations

from uuid import uuid4

import pytest
from browserflow.application.engine import FlowEngine
from browserflow.flow_compiler.compiler import FlowCompiler
from browserflow.node_sdk.loading import load_release1_nodes
from browserflow.node_sdk.registry import NodeRegistry

pytestmark = pytest.mark.unit


def _reg() -> NodeRegistry:
    r = NodeRegistry()
    load_release1_nodes(r)
    return r


@pytest.mark.asyncio
async def test_engine_constant_flow() -> None:
    registry = _reg()
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
                    "config": {"value": 42},
                },
                {"id": "end", "type": "control.end", "version": "1", "position": {"x": 0, "y": 0}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "c", "kind": "SUCCESS"},
                {"id": "e2", "source": "c", "target": "end", "kind": "SUCCESS"},
            ],
        }
    )
    engine = FlowEngine(registry)
    outcome = await engine.execute(
        plan, execution_id=uuid4(), attempt_id=uuid4(), flow_version_id=uuid4()
    )
    assert outcome.status == "SUCCEEDED"
    assert outcome.node_statuses["c"] == "SUCCEEDED"
    assert outcome.node_statuses["end"] == "SUCCEEDED"


@pytest.mark.asyncio
async def test_if_skips_false_branch() -> None:
    registry = _reg()
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
                    "id": "iff",
                    "type": "control.if",
                    "version": "1",
                    "position": {"x": 0, "y": 0},
                    "config": {"left": 1, "op": "eq", "right": 1},
                },
                {
                    "id": "yes",
                    "type": "data.constant",
                    "version": "1",
                    "position": {"x": 0, "y": 0},
                    "config": {"value": "yes"},
                },
                {
                    "id": "no",
                    "type": "data.constant",
                    "version": "1",
                    "position": {"x": 0, "y": 0},
                    "config": {"value": "no"},
                },
                {"id": "end", "type": "control.end", "version": "1", "position": {"x": 0, "y": 0}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "iff", "kind": "SUCCESS"},
                {"id": "e2", "source": "iff", "target": "yes", "kind": "TRUE"},
                {"id": "e3", "source": "iff", "target": "no", "kind": "FALSE"},
                {"id": "e4", "source": "yes", "target": "end", "kind": "SUCCESS"},
                {"id": "e5", "source": "no", "target": "end", "kind": "SUCCESS"},
            ],
        }
    )
    outcome = await FlowEngine(registry).execute(
        plan, execution_id=uuid4(), attempt_id=uuid4(), flow_version_id=uuid4()
    )
    assert outcome.status == "SUCCEEDED"
    assert outcome.node_statuses["yes"] == "SUCCEEDED"
    assert outcome.node_statuses["no"] == "SKIPPED"


@pytest.mark.asyncio
async def test_foreach_and_return() -> None:
    registry = _reg()
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
                    "id": "loop",
                    "type": "control.foreach",
                    "version": "1",
                    "position": {"x": 0, "y": 0},
                    "config": {"items": [1, 2, 3]},
                },
                {
                    "id": "body",
                    "type": "data.constant",
                    "version": "1",
                    "position": {"x": 0, "y": 0},
                    "config": {"value": "x"},
                },
                {"id": "end", "type": "control.end", "version": "1", "position": {"x": 0, "y": 0}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "loop", "kind": "SUCCESS"},
                {"id": "e2", "source": "loop", "target": "body", "kind": "LOOP_BODY"},
                {"id": "e3", "source": "loop", "target": "end", "kind": "LOOP_DONE"},
            ],
        }
    )
    outcome = await FlowEngine(registry).execute(
        plan, execution_id=uuid4(), attempt_id=uuid4(), flow_version_id=uuid4()
    )
    assert outcome.status == "SUCCEEDED"
    assert outcome.node_statuses["body"] == "SUCCEEDED"
