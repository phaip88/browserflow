from __future__ import annotations

from enum import StrEnum
from typing import Any


class ErrorCode(StrEnum):
    FLOW = "BF-FLOW"
    NODE = "BF-NODE"
    BROWSER = "BF-BROWSER"
    NETWORK = "BF-NETWORK"
    CREDENTIAL = "BF-CREDENTIAL"
    FILE = "BF-FILE"
    SCHEDULER = "BF-SCHEDULER"
    WORKER = "BF-WORKER"
    SYSTEM = "BF-SYSTEM"
    AUTH = "BF-AUTH"
    COMPILER = "BF-COMPILER"
    STATE = "BF-STATE"
    LEASE = "BF-LEASE"


class BrowserFlowError(Exception):
    """Safe, structured application error. Never attach secrets to details."""

    def __init__(
        self,
        code: ErrorCode | str,
        message: str,
        *,
        retryable: bool = False,
        details: dict[str, Any] | None = None,
        node_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = ErrorCode(code) if not isinstance(code, ErrorCode) else code
        self.safe_message = message
        self.retryable = retryable
        self.details = details or {}
        self.node_id = node_id

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "error_code": str(self.code),
            "message": self.safe_message,
            "retryable": self.retryable,
        }
        if self.node_id:
            payload["node_id"] = self.node_id
        if self.details:
            payload["details"] = self.details
        return payload


class NotFoundError(BrowserFlowError):
    def __init__(self, message: str, **kwargs: Any) -> None:
        super().__init__(ErrorCode.SYSTEM, message, **kwargs)


class ConflictError(BrowserFlowError):
    def __init__(self, message: str, **kwargs: Any) -> None:
        super().__init__(ErrorCode.SYSTEM, message, **kwargs)


class ValidationError(BrowserFlowError):
    def __init__(self, message: str, **kwargs: Any) -> None:
        super().__init__(ErrorCode.COMPILER, message, **kwargs)


class AuthError(BrowserFlowError):
    def __init__(self, message: str, **kwargs: Any) -> None:
        super().__init__(ErrorCode.AUTH, message, **kwargs)


class ForbiddenError(BrowserFlowError):
    def __init__(self, message: str = "forbidden", **kwargs: Any) -> None:
        super().__init__(ErrorCode.AUTH, message, **kwargs)


class LeaseError(BrowserFlowError):
    def __init__(self, message: str, **kwargs: Any) -> None:
        super().__init__(ErrorCode.LEASE, message, retryable=True, **kwargs)


class CancellationError(BrowserFlowError):
    def __init__(self, message: str = "execution cancelled", **kwargs: Any) -> None:
        super().__init__(ErrorCode.WORKER, message, **kwargs)


class NodeTimeoutError(BrowserFlowError):
    def __init__(self, message: str = "timed out", **kwargs: Any) -> None:
        super().__init__(ErrorCode.NODE, message, retryable=True, **kwargs)
