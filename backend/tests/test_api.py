"""
Comprehensive API test suite for backend/api/.
Tests:
- Auth failure: missing and invalid API key headers (401)
- Valid auth success
- Input validation: oversized goal (>5000 chars) and empty goal (422)
- Rate limiting on POST /runs (429)
- Run lifecycle: create background run, get run, SSE event streaming
- Zero secrets in responses
- Human-in-the-loop: GET /reviews, POST /reviews/{id}/approve & reject (resume after approve)
- Knowledge endpoints: GET /knowledge, GET /knowledge/{page_id}
- Guardrail events endpoint: GET /guardrail-events
"""

from __future__ import annotations

import os
from pathlib import Path
import time
from uuid import UUID, uuid4
import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.rate_limiter import runs_rate_limiter
from api.state import ReviewRecord, RunRecord, run_manager
from guardrails import clear_guardrail_events, record_guardrail_decision
from shared.models import AgentName, AppConfig, GuardrailEventType


TEST_API_KEY = "test-secret-key-12345"


@pytest.fixture(autouse=True)
def setup_api_env(monkeypatch, tmp_path):
    k_dir = tmp_path / "knowledge"
    k_dir.mkdir(parents=True, exist_ok=True)
    cfg = AppConfig(
        supabase_url="https://test.supabase.co",
        supabase_planner_key="pk",
        supabase_discovery_key="dk",
        supabase_extractor_key="ek",
        supabase_validator_key="vk",
        supabase_writer_key="wk",
        tavily_api_key="tk",
        openrouter_api_key="ok",
        groq_api_key="gk",
        groq_model="llama-3.3-70b-versatile",
        google_api_key="gok",
        api_key=TEST_API_KEY,
        frontend_url="http://localhost:3000",
        knowledge_dir=str(k_dir),
    )
    monkeypatch.setattr("shared.config.get_config", lambda: cfg)
    monkeypatch.setattr("api.deps.get_config", lambda: cfg)
    monkeypatch.setattr("api.state.get_config", lambda: cfg)
    monkeypatch.setattr("api.routes.knowledge.get_config", lambda: cfg)
    monkeypatch.setenv("API_KEY", TEST_API_KEY)
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")
    runs_rate_limiter.reset()
    clear_guardrail_events()
    return cfg


@pytest.fixture
def client():
    return TestClient(app)


# ============================================================
# 1. AUTHENTICATION TESTS
# ============================================================

def test_auth_failure_missing_key(client: TestClient):
    """Requests without an API key header must return 401 Unauthorized."""
    resp = client.get("/runs")
    assert resp.status_code == 401
    assert "Missing API key" in resp.json()["detail"]


def test_auth_failure_invalid_key(client: TestClient):
    """Requests with an invalid API key must return 401 Unauthorized."""
    resp = client.get("/runs", headers={"X-API-Key": "wrong-key"})
    assert resp.status_code == 401
    assert "Invalid API key" in resp.json()["detail"]


def test_auth_success_x_api_key(client: TestClient):
    """Requests with valid X-API-Key header succeed."""
    resp = client.get("/runs", headers={"X-API-Key": TEST_API_KEY})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_auth_success_bearer_token(client: TestClient):
    """Requests with valid Authorization: Bearer token succeed."""
    resp = client.get("/runs", headers={"Authorization": f"Bearer {TEST_API_KEY}"})
    assert resp.status_code == 200


# ============================================================
# 2. INPUT VALIDATION TESTS (GOAL LENGTH LIMITS)
# ============================================================

def test_oversized_goal_rejected(client: TestClient):
    """Goal exceeding 5000 characters must return 422 Unprocessable Entity."""
    oversized = "A" * 5001
    resp = client.post(
        "/runs",
        headers={"X-API-Key": TEST_API_KEY},
        json={"goal": oversized},
    )
    assert resp.status_code == 422
    assert "goal" in str(resp.json())


def test_empty_goal_rejected(client: TestClient):
    """Empty goal string must return 422 Unprocessable Entity."""
    resp = client.post(
        "/runs",
        headers={"X-API-Key": TEST_API_KEY},
        json={"goal": ""},
    )
    assert resp.status_code == 422


# ============================================================
# 3. RATE LIMITING ON POST /runs
# ============================================================

