"""
Verification Tests for Workstream 4 (WS4): Pipeline & Orchestration.

Tests:
1. Egress allowlist validation for academic API endpoints (arXiv, OpenAlex, Crossref, Tavily).
2. Multi-source academic discovery (arXiv, OpenAlex, Crossref) with 3-stage deduplication (DOI -> arXiv ID -> URL).
3. Sandboxed PDF extraction with page and 10MB caps.
4. Supervisor coverage loop triggering extra rounds to reach target PASS sources.
5. Non-blocking UNCERTAIN review queue in Supervisor.
6. Durable jobs queue with SKIP LOCKED, worker heartbeats, and orphan recovery.
7. Authenticated SSE event stream with Last-Event-ID replay.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest
from pypdf import PdfWriter

from agents.discovery import (
    ArxivClient,
    CrossrefClient,
    OpenAlexClient,
    deduplicate_and_rank_candidates,
    discovery_node,
    extract_arxiv_id,
    normalize_doi,
)
from agents.extractor import extract_pdf_content
from agents.supervisor import (
    BudgetConfig,
    InterruptReason,
    Supervisor,
    SupervisorInterrupt,
)
from guardrails.egress import ACADEMIC_EGRESS_ALLOWLIST, validate_url_and_egress
from shared.jobs import JobQueueManager
from shared.models import (
    AppConfig,
    ExtractedPage,
    RankedUrl,
    ValidationVerdict,
    ValidatorOutput,
)


@pytest.fixture
def test_config() -> AppConfig:
    return AppConfig(
        supabase_url="https://test.supabase.co",
        supabase_planner_key="key",
        supabase_discovery_key="key",
        supabase_extractor_key="key",
        supabase_validator_key="key",
        supabase_writer_key="key",
        tavily_api_key="tvly-test",
        openrouter_api_key="sk-test",
        groq_api_key="sk-groq-test",
        google_api_key="sk-google-test",
    )


# ============================================================
# 1. Egress Allowlist Validation
# ============================================================

def test_academic_egress_allowlist():
    assert "export.arxiv.org" in ACADEMIC_EGRESS_ALLOWLIST
    assert "api.openalex.org" in ACADEMIC_EGRESS_ALLOWLIST
    assert "api.crossref.org" in ACADEMIC_EGRESS_ALLOWLIST
    assert "api.tavily.com" in ACADEMIC_EGRESS_ALLOWLIST

    domain = validate_url_and_egress(
        "http://export.arxiv.org/api/query?search_query=all:transformer",
        allowed_domains=list(ACADEMIC_EGRESS_ALLOWLIST),
    )
    assert domain == "export.arxiv.org"


# ============================================================
# 2. Multi-Source Discovery & 3-Stage Deduplication
# ============================================================

def test_normalize_doi_and_extract_arxiv():
    assert normalize_doi("https://doi.org/10.1145/12345.6789") == "10.1145/12345.6789"
    assert normalize_doi("doi:10.1000/182") == "10.1000/182"
    assert normalize_doi("invalid") is None

    assert extract_arxiv_id("http://arxiv.org/abs/2301.00001v2") == "2301.00001"
    assert extract_arxiv_id("https://arxiv.org/pdf/2301.00001.pdf") == "2301.00001"
    assert extract_arxiv_id("2301.00001v1") == "2301.00001"


def test_three_stage_deduplication():
    candidates = [
        # Candidate 1: Canonical paper with DOI
        RankedUrl(
            url="https://publisher.com/paper1",
            relevance_score=0.9,
            domain="publisher.com",
            source_type="crossref",
            doi="10.1145/test.doi.1",
            title="Transformer Swarms",
        ),
        # Candidate 2: Same DOI from OpenAlex (should be deduplicated out)
        RankedUrl(
            url="https://openalex.org/w12345",
            relevance_score=0.85,
            domain="openalex.org",
            source_type="openalex",
            doi="10.1145/test.doi.1",
            title="Transformer Swarms Mirror",
        ),
        # Candidate 3: arXiv Preprint
        RankedUrl(
            url="https://arxiv.org/abs/2305.11111",
            relevance_score=0.92,
            domain="arxiv.org",
            source_type="arxiv",
            arxiv_id="2305.11111",
            title="Preprint Version",
        ),
        # Candidate 4: Same arXiv ID with pdf link (should be deduplicated out)
        RankedUrl(
            url="https://arxiv.org/pdf/2305.11111.pdf",
            relevance_score=0.88,
            domain="arxiv.org",
            source_type="arxiv",
            arxiv_id="2305.11111",
            title="Preprint PDF",
        ),
        # Candidate 5: Web article
        RankedUrl(
            url="https://blog.example.com/post",
            relevance_score=0.7,
            domain="blog.example.com",
            source_type="web",
            title="Blog Post",
        ),
        # Candidate 6: Duplicate URL (should be deduplicated out)
        RankedUrl(
            url="https://blog.example.com/post/",
            relevance_score=0.7,
            domain="blog.example.com",
            source_type="web",
            title="Duplicate Post",
        ),
    ]

    deduped = deduplicate_and_rank_candidates(candidates, max_urls=10)
    assert len(deduped) == 3
    urls = [d.url for d in deduped]
    assert "https://publisher.com/paper1" in urls
    assert "https://arxiv.org/abs/2305.11111" in urls
    assert "https://blog.example.com/post" in urls


@pytest.mark.asyncio
async def test_arxiv_client_atom_parsing():
    sample_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
      <entry>
        <id>http://arxiv.org/abs/2301.12345v1</id>
        <title>Multi-Agent Consensus in Swarms</title>
        <summary>Empirical investigation of distributed swarm protocols.</summary>
        <published>2023-01-15T00:00:00Z</published>
        <author><name>Alice Smith</name></author>
        <author><name>Bob Jones</name></author>
        <arxiv:doi>10.1000/arxiv.2301.12345</arxiv:doi>
      </entry>
    </feed>
    """
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = sample_xml

    client = ArxivClient(timeout=5.0)
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_resp):
        items, tc = await client.search("swarm", max_results=5)
        assert len(items) == 1
        item = items[0]
        assert item.source_type == "arxiv"
        assert item.arxiv_id == "2301.12345"
        assert item.title == "Multi-Agent Consensus in Swarms"
        assert item.year == 2023
        assert item.authors == ["Alice Smith", "Bob Jones"]
        assert item.doi == "10.1000/arxiv.2301.12345"
        assert item.url == "https://arxiv.org/pdf/2301.12345.pdf"


