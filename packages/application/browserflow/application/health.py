from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from browserflow.infrastructure.config import Settings


def live_payload(settings: Settings) -> dict[str, Any]:
    return {
        "status": "ok",
        "service": settings.service_name,
        "time": datetime.now(timezone.utc).isoformat(),
    }


def ready_payload(
    settings: Settings,
    *,
    database_ok: bool,
    redis_ok: bool | None,
    browser_ok: bool | None = None,
) -> tuple[dict[str, Any], int]:
    checks: dict[str, str] = {
        "database": "ok" if database_ok else "fail",
    }
    if redis_ok is None:
        checks["redis"] = "optional"
    else:
        checks["redis"] = "ok" if redis_ok else ("degraded" if settings.redis_optional else "fail")
    if browser_ok is not None:
        checks["browser"] = "ok" if browser_ok else "fail"
    db_required_ok = database_ok
    redis_required_ok = True if settings.redis_optional else bool(redis_ok)
    browser_required_ok = True if browser_ok is None else browser_ok
    ok = db_required_ok and redis_required_ok and browser_required_ok
    body = {
        "status": "ok" if ok else "fail",
        "service": settings.service_name,
        "checks": checks,
        "time": datetime.now(timezone.utc).isoformat(),
    }
    return body, 200 if ok else 503
