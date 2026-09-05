from __future__ import annotations

from typing import Any


def _flow(name: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": name.lower().replace(" ", "-"),
        "name": name,
        "definition": {
            "schema_version": 1,
            "nodes": nodes,
            "edges": edges,
            "metadata": {"template": True},
        },
    }


def builtin_templates() -> list[dict[str, Any]]:
    start = {"id": "start", "type": "control.start", "version": "1", "position": {"x": 0, "y": 0}}
    end = {"id": "end", "type": "control.end", "version": "1", "position": {"x": 400, "y": 0}}
    const = {
        "id": "title",
        "type": "data.constant",
        "version": "1",
        "position": {"x": 200, "y": 0},
        "config": {"value": "BrowserFlow"},
    }
    return [
        _flow(
            "Page title constant",
            [start, const, end],
            [
                {"id": "e1", "source": "start", "target": "title", "kind": "SUCCESS"},
                {"id": "e2", "source": "title", "target": "end", "kind": "SUCCESS"},
            ],
        ),
        _flow(
            "Form fill (local)",
            [start, end],
            [{"id": "e1", "source": "start", "target": "end", "kind": "SUCCESS"}],
        ),
        _flow(
            "HTTP plus constant",
            [start, const, end],
            [
                {"id": "e1", "source": "start", "target": "title", "kind": "SUCCESS"},
                {"id": "e2", "source": "title", "target": "end", "kind": "SUCCESS"},
            ],
        ),
        _flow(
            "File output",
            [start, const, end],
            [
                {"id": "e1", "source": "start", "target": "title", "kind": "SUCCESS"},
                {"id": "e2", "source": "title", "target": "end", "kind": "SUCCESS"},
            ],
        ),
        _flow(
            "Condition demo",
            [start, const, end],
            [
                {"id": "e1", "source": "start", "target": "title", "kind": "SUCCESS"},
                {"id": "e2", "source": "title", "target": "end", "kind": "SUCCESS"},
            ],
        ),
        _flow(
            "Foreach demo",
            [start, const, end],
            [
                {"id": "e1", "source": "start", "target": "title", "kind": "SUCCESS"},
                {"id": "e2", "source": "title", "target": "end", "kind": "SUCCESS"},
            ],
        ),
        _flow(
            "Timed screenshot skeleton",
            [start, end],
            [{"id": "e1", "source": "start", "target": "end", "kind": "SUCCESS"}],
        ),
        _flow(
            "List collect skeleton",
            [start, end],
            [{"id": "e1", "source": "start", "target": "end", "kind": "SUCCESS"}],
        ),
    ]
