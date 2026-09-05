from __future__ import annotations

import logging
import re
import sys
from typing import Any

import structlog
from browserflow.infrastructure.config import Settings

_SENSITIVE_KEYS = {
    "password",
    "token",
    "cookie",
    "authorization",
    "proxy_password",
    "proxy-password",
    "credential",
    "session",
    "api_key",
    "apikey",
    "api-key",
    "secret",
    "private",
    "set-cookie",
    "master_key",
    "session_secret",
}

_REDACT_PATTERN = re.compile(
    r"(password|token|cookie|authorization|credential|secret|api[_-]?key)\s*[:=]\s*([^\s,;]+)",
    re.IGNORECASE,
)


def redact_value(key: str, value: Any) -> Any:
    lowered = key.lower().replace("-", "_")
    if any(part in lowered for part in _SENSITIVE_KEYS):
        return "[REDACTED]"
    if isinstance(value, str):
        return _REDACT_PATTERN.sub(r"\1=[REDACTED]", value)
    if isinstance(value, dict):
        return {k: redact_value(str(k), v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_value(key, item) for item in value]
    return value


class RedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, dict):
            record.args = {k: redact_value(str(k), v) for k, v in record.args.items()}
        if isinstance(record.msg, str):
            record.msg = _REDACT_PATTERN.sub(r"\1=[REDACTED]", record.msg)
        return True


def _drop_secrets(_logger: Any, _method: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    return {k: redact_value(str(k), v) for k, v in event_dict.items()}


def configure_logging(settings: Settings) -> None:
    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)
    shared: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        timestamper,
        _drop_secrets,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    structlog.configure(
        processors=[
            *shared,
            structlog.processors.UnicodeDecoder(),
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.JSONRenderer(),
        ],
        foreign_pre_chain=shared,
    )
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    handler.addFilter(RedactionFilter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(settings.log_level.upper())
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def bind_execution_context(
    *,
    execution_id: str | None = None,
    attempt_id: str | None = None,
    flow_id: str | None = None,
    flow_version_id: str | None = None,
    node_id: str | None = None,
    worker_id: str | None = None,
    trace_id: str | None = None,
    error_code: str | None = None,
) -> None:
    payload = {
        "service": None,
        "execution_id": execution_id,
        "attempt_id": attempt_id,
        "flow_id": flow_id,
        "flow_version_id": flow_version_id,
        "node_id": node_id,
        "worker_id": worker_id,
        "trace_id": trace_id,
        "error_code": error_code,
    }
    structlog.contextvars.bind_contextvars(**{k: v for k, v in payload.items() if v})


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
