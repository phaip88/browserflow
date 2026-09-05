from __future__ import annotations

from typing import Any, Literal

from browserflow.domain.enums import EdgeKind, ErrorPolicy, RetryBackoff
from pydantic import BaseModel, ConfigDict, Field, field_validator

FLOW_SCHEMA_VERSION = 1


class Position(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float = 0
    y: float = 0


class RetryPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_attempts: int = Field(default=0, ge=0, le=10)
    backoff: RetryBackoff = RetryBackoff.NONE
    delay_ms: int = Field(default=0, ge=0, le=60_000)


class InputBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["value", "variable", "output", "runtime", "selector"] = "value"
    value: Any = None
    path: str | None = None
    node_id: str | None = None
    selector: str | None = None


class FlowNode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=128)
    type: str = Field(min_length=1, max_length=128)
    version: str = "1"
    position: Position = Field(default_factory=Position)
    label: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    inputs: dict[str, InputBinding] = Field(default_factory=dict)
    timeout_ms: int | None = Field(default=None, ge=1, le=600_000)
    retry: RetryPolicy = Field(default_factory=RetryPolicy)
    error_policy: ErrorPolicy = ErrorPolicy.FAIL_FLOW

    @field_validator("id")
    @classmethod
    def _id_chars(cls, v: str) -> str:
        if any(ch in v for ch in " \t\n/\\"):
            raise ValueError("node id must not contain whitespace or slashes")
        return v


class FlowEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=128)
    source: str
    target: str
    source_handle: str = "success"
    target_handle: str = "in"
    kind: EdgeKind = EdgeKind.SUCCESS
    condition: str | None = None
    priority: int = 0


class FlowDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: int = FLOW_SCHEMA_VERSION
    name: str = ""
    nodes: list[FlowNode] = Field(default_factory=list)
    edges: list[FlowEdge] = Field(default_factory=list)
    identity_ref: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("schema_version")
    @classmethod
    def _schema(cls, v: int) -> int:
        if v != FLOW_SCHEMA_VERSION:
            raise ValueError(f"unsupported schema_version {v}")
        return v
