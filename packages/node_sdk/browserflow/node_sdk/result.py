from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class NodeResult:
    ok: bool
    outputs: dict[str, Any] = field(default_factory=dict)
    error_code: str | None = None
    error_message: str | None = None
    branch: str | None = None  # TRUE / FALSE for if
    return_value: Any = None
    did_return: bool = False
    skipped: bool = False

    @classmethod
    def success(
        cls, outputs: dict[str, Any] | None = None, *, branch: str | None = None
    ) -> NodeResult:
        return cls(ok=True, outputs=outputs or {}, branch=branch)

    @classmethod
    def failure(cls, code: str, message: str) -> NodeResult:
        return cls(ok=False, error_code=code, error_message=message)

    @classmethod
    def returned(cls, value: Any) -> NodeResult:
        return cls(ok=True, did_return=True, return_value=value)
