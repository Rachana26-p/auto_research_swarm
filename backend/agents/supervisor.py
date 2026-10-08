"""
Supervisor — LangGraph Orchestration Layer (supervisor.md)

Wires Planner, Discovery, Extractor, Validator, Writer into a single
deterministic state machine with explicit conditional edges.
No LLM calls for routing logic — routing decisions are deterministic code.

Features:
- Explicit nodes: planner_node, discovery_node, extractor_node, validator_node, writer_node
- Conditional edges:
    extractor -> validator (always)
    validator -> writer (on PASS)
    validator -> interrupt() (on UNCERTAIN)
    validator -> discard (on FAIL)
- Per-node timeout and retry with exponential backoff (tenacity)
- Per-run budget: max_tokens, max_tool_calls, max_pages, max_wall_seconds (hard stop)
- Human-in-the-loop: interrupt() on UNCERTAIN verdict or budget warning (>=80%)
- Interrupted runs are resumable without re-running completed work
- Crash recovery: restore from latest checkpoint and resume
- Full state checkpointing to Supabase agent_logs after every node transition
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import logging
import time
from typing import Any, Callable, Dict, List, Optional
from uuid import UUID, uuid4

import httpx
from pydantic import ValidationError
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from shared.config import get_config
from shared.models import (
    AgentLogEntry,
    AgentName,
    AppConfig,
    DiscoveryInput,
    DiscoveryOutput,
    ExtractedPage,
    ExtractorInput,
    ExtractorOutput,
    LogStatus,
    PlannerInput,
    PlannerOutput,
    RankedUrl,
    Subtask,
    SupervisorRunSummary,
    ToolCall,
    ValidationVerdict,
    ValidatorInput,
    ValidatorOutput,
    WriterInput,
    WriterOutput,
)

logger = logging.getLogger(__name__)


# ============================================================
# CONFIGURATIONS & ENUMS
# ============================================================

@dataclass
class NodeConfig:
    timeout_seconds: float
    max_retries: int
    retry_wait_min: float = 0.5
    retry_wait_max: float = 5.0


@dataclass
class BudgetConfig:
    max_pages: int = 20
    max_tool_calls: int = 200
    max_tokens: int = 500_000
    max_wall_seconds: float = 1800.0
    budget_warn_fraction: float = 0.8


DEFAULT_NODE_CONFIGS: dict[str, NodeConfig] = {
    "planner":   NodeConfig(timeout_seconds=60.0,  max_retries=2),
    "discovery": NodeConfig(timeout_seconds=120.0, max_retries=3),
    "extractor": NodeConfig(timeout_seconds=180.0, max_retries=3),
    "validator": NodeConfig(timeout_seconds=90.0,  max_retries=2),
    "writer":    NodeConfig(timeout_seconds=120.0, max_retries=2),
}


class InterruptReason(str, Enum):
    UNCERTAIN_VERDICT = "uncertain_verdict"
    BUDGET_WARNING    = "budget_warning"
    GUARDRAIL_REJECT  = "guardrail_reject"


class SupervisorInterrupt(Exception):
    """Raised when execution needs human-in-the-loop review or intervention."""
    def __init__(self, reason: InterruptReason, state: dict[str, Any]) -> None:
        super().__init__(f"Supervisor interrupt: {reason.value}")
        self.reason = reason
        self.state = state


class BudgetExceeded(Exception):
    """Raised when hard budget limit is exceeded (hard stop, not a warning)."""
    def __init__(self, msg: str, state: dict[str, Any]) -> None:
        super().__init__(msg)
        self.state = state


# ============================================================
# BUDGET TRACKER
# ============================================================

@dataclass
class RunBudget:
    max_pages: int
    max_tool_calls: int
    max_tokens: int
    max_wall_seconds: float
    budget_warn_fraction: float
    start_wall_time: float = field(default_factory=time.monotonic)
    pages_processed: int = 0
    tool_calls_made: int = 0
    tokens_used: int = 0
    budget_warning_fired: bool = False

    def record_page(self) -> None:
        self.pages_processed += 1

    def record_tool_calls(self, count: int) -> None:
        self.tool_calls_made += count

    def record_tokens(self, count: int) -> None:
        self.tokens_used += count

    def elapsed_seconds(self) -> float:
        return time.monotonic() - self.start_wall_time

    def check_hard_limits(self, state: dict[str, Any]) -> None:
        """Enforces hard stops. Raises BudgetExceeded immediately."""
        if self.pages_processed > self.max_pages:
            raise BudgetExceeded(
                f"Hard budget exceeded: pages_processed {self.pages_processed} > max {self.max_pages}",
                state,
            )
        if self.tool_calls_made > self.max_tool_calls:
            raise BudgetExceeded(
                f"Hard budget exceeded: tool_calls_made {self.tool_calls_made} > max {self.max_tool_calls}",
                state,
            )
        if self.tokens_used > self.max_tokens:
            raise BudgetExceeded(
                f"Hard budget exceeded: tokens_used {self.tokens_used} > max {self.max_tokens}",
                state,
            )
        elapsed = self.elapsed_seconds()
        if elapsed > self.max_wall_seconds:
            raise BudgetExceeded(
                f"Hard budget exceeded: elapsed {elapsed:.1f}s > max {self.max_wall_seconds:.1f}s",
                state,
            )

    def check_warn_threshold(self, state: dict[str, Any]) -> bool:
        """Returns True if any resource reached warning fraction and hasn't fired yet."""
        if self.budget_warning_fired:
            return False

        warn = (
            (self.max_pages > 0 and self.pages_processed > 0 and self.pages_processed >= self.max_pages * self.budget_warn_fraction)
            or (self.max_tool_calls > 0 and self.tool_calls_made > 0 and self.tool_calls_made >= self.max_tool_calls * self.budget_warn_fraction)
            or (self.max_tokens > 0 and self.tokens_used > 0 and self.tokens_used >= self.max_tokens * self.budget_warn_fraction)
            or (self.max_wall_seconds > 0 and self.elapsed_seconds() >= self.max_wall_seconds * self.budget_warn_fraction)
        )
        if warn:
            self.budget_warning_fired = True
        return warn

    def to_dict(self) -> dict[str, Any]:
        return {
            "max_pages": self.max_pages,
            "max_tool_calls": self.max_tool_calls,
            "max_tokens": self.max_tokens,
            "max_wall_seconds": self.max_wall_seconds,
            "pages_processed": self.pages_processed,
            "tool_calls_made": self.tool_calls_made,
            "tokens_used": self.tokens_used,
            "elapsed_seconds": self.elapsed_seconds(),
            "budget_warning_fired": self.budget_warning_fired,
        }


