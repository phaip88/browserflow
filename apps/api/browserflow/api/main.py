from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from browserflow.api.middleware.security_headers import SecurityHeadersMiddleware
from browserflow.api.routes import health as health_routes
from browserflow.infrastructure.config import get_settings, require_production_secrets
from browserflow.infrastructure.logging import configure_logging, get_logger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings)
    require_production_secrets(settings)
    logger.info("api_starting", service=settings.service_name, env=settings.env)
    yield
    logger.info("api_stopping", service=settings.service_name)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="BrowserFlow API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.env != "production" else None,
        redoc_url=None,
    )
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-CSRF-Token", "X-Requested-With"],
    )
    app.include_router(health_routes.router)
    return app


app = create_app()
