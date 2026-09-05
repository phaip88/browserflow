from __future__ import annotations

import os

import pytest
from browserflow.infrastructure.config import reset_settings_cache
from browserflow.infrastructure.db import models  # noqa: F401
from browserflow.infrastructure.db.base import Base
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

TEST_URL = os.environ.get(
    "BROWSERFLOW_TEST_DATABASE_URL",
    "postgresql+asyncpg://browserflow:browserflow_dev@127.0.0.1:5432/browserflow_test",
)


@pytest.fixture
async def db_engine():
    reset_settings_cache()
    engine = create_async_engine(TEST_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db_session(db_engine) -> AsyncSession:
    factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with factory() as session:
        yield session
        await session.rollback()