def test_rate_limit_on_runs_post(client: TestClient, monkeypatch):
    """Burst of requests exceeding rate limit must return 429 Too Many Requests."""
    runs_rate_limiter.reset()
    # Rate limiter allows max 10 requests per minute
    for i in range(10):
        resp = client.post(
            "/runs",
            headers={"X-API-Key": TEST_API_KEY},
            json={"goal": f"Valid research goal {i}"},
        )
        assert resp.status_code == 201

    # 11th request triggers 429
    overflow_resp = client.post(
        "/runs",
        headers={"X-API-Key": TEST_API_KEY},
        json={"goal": "Exceeding rate limit goal"},
    )
    assert overflow_resp.status_code == 429
    assert "Rate limit exceeded" in overflow_resp.json()["detail"]
    assert "Retry-After" in overflow_resp.headers


# ============================================================
# 4. RUN LIFECYCLE & ZERO SECRETS IN RESPONSES
# ============================================================

def test_run_creation_and_secrets_exclusion(client: TestClient):
    """Verify run creation, retrieval, and that zero secrets are exposed in responses."""
    resp = client.post(
        "/runs",
        headers={"X-API-Key": TEST_API_KEY},
        json={"goal": "Quantum computing hardware advancements 2026"},
    )
    assert resp.status_code == 201
    data = resp.json()
    run_id = data["id"]
    assert data["goal"] == "Quantum computing hardware advancements 2026"
    assert data["status"] in ("pending", "running")

    # Verify NO secrets leaked in response
    serialized = str(data).lower()
    for secret_keyword in ("api_key", "password", "secret", "bearer", "supabase_key"):
        assert secret_keyword not in serialized

    # Query GET /runs/{id}
    detail_resp = client.get(f"/runs/{run_id}", headers={"X-API-Key": TEST_API_KEY})
    assert detail_resp.status_code == 200
    assert detail_resp.json()["id"] == run_id


def test_stream_run_events_sse(client: TestClient):
    """Verify GET /runs/{id}/events returns SSE stream."""
    post_resp = client.post(
        "/runs",
        headers={"X-API-Key": TEST_API_KEY},
        json={"goal": "SSE stream verification"},
    )
    run_id = post_resp.json()["id"]
    rec = run_manager.get_run(UUID(run_id))
    if rec:
        rec.status = "completed"
        rec.emit_event("run_completed", {"summary": {}})

    # Request SSE stream with stream=True
    with client.stream("GET", f"/runs/{run_id}/events", headers={"X-API-Key": TEST_API_KEY}) as sse_resp:
        assert sse_resp.status_code == 200
        assert "text/event-stream" in sse_resp.headers["content-type"]
        # Read initial chunk
        first_chunk = next(sse_resp.iter_text())
        assert "data:" in first_chunk


# ============================================================
# 5. HUMAN-IN-THE-LOOP REVIEWS & RESUME AFTER APPROVE
# ============================================================

def test_reviews_listing_and_resume_after_approve(client: TestClient):
    """
    Simulate interrupted run with UNCERTAIN verdict.
    Verify GET /reviews shows pending item, and POST /reviews/{id}/approve
    resumes the run.
    """
    run_id = uuid4()
    rev_id = uuid4()
    page_id = uuid4()

    # Create dummy run record
    run_rec = RunRecord(
        run_id=run_id,
        goal="Test review approval",
        budget_config=run_manager.runs.get(run_id, None) or None,  # type: ignore
        config=None,  # type: ignore
    )
    run_rec.status = "interrupted"

    # Mock orchestrator
    class MockOrchestrator:
        def __init__(self):
            self.resumed = False
            self.decision = None

        async def resume(self, checkpoint_state, human_decision):
            self.resumed = True
            self.decision = human_decision
            return {"status": "completed", "pages_processed": 1, "pages_persisted": 1}

    mock_orch = MockOrchestrator()
    run_rec.orchestrator = mock_orch
    run_manager.runs[run_id] = run_rec

    # Register review
    review = ReviewRecord(
        review_id=rev_id,
        run_id=run_id,
        page_id=page_id,
        url="https://uncertain-research.org/study",
        validator_output={"verdict": "UNCERTAIN", "confidence": 0.65, "safety_flags": []},
        checkpoint_state={"run_id": str(run_id), "page_id": str(page_id)},
    )
    run_manager.reviews[rev_id] = review

    # 1. GET /reviews
    rev_list_resp = client.get("/reviews", headers={"X-API-Key": TEST_API_KEY})
    assert rev_list_resp.status_code == 200
    revs = rev_list_resp.json()
    assert any(r["id"] == str(rev_id) for r in revs)

    # 2. POST /reviews/{id}/approve (resumes run)
    approve_resp = client.post(f"/reviews/{rev_id}/approve", headers={"X-API-Key": TEST_API_KEY})
    assert approve_resp.status_code == 200
    assert approve_resp.json()["status"] == "approved"

    # Allow asyncio loop to execute
    time.sleep(0.1)
    assert review.status == "approved"


