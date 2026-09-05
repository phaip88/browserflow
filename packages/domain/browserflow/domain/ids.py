from __future__ import annotations

from uuid import UUID, uuid4


def new_id() -> UUID:
    return uuid4()


def parse_id(value: str | UUID) -> UUID:
    if isinstance(value, UUID):
        return value
    return UUID(str(value))
