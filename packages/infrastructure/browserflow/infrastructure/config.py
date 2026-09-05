from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from browserflow.domain.enums import AuthMode, Locale
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _read_secret_file(path: str | None) -> bytes | None:
    if not path:
        return None
    p = Path(path)
    if not p.is_file():
        return None
    data = p.read_bytes()
    return data.strip() if data else None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="BROWSERFLOW_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    service_name: str = "api"
    bind_host: str = "127.0.0.1"
    api_port: int = 8000
    public_base_url: str = "http://127.0.0.1:8000"
    web_origin: str = "http://127.0.0.1:5173"
    locale: Locale = Locale.EN
    allowed_origins: str = "http://127.0.0.1:5173,http://localhost:5173"

    auth_mode: AuthMode = AuthMode.AUTHENTICATED
    allow_local_unauthenticated: bool = False
    session_cookie_name: str = "bf_session"
    session_ttl_seconds: int = 43200
    session_secure_cookie: bool = False
    csrf_cookie_name: str = "bf_csrf"
    login_rate_limit_per_minute: int = 10

    master_key_file: str = "./secrets/master.key"
    session_secret_file: str = "./secrets/session.secret"

    database_url: str = (
        "postgresql+asyncpg://browserflow:browserflow_dev@127.0.0.1:5432/browserflow"
    )
    database_url_sync: str = "postgresql://browserflow:browserflow_dev@127.0.0.1:5432/browserflow"

    redis_url: str = "redis://127.0.0.1:6379/0"
    redis_optional: bool = True

    worker_id: str = ""
    worker_capacity: int = 1
    max_browser_concurrency: int = 1
    heartbeat_interval_seconds: int = 5
    lease_ttl_seconds: int = 30
    worker_poll_interval_seconds: float = 2.0
    playwright_skip_browser_download: bool = True

    flow_timeout_seconds: int = 600
    node_timeout_seconds: int = 60
    max_foreach_iterations: int = 1000
    max_pages: int = 8
    max_download_bytes: int = 52_428_800
    max_artifact_bytes: int = 104_857_600
    max_total_storage_bytes: int = 10_737_418_240
    screenshot_interval_seconds: int = 4
    screenshot_max_width: int = 1280
    artifact_retention_days: int = 14
    event_retention_days: int = 30

    data_dir: str = "./data"
    runtime_dir: str = "./runtime"
    artifact_dir: str = "./data/artifacts"

    otel_exporter_otlp_endpoint: str = ""
    otel_enabled: bool = False
    metrics_enabled: bool = True

    allow_private_network: bool = False
    private_network_allowlist: str = ""

    ai_provider: Literal["disabled", "fake"] = "disabled"

    graceful_shutdown_seconds: int = 25
    outbox_poll_interval_seconds: float = 1.0
    scheduler_poll_interval_seconds: float = 2.0
    max_compiled_nodes: int = 200
    max_loop_depth: int = 8

    @field_validator("max_browser_concurrency")
    @classmethod
    def _cap_concurrency(cls, v: int) -> int:
        if v < 1 or v > 2:
            raise ValueError("max_browser_concurrency must be 1 or 2 in Release 1")
        return v

    @field_validator("worker_capacity")
    @classmethod
    def _cap_worker(cls, v: int) -> int:
        if v < 1 or v > 2:
            raise ValueError("worker_capacity must be 1 or 2 in Release 1")
        return v

    @model_validator(mode="after")
    def _validate_auth_and_ai(self) -> Settings:
        bind = self.bind_host.strip()
        local_bind = bind in {"127.0.0.1", "::1", "localhost"}
        if self.allow_local_unauthenticated:
            if not local_bind:
                raise ValueError("BROWSERFLOW_ALLOW_LOCAL_UNAUTHENTICATED requires bind 127.0.0.1")
            if self.env == "production":
                raise ValueError("local unauthenticated mode is forbidden in production")
        if self.auth_mode == AuthMode.LOCAL_UNAUTHENTICATED and not (
            self.allow_local_unauthenticated and local_bind
        ):
            raise ValueError("local_unauthenticated auth mode is not permitted by config")
        if self.ai_provider == "fake" and self.env != "test":
            raise ValueError("Fake AI provider is test-only and cannot be used in this environment")
        if self.session_secure_cookie is False and self.env == "production" and not local_bind:
            raise ValueError("Secure session cookies are required when binding a public interface")
        return self

    @property
    def cors_origins(self) -> list[str]:
        return [part.strip() for part in self.allowed_origins.split(",") if part.strip()]

    @property
    def is_local_unauthenticated(self) -> bool:
        bind = self.bind_host.strip()
        return (
            self.allow_local_unauthenticated
            and bind in {"127.0.0.1", "::1", "localhost"}
            and self.env != "production"
        )

    def master_key(self) -> bytes:
        data = _read_secret_file(self.master_key_file)
        if data is None or len(data) < 32:
            if self.env == "test":
                return b"0" * 32
            raise RuntimeError("BROWSERFLOW_MASTER_KEY_FILE is missing or shorter than 32 bytes")
        return data[:32] if len(data) >= 32 else data.ljust(32, b"\0")

    def session_secret(self) -> bytes:
        data = _read_secret_file(self.session_secret_file)
        if data is None or len(data) < 32:
            if self.env == "test":
                return b"1" * 48
            raise RuntimeError("BROWSERFLOW_SESSION_SECRET_FILE is missing or too short")
        return data

    def private_allowlist(self) -> list[str]:
        return [p.strip() for p in self.private_network_allowlist.split(",") if p.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()


def require_production_secrets(settings: Settings) -> None:
    if settings.env == "test":
        return
    if not Path(settings.master_key_file).is_file():
        raise RuntimeError(f"master key file not found: {settings.master_key_file}")
    if not Path(settings.session_secret_file).is_file():
        raise RuntimeError(f"session secret file not found: {settings.session_secret_file}")
    # never log secret material
    _ = settings.master_key()
    _ = settings.session_secret()