# ============================================================
# STATE CHECKPOINTING & OBSERVABILITY
# ============================================================

def _sanitize_for_json(obj: Any) -> Any:
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(i) for i in obj]
    return obj


async def _checkpoint_to_supabase(
    config: AppConfig,
    run_id: UUID,
    node_name: str,
    state_snapshot: dict[str, Any],
    duration_ms: int,
    status: LogStatus,
    error_message: str | None = None,
    tool_calls: list[dict[str, Any]] | None = None,
    tokens_used: int = 0,
) -> None:
    """Checkpoints state to Supabase agent_logs for full audit trail and recovery."""
    safe_state = _sanitize_for_json(state_snapshot)
    try:
        agent_enum = AgentName(node_name)
    except ValueError:
        agent_enum = AgentName.PLANNER

    valid_tcs: list[ToolCall] = []
    for tc in (tool_calls or []):
        try:
            if isinstance(tc, ToolCall):
                valid_tcs.append(tc)
            elif isinstance(tc, dict):
                valid_tcs.append(ToolCall(**tc))
        except Exception:
            pass

    entry = AgentLogEntry(
        run_id=run_id,
        agent_name=agent_enum,
        node_name=node_name,
        input_state=safe_state,
        output_state=safe_state,
        tool_calls=valid_tcs,
        duration_ms=duration_ms,
        status=status,
        error_message=error_message,
    )
    payload = {
        "id": str(entry.id),
        "run_id": str(entry.run_id),
        "agent_name": entry.agent_name,
        "node_name": entry.node_name,
        "input_state": entry.input_state,
        "output_state": entry.output_state,
        "tool_calls": [tc.model_dump(mode="json") for tc in entry.tool_calls],
        "duration_ms": entry.duration_ms,
        "status": entry.status,
        "error_message": entry.error_message,
        "created_at": entry.created_at.isoformat(),
    }
    headers = {
        "apikey": config.supabase_planner_key,
        "Authorization": f"Bearer {config.supabase_planner_key}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{config.supabase_url}/rest/v1/agent_logs",
                json=payload,
                headers=headers,
            )
            if resp.status_code not in (200, 201):
                logger.warning("agent_logs HTTP %d: %s", resp.status_code, resp.text[:200])
    except Exception as exc:
        logger.warning("Checkpoint to agent_logs failed (non-fatal): %s", exc)