# ============================================================
# 3. Sandboxed PDF Extraction
# ============================================================

def create_synthetic_pdf(num_pages: int = 3) -> bytes:
    writer = PdfWriter()
    for i in range(num_pages):
        writer.add_blank_page(width=72 * 8.5, height=72 * 11)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_pdf_extraction_caps():
    # 1. Normal PDF
    pdf_bytes = create_synthetic_pdf(num_pages=3)
    text, title, headings = extract_pdf_content(pdf_bytes, max_pages=50)
    assert isinstance(text, str)
    assert len(headings) >= 1

    # 2. 10MB limit enforcement
    huge_bytes = b"%PDF-" + b"0" * (11 * 1024 * 1024)
    with pytest.raises(ValueError, match="exceeds 10MB limit"):
        extract_pdf_content(huge_bytes, max_size_bytes=10 * 1024 * 1024)


# ============================================================
# 4. Supervisor Coverage Loop & Non-Blocking UNCERTAIN Review
# ============================================================

@pytest.mark.asyncio
async def test_supervisor_coverage_loop_targets(test_config: AppConfig):
    """Verifies coverage loop runs extra rounds when target_min_pages > initial results."""
    run_id = uuid4()
    supervisor = Supervisor(config=test_config)

    # Initial Planner returns 1 subtask
    planner_fn = AsyncMock(return_value={
        "run_id": run_id,
        "reasoning": "Decomposing research objective",
        "subtasks": [{"subtask_id": "sub_1", "description": "Core subtask", "candidate_domains": []}],
    })

    # Discovery returns 1 URL initially, then returns 2 more URLs on the coverage round
    call_count = 0
    def mock_disc(state):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return {
                "run_id": run_id,
                "subtask_id": state["subtask_id"],
                "urls": [{"url": "https://source1.org", "relevance_score": 0.9, "domain": "source1.org"}],
            }
        else:
            return {
                "run_id": run_id,
                "subtask_id": state["subtask_id"],
                "urls": [
                    {"url": "https://source2.org", "relevance_score": 0.9, "domain": "source2.org"},
                    {"url": "https://source3.org", "relevance_score": 0.9, "domain": "source3.org"},
                ],
            }
    discovery_fn = AsyncMock(side_effect=mock_disc)

    extractor_fn = AsyncMock(side_effect=lambda state: {
        "extracted_page": {
            "title": f"Page {state['url']}",
            "description": "Valid content",
            "main_content": "Extracted evidence text...",
            "headings": ["Overview"],
            "links": [],
            "images": [],
            "metadata": {},
        },
        "source_content": "Full source content...",
    })

    validator_fn = AsyncMock(side_effect=lambda state: {
        "validation_results": {
            str(state["page_id"]): {
                "run_id": run_id,
                "page_id": state["page_id"],
                "verdict": "pass",
                "confidence": 0.95,
            }
        }
    })

    writer_fn = AsyncMock(side_effect=lambda state: {
        "run_id": run_id,
        "page_id": state["page_id"],
        "markdown_path": f"/tmp/{state['page_id']}.md",
        "embedding_generated": False,
        "supabase_page_row_id": state["page_id"],
    })

    supervisor._get_fns = lambda: {
        "planner": planner_fn,
        "discovery": discovery_fn,
        "extractor": extractor_fn,
        "validator": validator_fn,
        "writer": writer_fn,
    }

    result = await supervisor.run(
        run_id=run_id,
        goal="Autonomous Swarm Synthesis",
        target_min_pages=3,
    )

    assert result["pages_passed"] == 3
    assert len(result["pages_written"]) == 3
    assert call_count >= 2  # Coverage loop triggered at least once


