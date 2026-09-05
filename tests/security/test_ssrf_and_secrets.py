from __future__ import annotations

import pytest
from browserflow.domain.errors import BrowserFlowError
from browserflow.infrastructure.crypto import SecretBox
from browserflow.infrastructure.logging import redact_value
from browserflow.infrastructure.network_policy import HttpRequestNetworkPolicy

pytestmark = pytest.mark.security


def test_metadata_blocked() -> None:
    policy = HttpRequestNetworkPolicy(allow_private=False, allowlist=[])
    with pytest.raises(BrowserFlowError):
        policy.assert_url_allowed("http://169.254.169.254/latest/meta-data/")
    with pytest.raises(BrowserFlowError):
        policy.assert_url_allowed("http://[::1]/")


def test_secret_box_roundtrip() -> None:
    box = SecretBox(b"k" * 32)
    nonce, ct = box.encrypt({"password": "p@ss"})
    out = box.decrypt(nonce, ct)
    assert out["password"] == "p@ss"
    assert b"p@ss" not in ct


def test_redaction_filter_values() -> None:
    assert redact_value("cookie", "abc") == "[REDACTED]"
    assert redact_value("note", "ok") == "ok"
