from __future__ import annotations

from typing import Any, Protocol

from browserflow.domain.errors import BrowserFlowError, ErrorCode


class AIProvider(Protocol):
    name: str

    async def complete(self, prompt: str) -> str: ...


class DisabledAIProvider:
    name = "disabled"

    async def complete(self, prompt: str) -> str:
        raise BrowserFlowError(ErrorCode.SYSTEM, "AI provider is not configured")


class FakeAIProvider:
    """Test-only. Production startup must refuse this provider."""

    name = "fake"

    async def complete(self, prompt: str) -> str:
        return f"fake:{prompt[:80]}"


AI_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {"name": "listNodeTypes", "description": "List registered node types"},
    {"name": "getNodeSchema", "description": "Get a node spec"},
    {"name": "getFlowSchema", "description": "Get flow JSON schema"},
    {"name": "createFlowDraft", "description": "Create a flow draft"},
    {"name": "addNode", "description": "Add a node to a draft"},
    {"name": "updateNode", "description": "Update a node"},
    {"name": "removeNode", "description": "Remove a node"},
    {"name": "connectNodes", "description": "Connect two nodes"},
    {"name": "disconnectNodes", "description": "Remove an edge"},
    {"name": "validateFlow", "description": "Validate a draft"},
    {"name": "compileFlow", "description": "Compile a draft"},
    {"name": "explainDiagnostic", "description": "Explain a compiler diagnostic"},
    {"name": "repairFlow", "description": "Propose a repair"},
    {"name": "estimateExecution", "description": "Estimate resources"},
    {"name": "generateTestFlow", "description": "Generate a test flow"},
]


def provider_from_settings(name: str, env: str) -> DisabledAIProvider | FakeAIProvider:
    if name == "fake":
        if env != "test":
            raise RuntimeError("Fake AI provider is test-only")
        return FakeAIProvider()
    return DisabledAIProvider()
