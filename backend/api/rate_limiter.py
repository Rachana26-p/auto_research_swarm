"""
In-memory sliding window rate limiter for POST /runs endpoint.
"""

from __future__ import annotations

import collections
import time
from fastapi import HTTPException, Request


class RateLimiter:
    """Sliding-window in-memory rate limiter."""

    def __init__(self, max_requests: int = 10, window_seconds: float = 60.0) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._history: dict[str, collections.deque[float]] = collections.defaultdict(collections.deque)

    def check(self, key: str) -> None:
        now = time.time()
        q = self._history[key]

        # Evict timestamps older than window
        while q and q[0] <= now - self.window_seconds:
            q.popleft()

        if len(q) >= self.max_requests:
            retry_after = int(self.window_seconds - (now - q[0])) + 1
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded. Maximum {self.max_requests} runs per {int(self.window_seconds)}s allowed.",
                headers={"Retry-After": str(retry_after)},
            )

        q.append(now)

    def reset(self) -> None:
        """Reset rate limiter state (useful in testing)."""
        self._history.clear()


runs_rate_limiter = RateLimiter(max_requests=10, window_seconds=60.0)


async def rate_limit_runs(request: Request) -> None:
    """FastAPI dependency to rate limit run creation."""
    client_ip = request.client.host if request.client else "unknown"
    runs_rate_limiter.check(client_ip)
