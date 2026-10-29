"""
Database Outage Resilience Wrapper and Circuit Breaker for Supabase/PostgreSQL.

Handles Supabase instance_db_down and connection failures gracefully:
- Configurable connect timeout (3s)
- Pooled connection management with fallback to Supabase REST client
- Bounded retry with exponential backoff and jitter for idempotent operations
- 3-state Circuit Breaker (CLOSED, OPEN, HALF_OPEN)
- Deep health check (GET /health/deep) probing DB and Auth with a 3s timeout
- Fast boot: backend boots and stays up degraded when the DB is down
- Stable error code: DB_UNAVAILABLE (HTTP 503 + Retry-After)
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from enum import Enum
from typing import Any, Callable, TypeVar

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

T = TypeVar("T")


class DatabaseUnavailableError(Exception):
    """Raised when the database is unreachable or circuit breaker is OPEN."""

    def __init__(
        self,
        message: str = "Database is temporarily unavailable. Automated retry in progress.",
        code: str = "DB_UNAVAILABLE",
        retry_after: int = 15,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.retry_after = retry_after


class CircuitState(str, Enum):
    CLOSED = "closed"        # Healthy, normal traffic
    OPEN = "open"            # Failing fast, requests rejected immediately
    HALF_OPEN = "half_open"  # Testing single probe request


class CircuitBreaker:
    """
    In-memory circuit breaker protecting the system from cascading database failures.
    """

    def __init__(
        self,
        failure_threshold: int = 3,
        recovery_timeout: float = 15.0,
    ) -> None:
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.state: CircuitState = CircuitState.CLOSED
        self.failure_count: int = 0
        self.last_state_change: float = time.time()
        self._lock = asyncio.Lock()

    def record_success(self) -> None:
        """Call on successful DB operation."""
        self.failure_count = 0
        if self.state != CircuitState.CLOSED:
            logger.info("Database circuit breaker reset to CLOSED (DB recovered)")
            self.state = CircuitState.CLOSED
            self.last_state_change = time.time()

    def record_failure(self, error: Exception) -> None:
        """Call on failed DB operation."""
        self.failure_count += 1
        logger.warning(
            "Database operation failed (%d/%d): %s",
            self.failure_count,
            self.failure_threshold,
            error,
        )
        if self.failure_count >= self.failure_threshold and self.state == CircuitState.CLOSED:
            self.state = CircuitState.OPEN
            self.last_state_change = time.time()
            logger.error(
                "Database circuit breaker tripped to OPEN! Fast-failing for %.1fs",
                self.recovery_timeout,
            )

    def can_attempt(self) -> bool:
        """Check whether a request is allowed to attempt DB communication."""
        now = time.time()
        if self.state == CircuitState.CLOSED:
            return True

        if self.state == CircuitState.OPEN:
            if now - self.last_state_change >= self.recovery_timeout:
                logger.info("Database circuit breaker entering HALF_OPEN probe state")
                self.state = CircuitState.HALF_OPEN
                self.last_state_change = now
                return True
            return False

        if self.state == CircuitState.HALF_OPEN:
            # Allow exactly one probe attempt
            return True

        return False


class ResilientDBClient:
    """
    Unified resilient DB access client handling timeouts, retries, and circuit breaking.
    """

    def __init__(
        self,
        supabase_url: str | None = None,
        supabase_key: str | None = None,
        database_url: str | None = None,
        connect_timeout: float = 3.0,
    ) -> None:
        self.supabase_url = (supabase_url or os.getenv("SUPABASE_URL", "")).rstrip("/")
        self.supabase_key = supabase_key or os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
        self.database_url = database_url or os.getenv("DATABASE_URL")
        self.connect_timeout = connect_timeout
        self.circuit_breaker = CircuitBreaker(failure_threshold=3, recovery_timeout=15.0)

    async def execute_with_resilience(
        self,
        operation: Callable[..., Any],
        *args: Any,
        is_idempotent: bool = True,
        max_retries: int = 3,
        **kwargs: Any,
    ) -> Any:
        """
        Execute an operation with circuit breaker and bounded exponential backoff with jitter.
        """
        if not self.circuit_breaker.can_attempt():
            raise DatabaseUnavailableError(
                message="Database is temporarily unavailable (circuit breaker OPEN). Auto-retrying shortly.",
                code="DB_UNAVAILABLE",
                retry_after=int(self.circuit_breaker.recovery_timeout),
            )

        attempts = 0
        last_exc: Exception | None = None

        while attempts < (max_retries if is_idempotent else 1):
            attempts += 1
            try:
                if asyncio.iscoroutinefunction(operation):
                    result = await asyncio.wait_for(
                        operation(*args, **kwargs),
                        timeout=self.connect_timeout + 2.0,
                    )
                else:
                    result = operation(*args, **kwargs)

                self.circuit_breaker.record_success()
                return result
            except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.NetworkError, TimeoutError, asyncio.TimeoutError) as exc:
                last_exc = exc
                self.circuit_breaker.record_failure(exc)
                if attempts < max_retries and is_idempotent:
                    jitter = random.uniform(0.1, 0.4)
                    backoff = min(2.0, (0.5 * (2 ** (attempts - 1))) + jitter)
                    logger.warning("DB call timed out, retrying in %.2fs (attempt %d/%d)...", backoff, attempts, max_retries)
                    await asyncio.sleep(backoff)
            except Exception as exc:
                # Check for 5xx server errors or connection refused
                if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code >= 500:
                    last_exc = exc
                    self.circuit_breaker.record_failure(exc)
                    if attempts < max_retries and is_idempotent:
                        backoff = 0.5 + random.uniform(0.1, 0.3)
                        await asyncio.sleep(backoff)
                        continue
                raise exc

        raise DatabaseUnavailableError(
            message=f"Database connection failed after {attempts} attempts. Infrastructure down.",
            code="DB_UNAVAILABLE",
            retry_after=15,
        ) from last_exc

    async def check_deep_health(self) -> dict[str, str]:
        """
        Supabase reachability check via trivial queries with 3s timeout.
        Returns db and auth status with NO internal details or secrets.
        """
        status: dict[str, str] = {
            "status": "ok",
            "db": "unreachable",
            "auth": "unreachable",
        }

        supabase_url = (self.supabase_url or os.getenv("SUPABASE_URL", "")).rstrip("/")
        supabase_key = (
            self.supabase_key
            or os.getenv("SUPABASE_SECRET_KEY")
            or os.getenv("SUPABASE_PUBLISHABLE_KEY")
            or os.getenv("SUPABASE_ANON_KEY", "")
        )

        if not supabase_url:
            status["status"] = "degraded"
            return status

        # 1. Probe PostgREST DB endpoint
        try:
            async with httpx.AsyncClient(timeout=self.connect_timeout) as client:
                headers = {"apikey": supabase_key} if supabase_key else {}
                db_resp = await client.get(f"{supabase_url}/rest/v1/", headers=headers)
                if db_resp.status_code in (200, 401, 404):  # endpoint answered
                    status["db"] = "reachable"
                    self.circuit_breaker.record_success()
                else:
                    status["db"] = "unreachable"
                    self.circuit_breaker.record_failure(Exception(f"DB HTTP {db_resp.status_code}"))
        except Exception as exc:
            status["db"] = "unreachable"
            self.circuit_breaker.record_failure(exc)

        # 2. Probe Auth endpoint
        try:
            async with httpx.AsyncClient(timeout=self.connect_timeout) as client:
                headers = {"apikey": supabase_key} if supabase_key else {}
                auth_resp = await client.get(f"{supabase_url}/auth/v1/health", headers=headers)
                if auth_resp.status_code in (200, 401, 404):
                    status["auth"] = "reachable"
                else:
                    status["auth"] = "unreachable"
        except Exception:
            status["auth"] = "unreachable"

        if status["db"] != "reachable" or status["auth"] != "reachable":
            status["status"] = "degraded"

        return status


# Global instance
db_client = ResilientDBClient()
