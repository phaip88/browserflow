from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from browserflow.domain.enums import SideEffectLevel


@dataclass(frozen=True)
class NodeSpec:
    type: str
    version: str
    category: str
    display_name: str
    description: str
    config_schema: dict[str, Any]
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    default_timeout_ms: int = 30_000
    default_retry_policy: dict[str, Any] = field(default_factory=dict)
    required_capabilities: tuple[str, ...] = ()
    sensitive_fields: tuple[str, ...] = ()
    side_effect_level: SideEffectLevel = SideEffectLevel.NONE
    supports_cancellation: bool = True
    supports_retry: bool = True
