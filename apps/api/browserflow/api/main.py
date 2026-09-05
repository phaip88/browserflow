from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from browserflow.api.middleware.security_headers import SecurityHeadersMiddleware
from browserflow.api.routes import auth as auth_routes
from browserflow.api.routes import executions as execution_routes
from browserflow.api.routes import flows as flow_routes
from browserflow.api.routes import health as health_routes
from browserflow.api.routes import resources as resource_routes
from browserflow.domain.errors import AuthError, BrowserFlowError, ConflictError, NotFoundError
from browserflow.infrastructure.config import get_settings, require_production_secrets
from browserflow.infrastructure.logging import configure_logging, get_logger
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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
    app.include_router(auth_routes.router)
    app.include_router(flow_routes.router)
    app.include_router(execution_routes.router)
    app.include_router(resource_routes.router)

    @app.exception_handler(BrowserFlowError)
    async def _bf_error(_request: Request, exc: BrowserFlowError) -> JSONResponse:
        status = 400
        if isinstance(exc, AuthError):
            status = 401
        elif isinstance(exc, NotFoundError):
            status = 404
        elif isinstance(exc, ConflictError):
            status = 409
        return JSONResponse(status_code=status, content=exc.to_dict())

    return app


app = create_app()