def _route_validator_output(val_dict: dict[str, Any]) -> str:
    """
    Deterministic conditional edge routing:
      PASS      -> writer
      UNCERTAIN -> interrupt
      FAIL      -> discard
    """
    verdict_raw = val_dict.get("verdict", "")
    verdict = verdict_raw.value if hasattr(verdict_raw, "value") else str(verdict_raw).lower()
    if verdict == ValidationVerdict.PASS.value:
        return "writer"
    if verdict == ValidationVerdict.UNCERTAIN.value:
        return "interrupt"
    return "discard"


# ============================================================
# SUPERVISOR ORCHESTRATOR
# ============================================================

class SupervisorOrchestrator:
    """
    LangGraph state machine supervisor managing execution flow,
    conditional edge routing, budgets, timeouts, retries, and checkpoint recovery.
    """

    def __init__(
        self,
        node_configs: dict[str, NodeConfig] | None = None,
        budget_config: BudgetConfig | None = None,
        planner_fn:    Callable | None = None,
        discovery_fn:  Callable | None = None,
        extractor_fn:  Callable | None = None,
        validator_fn:  Callable | None = None,
        writer_fn:     Callable | None = None,
        checkpoint_fn: Callable | None = None,
        config:        AppConfig | None = None,
    ) -> None:
        self.node_configs   = node_configs  or DEFAULT_NODE_CONFIGS
        self.budget_config  = budget_config or BudgetConfig()
        self._planner_fn    = planner_fn
        self._discovery_fn  = discovery_fn
        self._extractor_fn  = extractor_fn
        self._validator_fn  = validator_fn
        self._writer_fn     = writer_fn
        self._checkpoint_fn = checkpoint_fn
        self._config        = config
        self.checkpoint_history: list[dict[str, Any]] = []

    def _get_fns(self) -> dict[str, Callable]:
        if self._planner_fn is not None:
            return {
                "planner":   self._planner_fn,
                "discovery": self._discovery_fn,
                "extractor": self._extractor_fn,
                "validator": self._validator_fn,
                "writer":    self._writer_fn,
            }
        from agents.planner   import planner_node
        from agents.discovery import discovery_node
        from agents.extractor import extractor_node
        from agents.validator import validator_node
        from agents.writer    import writer_node
        return {
            "planner":   planner_node,
            "discovery": discovery_node,
            "extractor": extractor_node,
            "validator": validator_node,
            "writer":    writer_node,
        }

    async def _do_checkpoint(self, **kwargs: Any) -> None:
        self.checkpoint_history.append(kwargs)
        if self._checkpoint_fn is not None:
            await self._checkpoint_fn(**kwargs)
        else:
            await _checkpoint_to_supabase(**kwargs)

    async def _run_node(
        self,
        node_name: str,
        node_fn: Callable,
        state: dict[str, Any],
        budget: RunBudget,
        config: AppConfig,
        run_id: UUID,
    ) -> dict[str, Any]:
        """
        Executes a single agent node with:
        - Per-node timeout enforcement
        - Tenacity retry with exponential backoff on retryable errors
        - Audit checkpointing on both success and failure
        """
        cfg = self.node_configs.get(node_name, NodeConfig(timeout_seconds=60.0, max_retries=2))
        budget.check_hard_limits(state)

        start = time.monotonic()
        last_exc: Exception | None = None
        result: dict[str, Any] = {}

        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(cfg.max_retries),
                wait=wait_exponential(multiplier=0.5, min=cfg.retry_wait_min, max=cfg.retry_wait_max),
                retry=retry_if_exception_type((asyncio.TimeoutError, RuntimeError, ConnectionError)),
                reraise=False,
            ):
                with attempt:
                    try:
                        result = await asyncio.wait_for(node_fn(state), timeout=cfg.timeout_seconds)
                        last_exc = None
                    except asyncio.TimeoutError as exc:
                        last_exc = exc
                        logger.warning(
                            "Node %r timed out (attempt %d/%d)",
                            node_name, attempt.retry_state.attempt_number, cfg.max_retries
                        )
                        raise
                    except (RuntimeError, ConnectionError) as exc:
                        last_exc = exc
                        logger.warning(
                            "Node %r attempt %d/%d failed: %s",
                            node_name, attempt.retry_state.attempt_number, cfg.max_retries, exc
                        )
                        raise
        except Exception as exc:
            last_exc = exc

        duration_ms = int((time.monotonic() - start) * 1000)

        if last_exc is not None:
            await self._do_checkpoint(
                config=config,
                run_id=run_id,
                node_name=node_name,
                state_snapshot=state,
                duration_ms=duration_ms,
                status=LogStatus.FAILED,
                error_message=str(last_exc),
                tool_calls=[],
            )
            raise RuntimeError(
                f"Node {node_name!r} failed after {cfg.max_retries} retries: {last_exc}"
            ) from last_exc

        # Record tool calls and token usage into budget
        tool_calls = result.get("tool_calls", [])
        budget.record_tool_calls(len(tool_calls) if isinstance(tool_calls, list) else 0)
        tokens = result.get("tokens_used", 0)
        if tokens:
            budget.record_tokens(int(tokens))

        merged = {**state, **result}
        await self._do_checkpoint(
            config=config,
            run_id=run_id,
            node_name=node_name,
            state_snapshot=merged,
            duration_ms=duration_ms,
            status=LogStatus.SUCCESS,
            error_message=None,
            tool_calls=[tc if isinstance(tc, dict) else tc for tc in (tool_calls or [])],
            tokens_used=tokens,
        )
        logger.info("Node %r completed successfully in %dms", node_name, duration_ms)
        return result

    async def run(
        self,
        run_id: UUID,
        goal: str,
        max_subtasks: int = 5,
        max_domains_per_subtask: int = 3,
        max_urls_per_subtask: int = 5,
        resume_checkpoint: dict[str, Any] | None = None,
        human_decision: str = "approve",
    ) -> dict[str, Any]:
        """
        Runs the orchestration loop across all nodes.
        Supports resuming from a prior checkpoint state (crash recovery or post-interrupt).
        """
        config = self._config or get_config()
        fns = self._get_fns()

        # Initialize budget, restoring previous usage if resuming
        budget = RunBudget(
            max_pages=self.budget_config.max_pages,
            max_tool_calls=self.budget_config.max_tool_calls,
            max_tokens=self.budget_config.max_tokens,
            max_wall_seconds=self.budget_config.max_wall_seconds,
            budget_warn_fraction=self.budget_config.budget_warn_fraction,
            start_wall_time=time.monotonic(),
        )

        # Restore state if resuming
        if resume_checkpoint:
            summary = dict(resume_checkpoint)
            budget.pages_processed = summary.get("pages_processed", 0)
            budget.tool_calls_made = summary.get("tool_calls_made", 0)
            budget.tokens_used = summary.get("tokens_used", 0)
            subtasks = summary.get("subtasks", [])
            processed_urls = {
                item.get("url") for item in summary.get("pages_written", [])
            } | {
                err.get("url") for err in summary.get("errors", [])
            }
        else:
            summary = {
                "run_id": str(run_id),
                "goal": goal,
                "pages_processed": 0,
                "pages_passed": 0,
                "pages_failed": 0,
                "pages_uncertain": [],
                "pages_written": [],
                "errors": [],
                "subtasks": [],
            }
            subtasks = []
            processed_urls = set()

        # Handle pending uncertain page if resuming from human interrupt
        if resume_checkpoint and resume_checkpoint.get("pages_uncertain"):
            uncertain_pages = list(resume_checkpoint["pages_uncertain"])
            summary["pages_uncertain"] = []
            for item in uncertain_pages:
                u_url = item.get("url")
                u_page_id = item.get("page_id")
                u_val_dict = item.get("validator_output", {})
                u_ext_json = item.get("extracted_json", {})
                processed_urls.add(u_url)

                if human_decision == "approve":
                    # Human approved: force PASS and proceed to writer
                    try:
                        ep = ExtractedPage.model_validate(u_ext_json)
                        u_val_dict["verdict"] = ValidationVerdict.PASS.value
                        vo = ValidatorOutput.model_validate(u_val_dict)
                        wr = await self._run_node(
                            "writer", fns["writer"],
                            {
                                "run_id": run_id,
                                "page_id": UUID(str(u_page_id)),
                                "source_url": u_url,
                                "extracted_content": ep.model_dump(),
                                "validation_result": vo.model_dump(),
                            },
                            budget, config, run_id,
                        )
                        summary["pages_passed"] += 1
                        summary["pages_written"].append({
                            "url": u_url,
                            "page_id": str(u_page_id),
                            "markdown_path": wr.get("markdown_path", ""),
                        })
                    except Exception as exc:
                        summary["errors"].append({"url": u_url, "stage": "resume_writer", "error": str(exc)})
                        summary["pages_failed"] += 1
                else:
                    # Human rejected: discard
                    summary["pages_failed"] += 1

        # Step 1: Planner Node (skip if already done in resumed checkpoint)
        if not subtasks:
            planner_input = PlannerInput(
                run_id=run_id,
                goal=goal,
                max_subtasks=max_subtasks,
                max_domains_per_subtask=max_domains_per_subtask,
            )
            planner_result = await self._run_node(
                "planner", fns["planner"],
                planner_input.model_dump(),
                budget, config, run_id,
            )
            valid_p_keys = {"run_id", "subtasks", "reasoning", "tool_calls", "tokens_used"}
            planner_output = (
                planner_result if isinstance(planner_result, PlannerOutput)
                else PlannerOutput.model_validate({k: v for k, v in planner_result.items() if k in valid_p_keys})
            )
            subtasks = planner_output.subtasks
            summary["subtasks"] = [s.model_dump() for s in subtasks]

        # Step 2: Loop Subtasks -> Discovery
        for subtask in subtasks:
            subtask_obj = subtask if isinstance(subtask, Subtask) else Subtask.model_validate(subtask)
            subtask_id   = subtask_obj.subtask_id
            description  = subtask_obj.description
            cand_domains = subtask_obj.candidate_domains

            budget.check_hard_limits(summary)
            if budget.check_warn_threshold(summary):
                raise SupervisorInterrupt(
                    InterruptReason.BUDGET_WARNING,
                    {**summary, "subtask_id": subtask_id, "budget": budget.to_dict()}
                )

            disc_input = DiscoveryInput(
                run_id=run_id,
                subtask_id=subtask_id,
                description=description,
                candidate_domains=cand_domains,
                max_urls=max_urls_per_subtask,
            )
            disc_result = await self._run_node(
                "discovery", fns["discovery"],
                disc_input.model_dump(),
                budget, config, run_id,
            )
            valid_d_keys = {"run_id", "subtask_id", "urls", "tool_calls", "tokens_used"}
            discovery_output = (
                disc_result if isinstance(disc_result, DiscoveryOutput)
                else DiscoveryOutput.model_validate({k: v for k, v in disc_result.items() if k in valid_d_keys})
            )
            urls = discovery_output.urls

            # Step 3: For each URL -> Extractor -> Validator -> Writer / Discard / Interrupt
            for url_item in urls:
                ranked_url = url_item if isinstance(url_item, RankedUrl) else RankedUrl.model_validate(url_item)
                url = ranked_url.url
                if not url or url in processed_urls:
                    continue
                processed_urls.add(url)

                page_id = uuid4()
                budget.record_page()
                summary["pages_processed"] = budget.pages_processed
                budget.check_hard_limits(summary)

                if budget.check_warn_threshold(summary):
                    raise SupervisorInterrupt(
                        InterruptReason.BUDGET_WARNING,
                        {**summary, "current_url": url, "budget": budget.to_dict()}
                    )

                # Node: Extractor
                extractor_input = ExtractorInput(run_id=run_id, page_id=page_id, url=url)
                try:
                    ext_result = await self._run_node(
                        "extractor", fns["extractor"],
                        extractor_input.model_dump(),
                        budget, config, run_id,
                    )
                except RuntimeError as exc:
                    summary["errors"].append({"url": url, "stage": "extractor", "error": str(exc)})
                    summary["pages_failed"] += 1
                    continue

                valid_e_keys = {"extracted_page", "extracted_json", "source_content", "tool_calls"}
                extractor_output = (
                    ext_result if isinstance(ext_result, ExtractorOutput)
                    else ExtractorOutput.model_validate({k: v for k, v in ext_result.items() if k in valid_e_keys})
                )
                ep: ExtractedPage = extractor_output.extracted_page
                source_content: str = extractor_output.source_content

                # Node: Validator
                validator_input = ValidatorInput(
                    run_id=run_id,
                    page_id=page_id,
                    url=url,
                    extracted_content=ep,
                    source_content=source_content,
                    subtask_description=description,
                )
                try:
                    val_result = await self._run_node(
                        "validator", fns["validator"],
                        validator_input.model_dump(),
                        budget, config, run_id,
                    )
                except RuntimeError as exc:
                    raise SupervisorInterrupt(
                        InterruptReason.GUARDRAIL_REJECT,
                        {**summary, "url": url, "page_id": str(page_id), "error": str(exc)},
                    )

                val_results = val_result.get("validation_results", {})
                val_data = val_results.get(str(page_id), {})
                valid_v_keys = {"run_id", "page_id", "verdict", "confidence", "faithfulness_notes", "relevance_notes", "safety_flags", "validation_status", "validation_reasoning", "tool_calls"}
                validator_output = (
                    val_data if isinstance(val_data, ValidatorOutput)
                    else ValidatorOutput.model_validate({k: v for k, v in val_data.items() if k in valid_v_keys})
                )
                val_dict = validator_output.model_dump(mode="json")
                route = _route_validator_output(val_dict)

                # Conditional Edge: UNCERTAIN -> interrupt()
                if route == "interrupt":
                    summary["pages_uncertain"].append({
                        "url": url,
                        "page_id": str(page_id),
                        "validator_output": val_dict,
                        "extracted_json": ep.model_dump(),
                    })
                    await self._do_checkpoint(
                        config=config,
                        run_id=run_id,
                        node_name="supervisor_interrupt",
                        state_snapshot={**summary, "interrupt_reason": "uncertain_verdict"},
                        duration_ms=0,
                        status=LogStatus.FAILED,
                        error_message="UNCERTAIN -- interrupt for human review",
                    )
                    raise SupervisorInterrupt(
                        InterruptReason.UNCERTAIN_VERDICT,
                        {**summary, "url": url, "page_id": str(page_id), "validator_output": val_dict},
                    )

                # Conditional Edge: FAIL -> discard
                if route == "discard":
                    summary["pages_failed"] += 1
                    continue

                # Conditional Edge: PASS -> writer
                writer_input = WriterInput(
                    run_id=run_id,
                    page_id=page_id,
                    source_url=url,
                    extracted_content=ep,
                    validation_result=validator_output,
                )
                try:
                    wr = await self._run_node(
                        "writer", fns["writer"],
                        writer_input.model_dump(),
                        budget, config, run_id,
                    )
                    valid_w_keys = {"run_id", "page_id", "markdown_path", "supabase_page_row_id", "embedding_generated", "embedding_ids", "tool_calls"}
                    writer_output = (
                        wr if isinstance(wr, WriterOutput)
                        else WriterOutput.model_validate({k: v for k, v in wr.items() if k in valid_w_keys})
                    )
                    summary["pages_passed"] += 1
                    summary["pages_written"].append({
                        "url": url,
                        "page_id": str(page_id),
                        "markdown_path": writer_output.markdown_path,
                    })
                except RuntimeError as exc:
                    summary["errors"].append({"url": url, "stage": "writer", "error": str(exc)})
                    summary["pages_failed"] += 1

        summary["pages_processed"] = budget.pages_processed
        summary["tool_calls_made"] = budget.tool_calls_made
        summary["tokens_used"] = budget.tokens_used
        return summary

    async def resume(
        self,
        checkpoint_state: dict[str, Any],
        human_decision: str = "approve",
    ) -> dict[str, Any]:
        """Resumes an interrupted run using its checkpointed state."""
        run_id = UUID(str(checkpoint_state.get("run_id", uuid4())))
        goal = str(checkpoint_state.get("goal", ""))
        return await self.run(
            run_id=run_id,
            goal=goal,
            resume_checkpoint=checkpoint_state,
            human_decision=human_decision,
        )


