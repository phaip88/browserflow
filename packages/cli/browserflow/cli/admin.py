from __future__ import annotations

import asyncio

import typer
from browserflow.infrastructure.logging import get_logger

logger = get_logger(__name__)


def create_admin(*, email: str, password: str) -> None:
    asyncio.run(_create_admin(email=email, password=password))


def reset_admin_password(*, email: str, password: str) -> None:
    asyncio.run(_reset_admin_password(email=email, password=password))


async def _create_admin(*, email: str, password: str) -> None:
    from browserflow.application.auth_service import AuthService
    from browserflow.infrastructure.db.session import session_scope

    async with session_scope() as session:
        service = AuthService(session)
        user = await service.create_initial_admin(email=email, password=password)
        logger.info("admin_created", user_id=str(user.id))
        typer.echo(f"Administrator created: {user.email}")


async def _reset_admin_password(*, email: str, password: str) -> None:
    from browserflow.application.auth_service import AuthService
    from browserflow.infrastructure.db.session import session_scope

    async with session_scope() as session:
        service = AuthService(session)
        await service.reset_password(email=email, password=password)
        logger.info("admin_password_reset")
        typer.echo("Password reset complete.")
