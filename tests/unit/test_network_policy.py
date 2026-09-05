from __future__ import annotations

import pytest
from browserflow.domain.errors import BrowserFlowError
from browserflow.infrastructure.network_policy import HttpRequestNetworkPolicy

pytestmark = pytest.mark.unit


def test_blocks_localhost() -> None:
    policy = HttpRequestNetworkPolicy(allow_private=False, allowlist=[])
    with pytest.raises(BrowserFlowError):
        policy.assert_url_allowed("http://127.0.0.1/")
    with pytest.raises(BrowserFlowError):
        policy.assert_url_allowed("http://localhost/admin")
    with pytest.raises(BrowserFlowError):
        policy.assert_url_allowed("http://169.254.169.254/latest/meta-data")


def test_blocks_file_scheme() -> None:
    policy = HttpRequestNetworkPolicy(allow_private=False, allowlist=[])
    with pytest.raises(BrowserFlowError):
        policy.assert_url_allowed("file:///etc/passwd")


def test_allows_public_https() -> None:
    policy = HttpRequestNetworkPolicy(allow_private=False, allowlist=[])
    policy.assert_url_allowed("https://example.com/")
