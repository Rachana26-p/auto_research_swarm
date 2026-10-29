"""
Tests for WS2: Data Model, Chat Isolation, Cross-Tenant Security, and Cascade Deletions.
"""

import os
import time
from uuid import uuid4

import jwt
from fastapi.testclient import TestClient

from api.main import create_app

os.environ["TEST_JWT_SECRET"] = "a" * 32


def create_token(user_id: str, email: str) -> str:
    """Generate signed JWT token for testing."""
    payload = {
        "sub": user_id,
        "email": email,
        "role": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    return jwt.encode(payload, "a" * 32, algorithm="HS256")


def test_user_can_create_and_list_own_chats() -> None:
    """User A creates a chat and lists it."""
    client = TestClient(create_app())
    user_a_id = str(uuid4())
    token_a = create_token(user_a_id, "user_a@test.com")

    # 1. Create chat
    create_resp = client.post(
        "/chats",
        json={
            "title": "Quantum Computing Survey",
            "query": "Quantum algorithms and fault-tolerant architecture",
            "params": {"min_pages": 5, "max_pages": 10},
        },
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert create_resp.status_code == 201
    chat = create_resp.json()
    assert chat["title"] == "Quantum Computing Survey"
    assert chat["user_id"] == user_a_id
    assert chat["params"]["min_pages"] == 5

    # 2. List chats for User A
    list_resp = client.get("/chats", headers={"Authorization": f"Bearer {token_a}"})
    assert list_resp.status_code == 200
    user_a_chats = list_resp.json()
    assert len(user_a_chats) >= 1
    assert any(c["id"] == chat["id"] for c in user_a_chats)


def test_cross_tenant_isolation_returns_404_not_403() -> None:
    """User B attempting to read or update User A's chat gets 404 (Not Found), preventing enumeration."""
    client = TestClient(create_app())
    user_a_id = str(uuid4())
    user_b_id = str(uuid4())
    token_a = create_token(user_a_id, "user_a@test.com")
    token_b = create_token(user_b_id, "user_b@test.com")

    # 1. User A creates chat
    create_resp = client.post(
        "/chats",
        json={"title": "Proprietary AI Architecture", "query": "internal models"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert create_resp.status_code == 201
    chat_a_id = create_resp.json()["id"]

    # 2. User B tries to read User A's chat
    read_resp = client.get(f"/chats/{chat_a_id}", headers={"Authorization": f"Bearer {token_b}"})
    assert read_resp.status_code == 404
    assert read_resp.json()["detail"] == "Resource not found"

    # 3. User B tries to update User A's chat
    update_resp = client.patch(
        f"/chats/{chat_a_id}",
        json={"title": "Hacked Title"},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert update_resp.status_code == 404

    # 4. User B lists chats -> sees NOTHING belonging to User A
    list_b = client.get("/chats", headers={"Authorization": f"Bearer {token_b}"})
    assert list_b.status_code == 200
    b_chats = list_b.json()
    assert not any(c["id"] == chat_a_id for c in b_chats)


def test_cascade_deletion_leaves_no_orphans() -> None:
    """Deleting a chat cascades through all dependent entities with zero orphans."""
    client = TestClient(create_app())
    user_id = str(uuid4())
    token = create_token(user_id, "owner@test.com")

    # 1. Create chat
    create_resp = client.post(
        "/chats",
        json={"title": "Temporary Research", "query": "temporary topic"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_resp.status_code == 201
    chat_id = create_resp.json()["id"]

    # 2. Check paper exists
    paper_resp = client.get(f"/chats/{chat_id}/paper", headers={"Authorization": f"Bearer {token}"})
    assert paper_resp.status_code == 200

    # 3. Delete chat
    del_resp = client.delete(f"/chats/{chat_id}", headers={"Authorization": f"Bearer {token}"})
    assert del_resp.status_code == 204

    # 4. Verify chat and paper are both gone (404)
    assert client.get(f"/chats/{chat_id}", headers={"Authorization": f"Bearer {token}"}).status_code == 404
    assert client.get(f"/chats/{chat_id}/paper", headers={"Authorization": f"Bearer {token}"}).status_code == 404
    assert client.get(f"/chats/{chat_id}/sources", headers={"Authorization": f"Bearer {token}"}).status_code == 404
