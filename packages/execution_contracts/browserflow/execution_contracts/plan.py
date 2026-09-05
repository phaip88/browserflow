from __future__ import annotations

from typing import Any

from browserflow.domain.enums import EdgeKind, ErrorPolicy
from pydantic import BaseModel, Field


class CompiledEdge(BaseModel):
    id: str
    source: str
    target: str
    kind: EdgeKind
    priority: int = 0
    source_handle: str = "success"
    target_handle: str = "in"
    condition: str | None = None


class CompiledNode(BaseModel):
    id: str
    type: str
    version: str
    label: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    inputs: dict[str, Any] = Field(default_factory=dict)
    timeout_ms: int
    retry: dict[str, Any] = Field(default_factory=dict)
    error_policy: ErrorPolicy = ErrorPolicy.FAIL_FLOW
    outgoing: list[CompiledEdge] = Field(default_factory=list)


class ResourceEstimate(BaseModel):
    node_count: int
    estimated_duration_ms: int
    pages: int = 1
    requires_browser: bool = False
    requires_identity: bool = False


class Diagnostic(BaseModel):
    severity: str  # ERROR | WARNING
    code: str
    message: str
    node_id: str | None = None
    edge_id: str | None = None


class CompiledFlowExecutionPlan(BaseModel):
    schema_version: int = 1
    start_node_id: str
    nodes: dict[str, CompiledNode]
    checksum: str
    node_registry_version: str
    resource_estimate: ResourceEstimate
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    identity_ref: str | None = None