# ============================================================
# GRAPH BUILDER (LangGraph compatible)
# ============================================================

class SimpleCompiledGraph:
    """Fallback compiled graph when LangGraph is not installed."""
    def __init__(self, orchestrator: SupervisorOrchestrator) -> None:
        self.orchestrator = orchestrator

    async def ainvoke(self, state: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, Any]:
        rid = UUID(str(state.get("run_id", uuid4())))
        result = await self.orchestrator.run(
            run_id=rid,
            goal=str(state.get("goal", "")),
            max_subtasks=int(state.get("max_subtasks", 5)),
            max_urls_per_subtask=int(state.get("max_urls_per_subtask", 5)),
        )
        return {"result": result, **state}

    def invoke(self, state: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, Any]:
        return asyncio.run(self.ainvoke(state, config))


def build_graph(
    node_configs: dict[str, NodeConfig] | None = None,
    budget_config: BudgetConfig | None = None,
    planner_fn:    Callable | None = None,
    discovery_fn:  Callable | None = None,
    extractor_fn:  Callable | None = None,
    validator_fn:  Callable | None = None,
    writer_fn:     Callable | None = None,
    checkpoint_fn: Callable | None = None,
    config:        AppConfig | None = None,
) -> Any:
    """
    Builds the state graph. Returns LangGraph StateGraph if installed,
    otherwise returns a SimpleCompiledGraph with equivalent execution behavior.
    """
    orch = SupervisorOrchestrator(
        node_configs=node_configs,
        budget_config=budget_config,
        planner_fn=planner_fn,
        discovery_fn=discovery_fn,
        extractor_fn=extractor_fn,
        validator_fn=validator_fn,
        writer_fn=writer_fn,
        checkpoint_fn=checkpoint_fn,
        config=config,
    )

    try:
        from langgraph.graph import StateGraph, END
        import concurrent.futures
        from typing import TypedDict

        class GraphState(TypedDict, total=False):
            run_id: str
            goal: str
            max_subtasks: int
            max_urls_per_subtask: int
            result: dict

        def _run_supervisor(state: GraphState) -> GraphState:
            rid = UUID(str(state.get("run_id", uuid4())))
            coro = orch.run(
                run_id=rid,
                goal=str(state.get("goal", "")),
                max_subtasks=int(state.get("max_subtasks", 5)),
                max_urls_per_subtask=int(state.get("max_urls_per_subtask", 5)),
            )
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

            if loop and loop.is_running():
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                    res = ex.submit(asyncio.run, coro).result()
            else:
                res = asyncio.run(coro)
            return {"result": res, **state}

        g = StateGraph(GraphState)
        g.add_node("supervisor", _run_supervisor)
        g.set_entry_point("supervisor")
        g.add_edge("supervisor", END)
        logger.info("Using real LangGraph engine (langgraph StateGraph active)")
        return g.compile()
    except ImportError:
        logger.info("langgraph not available; using SimpleCompiledGraph fallback")
        return SimpleCompiledGraph(orch)


