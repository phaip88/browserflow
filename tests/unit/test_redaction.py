from __future__ import annotations

import pytest
from browserflow.infrastructure.logging import redact_value

pytestmark = pytest.mark.unit


def test_redacts_password_key() -> None:
    assert redact_value("password", "hunter2") == "[REDACTED]"
    assert redact_value("authorization", "Bearer abc") == "[REDACTED]"
    assert redact_value("api_key", "k") == "[REDACTED]"


def test_redacts_nested() -> None:
    out = redact_value("body", {"token": "abc", "name": "ok"})
    assert out["token"] == "[REDACTED]"
    assert out["name"] == "ok"


def test_redacts_inline_secret_text() -> None:
    text = redact_value("msg", "password=super-secret rest")
    assert "super-secret" not in text
    assert "[REDACTED]" in text
