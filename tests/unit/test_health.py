from __future__ import annotations

import pytest
from browserflow.api.main import create_app
from browserflow.application.health import live_payload, ready_payload
from browserflow.infrastructure.config import get_settings
from fastapi.testclient import TestClient

pytestmark = pytest.mark.unit


def test_live_payload_ok() -> None:
    body = live_payload(get_settings())
    assert body["status"] == "ok"
    assert body["service"] == "api"
    assert "time" in body


def test_ready_optional_redis() -> None:
    body, status = ready_payload(get_settings(), database_ok=True, redis_ok=None)
    assert status == 200
    assert body["status"] == "ok"
    assert body["checks"]["redis"] == "optional"


def test_health_live_http() -> None:
    client = TestClient(create_app())
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"


def test_health_ready_http() -> None:
    client = TestClient(create_app())
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_metrics_http() -> None:
    client = TestClient(create_app())
    response = client.get("/metrics")
    assert response.status_code == 200
    assert "text/plain" in response.headers["content-type"]
