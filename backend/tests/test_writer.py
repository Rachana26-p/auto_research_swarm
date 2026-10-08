"""
Unit tests for Writer Agent.

Per /context/agents/writer.md Test requirements:
1. Unit test asserting Writer raises/refuses if verdict != PASS
2. Unit test with mocked Supabase client asserting correct table/columns used, no writes to any other table
3. Unit test asserting atomic write behavior (simulate interruption, confirm no partial file left in /knowledge/)
4. Unit test asserting re-running for the same page_id upserts rather than duplicates
5. Unit test asserting embedding failure logs clearly but does not roll back the already-valid .md file and pages row

Additional tests:
- Refusal when verdict is FAIL or UNCERTAIN
- Enforces strict path confinement to /knowledge/ (cannot write to outside paths)
- Deterministic markdown generation verification
- Synchronous wrapper test (run_writer_sync)
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest
from tenacity import wait_none

from agents.writer import (
    EmbeddingClient,
    SupabaseWriterClient,
    atomic_write_markdown,
    generate_knowledge_markdown,
    run_writer_sync,
    writer_node,
)
from shared.models import (
    AppConfig,
    ExtractedLink,
    ExtractedMetadata,
    ExtractedPage,
    ValidationVerdict,
    ValidatorOutput,
    WriterInput,
)


@pytest.fixture
def mock_config(tmp_path: Path) -> AppConfig:
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir(parents=True, exist_ok=True)
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
        groq_model="llama-3.3-70b-versatile",
        google_api_key="sk-google-test",
        embedding_model="text-embedding-004",
        embedding_dimensions=768,
        knowledge_dir=str(knowledge_dir),
    )


@pytest.fixture
def sample_extracted_page() -> ExtractedPage:
    return ExtractedPage(
        title="Attention Is All You Need",
        description="Transformer neural network architecture paper.",
        main_content="The dominant sequence transduction models are based on complex recurrent or convolutional neural networks...",
        headings=["Introduction", "Model Architecture", "Attention Mechanism"],
        links=[ExtractedLink(url="https://arxiv.org/abs/1706.03762", text="Paper")],
        metadata=ExtractedMetadata(
            author="Ashish Vaswani et al.",
            published_date="2017-06-12",
            tags=["nlp", "transformers", "deep-learning"],
        ),
    )


@pytest.fixture
def sample_pass_validator_output() -> ValidatorOutput:
    return ValidatorOutput(
        run_id=uuid4(),
        page_id=uuid4(),
        verdict=ValidationVerdict.PASS,
        confidence=0.95,
        faithfulness_notes="All claims verified against source text.",
        relevance_notes="Directly answers the transformer attention subtask.",
        safety_flags=[],
    )


class TestWriterUnit:
    """Core Writer agent tests matching spec requirements."""

    @pytest.mark.asyncio
    async def test_writer_refuses_if_verdict_not_pass(
        self,
        mock_config: AppConfig,
        sample_extracted_page: ExtractedPage,
    ) -> None:
        """1. Unit test asserting Writer raises/refuses if verdict != PASS."""
        run_id = uuid4()
        page_id = uuid4()

        # Test FAIL verdict
        fail_val = ValidatorOutput(
            run_id=run_id,
            page_id=page_id,
            verdict=ValidationVerdict.FAIL,
            confidence=0.90,
            faithfulness_notes="Fabricated statements found",
            relevance_notes="Irrelevant to subtask",
        )

        with patch("agents.writer.get_config", return_value=mock_config):
            with pytest.raises(ValueError, match="Writer refused execution: validation verdict is 'fail'"):
                await writer_node({
                    "run_id": run_id,
                    "page_id": page_id,
                    "source_url": "https://arxiv.org/abs/1706.03762",
                    "extracted_content": sample_extracted_page.model_dump(),
                    "validation_result": fail_val.model_dump(),
                })

        # Test UNCERTAIN verdict
        uncertain_val = ValidatorOutput(
            run_id=run_id,
            page_id=page_id,
            verdict=ValidationVerdict.UNCERTAIN,
            confidence=0.60,
            faithfulness_notes="Could not verify claims completely",
        )

        with patch("agents.writer.get_config", return_value=mock_config):
            with pytest.raises(ValueError, match="Writer refused execution: validation verdict is 'uncertain'"):
                await writer_node({
                    "run_id": run_id,
                    "page_id": page_id,
                    "source_url": "https://arxiv.org/abs/1706.03762",
                    "extracted_content": sample_extracted_page.model_dump(),
                    "validation_result": uncertain_val.model_dump(),
                })

    @pytest.mark.asyncio
    async def test_writer_supabase_writes_only_to_pages_and_embeddings(
        self,
        mock_config: AppConfig,
        sample_extracted_page: ExtractedPage,
        sample_pass_validator_output: ValidatorOutput,
    ) -> None:
        """2. Unit test with mocked Supabase client asserting correct table/columns used, no writes to any other table."""
        run_id = uuid4()
        page_id = uuid4()
        val = ValidatorOutput(
            run_id=run_id,
            page_id=page_id,
            verdict=ValidationVerdict.PASS,
            confidence=0.98,
            faithfulness_notes="Perfect match",
        )

        # Mock embedding response (Gemini text-embedding-004)
        mock_emb_resp = MagicMock(status_code=200)
        mock_emb_resp.json.return_value = {
            "embedding": {"values": [0.1] * 768}
        }

        # Mock Supabase responses
        mock_sb_page_resp = MagicMock(status_code=201)
        mock_sb_page_resp.json.return_value = [{"id": str(page_id)}]
        mock_sb_emb_resp = MagicMock(status_code=201)
        mock_sb_emb_resp.json.return_value = [{"id": str(uuid4())}]

        captured_urls: list[str] = []

        async def _mock_post(url, **kwargs):
            url_str = str(url)
            captured_urls.append(url_str)
            if "embedContent" in url_str or "googleapis.com" in url_str:
                return mock_emb_resp
            if "/rest/v1/embeddings" in url_str:
                return mock_sb_emb_resp
            return mock_sb_page_resp

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=_mock_post), \
             patch("agents.writer.get_config", return_value=mock_config):
            result = await writer_node({
                "run_id": run_id,
                "page_id": page_id,
                "source_url": "https://arxiv.org/abs/1706.03762",
                "extracted_content": sample_extracted_page.model_dump(),
                "validation_result": val.model_dump(),
            })

            assert result["page_id"] == page_id
            assert result["embedding_generated"] is True

            # Verify that only /pages and /embeddings endpoints were accessed in Supabase
            sb_endpoints = [u for u in captured_urls if "supabase.co" in u]
            for endpoint in sb_endpoints:
                assert "/rest/v1/pages" in endpoint or "/rest/v1/embeddings" in endpoint
                # Explicitly confirm no writes to runs, agent_logs, guardrail_events, etc.
                assert "/rest/v1/runs" not in endpoint
                assert "/rest/v1/agent_logs" not in endpoint
                assert "/rest/v1/guardrail_events" not in endpoint

        # Direct table check on SupabaseWriterClient
        client = SupabaseWriterClient(mock_config)
        with pytest.raises(ValueError, match="Security violation: Writer is forbidden"):
            client._assert_table_allowed("runs")
        with pytest.raises(ValueError, match="Security violation: Writer is forbidden"):
            client._assert_table_allowed("agent_logs")
        client._assert_table_allowed("pages")
        client._assert_table_allowed("embeddings")

    def test_writer_atomic_write_leaves_no_partial_file_on_error(
        self,
        tmp_path: Path,
    ) -> None:
        """3. Unit test asserting atomic write behavior (simulate interruption, confirm no partial file left in /knowledge/)."""
        knowledge_dir = tmp_path / "knowledge"
        knowledge_dir.mkdir(parents=True, exist_ok=True)
        filename = "interrupted_page.md"
        target_path = knowledge_dir / filename

        # Simulate interruption during writing by patching os.fdopen to raise IOError
        with patch("os.fdopen", side_effect=IOError("Simulated disk full / interruption")):
            with pytest.raises(IOError, match="Simulated disk full"):
                atomic_write_markdown(
                    knowledge_dir=knowledge_dir,
                    filename=filename,
                    content="# Incomplete content",
                )

        # Confirm target file does NOT exist in knowledge_dir
        assert not target_path.exists()

        # Confirm no temporary files were left behind in knowledge_dir
        leftovers = list(knowledge_dir.glob(".tmp_writer_*"))
        assert len(leftovers) == 0

    @pytest.mark.asyncio
    async def test_writer_idempotency_upserts_same_page_id(
        self,
        mock_config: AppConfig,
        sample_extracted_page: ExtractedPage,
    ) -> None:
        """4. Unit test asserting re-running for the same page_id upserts rather than duplicates."""
        run_id = uuid4()
        page_id = uuid4()
        val = ValidatorOutput(
            run_id=run_id,
            page_id=page_id,
            verdict=ValidationVerdict.PASS,
            confidence=0.95,
        )

        mock_emb_resp = MagicMock(status_code=200)
        mock_emb_resp.json.return_value = {"embedding": {"values": [0.05] * 768}}
        mock_sb_page_resp = MagicMock(status_code=200)
        mock_sb_page_resp.json.return_value = [{"id": str(page_id)}]
        mock_sb_emb_resp = MagicMock(status_code=200)
        mock_sb_emb_resp.json.return_value = [{"id": str(uuid4())}]

        captured_headers: list[dict[str, str]] = []

        async def _mock_post(url, **kwargs):
            url_str = str(url)
            if "headers" in kwargs:
                captured_headers.append(kwargs["headers"])
            if "embedContent" in url_str or "googleapis.com" in url_str:
                return mock_emb_resp
            if "/rest/v1/embeddings" in url_str:
                return mock_sb_emb_resp
            return mock_sb_page_resp

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=_mock_post), \
             patch("agents.writer.get_config", return_value=mock_config):
            # Run 1
            res1 = await writer_node({
                "run_id": run_id,
                "page_id": page_id,
                "source_url": "https://example.com/item",
                "extracted_content": sample_extracted_page.model_dump(),
                "validation_result": val.model_dump(),
            })

            # Run 2 with same page_id
            res2 = await writer_node({
                "run_id": run_id,
                "page_id": page_id,
                "source_url": "https://example.com/item",
                "extracted_content": sample_extracted_page.model_dump(),
                "validation_result": val.model_dump(),
            })

            # Filename and destination path must match exactly (deterministic overwriting, not duplication)
            assert res1["markdown_path"] == res2["markdown_path"]
            assert res1["markdown_path"].endswith(f"{page_id}.md")
            assert Path(res1["markdown_path"]).exists()

            # Confirm PostgREST upsert merge-duplicates header was sent
            merge_headers = [h for h in captured_headers if "resolution=merge-duplicates" in h.get("Prefer", "")]
            assert len(merge_headers) >= 2

    @pytest.mark.asyncio
    async def test_writer_embedding_failure_does_not_rollback_md_or_page(
        self,
        mock_config: AppConfig,
        sample_extracted_page: ExtractedPage,
    ) -> None:
        """5. Unit test asserting embedding failure logs clearly but does not roll back the already-valid .md file and pages row."""
        run_id = uuid4()
        page_id = uuid4()
        val = ValidatorOutput(
            run_id=run_id,
            page_id=page_id,
            verdict=ValidationVerdict.PASS,
            confidence=0.92,
        )

        # Mock embedding API failure (e.g. 500 or timeout)
        mock_emb_fail = MagicMock(status_code=500, text="Internal embedding service error")
        mock_sb_success = MagicMock(status_code=201)
        mock_sb_success.json.return_value = [{"id": str(page_id)}]

        async def _mock_post(url, **kwargs):
            if "embedContent" in str(url) or "googleapis.com" in str(url):
                return mock_emb_fail
            return mock_sb_success

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=_mock_post), \
             patch("agents.writer.get_config", return_value=mock_config):
            result = await writer_node({
                "run_id": run_id,
                "page_id": page_id,
                "source_url": "https://arxiv.org/abs/1706.03762",
                "extracted_content": sample_extracted_page.model_dump(),
                "validation_result": val.model_dump(),
            })

            # Markdown was still successfully written and retained
            assert result["markdown_path"].endswith(f"{page_id}.md")
            assert Path(result["markdown_path"]).exists()

            # Page row was persisted
            assert result["supabase_page_row_id"] == page_id

            # Embedding status accurately reflects failure without raising exception
            assert result["embedding_generated"] is False
            assert result["embedding_ids"] == []

    def test_writer_refuses_paths_outside_knowledge_dir(self, tmp_path: Path) -> None:
        """Constraint check: never write outside /knowledge/ directory."""
        knowledge_dir = tmp_path / "knowledge"
        knowledge_dir.mkdir(parents=True, exist_ok=True)

        with pytest.raises(ValueError, match="Security violation"):
            atomic_write_markdown(
                knowledge_dir=knowledge_dir,
                filename="../../escape.md",
                content="malicious escape attempt",
            )

    def test_deterministic_markdown_template(
        self,
        sample_extracted_page: ExtractedPage,
        sample_pass_validator_output: ValidatorOutput,
    ) -> None:
        """Verify markdown contains all required deterministic sections."""
        page_id = uuid4()
        md = generate_knowledge_markdown(
            page_id=page_id,
            source_url="https://arxiv.org/abs/1706.03762",
            extracted=sample_extracted_page,
            validation=sample_pass_validator_output,
        )

        # Frontmatter
        assert "---" in md
        assert f'page_id: "{page_id}"' in md
        assert 'confidence_score: 0.95' in md
        assert 'verdict: "pass"' in md

        # Content sections
        assert "# Attention Is All You Need" in md
        assert "## Summary" in md
        assert "> Transformer neural network architecture paper." in md
        assert "## Validation & Confidence" in md
        assert "- **Confidence Score**: 0.95" in md
        assert "- **Faithfulness**: All claims verified against source text." in md
        assert "## Key Content" in md
        assert "## Key Facts & Structure" in md
        assert "- Introduction" in md
        assert "- Model Architecture" in md
        assert "## References & Links" in md

    def test_run_writer_sync(
        self,
        mock_config: AppConfig,
        sample_extracted_page: ExtractedPage,
        sample_pass_validator_output: ValidatorOutput,
    ) -> None:
        """Test synchronous wrapper for Writer."""
        run_id = uuid4()
        page_id = uuid4()

        mock_emb_resp = MagicMock(status_code=200)
        mock_emb_resp.json.return_value = {"embedding": {"values": [0.1] * 768}}
        mock_sb_page_resp = MagicMock(status_code=201)
        mock_sb_page_resp.json.return_value = [{"id": str(page_id)}]
        mock_sb_emb_resp = MagicMock(status_code=201)
        mock_sb_emb_resp.json.return_value = [{"id": str(uuid4())}]

        async def _mock_post(url, **kwargs):
            if "embedContent" in str(url) or "googleapis.com" in str(url):
                return mock_emb_resp
            if "/rest/v1/embeddings" in str(url):
                return mock_sb_emb_resp
            return mock_sb_page_resp

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=_mock_post), \
             patch("agents.writer.get_config", return_value=mock_config):
            res = run_writer_sync(
                run_id=run_id,
                page_id=page_id,
                source_url="https://example.com/sync",
                extracted_content=sample_extracted_page,
                validation_result=sample_pass_validator_output,
            )

            assert res["page_id"] == page_id
            assert res["embedding_generated"] is True
            assert Path(res["markdown_path"]).exists()
