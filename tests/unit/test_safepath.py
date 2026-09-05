from __future__ import annotations

from pathlib import Path

import pytest
from browserflow.domain.errors import BrowserFlowError
from browserflow.infrastructure.safepath import SafePathResolver

pytestmark = pytest.mark.unit


def test_rejects_traversal(tmp_path: Path) -> None:
    resolver = SafePathResolver(tmp_path)
    with pytest.raises(BrowserFlowError):
        resolver.resolve("../etc/passwd")
    with pytest.raises(BrowserFlowError):
        resolver.resolve("/etc/passwd")
    with pytest.raises(BrowserFlowError):
        resolver.resolve("C:\\windows\\system32")


def test_allows_nested(tmp_path: Path) -> None:
    resolver = SafePathResolver(tmp_path)
    path = resolver.resolve("a/b.txt")
    assert path.parent == tmp_path / "a" or path.parent == (tmp_path / "a").resolve()