# ============================================================
# SYNCHRONOUS RUNNER
# ============================================================

def run_supervisor_sync(
    goal: str,
    run_id: UUID | None = None,
    max_subtasks: int = 5,
    max_urls_per_subtask: int = 5,
    node_configs: dict[str, NodeConfig] | None = None,
    budget_config: BudgetConfig | None = None,
    planner_fn:    Callable | None = None,
    discovery_fn:  Callable | None = None,
    extractor_fn:  Callable | None = None,
    validator_fn:  Callable | None = None,
    writer_fn:     Callable | None = None,
    checkpoint_fn: Callable | None = None,
    config:        AppConfig | None = None,
) -> dict[str, Any]:
    """Synchronous entry point for running the supervisor state machine."""
    orch = SupervisorOrchestrator(
        node_configs=node_configs,
        budget_config=budget_config,
        planner_fn=planner_fn,
        discovery_fn=discovery_fn,
        extractor_fn=extractor_fn,
        validator_fn=validator_fn,
        writer_fn=writer_fn,
        checkpoint_fn=checkpoint_fn,
        config=config,
    )
    return asyncio.run(orch.run(
        run_id=run_id or uuid4(),
        goal=goal,
        max_subtasks=max_subtasks,
        max_urls_per_subtask=max_urls_per_subtask,
    ))


__all__ = [
    "SupervisorOrchestrator",
    "SupervisorInterrupt",
    "BudgetExceeded",
    "InterruptReason",
    "NodeConfig",
    "BudgetConfig",
    "RunBudget",
    "DEFAULT_NODE_CONFIGS",
    "build_graph",
    "run_supervisor_sync",
]