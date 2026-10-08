"""
Tests for Supervisor Orchestrator (supervisor.md)

Test requirements covered per supervisor.md:
1. Unit test asserting a node exceeding its timeout is retried per config,
   then fails cleanly after max retries.
2. Unit test asserting budget overrun halts the run (hard stop, not just warning):
   - max_pages
   - max_tool_calls
   - max_tokens
   - max_wall_seconds
3. Unit test asserting an UNCERTAIN validator verdict triggers interrupt()
   rather than auto-continuing to Writer.
4. Unit test asserting state is fully recoverable from a checkpoint after
   a simulated crash mid-run.
5. Integration test running the full Planner -> Discovery -> Extractor ->
   Validator -> Writer path end-to-end with mocked LLM/tool responses.

Additional capabilities covered:
- Validator FAIL routes to discard (Writer is skipped).
- Resuming interrupted run with human approval executes Writer.
- Resuming interrupted run with human rejection discards page.
- Budget 80% warning triggers SupervisorInterrupt(BUDGET_WARNING).
- build_graph() compilation and execution.
- Checkpoints persisted after every transition with status/duration/tool_calls.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest

from agents.supervisor import (
    BudgetConfig,
    BudgetExceeded,
    DEFAULT_NODE_CONFIGS,
    InterruptReason,
    NodeConfig,
    RunBudget,
    SupervisorInterrupt,
    SupervisorOrchestrator,
    build_graph,
    run_supervisor_sync,
)
from shared.models import (
    AppConfig,
    ExtractedPage,
    LogStatus,
    ValidationVerdict,
    ValidatorOutput,
)


# ============================================================
# FIXTURES & HELPER MOCKS
# ============================================================

@pytest.fixture(autouse=True)
def mock_app_config():
    cfg = AppConfig(
        supabase_url="https://test.supabase.co",
        supabase_planner_key="test_key",
        supabase_discovery_key="test_key",
        supabase_extractor_key="test_key",
        supabase_validator_key="test_key",
        supabase_writer_key="test_key",
        tavily_api_key="tvly-test",
        openrouter_api_key="sk-test",
        anthropic_api_key="sk-ant-test",
        openai_api_key="sk-test",
    )
    with patch("agents.supervisor.get_config", return_value=cfg), \
         patch("shared.config.get_config", return_value=cfg):
        yield cfg


@pytest.fixture
def run_id() -> UUID:
    return uuid4()


@pytest.fixture
def mock_planner():
    async def _planner(state: dict[str, Any]) -> dict[str, Any]:
        return {
            "run_id": state["run_id"],
            "subtasks": [
                {
                    "subtask_id": "sub_1",
                    "description": "Analyze state machine architectures",
                    "candidate_domains": ["arxiv.org"],
                }
            ],
            "reasoning": "Decomposed into 1 subtask",
            "tool_calls": [{"tool_name": "planner_llm", "input_args": {}, "duration_ms": 10}],
            "tokens_used": 150,
        }
    return _planner


@pytest.fixture
def mock_discovery():
    async def _discovery(state: dict[str, Any]) -> dict[str, Any]:
        return {
            "run_id": state["run_id"],
            "subtask_id": state["subtask_id"],
            "urls": [
                {
                    "url": "https://arxiv.org/abs/2401.00001",
                    "relevance_score": 0.95,
                    "domain": "arxiv.org",
                }
            ],
            "tool_calls": [{"tool_name": "tavily_search", "input_args": {}, "duration_ms": 25}],
            "tokens_used": 200,
        }
    return _discovery


@pytest.fixture
def mock_extractor():
    async def _extractor(state: dict[str, Any]) -> dict[str, Any]:
        return {
            "extracted_json": {
                "title": "State Machines in AI",
                "description": "A comprehensive survey of agentic state graphs",
                "main_content": "State machines ensure deterministic workflows.",
                "headings": ["Introduction", "Architectures"],
                "links": [],
                "images": [],
                "metadata": {"author": "Jane Doe", "tags": ["agents", "langgraph"]},
            },
            "source_content": "<html><body>State machines ensure deterministic workflows.</body></html>",
            "markdown_path": "./knowledge/_pending/state_machines.md",
            "tool_calls": [{"tool_name": "playwright_fetch", "input_args": {}, "duration_ms": 120}],
            "tokens_used": 800,
        }
    return _extractor


@pytest.fixture
def mock_validator_pass():
    async def _validator(state: dict[str, Any]) -> dict[str, Any]:
        pid = str(state["page_id"])
        return {
            "validation_results": {
                pid: {
                    "run_id": str(state["run_id"]),
                    "page_id": pid,
                    "verdict": ValidationVerdict.PASS.value,
                    "confidence": 0.96,
                    "faithfulness_notes": "Content strictly grounded",
                    "relevance_notes": "Directly matches subtask",
                    "safety_flags": [],
                    "tool_calls": [],
                }
            },
            "tool_calls": [],
            "tokens_used": 250,
        }
    return _validator


@pytest.fixture
def mock_validator_uncertain():
    async def _validator(state: dict[str, Any]) -> dict[str, Any]:
        pid = str(state["page_id"])
        return {
            "validation_results": {
                pid: {
                    "run_id": str(state["run_id"]),
                    "page_id": pid,
                    "verdict": ValidationVerdict.UNCERTAIN.value,
                    "confidence": 0.62,
                    "faithfulness_notes": "Borderline claim verification",
                    "relevance_notes": "Partially relevant",
                    "safety_flags": [],
                    "tool_calls": [],
                }
            },
            "tool_calls": [],
            "tokens_used": 200,
        }
    return _validator


@pytest.fixture
def mock_validator_fail():
    async def _validator(state: dict[str, Any]) -> dict[str, Any]:
        pid = str(state["page_id"])
        return {
            "validation_results": {
                pid: {
                    "run_id": str(state["run_id"]),
                    "page_id": pid,
                    "verdict": ValidationVerdict.FAIL.value,
                    "confidence": 0.15,
                    "faithfulness_notes": "Severe hallucination",
                    "relevance_notes": "Completely irrelevant",
                    "safety_flags": ["injection_attempt"],
                    "tool_calls": [],
                }
            },
            "tool_calls": [],
            "tokens_used": 180,
        }
    return _validator


@pytest.fixture
def mock_writer():
    async def _writer(state: dict[str, Any]) -> dict[str, Any]:
        return {
            "run_id": state["run_id"],
            "page_id": state["page_id"],
            "markdown_path": "./knowledge/state_machines.md",
            "supabase_page_row_id": uuid4(),
            "embedding_generated": True,
            "embedding_ids": [uuid4()],
            "tool_calls": [{"tool_name": "filesystem_write", "input_args": {}, "duration_ms": 15}],
            "tokens_used": 100,
        }
    return _writer


# ============================================================
# 1. TIMEOUT & RETRY TESTS
# ============================================================

@pytest.mark.asyncio
async def test_node_timeout_retried_and_fails_cleanly(run_id: UUID):
    """
    Asserts a node exceeding its timeout is retried per config,
    then fails cleanly with a RuntimeError after max retries.
    """
    attempt_count = 0
    checkpoints: list[dict[str, Any]] = []

    async def slow_planner(state: dict[str, Any]) -> dict[str, Any]:
        nonlocal attempt_count
        attempt_count += 1
        # Sleep longer than the 0.1s timeout
        await asyncio.sleep(0.3)
        return {"subtasks": []}

    async def capture_checkpoint(**kwargs: Any) -> None:
        checkpoints.append(kwargs)

    node_configs = {
        "planner": NodeConfig(
            timeout_seconds=0.1,
            max_retries=3,
            retry_wait_min=0.01,
            retry_wait_max=0.05,
        )
    }

    orch = SupervisorOrchestrator(
        node_configs=node_configs,
        planner_fn=slow_planner,
        checkpoint_fn=capture_checkpoint,
    )

    with pytest.raises(RuntimeError) as exc_info:
        await orch.run(run_id=run_id, goal="Test timeout failure")

    assert "failed after 3 retries" in str(exc_info.value)
    assert attempt_count == 3

    # Ensure a failure checkpoint was recorded
    failed_checkpoints = [cp for cp in checkpoints if cp.get("status") == LogStatus.FAILED]
    assert len(failed_checkpoints) == 1
    assert failed_checkpoints[0]["node_name"] == "planner"


@pytest.mark.asyncio
async def test_node_retry_succeeds_on_second_attempt(
    run_id: UUID,
    mock_discovery,
    mock_extractor,
    mock_validator_pass,
    mock_writer,
):
    """Asserts a node that fails on attempt 1 succeeds when retried."""
    attempts = 0

    async def flakey_planner(state: dict[str, Any]) -> dict[str, Any]:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ConnectionError("Temporary network glitch")
        return {
            "run_id": state["run_id"],
            "subtasks": [
                {
                    "subtask_id": "sub_1",
                    "description": "Subtask 1",
                    "candidate_domains": ["arxiv.org"],
                }
            ],
            "reasoning": "Plan ok",
            "tool_calls": [],
        }

    node_configs = {
        "planner": NodeConfig(
            timeout_seconds=2.0,
            max_retries=3,
            retry_wait_min=0.01,
            retry_wait_max=0.05,
        )
    }

    orch = SupervisorOrchestrator(
        node_configs=node_configs,
        planner_fn=flakey_planner,
        discovery_fn=mock_discovery,
        extractor_fn=mock_extractor,
        validator_fn=mock_validator_pass,
        writer_fn=mock_writer,
        checkpoint_fn=AsyncMock(),
    )

    result = await orch.run(run_id=run_id, goal="Test retry success")
    assert attempts == 2
    assert result["pages_passed"] == 1


# ============================================================
# 2. BUDGET OVERRUN TESTS (HARD STOPS)
# ============================================================

@pytest.mark.asyncio
async def test_budget_overrun_pages_halts_run(
    run_id: UUID,
    mock_planner,
    mock_discovery,
    mock_extractor,
    mock_validator_pass,
    mock_writer,
):
    """Asserts max_pages overrun halts the run immediately with BudgetExceeded."""
    budget_cfg = BudgetConfig(max_pages=0)  # Overrun on very first page

    orch = SupervisorOrchestrator(
        budget_config=budget_cfg,
        planner_fn=mock_planner,
        discovery_fn=mock_discovery,
        extractor_fn=mock_extractor,
        validator_fn=mock_validator_pass,
        writer_fn=mock_writer,
        checkpoint_fn=AsyncMock(),
    )

    with pytest.raises(BudgetExceeded) as exc_info:
        await orch.run(run_id=run_id, goal="Test max pages hard stop")

    assert "pages_processed" in str(exc_info.value)


@pytest.mark.asyncio
async def test_budget_overrun_tool_calls_halts_run(
    run_id: UUID,
    mock_discovery,
    mock_extractor,
    mock_validator_pass,
    mock_writer,
):
    """Asserts max_tool_calls overrun halts the run immediately with BudgetExceeded."""
    async def tool_heavy_planner(state: dict[str, Any]) -> dict[str, Any]:
        return {
            "run_id": state["run_id"],
            "subtasks": [{"subtask_id": "s1", "description": "d", "candidate_domains": []}],
            "reasoning": "reason",
            "tool_calls": [{"tool_name": f"tool_{i}", "input_args": {}, "duration_ms": 1} for i in range(15)],
        }

    budget_cfg = BudgetConfig(max_tool_calls=10)

    orch = SupervisorOrchestrator(
        budget_config=budget_cfg,
        planner_fn=tool_heavy_planner,
        discovery_fn=mock_discovery,
        extractor_fn=mock_extractor,
        validator_fn=mock_validator_pass,
        writer_fn=mock_writer,
        checkpoint_fn=AsyncMock(),
    )

    with pytest.raises(BudgetExceeded) as exc_info:
        await orch.run(run_id=run_id, goal="Test max tool calls hard stop")

    assert "tool_calls_made" in str(exc_info.value)


@pytest.mark.asyncio
async def test_budget_overrun_tokens_halts_run(
    run_id: UUID,
    mock_discovery,
    mock_extractor,
    mock_validator_pass,
    mock_writer,
):
    """Asserts max_tokens overrun halts the run immediately with BudgetExceeded."""
    async def token_heavy_planner(state: dict[str, Any]) -> dict[str, Any]:
        return {
            "run_id": state["run_id"],
            "subtasks": [{"subtask_id": "s1", "description": "d", "candidate_domains": []}],
            "reasoning": "reason",
            "tool_calls": [],
            "tokens_used": 1500,
        }

    budget_cfg = BudgetConfig(max_tokens=1000)

    orch = SupervisorOrchestrator(
        budget_config=budget_cfg,
        planner_fn=token_heavy_planner,
        discovery_fn=mock_discovery,
        extractor_fn=mock_extractor,
        validator_fn=mock_validator_pass,
        writer_fn=mock_writer,
        checkpoint_fn=AsyncMock(),
    )

    with pytest.raises(BudgetExceeded) as exc_info:
        await orch.run(run_id=run_id, goal="Test max tokens hard stop")

    assert "tokens_used" in str(exc_info.value)


@pytest.mark.asyncio
async def test_budget_overrun_wall_clock_halts_run(
    run_id: UUID,
    mock_discovery,
    mock_extractor,
    mock_validator_pass,
    mock_writer,
):
    """Asserts max_wall_seconds overrun halts the run immediately."""
    async def slow_planner(state: dict[str, Any]) -> dict[str, Any]:
        await asyncio.sleep(0.1)
        return {
            "run_id": state["run_id"],
            "subtasks": [{"subtask_id": "s1", "description": "d", "candidate_domains": []}],
            "reasoning": "reason",
            "tool_calls": [],
        }

    budget_cfg = BudgetConfig(max_wall_seconds=0.05)

    orch = SupervisorOrchestrator(
        budget_config=budget_cfg,
        planner_fn=slow_planner,
        discovery_fn=mock_discovery,
        extractor_fn=mock_extractor,
        validator_fn=mock_validator_pass,
        writer_fn=mock_writer,
        checkpoint_fn=AsyncMock(),
    )

    with pytest.raises(BudgetExceeded) as exc_info:
        await orch.run(run_id=run_id, goal="Test wall time hard stop")

    assert "elapsed" in str(exc_info.value)


@pytest.mark.asyncio
async def test_budget_warning_threshold_triggers_interrupt(
    run_id: UUID,
    mock_planner,
    mock_discovery,
    mock_extractor,
    mock_validator_pass,
    mock_writer,
):
    """Asserts that consuming >= 80% of budget triggers SupervisorInterrupt(BUDGET_WARNING)."""
    # max_pages=5, 4 pages = 80%
    budget_cfg = BudgetConfig(max_pages=5, budget_warn_fraction=0.8)

    urls = [{"url": f"https://arxiv.org/abs/2401.0000{i}", "relevance_score": 0.9, "domain": "arxiv.org"} for i in range(5)]

    async def multi_url_discovery(state: dict[str, Any]) -> dict[str, Any]:
        return {
            "run_id": state["run_id"],
            "subtask_id": state["subtask_id"],
            "urls": urls,
            "tool_calls": [],
        }

    orch = SupervisorOrchestrator(
        budget_config=budget_cfg,
        planner_fn=mock_planner,
        discovery_fn=multi_url_discovery,
        extractor_fn=mock_extractor,
        validator_fn=mock_validator_pass,
        writer_fn=mock_writer,
        checkpoint_fn=AsyncMock(),
    )

    with pytest.raises(SupervisorInterrupt) as exc_info:
        await orch.run(run_id=run_id, goal="Test budget warning")

    assert exc_info.value.reason == InterruptReason.BUDGET_WARNING


# ============================================================
# 3. HUMAN-IN-THE-LOOP (UNCERTAIN VERDICT) TESTS
# ============================================================

@pytest.mark.asyncio
async def test_validator_uncertain_triggers_interrupt_not_writer(
    run_id: UUID,
    mock_planner,
    mock_discovery,
    mock_extractor,
    mock_validator_uncertain,
):
    """
    Asserts an UNCERTAIN validator verdict triggers interrupt()
    rather than auto-continuing to Writer.
    """
    writer_called = False

    async def spy_writer(state: dict[str, Any]) -> dict[str, Any]:
        nonlocal writer_called
        writer_called = True
        return {"markdown_path": "./knowledge/doc.md"}

    checkpoints: list[dict[str, Any]] = []

    async def capture_checkpoint(**kwargs: Any) -> None:
        checkpoints.append(kwargs)

    orch = SupervisorOrchestrator(
        planner_fn=mock_planner,
        discovery_fn=mock_discovery,
        extractor_fn=mock_extractor,
        validator_fn=mock_validator_uncertain,
        writer_fn=spy_writer,
        checkpoint_fn=capture_checkpoint,
    )

    with pytest.raises(SupervisorInterrupt) as exc_info:
        await orch.run(run_id=run_id, goal="Test UNCERTAIN interrupt")

    assert exc_info.value.reason == InterruptReason.UNCERTAIN_VERDICT
    assert not writer_called, "Writer MUST NOT be called when verdict is UNCERTAIN"

    # Checkpoint should contain uncertain item details
    state = exc_info.value.state
    assert len(state["pages_uncertain"]) == 1
    assert state["pages_uncertain"][0]["validator_output"]["verdict"] == "uncertain"


@pytest.mark.asyncio
async def test_validator_fail_discards_and_skips_writer(
    run_id: UUID,
    mock_planner,
    mock_discovery,
    mock_extractor,
    mock_validator_fail,
):
    """Asserts a FAIL validator verdict discards the page and does NOT call Writer."""
    writer_called = False

    async def spy_writer(state: dict[str, Any]) -> dict[str, Any]:
        nonlocal writer_called
        writer_called = True
        return {"markdown_path": "./knowledge/doc.md"}

    orch = SupervisorOrchestrator(
        planner_fn=mock_planner,
        discovery_fn=mock_discovery,
        extractor_fn=mock_extractor,
        validator_fn=mock_validator_fail,
        writer_fn=spy_writer,
        checkpoint_fn=AsyncMock(),
    )

    result = await orch.run(run_id=run_id, goal="Test FAIL discard")

    assert not writer_called
    assert result["pages_failed"] == 1
    assert result["pages_passed"] == 0
    assert len(result["pages_written"]) == 0


# ============================================================
# 4. RESUME & CRASH RECOVERY TESTS
# ============================================================

@pytest.mark.asyncio
async def test_state_recoverable_from_checkpoint_after_crash(
    run_id: UUID,
    mock_planner,
    mock_extractor,
    mock_validator_pass,
    mock_writer,
):
    """
    Asserts state is fully recoverable from a checkpoint after a simulated crash mid-run.
    Planner is NOT re-executed, already processed pages are skipped, and remaining pages succeed.
    """
    planner_calls = 0

    async def tracked_planner(state: dict[str, Any]) -> dict[str, Any]:
        nonlocal planner_calls
        planner_calls += 1
        return await mock_planner(state)

    # 2 URLs in discovery
    two_urls = [
        {"url": "https://arxiv.org/abs/2401.00001", "relevance_score": 0.95, "domain": "arxiv.org"},
        {"url": "https://arxiv.org/abs/2401.00002", "relevance_score": 0.91, "domain": "arxiv.org"},
    ]

    async def discovery_two_urls(state: dict[str, Any]) -> dict[str, Any]:
        return {
            "run_id": state["run_id"],
            "subtask_id": state["subtask_id"],
            "urls": two_urls,
            "tool_calls": [],
        }

    # Simulate checkpoint snapshot saved after first page was written before crash
    saved_checkpoint = {
        "run_id": str(run_id),
        "goal": "Test recovery",
        "subtasks": [
            {
                "subtask_id": "sub_1",
                "description": "Analyze state machine architectures",
                "candidate_domains": ["arxiv.org"],
            }
        ],
        "pages_processed": 1,
        "pages_passed": 1,
        "pages_failed": 0,
        "pages_uncertain": [],
        "pages_written": [
            {"url": "https://arxiv.org/abs/2401.00001", "page_id": str(uuid4()), "markdown_path": "./knowledge/doc1.md"}
        ],
        "errors": [],
        "tool_calls_made": 3,
        "tokens_used": 1200,
    }

    orch = SupervisorOrchestrator(
        planner_fn=tracked_planner,
        discovery_fn=discovery_two_urls,
        extractor_fn=mock_extractor,
        validator_fn=mock_validator_pass,
        writer_fn=mock_writer,
        checkpoint_fn=AsyncMock(),
    )

    # Resume from checkpoint
    result = await orch.resume(checkpoint_state=saved_checkpoint)

    # Planner was skipped
    assert planner_calls == 0
    # First URL was skipped, second URL was processed
    assert result["pages_passed"] == 2
    assert len(result["pages_written"]) == 2
    assert result["pages_written"][0]["url"] == "https://arxiv.org/abs/2401.00001"
    assert result["pages_written"][1]["url"] == "https://arxiv.org/abs/2401.00002"


@pytest.mark.asyncio
async def test_resume_interrupted_run_with_human_approval(
    run_id: UUID,
    mock_planner,
    mock_discovery,
    mock_extractor,
    mock_validator_uncertain,
    mock_writer,
):
    """Asserts that resuming an interrupted UNCERTAIN run with human approval promotes to Writer."""
    orch = SupervisorOrchestrator(
        planner_fn=mock_planner,
        discovery_fn=mock_discovery,
        extractor_fn=mock_extractor,
        validator_fn=mock_validator_uncertain,
        writer_fn=mock_writer,
        checkpoint_fn=AsyncMock(),
    )

    # Step 1: Run halts with UNCERTAIN interrupt
    with pytest.raises(SupervisorInterrupt) as exc_info:
        await orch.run(run_id=run_id, goal="Test human approval resume")

    checkpoint = exc_info.value.state

    # Step 2: Human approves
    result = await orch.resume(checkpoint_state=checkpoint, human_decision="approve")

    assert result["pages_passed"] == 1
    assert len(result["pages_written"]) == 1
    assert result["pages_written"][0]["markdown_path"] == "./knowledge/state_machines.md"


@pytest.mark.asyncio
async def test_resume_interrupted_run_with_human_rejection(
    run_id: UUID,
    mock_planner,
    mock_discovery,
    mock_extractor,
    mock_validator_uncertain,
    mock_writer,
):
    """Asserts that resuming an interrupted UNCERTAIN run with human rejection discards page."""
    orch = SupervisorOrchestrator(
        planner_fn=mock_planner,
        discovery_fn=mock_discovery,
        extractor_fn=mock_extractor,
        validator_fn=mock_validator_uncertain,
        writer_fn=mock_writer,
        checkpoint_fn=AsyncMock(),
    )

    with pytest.raises(SupervisorInterrupt) as exc_info:
        await orch.run(run_id=run_id, goal="Test human rejection resume")

    checkpoint = exc_info.value.state

    result = await orch.resume(checkpoint_state=checkpoint, human_decision="discard")

    assert result["pages_passed"] == 0
    assert result["pages_failed"] == 1
    assert len(result["pages_written"]) == 0


# ============================================================
# 5. INTEGRATION END-TO-END TEST
# ============================================================

@pytest.mark.asyncio
async def test_integration_full_path_end_to_end_mocked(
    run_id: UUID,
    mock_planner,
    mock_discovery,
    mock_extractor,
    mock_validator_pass,
    mock_writer,
):
    """
    Integration test running the full Planner -> Discovery -> Extractor ->
    Validator -> Writer path end-to-end with mocked LLM/tool responses.
    """
    captured_checkpoints: list[dict[str, Any]] = []

    async def checkpoint_collector(**kwargs: Any) -> None:
        captured_checkpoints.append(kwargs)

    orch = SupervisorOrchestrator(
        planner_fn=mock_planner,
        discovery_fn=mock_discovery,
        extractor_fn=mock_extractor,
        validator_fn=mock_validator_pass,
        writer_fn=mock_writer,
        checkpoint_fn=checkpoint_collector,
    )

    result = await orch.run(
        run_id=run_id,
        goal="Autonomous research into multi-agent systems",
        max_subtasks=1,
        max_urls_per_subtask=1,
    )

    # Validate output summary
    assert result["run_id"] == str(run_id)
    assert result["goal"] == "Autonomous research into multi-agent systems"
    assert result["pages_processed"] == 1
    assert result["pages_passed"] == 1
    assert result["pages_failed"] == 0
    assert len(result["pages_written"]) == 1
    assert result["pages_written"][0]["markdown_path"] == "./knowledge/state_machines.md"

    # Validate audit trail checkpoints
    node_names_checkpointed = [cp["node_name"] for cp in captured_checkpoints]
    assert "planner" in node_names_checkpointed
    assert "discovery" in node_names_checkpointed
    assert "extractor" in node_names_checkpointed
    assert "validator" in node_names_checkpointed
    assert "writer" in node_names_checkpointed

    for cp in captured_checkpoints:
        assert cp["status"] == LogStatus.SUCCESS
        assert cp["run_id"] == run_id
        assert cp["duration_ms"] >= 0


# ============================================================
# 6. GRAPH & SYNC WRAPPER TESTS
# ============================================================

def test_run_supervisor_sync(
    mock_planner,
    mock_discovery,
    mock_extractor,
    mock_validator_pass,
    mock_writer,
):
    """Tests the synchronous wrapper for supervisor execution."""
    result = run_supervisor_sync(
        goal="Synchronous research goal",
        planner_fn=mock_planner,
        discovery_fn=mock_discovery,
        extractor_fn=mock_extractor,
        validator_fn=mock_validator_pass,
        writer_fn=mock_writer,
        checkpoint_fn=AsyncMock(),
    )
    assert result["pages_passed"] == 1
    assert len(result["pages_written"]) == 1


def test_build_graph_compiles_and_invokes(
    mock_planner,
    mock_discovery,
    mock_extractor,
    mock_validator_pass,
    mock_writer,
):
    """Tests that build_graph compiles a graph and can execute .invoke()."""
    graph = build_graph(
        planner_fn=mock_planner,
        discovery_fn=mock_discovery,
        extractor_fn=mock_extractor,
        validator_fn=mock_validator_pass,
        writer_fn=mock_writer,
        checkpoint_fn=AsyncMock(),
    )

    state = {
        "run_id": str(uuid4()),
        "goal": "Build graph test",
        "max_subtasks": 1,
        "max_urls_per_subtask": 1,
    }

    output = graph.invoke(state)
    assert "result" in output
    assert output["result"]["pages_passed"] == 1