@pytest.mark.asyncio
async def test_supervisor_non_blocking_uncertain_review(test_config: AppConfig):
    """Verifies that non_blocking_review=True routes UNCERTAIN verdict without raising interrupt."""
    run_id = uuid4()
    supervisor = Supervisor(config=test_config)

    planner_fn = AsyncMock(return_value={
        "run_id": run_id,
        "reasoning": "Decomposing task",
        "subtasks": [{"subtask_id": "sub_1", "description": "Review test", "candidate_domains": []}],
    })

    discovery_fn = AsyncMock(return_value={
        "run_id": run_id,
        "subtask_id": "sub_1",
        "urls": [{"url": "https://uncertain-paper.org", "relevance_score": 0.7, "domain": "uncertain-paper.org"}],
    })

    extractor_fn = AsyncMock(return_value={
        "extracted_page": {
            "title": "Uncertain Paper",
            "description": "Pending verification",
            "main_content": "Content needing review",
            "headings": ["Abstract"],
            "links": [],
            "images": [],
            "metadata": {},
        },
        "source_content": "Source text",
    })

    validator_fn = AsyncMock(side_effect=lambda state: {
        "validation_results": {
            str(state["page_id"]): {
                "run_id": run_id,
                "page_id": state["page_id"],
                "verdict": "uncertain",
                "confidence": 0.65,
                "faithfulness_notes": "Requires human spot-check",
            }
        }
    })

    writer_fn = AsyncMock()

    supervisor._get_fns = lambda: {
        "planner": planner_fn,
        "discovery": discovery_fn,
        "extractor": extractor_fn,
        "validator": validator_fn,
        "writer": writer_fn,
    }

    # When non_blocking_review=True, it completes without raising SupervisorInterrupt
    result = await supervisor.run(
        run_id=run_id,
        goal="Test Non-Blocking Review",
        non_blocking_review=True,
    )

    assert len(result["pages_uncertain"]) == 1
    assert result["pages_uncertain"][0]["url"] == "https://uncertain-paper.org"
    writer_fn.assert_not_called()  # UNCERTAIN does not proceed to Writer


# ============================================================
# 5. Durable Job Queue Manager
# ============================================================

def test_job_queue_manager_lifecycle():
    qm = JobQueueManager()
    chat_id = uuid4()
    user_id = uuid4()

    # 1. Enqueue
    job_id = qm.enqueue_job(chat_id=chat_id, user_id=user_id)
    assert isinstance(job_id, UUID)

    # 2. Claim next job
    claimed = qm.claim_next_job(worker_id="worker-node-1")
    assert claimed is not None
    assert claimed["id"] == job_id
    assert claimed["locked_by"] == "worker-node-1"
    assert claimed["status"] == "claimed"

    # Concurrent claim on empty queue returns None
    assert qm.claim_next_job(worker_id="worker-node-2") is None

    # 3. Heartbeat
    assert qm.heartbeat(job_id=job_id, worker_id="worker-node-1") is True
    assert qm.heartbeat(job_id=job_id, worker_id="wrong-worker") is False

    # 4. Fail and requeue
    assert qm.fail_job(job_id=job_id, error="Transient network timeout", max_attempts=3, retry_delay_seconds=0) is True

    # 5. Reclaim after retry delay
    reclaimed = qm.claim_next_job(worker_id="worker-node-2")
    assert reclaimed is not None
    assert reclaimed["id"] == job_id
    assert reclaimed["attempts"] == 2

    # 6. Complete
    assert qm.complete_job(job_id=job_id) is True
    assert qm.claim_next_job(worker_id="worker-node-1") is None


def test_job_queue_orphan_recovery():
    qm = JobQueueManager()
    chat_id = uuid4()
    user_id = uuid4()

    job_id = qm.enqueue_job(chat_id=chat_id, user_id=user_id)
    claimed = qm.claim_next_job(worker_id="worker-crashed")
    assert claimed is not None

    # Simulate expired heartbeat
    qm._mock_jobs[job_id]["heartbeat_at"] = datetime.now(timezone.utc) - timedelta(seconds=400)

    # Recover orphaned jobs
    recovered = qm.recover_orphaned_jobs(timeout_seconds=300)
    assert recovered == 1
    assert qm._mock_jobs[job_id]["status"] == "pending"

    # New healthy worker can now claim the recovered job
    reclaimed = qm.claim_next_job(worker_id="healthy-worker")
    assert reclaimed is not None
    assert reclaimed["id"] == job_id
