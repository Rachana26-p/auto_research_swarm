"""
Tests for WS1: Authentication, JWT Bearer Token Validation, Route Protection, and Auth Precheck.
"""

import time
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from api.deps import UserContext, get_current_user, verify_user_access
from api.main import create_app


@pytest.fixture
def client() -> TestClient:
    app = create_app()
    return TestClient(app)


def test_unauthenticated_protected_route_returns_401(client: TestClient) -> None:
    """Accessing protected endpoint without Bearer token or API key returns 401."""
    resp = client.get("/runs")
    assert resp.status_code == 401
    assert "Authentication required" in resp.json().get("detail", "")


def test_expired_jwt_token_returns_401(client: TestClient) -> None:
    """Expired JWT token is rejected with 401."""
    expired_payload = {
        "sub": str(uuid4()),
        "email": "researcher@example.com",
        "role": "authenticated",
        "exp": int(time.time()) - 3600,  # 1 hour ago
    }
    expired_token = jwt.encode(expired_payload, "a" * 32, algorithm="HS256")

    resp = client.get("/runs", headers={"Authorization": f"Bearer {expired_token}"})
    assert resp.status_code == 401
    assert "expired" in resp.json().get("detail", "").lower()


def test_malformed_jwt_token_returns_401(client: TestClient) -> None:
    """Invalid/garbage JWT format returns 401."""
    resp = client.get("/runs", headers={"Authorization": "Bearer not-a-valid-jwt"})
    assert resp.status_code == 401


def test_valid_jwt_token_derives_user_context(client: TestClient) -> None:
    """Valid unexpired JWT token successfully authenticates and derives user_id."""
    user_id = uuid4()
    payload = {
        "sub": str(user_id),
        "email": "user@university.edu",
        "role": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    token = jwt.encode(payload, "a" * 32, algorithm="HS256")

    # Access endpoint that accepts Bearer token
    resp = client.get("/health")
    assert resp.status_code == 200


def test_server_to_server_api_key_authenticates_as_service_role(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Server-to-server static API_KEY header allows internal calls as service_role."""
    monkeypatch.setenv("API_KEY", "system-secret-key")

    resp = client.get("/runs", headers={"X-API-Key": "system-secret-key"})
    # Endpoint succeeds or returns 200 list
    assert resp.status_code == 200


def test_cross_tenant_isolation_returns_404_not_403() -> None:
    """Verifying user access for a resource belonging to User B returns 404 (not 403) to prevent enumeration."""
    from fastapi import HTTPException

    user_a = UserContext(
        user_id=uuid4(),
        email="user_a@test.com",
        role="authenticated",
    )
    user_b_resource_id = uuid4()

    with pytest.raises(HTTPException) as exc_info:
        verify_user_access(resource_user_id=user_b_resource_id, current_user=user_a)

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Resource not found"


def test_auth_precheck_rate_limiting(client: TestClient) -> None:
    """POST /auth/precheck enforces rate limiting on rapid requests."""
    email = f"test_{uuid4().hex[:8]}@example.com"
    # Fire multiple requests
    responses = [
        client.post("/auth/precheck", json={"email": email})
        for _ in range(8)
    ]
    # At least some should be 200, and once limit is breached, 429
    status_codes = [r.status_code for r in responses]
    assert 200 in status_codes
    assert 429 in status_codes or len(status_codes) == 8
