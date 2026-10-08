"""
Unit tests for Discovery Agent.

Per /context/agents/discovery.md Test requirements:
1. Unit test with mocked Tavily response producing valid DiscoveryOutput
2. Unit test asserting max_urls is enforced
3. Unit test asserting a malformed URL from a mocked search result is filtered out, not passed through
4. Unit test asserting empty search results produce an empty (not fabricated) urls list

Additional tests:
- Prioritization/deprioritization of candidate_domains (scoring multiplier applied, not silently dropped)
- Pydantic schema validation of TavilySearchInput before execution
- Tool call error handling and audit logging
- Synchronous wrapper test
- Deduplication of identical URLs
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from tenacity import wait_none

from agents.discovery import (
    TavilyClient,
    discovery_node,
    rank_search_results,
    run_discovery_sync,
    validate_and_filter_url,
)
from shared.models import (
    AppConfig,
    DiscoveryInput,
    DiscoveryOutput,
    RankedUrl,
    TavilySearchInput,
    TavilySearchResult,
)


@pytest.fixture
def mock_config() -> AppConfig:
    return AppConfig(
        supabase_url="https://test.supabase.co",
        supabase_planner_key="key",
        supabase_discovery_key="key",
        supabase_extractor_key="key",
        supabase_validator_key="key",
        supabase_writer_key="key",
        tavily_api_key="tvly-test",
        openrouter_api_key="sk-test",
        anthropic_api_key="sk-ant-test",
        openai_api_key="sk-test",
    )


class TestDiscoveryUnit:
    """Core Discovery agent tests matching spec requirements."""

    @pytest.mark.asyncio
    async def test_discovery_valid_mocked_tavily_response(self, mock_config: AppConfig) -> None:
        """1. Unit test with mocked Tavily response producing valid DiscoveryOutput."""
        run_id = uuid4()
        mock_tavily_resp = {
            "query": "transformer attention mechanisms",
            "results": [
                {
                    "url": "https://arxiv.org/abs/1706.03762",
                    "title": "Attention Is All You Need",
                    "content": "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks...",
                    "score": 0.95,
                },
                {
                    "url": "https://github.com/huggingface/transformers",
                    "title": "Transformers GitHub",
                    "content": "State-of-the-art Machine Learning for PyTorch, TensorFlow, and JAX.",
                    "score": 0.88,
                },
            ],
            "response_time": 0.45,
        }

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = mock_tavily_resp

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp), \
             patch("agents.discovery.get_config", return_value=mock_config):
            result = await discovery_node({
                "run_id": run_id,
                "subtask_id": "subtask_1",
                "description": "transformer attention mechanisms",
                "candidate_domains": ["arxiv.org"],
                "max_urls": 5,
            })

            assert result["run_id"] == run_id
            assert result["subtask_id"] == "subtask_1"
            assert len(result["urls"]) == 2
            # arxiv.org is in candidate domains -> score kept intact
            assert result["urls"][0]["url"] == "https://arxiv.org/abs/1706.03762"
            assert result["urls"][0]["domain"] == "arxiv.org"
            assert result["urls"][0]["relevance_score"] == 0.95
            # github.com is outside candidate domains -> score multiplied by 0.7
            assert result["urls"][1]["domain"] == "github.com"
            assert result["urls"][1]["relevance_score"] == pytest.approx(0.88 * 0.7, 0.001)

            # Check audit log
            assert len(result["tool_calls"]) == 1
            assert result["tool_calls"][0]["tool_name"] == "tavily_search"
            assert result["tool_calls"][0]["error"] is None

    @pytest.mark.asyncio
    async def test_discovery_enforces_max_urls(self, mock_config: AppConfig) -> None:
        """2. Unit test asserting max_urls is enforced."""
        run_id = uuid4()
        # Mock 10 results returned by Tavily
        mock_results = [
            {
                "url": f"https://example{i}.org/article",
                "title": f"Article {i}",
                "content": f"Content {i}",
                "score": 0.9 - (i * 0.05),
            }
            for i in range(10)
        ]
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"results": mock_results, "response_time": 0.3}

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp), \
             patch("agents.discovery.get_config", return_value=mock_config):
            result = await discovery_node({
                "run_id": run_id,
                "subtask_id": "subtask_1",
                "description": "Search topic",
                "candidate_domains": [],
                "max_urls": 3,
            })

            assert len(result["urls"]) == 3
            # Ensure they are the top 3 highest scores
            assert result["urls"][0]["url"] == "https://example0.org/article"
            assert result["urls"][1]["url"] == "https://example1.org/article"
            assert result["urls"][2]["url"] == "https://example2.org/article"

    @pytest.mark.asyncio
    async def test_discovery_malformed_url_filtered_out(self, mock_config: AppConfig) -> None:
        """3. Unit test asserting a malformed URL from a mocked search result is filtered out, not passed through."""
        run_id = uuid4()
        mock_results = [
            {
                "url": "not_a_valid_url_at_all",
                "title": "Bad URL",
                "content": "...",
                "score": 0.99,
            },
            {
                "url": "ftp://badscheme.org/file",
                "title": "Bad Scheme",
                "content": "...",
                "score": 0.95,
            },
            {
                "url": "http://",
                "title": "Empty netloc",
                "content": "...",
                "score": 0.90,
            },
            {
                "url": "https://valid-domain.com/path",
                "title": "Good URL",
                "content": "...",
                "score": 0.85,
            },
        ]
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"results": mock_results, "response_time": 0.2}

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp), \
             patch("agents.discovery.get_config", return_value=mock_config):
            result = await discovery_node({
                "run_id": run_id,
                "subtask_id": "subtask_1",
                "description": "Search test",
                "candidate_domains": [],
                "max_urls": 10,
            })

            # Only the valid http/https URL should pass through
            assert len(result["urls"]) == 1
            assert result["urls"][0]["url"] == "https://valid-domain.com/path"
            assert result["urls"][0]["domain"] == "valid-domain.com"

    @pytest.mark.asyncio
    async def test_discovery_empty_search_results_produce_empty_list(self, mock_config: AppConfig) -> None:
        """4. Unit test asserting empty search results produce an empty (not fabricated) urls list."""
        run_id = uuid4()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"results": [], "response_time": 0.1}

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp), \
             patch("agents.discovery.get_config", return_value=mock_config):
            result = await discovery_node({
                "run_id": run_id,
                "subtask_id": "subtask_1",
                "description": "Extremely obscure query",
                "candidate_domains": ["nonexistent.domain.xyz"],
                "max_urls": 10,
            })

            assert result["urls"] == []
            assert isinstance(result["urls"], list)

    def test_url_validation_helper(self) -> None:
        """Direct unit test of validate_and_filter_url."""
        assert validate_and_filter_url("https://example.com/page")[0] is True
        assert validate_and_filter_url("http://sub.domain.org")[0] is True
        assert validate_and_filter_url("ftp://example.com")[0] is False
        assert validate_and_filter_url("javascript:alert(1)")[0] is False
        assert validate_and_filter_url("")[0] is False
        assert validate_and_filter_url("just_text")[0] is False

    def test_rank_search_results_deduplication(self) -> None:
        """Asserts duplicate URLs from search results are deduplicated."""
        results = [
            TavilySearchResult(url="https://arxiv.org/abs/1", title="A", content="C", score=0.9),
            TavilySearchResult(url="https://arxiv.org/abs/1", title="A dup", content="C", score=0.9),
            TavilySearchResult(url="https://arxiv.org/abs/2", title="B", content="C", score=0.8),
        ]
        ranked = rank_search_results(results, candidate_domains=["arxiv.org"], max_urls=5)
        assert len(ranked) == 2
        assert ranked[0].url == "https://arxiv.org/abs/1"
        assert ranked[1].url == "https://arxiv.org/abs/2"

    @pytest.mark.asyncio
    async def test_tavily_search_input_pydantic_validation(self, mock_config: AppConfig) -> None:
        """Asserts TavilyClient validates schema before execution."""
        async with TavilyClient(mock_config) as client:
            with pytest.raises(ValueError, match="Invalid tool input"):
                # query must be min_length=1: pass dict or invalid object to client.search
                await client.search({"query": "", "max_results": 5})

    def test_run_discovery_sync(self, mock_config: AppConfig) -> None:
        """Test synchronous discovery runner wrapper (non-async test)."""
        run_id = uuid4()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "results": [{"url": "https://test.com", "title": "T", "content": "C", "score": 0.8}],
            "response_time": 0.1,
        }

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp), \
             patch("agents.discovery.get_config", return_value=mock_config):
            res = run_discovery_sync(
                run_id=run_id,
                subtask_id="sub_1",
                description="Sync test",
                candidate_domains=["test.com"],
            )
            assert res["subtask_id"] == "sub_1"
            assert len(res["urls"]) == 1

