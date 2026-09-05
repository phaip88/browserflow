from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from browserflow.domain.errors import CancellationError


@dataclass
class ExecutionScope:
    parent: ExecutionScope | None = None
    values: dict[str, Any] = field(default_factory=dict)
    runtime: dict[str, Any] = field(default_factory=dict)
    private: dict[str, Any] = field(default_factory=dict)

    def get(self, key: str) -> Any:
        if key in self.values:
            return self.values[key]
        if self.parent is not None:
            return self.parent.get(key)
        raise KeyError(key)

    def get_runtime(self, key: str) -> Any:
        if key in self.runtime:
            return self.runtime[key]
        if self.parent is not None:
            return self.parent.get_runtime(key)
        raise KeyError(key)

    def set_value(self, key: str, value: Any) -> None:
        self.values[key] = value

    def set_runtime(self, key: str, value: Any) -> None:
        self.runtime[key] = value


@dataclass
class LoopScope(ExecutionScope):
    item: Any = None
    index: int = 0
    length: int = 0

    def __post_init__(self) -> None:
        self.values.update(
            {
                "item": self.item,
                "index": self.index,
                "length": self.length,
                "first": self.index == 0,
                "last": self.index == self.length - 1 if self.length else True,
            }
        )


class CancellationToken:
    def __init__(self) -> None:
        self._event = asyncio.Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def raise_if_cancelled(self) -> None:
        if self.cancelled:
            raise CancellationError()


class ExecutionContext:
    def __init__(
        self,
        *,
        execution_id: UUID,
        attempt_id: UUID,
        flow_version_id: UUID,
        node_id: str,
        node_type: str,
        config: dict[str, Any],
        inputs: dict[str, Any],
        scope: ExecutionScope,
        cancellation: CancellationToken,
        browser_session: Any | None = None,
        artifact_service: Any | None = None,
        secret_resolver: Any | None = None,
        timeout_ms: int = 30_000,
        outputs: dict[str, dict[str, Any]] | None = None,
    ) -> None:
        self.execution_id = execution_id
        self.attempt_id = attempt_id
        self.flow_version_id = flow_version_id
        self.node_id = node_id
        self.node_type = node_type
        self._config = config
        self._inputs = inputs
        self.scope = scope
        self.cancellation = cancellation
        self.browser_session = browser_session
        self.artifact_service = artifact_service
        self.secret_resolver = secret_resolver
        self.timeout_ms = timeout_ms
        self.outputs = outputs if outputs is not None else {}
        self.pages: dict[str, Any] = {}
        if browser_session is not None and hasattr(browser_session, "pages"):
            self.pages = browser_session.pages

    def config(self, key: str, default: Any = None) -> Any:
        value = self._config.get(key, default)
        return self._resolve(value)

    def require_config(self, key: str) -> Any:
        if key not in self._config:
            raise KeyError(key)
        return self._resolve(self._config[key])

    def _resolve(self, value: Any) -> Any:
        if isinstance(value, str) and value.startswith("{{") and value.endswith("}}"):
            path = value[2:-2].strip()
            return self.scope.get(path)
        if isinstance(value, str) and value.startswith("cred:") and self.secret_resolver:
            return self.secret_resolver.resolve(value)
        return value

    def input(self, name: str, default: Any = None) -> Any:
        binding = self._inputs.get(name)
        if binding is None:
            return default
        kind = binding.get("kind", "value")
        if kind == "runtime":
            key = binding.get("path") or name
            try:
                return self.scope.get_runtime(key)
            except KeyError:
                return default
        if kind == "variable":
            path = binding.get("path") or name
            try:
                return self.scope.get(path)
            except KeyError:
                return default
        if kind == "output":
            node_id = binding.get("node_id")
            path = binding.get("path") or "value"
            return (self.outputs.get(node_id) or {}).get(path, default)
        if kind == "selector" and self.browser_session is not None:
            selector = binding.get("selector")
            page = self.browser_session.page()
            return page.locator(selector)
        return binding.get("value", default)

    def set_variable(self, name: str, value: Any) -> None:
        self.scope.set_value(name, value)

    def get_variable(self, name: str, default: Any = None) -> Any:
        try:
            return self.scope.get(name)
        except KeyError:
            return default

    async def checkpoint(self) -> None:
        self.cancellation.raise_if_cancelled()
