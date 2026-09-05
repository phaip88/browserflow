from __future__ import annotations

import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _test_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("BROWSERFLOW_ENV", "test")
    monkeypatch.setenv("BROWSERFLOW_SERVICE_NAME", "api")
    monkeypatch.setenv("BROWSERFLOW_BIND_HOST", "127.0.0.1")
    monkeypatch.setenv("BROWSERFLOW_AUTH_MODE", "authenticated")
    monkeypatch.setenv("BROWSERFLOW_ALLOW_LOCAL_UNAUTHENTICATED", "false")
    monkeypatch.setenv("BROWSERFLOW_AI_PROVIDER", "disabled")
    secrets = ROOT / "secrets"
    secrets.mkdir(exist_ok=True)
    master = secrets / "master.key"
    session = secrets / "session.secret"
    if not master.exists():
        master.write_bytes(os.urandom(32))
    if not session.exists():
        session.write_bytes(os.urandom(48))
    monkeypatch.setenv("BROWSERFLOW_MASTER_KEY_FILE", str(master))
    monkeypatch.setenv("BROWSERFLOW_SESSION_SECRET_FILE", str(session))
    from browserflow.infrastructure.config import reset_settings_cache

    reset_settings_cache()
    yield
    reset_settings_cache()
