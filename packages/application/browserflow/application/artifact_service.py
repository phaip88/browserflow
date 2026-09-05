from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid4

from browserflow.domain.errors import BrowserFlowError, ErrorCode
from browserflow.infrastructure.config import Settings, get_settings
from browserflow.infrastructure.db.models import Artifact
from browserflow.infrastructure.safepath import SafePathResolver
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass
class StoredArtifact:
    id: UUID
    relative_path: str
    size_bytes: int
    sha256: str
    content_type: str


class ArtifactService:
    def __init__(
        self, session: AsyncSession | None = None, settings: Settings | None = None
    ) -> None:
        self._session = session
        self._settings = settings or get_settings()
        self._root = Path(self._settings.artifact_dir).resolve()
        self._root.mkdir(parents=True, exist_ok=True)
        self._resolver = SafePathResolver(self._root)

    def _execution_root(self, execution_id: UUID) -> Path:
        path = self._root / str(execution_id)
        path.mkdir(parents=True, exist_ok=True)
        return path

    async def write_text(
        self,
        execution_id: UUID,
        relative: str,
        content: str,
        *,
        node_id: str | None = None,
        content_type: str = "text/plain",
    ) -> StoredArtifact:
        data = content.encode("utf-8")
        if len(data) > self._settings.max_artifact_bytes:
            raise BrowserFlowError(ErrorCode.FILE, "artifact exceeds size limit")
        resolver = SafePathResolver(self._execution_root(execution_id))
        dest = resolver.resolve(relative)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        rel = f"{execution_id}/{relative}"
        row = Artifact(
            id=uuid4(),
            execution_id=execution_id,
            node_id=node_id,
            kind="file",
            relative_path=rel,
            content_type=content_type,
            size_bytes=len(data),
            sha256=digest,
        )
        if self._session is not None:
            self._session.add(row)
            await self._session.flush()
        return StoredArtifact(row.id, rel, len(data), digest, content_type)

    async def write_bytes(
        self,
        execution_id: UUID,
        relative: str,
        data: bytes,
        *,
        node_id: str | None = None,
        content_type: str = "application/octet-stream",
        kind: str = "file",
    ) -> StoredArtifact:
        if len(data) > self._settings.max_artifact_bytes:
            raise BrowserFlowError(ErrorCode.FILE, "artifact exceeds size limit")
        resolver = SafePathResolver(self._execution_root(execution_id))
        dest = resolver.resolve(relative)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        rel = f"{execution_id}/{relative}"
        row = Artifact(
            id=uuid4(),
            execution_id=execution_id,
            node_id=node_id,
            kind=kind,
            relative_path=rel,
            content_type=content_type,
            size_bytes=len(data),
            sha256=digest,
        )
        if self._session is not None:
            self._session.add(row)
            await self._session.flush()
        return StoredArtifact(row.id, rel, len(data), digest, content_type)

    async def read_text(self, execution_id: UUID, relative: str) -> str:
        resolver = SafePathResolver(self._execution_root(execution_id))
        dest = resolver.resolve(relative, must_exist=True)
        return dest.read_text(encoding="utf-8")