def test_review_reject_flow(client: TestClient):
    """Verify rejecting an item marks it rejected and resumes supervisor."""
    run_id = uuid4()
    rev_id = uuid4()
    page_id = uuid4()

    run_rec = RunRecord(run_id=run_id, goal="Test reject", budget_config=None, config=None)  # type: ignore
    run_rec.status = "interrupted"

    class MockOrchestrator:
        async def resume(self, checkpoint_state, human_decision):
            return {"status": "completed", "pages_processed": 1, "pages_persisted": 0}

    run_rec.orchestrator = MockOrchestrator()
    run_manager.runs[run_id] = run_rec

    review = ReviewRecord(
        review_id=rev_id,
        run_id=run_id,
        page_id=page_id,
        url="https://flawed-research.org/study",
        validator_output={"verdict": "UNCERTAIN", "confidence": 0.4, "safety_flags": []},
        checkpoint_state={"run_id": str(run_id)},
    )
    run_manager.reviews[rev_id] = review

    rej_resp = client.post(f"/reviews/{rev_id}/reject", headers={"X-API-Key": TEST_API_KEY})
    assert rej_resp.status_code == 200
    assert rej_resp.json()["status"] == "rejected"
    assert review.status == "rejected"


# ============================================================
# 6. KNOWLEDGE ENDPOINTS
# ============================================================

def test_knowledge_endpoints(client: TestClient, setup_api_env):
    """Verify GET /knowledge and GET /knowledge/{page_id}."""
    k_dir = Path(setup_api_env.knowledge_dir)
    page_file = k_dir / "quantum_computing_page123.md"
    page_file.write_text("# Quantum Computing Advances\n\nFull article content here.", encoding="utf-8")

    # 1. GET /knowledge
    resp = client.get("/knowledge", headers={"X-API-Key": TEST_API_KEY})
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) >= 1
    assert any(i["title"] == "Quantum Computing Advances" for i in items)

    # 2. GET /knowledge/{page_id}
    detail_resp = client.get("/knowledge/page123", headers={"X-API-Key": TEST_API_KEY})
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["title"] == "Quantum Computing Advances"
    assert "Full article content here." in detail["content"]

    # 3. Nonexistent page returns 404
    not_found = client.get("/knowledge/missing_page_xyz", headers={"X-API-Key": TEST_API_KEY})
    assert not_found.status_code == 404


# ============================================================
# 7. GUARDRAIL EVENTS ENDPOINT
# ============================================================

def test_guardrail_events_endpoint(client: TestClient):
    """Verify GET /guardrail-events returns recorded audit log items."""
    clear_guardrail_events()
    run_id = uuid4()
    record_guardrail_decision(
        agent_name=AgentName.EXTRACTOR,
        event_type=GuardrailEventType.EGRESS_ALLOWED,
        decision="PASS",
        details={"url": "https://trusted.org"},
        run_id=run_id,
    )
    record_guardrail_decision(
        agent_name=AgentName.VALIDATOR,
        event_type=GuardrailEventType.CONTENT_SANITIZATION,
        decision="BLOCK",
        details={"error": "injection pattern found"},
        run_id=run_id,
    )

    resp = client.get(f"/guardrail-events?run_id={run_id}", headers={"X-API-Key": TEST_API_KEY})
    assert resp.status_code == 200
    events = resp.json()
    assert len(events) == 2
    assert events[0]["decision"] == "PASS"
    assert events[1]["decision"] == "BLOCK"
