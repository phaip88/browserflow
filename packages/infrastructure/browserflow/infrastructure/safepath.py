from __future__ import annotations

import re
from pathlib import Path

from browserflow.domain.errors import BrowserFlowError, ErrorCode

_ILLEGAL = re.compile(r"[<>:\"|?*\x00-\x1f]")
_WINDOWS_DRIVE = re.compile(r"^[a-zA-Z]:[\\/]")


class SafePathResolver:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def resolve(self, relative: str, *, must_exist: bool = False) -> Path:
        if not relative or relative.strip() != relative:
            raise BrowserFlowError(ErrorCode.FILE, "invalid path")
        if relative.startswith("/") or relative.startswith("\\"):
            raise BrowserFlowError(ErrorCode.FILE, "absolute paths are not allowed")
        if _WINDOWS_DRIVE.match(relative) or relative.startswith("\\\\"):
            raise BrowserFlowError(ErrorCode.FILE, "drive/UNC paths are not allowed")
        if _ILLEGAL.search(relative):
            raise BrowserFlowError(ErrorCode.FILE, "illegal filename characters")
        parts = Path(relative).parts
        if any(p in {"", ".", ".."} for p in parts if p == "..") or ".." in parts:
            raise BrowserFlowError(ErrorCode.FILE, "path traversal is not allowed")
        candidate = (self.root / relative).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise BrowserFlowError(ErrorCode.FILE, "path escapes storage root") from exc
        if candidate.is_symlink():
            raise BrowserFlowError(ErrorCode.FILE, "symlinks are not allowed")
        if must_exist and not candidate.exists():
            raise BrowserFlowError(ErrorCode.FILE, "file not found")
        return candidate
