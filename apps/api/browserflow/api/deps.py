from __future__ import annotations

from collections.abc import AsyncIterator

from browserflow.application.auth_service import AuthService
from browserflow.infrastructure.config import Settings, get_settings
from browserflow.infrastructure.db.models import User
from browserflow.infrastructure.db.session import get_session_factory
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession


async def get_db() -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    session = factory()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


def settings_dep() -> Settings:
    return get_settings()


async def get_current_user(
    request: Request,
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(settings_dep),
) -> User:
    if settings.is_local_unauthenticated:
        user = User(email="local@localhost", password_hash="local", display_name="Local")
        request.state.user = user
        request.state.user_session = None
        return user
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="not authenticated")
    auth = AuthService(session, session_ttl_seconds=settings.session_ttl_seconds)
    resolved = await auth.resolve_session(token)
    if resolved is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    user, row = resolved
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        provided = request.headers.get("X-CSRF-Token") or request.cookies.get(
            settings.csrf_cookie_name, ""
        )
        if not AuthService.csrf_ok(row, provided):
            raise HTTPException(status_code=403, detail="csrf")
    request.state.user = user
    request.state.user_session = row
    return user


def set_session_cookies(
    response: Response, settings: Settings, *, raw_token: str, csrf: str, max_age: int
) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        raw_token,
        httponly=True,
        samesite="lax",
        secure=settings.session_secure_cookie,
        max_age=max_age,
        path="/",
    )
    response.set_cookie(
        settings.csrf_cookie_name,
        csrf,
        httponly=False,
        samesite="lax",
        secure=settings.session_secure_cookie,
        max_age=max_age,
        path="/",
    )


def clear_session_cookies(response: Response, settings: Settings) -> None:
    response.delete_cookie(settings.session_cookie_name, path="/")
    response.delete_cookie(settings.csrf_cookie_name, path="/")
