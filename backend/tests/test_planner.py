"""
Unit tests for Planner Agent.

Per /context/agents/planner.md Test requirements:
1. Unit test with mocked LLM response producing valid PlannerOutput
2. Unit test asserting a malformed LLM response (missing field, wrong type) raises rather than silently defaulting
3. Unit test asserting max_subtasks is enforced even if the LLM ignores it

Additional tests:
- Schema rejection and retry-once behavior (fails attempt 1, passes attempt 2)
- Rejection when LLM response includes URLs in subtask description
- Rejection of invalid domain formats
- Pure function behavior of planner_node
- Valid PlannerInput and PlannerOutput validation
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from tenacity import wait_none

from agents.planner import (
    LLMPlanner,
    planner_node,
    run_planner_sync,
    validate_subtask_constraints,
)
from shared.models import (
    AppConfig,
    PlannerInput,
    PlannerOutput,
    Subtask,
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


class TestPlannerUnit:
    """Core Planner agent tests matching spec requirements."""

    @pytest.mark.asyncio
    async def test_planner_valid_mocked_llm_response(self, mock_config: AppConfig) -> None:
        """1. Unit test with mocked LLM response producing valid PlannerOutput."""
        run_id = uuid4()
        mock_llm_json = json.dumps({
            "subtasks": [
                {
                    "subtask_id": "subtask_1",
                    "description": "Analyze state-of-the-art transformer architectures",
                    "candidate_domains": ["arxiv.org", "paperswithcode.com"],
                },
                {
                    "subtask_id": "subtask_2",
                    "description": "Investigate multi-agent consensus mechanisms",
                    "candidate_domains": ["github.com"],
                },
            ],
            "reasoning": "Decomposed into model architecture and multi-agent coordination dimensions.",
        })

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": mock_llm_json}}]
        }

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp), \
             patch("agents.planner.get_config", return_value=mock_config):
            result = await planner_node({
                "run_id": run_id,
                "goal": "Research autonomous multi-agent systems in 2026",
                "max_subtasks": 5,
                "max_domains_per_subtask": 3,
            })

            assert result["run_id"] == run_id
            assert len(result["subtasks"]) == 2
            assert result["subtasks"][0]["subtask_id"] == "subtask_1"
            assert "arxiv.org" in result["subtasks"][0]["candidate_domains"]
            assert result["reasoning"] == "Decomposed into model architecture and multi-agent coordination dimensions."
            assert len(result["tool_calls"]) == 1
            assert result["tool_calls"][0]["tool_name"] == "planner_reasoning"
            assert result["tool_calls"][0]["error"] is None

    @pytest.mark.asyncio
    async def test_planner_malformed_llm_response_raises(self, mock_config: AppConfig) -> None:
        """2. Unit test asserting a malformed LLM response (missing field, wrong type) raises rather than silently defaulting."""
        run_id = uuid4()
        # Missing 'reasoning' and subtasks has wrong type for candidate_domains
        malformed_json = json.dumps({
            "subtasks": [
                {
                    "subtask_id": "subtask_1",
                    # description is missing
                    "candidate_domains": "invalid_not_a_list",
                }
            ]
        })

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": malformed_json}}]
        }

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp), \
             patch("agents.planner.get_config", return_value=mock_config):
            with pytest.raises(ValueError, match="Planner output validation failed after retry"):
                await planner_node({
                    "run_id": run_id,
                    "goal": "Test malformed handling",
                })

    @pytest.mark.asyncio
    async def test_planner_enforces_max_subtasks_even_if_llm_ignores(self, mock_config: AppConfig) -> None:
        """3. Unit test asserting max_subtasks is enforced even if the LLM ignores it."""
        run_id = uuid4()
        # LLM returns 4 subtasks when max_subtasks is 2
        too_many_json = json.dumps({
            "subtasks": [
                {"subtask_id": f"s_{i}", "description": f"Subtask number {i}", "candidate_domains": ["example.com"]}
                for i in range(4)
            ],
            "reasoning": "Created 4 tasks",
        })

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": too_many_json}}]
        }

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp), \
             patch("agents.planner.get_config", return_value=mock_config):
            # Should fail validation after retrying because max_subtasks=2 is strictly exceeded
            with pytest.raises(ValueError, match="Exceeded max_subtasks"):
                await planner_node({
                    "run_id": run_id,
                    "goal": "Test max subtasks limit",
                    "max_subtasks": 2,
                })

    @pytest.mark.asyncio
    async def test_planner_retry_once_on_schema_failure(self, mock_config: AppConfig) -> None:
        """Asserts Planner retries once on schema failure and succeeds if second attempt is valid."""
        run_id = uuid4()
        bad_json = json.dumps({"invalid_key": "bad_data"})
        good_json = json.dumps({
            "subtasks": [
                {
                    "subtask_id": "subtask_1",
                    "description": "Valid subtask",
                    "candidate_domains": ["nature.com"],
                }
            ],
            "reasoning": "Recovered after retry",
        })

        resp_bad = MagicMock(status_code=200)
        resp_bad.json.return_value = {"choices": [{"message": {"content": bad_json}}]}

        resp_good = MagicMock(status_code=200)
        resp_good.json.return_value = {"choices": [{"message": {"content": good_json}}]}

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=[resp_bad, resp_good]), \
             patch("agents.planner.get_config", return_value=mock_config):
            async with LLMPlanner(mock_config, retry_wait=wait_none()) as planner:
                output, tool_call = await planner.plan(
                    PlannerInput(run_id=run_id, goal="Recoverable test")
                )
                assert len(output.subtasks) == 1
                assert output.reasoning == "Recovered after retry"
                assert tool_call.error is None

    def test_validate_subtask_constraints_rejects_urls_in_description(self) -> None:
        """Constraint check: no subtask description may contain a URL."""
        subtasks = [
            Subtask(
                subtask_id="s1",
                description="Check documentation at https://example.com/docs for details",
                candidate_domains=["example.com"],
            )
        ]
        with pytest.raises(ValueError, match="description contains a URL"):
            validate_subtask_constraints(subtasks, max_subtasks=5, max_domains_per_subtask=3)

    def test_validate_subtask_constraints_rejects_urls_in_candidate_domains(self) -> None:
        """Constraint check: candidate_domains must be hostnames only, not URLs."""
        subtasks = [
            Subtask(
                subtask_id="s1",
                description="Investigate topic",
                candidate_domains=["https://example.com/path"],
            )
        ]
        with pytest.raises(ValueError, match="not a valid hostname"):
            validate_subtask_constraints(subtasks, max_subtasks=5, max_domains_per_subtask=3)

    def test_validate_subtask_constraints_cleans_and_bounds_domains(self) -> None:
        """Constraint check: domains normalized and capped at max_domains_per_subtask."""
        subtasks = [
            Subtask(
                subtask_id="s1",
                description="Investigate topic",
                candidate_domains=["EXAMPLE.COM", "sub.domain.org", "third.edu", "excess.com"],
            )
        ]
        validated = validate_subtask_constraints(subtasks, max_subtasks=5, max_domains_per_subtask=2)
        assert len(validated[0].candidate_domains) == 2
        assert validated[0].candidate_domains == ["example.com", "sub.domain.org"]

    def test_planner_input_validation(self) -> None:
        """Pydantic validation for PlannerInput."""
        run_id = uuid4()
        valid = PlannerInput(run_id=run_id, goal="Build swarm")
        assert valid.goal == "Build swarm"
        assert valid.max_subtasks == 5

        with pytest.raises(ValidationError):
            PlannerInput(run_id=run_id, goal="")  # min_length=1

    def test_run_planner_sync(self, mock_config: AppConfig) -> None:
        """Synchronous wrapper test (not async def since wrapper uses asyncio.run)."""
        run_id = uuid4()
        mock_llm_json = json.dumps({
            "subtasks": [
                {"subtask_id": "s1", "description": "Sync test", "candidate_domains": ["test.org"]}
            ],
            "reasoning": "Sync test reasoning",
        })
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"choices": [{"message": {"content": mock_llm_json}}]}

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp), \
             patch("agents.planner.get_config", return_value=mock_config):
            res = run_planner_sync(goal="Sync goal", run_id=run_id)
            assert res["run_id"] == run_id
            assert len(res["subtasks"]) == 1

