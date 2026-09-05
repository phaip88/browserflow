from __future__ import annotations

from browserflow.api.deps import (
    clear_session_cookies,
    get_current_user,
    get_db,
    set_session_cookies,
    settings_dep,
)
from browserflow.application.auth_service import AuthService
from browserflow.application.rate_limit import login_limiter
from browserflow.domain.errors import AuthError
from browserflow.infrastructure.config import Settings
from browserflow.infrastructure.db.models import User
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class PasswordChangeBody(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=256)


class InitStatus(BaseModel):
    initialized: bool
    local_unauthenticated: bool


@router.get("/status", response_model=InitStatus)
async def status(
    session: AsyncSession = Depends(get_db), settings: Settings = Depends(settings_dep)
) -> InitStatus:
    count = await session.scalar(select(func.count()).select_from(User))
    return InitStatus(
        initialized=bool(count), local_unauthenticated=settings.is_local_unauthenticated
    )


@router.post("/login")
async def login(
    body: LoginBody,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(settings_dep),
) -> dict[str, str]:
    ip = request.client.host if request.client else "unknown"
    login_limiter.check(ip)
    auth = AuthService(session, session_ttl_seconds=settings.session_ttl_seconds)
    try:
        issued = await auth.authenticate(
            email=body.email,
            password=body.password,
            ip=ip,
            user_agent=request.headers.get("user-agent"),
        )
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=exc.safe_message) from exc
    set_session_cookies(
        response,
        settings,
        raw_token=issued.raw_token,
        csrf=issued.csrf_secret,
        max_age=settings.session_ttl_seconds,
    )
    return {"email": issued.user.email, "locale": issued.user.locale}


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(settings_dep),
) -> dict[str, str]:
    token = request.cookies.get(settings.session_cookie_name, "")
    await AuthService(session).logout(token)
    clear_session_cookies(response, settings)
    return {"status": "ok"}


@router.get("/me")
async def me(user: User = Depends(get_current_user)) -> dict[str, str]:
    return {"email": user.email, "locale": user.locale, "display_name": user.display_name}


@router.post("/password")
async def change_password(
    body: PasswordChangeBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(settings_dep),
) -> dict[str, str]:
    try:
        await AuthService(
            session, session_ttl_seconds=settings.session_ttl_seconds
        ).change_password(user, current=body.current_password, new=body.new_password)
    except (AuthError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}
