from __future__ import annotations

import time
from collections import defaultdict
from threading import Lock

from browserflow.domain.errors import AuthError


class SlidingWindowLimiter:
    def __init__(self, *, limit: int, window_seconds: int = 60) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def check(self, key: str) -> None:
        now = time.time()
        with self._lock:
            bucket = [t for t in self._hits[key] if now - t < self.window]
            if len(bucket) >= self.limit:
                self._hits[key] = bucket
                raise AuthError("too many attempts, try later")
            bucket.append(now)
            self._hits[key] = bucket


login_limiter = SlidingWindowLimiter(limit=10, window_seconds=60)
