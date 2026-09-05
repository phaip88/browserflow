from __future__ import annotations

import pytest
from browserflow.flow_compiler.compiler import FlowCompiler, has_errors
from browserflow.node_sdk.loading import load_release1_nodes
from browserflow.node_sdk.registry import NodeRegistry

pytestmark = pytest.mark.unit


def _registry() -> NodeRegistry:
    reg = NodeRegistry()
    load_release1_nodes(reg)
    return reg


def _flow(*extra_nodes: dict, edges: list[dict] | None = None) -> dict:
    nodes = [
        {"id": "start", "type": "control.start", "version": "1", "position": {"x": 0, "y": 0}},
        *extra_nodes,
        {"id": "end", "type": "control.end", "version": "1", "position": {"x": 300, "y": 0}},
    ]
    return {"schema_version": 1, "nodes": nodes, "edges": edges or []}


def test_rejects_missing_start() -> None:
    compiler = FlowCompiler(_registry())
    plan = compiler.compile({"schema_version": 1, "nodes": [], "edges": []})
    assert has_errors(plan)


def test_compiles_linear_flow() -> None:
    compiler = FlowCompiler(_registry())
    plan = compiler.compile(
        _flow(
            {
                "id": "c",
                "type": "data.constant",
                "version": "1",
                "position": {"x": 150, "y": 0},
                "config": {"value": "hi"},
            },
            edges=[
                {"id": "e1", "source": "start", "target": "c", "kind": "SUCCESS"},
                {"id": "e2", "source": "c", "target": "end", "kind": "SUCCESS"},
            ],
        )
    )
    assert not has_errors(plan)
    assert plan.start_node_id == "start"
    assert plan.checksum
    assert "c" in plan.nodes


def test_rejects_unknown_type() -> None:
    compiler = FlowCompiler(_registry())
    plan = compiler.compile(
        _flow(
            {"id": "x", "type": "shell.exec", "version": "1", "position": {"x": 1, "y": 1}},
            edges=[{"id": "e1", "source": "start", "target": "x", "kind": "SUCCESS"}],
        )
    )
    assert has_errors(plan)
    assert any("unknown node type" in d.message for d in plan.diagnostics)


def test_rejects_cycle() -> None:
    compiler = FlowCompiler(_registry())
    plan = compiler.compile(
        {
            "schema_version": 1,
            "nodes": [
                {
                    "id": "start",
                    "type": "control.start",
                    "version": "1",
                    "position": {"x": 0, "y": 0},
                },
                {"id": "a", "type": "data.constant", "version": "1", "position": {"x": 0, "y": 0}},
                {"id": "end", "type": "control.end", "version": "1", "position": {"x": 0, "y": 0}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "a", "kind": "SUCCESS"},
                {"id": "e2", "source": "a", "target": "a", "kind": "SUCCESS"},
            ],
        }
    )
    assert has_errors(plan)


def test_duplicate_ids() -> None:
    compiler = FlowCompiler(_registry())
    plan = compiler.compile(
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
                    "id": "start",
                    "type": "control.end",
                    "version": "1",
                    "position": {"x": 0, "y": 0},
                },
            ],
            "edges": [],
        }
    )
    assert has_errors(plan)
