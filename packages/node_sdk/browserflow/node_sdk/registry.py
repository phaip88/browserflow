from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol

from browserflow.domain.errors import BrowserFlowError, ErrorCode
from browserflow.node_sdk.spec import NodeSpec


class NodeHandler(Protocol):
    spec: NodeSpec

    async def run(self, ctx: object) -> object: ...


class NodeRegistry:
    def __init__(self) -> None:
        self._handlers: dict[str, NodeHandler] = {}

    def register(self, handler: NodeHandler) -> None:
        key = handler.spec.type
        if key in self._handlers:
            raise BrowserFlowError(ErrorCode.SYSTEM, f"duplicate node type {key}")
        self._handlers[key] = handler

    def get(self, node_type: str) -> NodeHandler:
        try:
            return self._handlers[node_type]
        except KeyError as exc:
            raise BrowserFlowError(ErrorCode.COMPILER, f"unknown node type {node_type}") from exc

    def has(self, node_type: str) -> bool:
        return node_type in self._handlers

    def types(self) -> list[str]:
        return sorted(self._handlers)

    def specs(self) -> list[NodeSpec]:
        return [h.spec for h in self._handlers.values()]

    def items(self) -> Iterable[tuple[str, NodeHandler]]:
        return self._handlers.items()


_GLOBAL: NodeRegistry | None = None


def global_registry() -> NodeRegistry:
    global _GLOBAL
    if _GLOBAL is None:
        _GLOBAL = NodeRegistry()
        from browserflow.node_sdk.loading import load_release1_nodes

        load_release1_nodes(_GLOBAL)
    return _GLOBAL
