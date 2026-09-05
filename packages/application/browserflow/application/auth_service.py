from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from browserflow.domain.clock import utcnow
from browserflow.domain.enums import AuditAction, Locale
from browserflow.domain.errors import AuthError, ConflictError, NotFoundError
from browserflow.infrastructure.db.models import AuditEvent, User, UserSession
from browserflow.infrastructure.passwords import hash_password, verify_password
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class SessionIssue:
    user: User
    raw_token: str
    csrf_secret: str
    expires_at: object


class AuthService:
    def __init__(self, session: AsyncSession, *, session_ttl_seconds: int = 43200) -> None:
        self._session = session
        self._ttl = session_ttl_seconds

    async def create_initial_admin(self, *, email: str, password: str) -> User:
        existing = await self._session.scalar(select(func.count()).select_from(User))
        if existing:
            raise ConflictError("administrator already initialized")
        user = User(
            email=email.strip().lower(),
            password_hash=hash_password(password),
            display_name="Admin",
            locale=Locale.EN.value,
            is_active=True,
            password_changed_at=utcnow(),
        )
        self._session.add(user)
        self._session.add(
            AuditEvent(
                actor=user.email,
                action=AuditAction.ADMIN_INIT.value,
                target_type="user",
                target_id=str(user.id),
                details={},
            )
        )
        await self._session.flush()
        return user

    async def reset_password(self, *, email: str, password: str) -> User:
        user = await self._session.scalar(select(User).where(User.email == email.strip().lower()))
        if user is None:
            raise NotFoundError("user not found")
        user.password_hash = hash_password(password)
        user.password_changed_at = utcnow()
        await self._revoke_all(user.id)
        self._session.add(
            AuditEvent(
                actor=user.email,
                action=AuditAction.PASSWORD_RESET.value,
                target_type="user",
                target_id=str(user.id),
                details={},
            )
        )
        await self._session.flush()
        return user

    async def authenticate(
        self,
        *,
        email: str,
        password: str,
        ip: str | None,
        user_agent: str | None,
    ) -> SessionIssue:
        user = await self._session.scalar(select(User).where(User.email == email.strip().lower()))
        if user is None or not user.is_active or not verify_password(user.password_hash, password):
            self._session.add(
                AuditEvent(
                    actor=email.strip().lower(),
                    action=AuditAction.LOGIN_FAILURE.value,
                    target_type="user",
                    target_id="",
                    ip_address=ip,
                    details={},
                )
            )
            await self._session.flush()
            raise AuthError("invalid credentials")
        raw = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        expires = utcnow() + timedelta(seconds=self._ttl)
        row = UserSession(
            user_id=user.id,
            token_hash=_sha256_hex(raw),
            csrf_secret=csrf,
            expires_at=expires,
            ip_address=ip,
            user_agent=(user_agent or "")[:512],
        )
        self._session.add(row)
        self._session.add(
            AuditEvent(
                actor=user.email,
                action=AuditAction.LOGIN_SUCCESS.value,
                target_type="user",
                target_id=str(user.id),
                ip_address=ip,
                details={},
            )
        )
        await self._session.flush()
        return SessionIssue(user=user, raw_token=raw, csrf_secret=csrf, expires_at=expires)

    async def resolve_session(self, raw_token: str) -> tuple[User, UserSession] | None:
        if not raw_token:
            return None
        token_hash = _sha256_hex(raw_token)
        row = await self._session.scalar(
            select(UserSession).where(UserSession.token_hash == token_hash)
        )
        if row is None or row.revoked_at is not None or row.expires_at <= utcnow():
            return None
        user = await self._session.get(User, row.user_id)
        if user is None or not user.is_active:
            return None
        return user, row

    async def logout(self, raw_token: str) -> None:
        token_hash = _sha256_hex(raw_token)
        row = await self._session.scalar(
            select(UserSession).where(UserSession.token_hash == token_hash)
        )
        if row is None:
            return
        row.revoked_at = utcnow()
        self._session.add(
            AuditEvent(
                actor=str(row.user_id),
                action=AuditAction.LOGOUT.value,
                target_type="session",
                target_id=str(row.id),
                details={},
            )
        )
        await self._session.flush()

    async def change_password(self, user: User, *, current: str, new: str) -> None:
        if not verify_password(user.password_hash, current):
            raise AuthError("invalid credentials")
        user.password_hash = hash_password(new)
        user.password_changed_at = utcnow()
        await self._revoke_all(user.id)
        self._session.add(
            AuditEvent(
                actor=user.email,
                action=AuditAction.PASSWORD_CHANGE.value,
                target_type="user",
                target_id=str(user.id),
                details={},
            )
        )
        await self._session.flush()

    async def _revoke_all(self, user_id: UUID) -> None:
        rows = (
            await self._session.scalars(
                select(UserSession).where(
                    UserSession.user_id == user_id, UserSession.revoked_at.is_(None)
                )
            )
        ).all()
        now = utcnow()
        for row in rows:
            row.revoked_at = now

    @staticmethod
    def csrf_ok(session_row: UserSession, provided: str) -> bool:
        return hmac.compare_digest(session_row.csrf_secret, provided or "")
