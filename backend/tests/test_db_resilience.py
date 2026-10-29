"""
Tests for WS0: Database Outage Resilience, Health Endpoints, Circuit Breaker, and paused_infra.
"""

import asyncio
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from shared.db import CircuitBreaker, CircuitState, DatabaseUnavailableError, ResilientDBClient
from shared.models import RunStatus


@pytest.fixture
def client() -> TestClient:
    app = create_app()
    return TestClient(app)


def test_health_liveness(client: TestClient) -> None:
    """GET /health must return 200 OK with zero external dependencies."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert "service" in data


@pytest.mark.asyncio
async def test_deep_health_reachable() -> None:
    """GET /health/deep returns 200 and reachable status when DB responds."""
    client = ResilientDBClient(supabase_url="https://mock.supabase.co", supabase_key="test-key")
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value.status_code = 200
        health = await client.check_deep_health()
        assert health["status"] == "ok"
        assert health["db"] == "reachable"
        assert health["auth"] == "reachable"


@pytest.mark.asyncio
async def test_deep_health_unreachable_returns_degraded() -> None:
    """GET /health/deep returns degraded when Supabase DB is down."""
    client = ResilientDBClient(supabase_url="https://mock.supabase.co", supabase_key="test-key")
    with patch("httpx.AsyncClient.get", side_effect=Exception("Connection refused")):
        health = await client.check_deep_health()
        assert health["status"] == "degraded"
        assert health["db"] == "unreachable"


def test_deep_health_endpoint_503(client: TestClient) -> None:
    """Test that FastAPI returns 503 with Retry-After when /health/deep is degraded."""
    with patch("shared.db.db_client.check_deep_health", new_callable=AsyncMock) as mock_health:
        mock_health.return_value = {"status": "degraded", "db": "unreachable", "auth": "reachable"}
        resp = client.get("/health/deep")
        assert resp.status_code == 503
        assert resp.headers.get("Retry-After") == "15"
        assert resp.json()["status"] == "degraded"


def test_circuit_breaker_transitions() -> None:
    """Circuit breaker should trip to OPEN after 3 failures, then HALF_OPEN after timeout."""
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout=0.2)
    assert cb.state == CircuitState.CLOSED
    assert cb.can_attempt() is True

    # 1st failure
    cb.record_failure(Exception("Fail 1"))
    assert cb.state == CircuitState.CLOSED

    # 2nd failure
    cb.record_failure(Exception("Fail 2"))
    assert cb.state == CircuitState.CLOSED

    # 3rd failure trips circuit breaker
    cb.record_failure(Exception("Fail 3"))
    assert cb.state == CircuitState.OPEN
    assert cb.can_attempt() is False

    # Wait for recovery timeout
    import time
    time.sleep(0.25)
    assert cb.can_attempt() is True
    assert cb.state == CircuitState.HALF_OPEN

    # Success in half open resets to CLOSED
    cb.record_success()
    assert cb.state == CircuitState.CLOSED
    assert cb.failure_count == 0


def test_db_unavailable_exception_handler(client: TestClient) -> None:
    """Ensure DatabaseUnavailableError is rendered as 503 with Retry-After and stable error code."""
    from fastapi import APIRouter
    app = create_app()

    test_router = APIRouter()
    @test_router.get("/test-db-error")
    def fail_endpoint() -> None:
        raise DatabaseUnavailableError(
            message="Database connection failed",
            code="DB_UNAVAILABLE",
            retry_after=15,
        )

    app.include_router(test_router)
    custom_client = TestClient(app)

    resp = custom_client.get("/test-db-error")
    assert resp.status_code == 503
    assert resp.headers.get("retry-after") == "15"
    data = resp.json()
    assert data["error"]["code"] == "DB_UNAVAILABLE"
    assert "retry_after" in data["error"]


def test_run_status_paused_infra_enum() -> None:
    """Verify PAUSED_INFRA is a valid RunStatus."""
    assert RunStatus.PAUSED_INFRA.value == "paused_infra"
    assert RunStatus.PAUSED_QUOTA.value == "paused_quota"
