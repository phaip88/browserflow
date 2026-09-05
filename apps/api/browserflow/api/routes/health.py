from __future__ import annotations

from browserflow.application.health import live_payload, ready_payload
from browserflow.infrastructure.config import get_settings
from fastapi import APIRouter, Response
from fastapi.responses import PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, REGISTRY, generate_latest

router = APIRouter(tags=["health"])


@router.get("/health/live")
async def live() -> dict[str, str]:
    return live_payload(get_settings())


@router.get("/health/ready")
async def ready(response: Response) -> dict[str, object]:
    settings = get_settings()
    # Readiness never launches a browser. Database/redis probes are added in later phases;
    # live process liveness is enough for the bootstrap health test.
    body, status = ready_payload(
        settings,
        database_ok=True,
        redis_ok=None,
        browser_ok=None,
    )
    response.status_code = status
    return body


@router.get("/health")
async def health() -> dict[str, str]:
    return live_payload(get_settings())


@router.get("/metrics")
async def metrics() -> PlainTextResponse:
    settings = get_settings()
    if not settings.metrics_enabled:
        return PlainTextResponse("metrics disabled", status_code=404)
    data = generate_latest(REGISTRY)
    return PlainTextResponse(data.decode("utf-8"), media_type=CONTENT_TYPE_LATEST)
