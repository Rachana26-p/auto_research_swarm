"""
In-memory run manager, review manager, and event bus for FastAPI API layer.
Executes supervisor runs in background asyncio tasks, streams node transitions,
and manages human-in-the-loop review approval/rejection.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import logging
from pathlib import Path
import shutil
from typing import Any, AsyncGenerator, Dict, List, Optional
from uuid import UUID, uuid4

import httpx

from agents.supervisor import (
    BudgetConfig,
    InterruptReason,
    SupervisorInterrupt,
    SupervisorOrchestrator,
)
from shared.config import get_config
from shared.models import AppConfig

logger = logging.getLogger(__name__)


async def _persist_run_to_supabase(
    cfg: AppConfig,
    run_id: UUID,
    goal: str,
    status: str = "running",
    user_id: str | None = None,
) -> None:
    """Inserts a run record to Supabase runs table so foreign keys in other tables succeed."""
    try:
        key = cfg.supabase_secret_key or cfg.supabase_planner_key
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        }
        payload: dict[str, Any] = {
            "id": str(run_id),
            "goal": goal,
            "status": status,
        }
        if user_id:
            payload["user_id"] = user_id
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"{cfg.supabase_url}/rest/v1/runs",
                json=payload,
                headers=headers,
            )
            if resp.status_code in (200, 201):
                logger.info("Persisted run %s to Supabase runs table", run_id)
            else:
                logger.warning("Supabase runs insert HTTP %d: %s", resp.status_code, resp.text[:200])
    except Exception as exc:
        logger.warning("Failed to insert run %s to Supabase (non-fatal): %s", run_id, exc)


async def _update_run_in_supabase(
    cfg: AppConfig,
    run_id: UUID,
    status: str,
    summary: dict[str, Any] | None = None,
) -> None:
    """Updates run status and summary in Supabase runs table."""
    try:
        key = cfg.supabase_secret_key or cfg.supabase_planner_key
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        payload: dict[str, Any] = {
            "status": status,
            "updated_at": datetime.utcnow().isoformat(),
        }
        if status in ("completed", "failed"):
            payload["completed_at"] = datetime.utcnow().isoformat()
        if summary:
            # Clean summary for JSON serialization
            clean_summary = {
                k: v for k, v in summary.items()
                if isinstance(v, (int, float, str, bool, list, dict))
            }
            payload["config"] = clean_summary

        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.patch(
                f"{cfg.supabase_url}/rest/v1/runs?id=eq.{run_id}",
                json=payload,
                headers=headers,
            )
    except Exception as exc:
        logger.warning("Failed to update run %s in Supabase (non-fatal): %s", run_id, exc)


class RunRecord:
    def __init__(
        self,
        run_id: UUID,
        goal: str,
        budget_config: BudgetConfig,
        config: AppConfig,
        provider: str | None = None,
        model: str | None = None,
        user_id: str | None = None,
    ):
        self.run_id = run_id
        self.goal = goal
        self.budget_config = budget_config
        self.config = config
        self.provider: str = provider or "gemini"
        self.model: str = model or "gemini-1.5-flash"
        self.user_id: Optional[str] = user_id
        self.status: str = "pending"  # pending, running, completed, interrupted, failed
        self.created_at: datetime = datetime.now(timezone.utc)
        self.completed_at: Optional[datetime] = None
        self.summary: dict[str, Any] = {
            "run_id": str(run_id),
            "goal": goal,
            "status": "pending",
            "provider": self.provider,
            "model": self.model,
            "user_id": self.user_id,
            "pages_processed": 0,
            "pages_persisted": 0,
            "pages_uncertain": [],
            "pages_failed": 0,
            "tool_calls_made": 0,
            "tokens_used": 0,
            "wall_clock_seconds": 0.0,
            "errors": [],
        }
        self.events: list[dict[str, Any]] = [
            {
                "run_id": str(run_id),
                "event_type": "run_created",
                "timestamp": self.created_at.isoformat(),
                "status": "pending",
                "goal": goal,
                "user_id": self.user_id,
            }
        ]
        self._subscribers: list[asyncio.Queue] = []
        self.checkpoint_state: Optional[dict[str, Any]] = None
        self.orchestrator: Optional[SupervisorOrchestrator] = None
        self.task: Optional[asyncio.Task] = None
        self.error_message: Optional[str] = None

    def emit_event(self, event_type: str, data: dict[str, Any]) -> None:
        event = {
            "run_id": str(self.run_id),
            "event_type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **data,
        }
        self.events.append(event)
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except Exception:
                pass

    def add_subscriber(self) -> asyncio.Queue:
        q = asyncio.Queue()
        self._subscribers.append(q)
        return q

    def remove_subscriber(self, q: asyncio.Queue) -> None:
        if q in self._subscribers:
            self._subscribers.remove(q)


class ReviewRecord:
    def __init__(
        self,
        review_id: UUID,
        run_id: UUID,
        page_id: UUID,
        url: str,
        validator_output: dict[str, Any],
        checkpoint_state: dict[str, Any],
    ):
        self.id = review_id
        self.run_id = run_id
        self.page_id = page_id
        self.url = url
        self.validator_output = validator_output
        self.checkpoint_state = checkpoint_state
        self.status: str = "pending"  # pending, approved, rejected
        self.created_at: datetime = datetime.utcnow()
        self.resolved_at: Optional[datetime] = None


class RunManager:
    """Thread-safe state manager for API background tasks."""

    def __init__(self) -> None:
        self.runs: dict[UUID, RunRecord] = {}
        self.reviews: dict[UUID, ReviewRecord] = {}
        self._lock = asyncio.Lock()

    def get_run(self, run_id: UUID) -> Optional[RunRecord]:
        return self.runs.get(run_id)

    def list_runs(self, user_id: str | None = None) -> list[RunRecord]:
        all_runs = sorted(self.runs.values(), key=lambda r: r.created_at, reverse=True)
        if user_id:
            return [r for r in all_runs if r.user_id == user_id]
        # Strict user isolation: never leak an authenticated user's runs to unauthenticated callers
        return [r for r in all_runs if not r.user_id]

    def get_review(self, review_id: UUID) -> Optional[ReviewRecord]:
        return self.reviews.get(review_id)

    def list_pending_reviews(self) -> list[ReviewRecord]:
        return [r for r in self.reviews.values() if r.status == "pending"]

    def list_reviews(self, run_id: UUID | None = None, include_resolved: bool = True) -> list[ReviewRecord]:
        items = list(self.reviews.values())
        if run_id is not None:
            items = [r for r in items if r.run_id == run_id]
        if not include_resolved:
            items = [r for r in items if r.status == "pending"]
        return sorted(items, key=lambda r: r.created_at, reverse=True)

    def update_run_goal(self, run_id: UUID, new_goal: str) -> Optional[RunRecord]:
        record = self.runs.get(run_id)
        if not record:
            return None
        record.goal = new_goal.strip()
        return record

    async def delete_run(self, run_id: UUID) -> bool:
        record = self.runs.pop(run_id, None)
        if not record:
            return False
        if record.task and not record.task.done():
            record.task.cancel()
        # Clean associated reviews
        associated_rev_ids = [k for k, r in self.reviews.items() if r.run_id == run_id]
        for k in associated_rev_ids:
            self.reviews.pop(k, None)
        # Clean isolated folder from disk
        try:
            cfg = (record.config if record else None) or get_config()
            k_dir = Path(getattr(cfg, "knowledge_dir", None) or "./knowledge") / str(run_id)
            if k_dir.exists():
                shutil.rmtree(k_dir, ignore_errors=True)
        except Exception as exc:
            logger.warning("Error deleting directory for run %s: %s", run_id, exc)
        return True

    async def start_run(
        self,
        goal: str,
        budget_config: BudgetConfig | None = None,
        config: AppConfig | None = None,
        run_id: UUID | None = None,
        provider: str | None = None,
        model: str | None = None,
        user_id: str | None = None,
    ) -> RunRecord:
        rid = run_id or uuid4()
        try:
            cfg = config or get_config()
        except Exception as exc:
            logger.warning("Could not load config in start_run, using fallback: %s", exc)
            cfg = config or AppConfig()
        b_cfg = budget_config or BudgetConfig()

        record = RunRecord(
            run_id=rid,
            goal=goal,
            budget_config=b_cfg,
            config=cfg,
            provider=provider,
            model=model,
            user_id=user_id,
        )
        self.runs[rid] = record

        # Custom checkpoint callback to intercept node transitions and emit SSE events
        async def checkpoint_callback(
            node_name: str,
            state_snapshot: dict[str, Any],
            duration_ms: int,
            status: Any,
            error_message: str | None = None,
            **kwargs: Any,
        ) -> None:
            record.summary.update({
                k: state_snapshot[k]
                for k in ("pages_processed", "pages_persisted", "tool_calls_made", "tokens_used", "wall_clock_seconds")
                if k in state_snapshot
            })
            # Format live AI reasoning and output text for this node
            agent_text = ""
            details: dict[str, Any] = {}
            if node_name == "planner":
                subtasks = state_snapshot.get("subtasks", [])
                reasoning = state_snapshot.get("reasoning", "")
                details = {"subtasks": subtasks, "reasoning": reasoning}
                subtask_lines = [
                    f"  {i+1}. {s.get('description', '')}\n     [Domains: {', '.join(s.get('candidate_domains', []))}]"
                    for i, s in enumerate(subtasks)
                ]
                agent_text = f"Goal decomposition generated {len(subtasks)} research subtasks:\n\n" + "\n\n".join(subtask_lines)
                if reasoning:
                    agent_text += f"\n\nStrategic Reasoning:\n{reasoning}"
            elif node_name == "discovery":
                ranked = state_snapshot.get("ranked_urls") or state_snapshot.get("urls", [])
                details = {"ranked_urls": ranked}
                url_lines = [
                    f"  • {u.get('url', '')} (relevance score: {u.get('relevance_score', 0):.2f}, domain: {u.get('domain', '')})"
                    for u in ranked[:5]
                ]
                agent_text = f"Discovered and prioritized {len(ranked)} candidate research targets:\n\n" + (
                    "\n".join(url_lines) if url_lines else "  No valid candidate URLs found for subtask criteria."
                )
            elif node_name == "extractor":
                ep = state_snapshot.get("extracted_page", {})
                title = ep.get("title", "Extracted Page")
                summary = ep.get("summary", "")
                headings = ep.get("headings", [])
                details = {"title": title, "summary": summary, "headings": headings}
                heading_str = ", ".join(headings[:4]) if headings else "None"
                agent_text = f"Extracted structured content for: \"{title}\"\n\nSummary:\n{summary}\n\nKey Headings Identified:\n{heading_str}"
            elif node_name == "validator":
                val_res = state_snapshot.get("validation_results", {})
                v_obj = next(iter(val_res.values()), {}) if isinstance(val_res, dict) and val_res else {}
                verdict = str(v_obj.get("verdict", "uncertain")).upper()
                conf = float(v_obj.get("confidence", 0.0))
                details = v_obj
                agent_text = f"Validation Verdict: [{verdict}] (Confidence: {conf*100:.1f}%)\n"
                if v_obj.get("faithfulness_notes"):
                    agent_text += f"\nFaithfulness Assessment:\n{v_obj.get('faithfulness_notes')}\n"
                if v_obj.get("relevance_notes"):
                    agent_text += f"\nRelevance Assessment:\n{v_obj.get('relevance_notes')}"
                if v_obj.get("safety_flags"):
                    agent_text += f"\n\nSafety Flags: {', '.join(v_obj.get('safety_flags'))}"
            elif node_name == "writer":
                md_path = state_snapshot.get("markdown_path", "")
                emb = state_snapshot.get("embedding_generated", False)
                details = {"markdown_path": md_path, "embedding_generated": emb}
                agent_text = f"Knowledge Persistence Complete:\n• Markdown Document: {md_path}\n• Vector Embeddings: {'Generated 768-dim vector in pgvector' if emb else 'Skipped/Offline fallback'}"

            record.emit_event(
                "node_transition",
                {
                    "node": node_name,
                    "status": str(status),
                    "duration_ms": duration_ms,
                    "error_message": error_message,
                    "agent_text": agent_text,
                    "details": details,
                    "pages_processed": record.summary.get("pages_processed", 0),
                    "tool_calls_made": record.summary.get("tool_calls_made", 0),
                    "tokens_used": record.summary.get("tokens_used", 0),
                    "wall_clock_seconds": record.summary.get("wall_clock_seconds", 0.0),
                },
            )

        orchestrator = SupervisorOrchestrator(
            budget_config=b_cfg,
            checkpoint_fn=checkpoint_callback,
            config=cfg,
            provider=provider,
            model=model,
        )
        record.orchestrator = orchestrator

        # Persist run row to Supabase runs table immediately so foreign keys succeed
        await _persist_run_to_supabase(cfg, rid, goal, "running", user_id=user_id)

        # Launch background task
        task = asyncio.create_task(self._run_supervisor_loop(record, orchestrator))
        record.task = task
        return record

    async def _run_supervisor_loop(
        self,
        record: RunRecord,
        orchestrator: SupervisorOrchestrator,
        resume_checkpoint: dict[str, Any] | None = None,
        human_decision: str | None = None,
    ) -> None:
        record.status = "running"
        record.emit_event("run_started", {"goal": record.goal})

        try:
            if resume_checkpoint:
                summary = await orchestrator.resume(
                    checkpoint_state=resume_checkpoint,
                    human_decision=human_decision or "approve",
                )
            else:
                summary = await orchestrator.run(
                    run_id=record.run_id,
                    goal=record.goal,
                )

            record.status = "completed"
            record.completed_at = datetime.now(timezone.utc)
            record.summary.update(summary)
            record.emit_event("run_completed", {"summary": record.summary})
            await _update_run_in_supabase(record.config, record.run_id, "completed", record.summary)

        except SupervisorInterrupt as interrupt:
            logger.info("Supervisor run %s interrupted: %s", record.run_id, interrupt.reason)
            record.status = "interrupted"
            interrupt_state = getattr(interrupt, "state_snapshot", None) or getattr(interrupt, "state", {})
            record.checkpoint_state = interrupt_state
            record.summary.update(interrupt_state)
            await _update_run_in_supabase(record.config, record.run_id, "interrupted", record.summary)

            if interrupt.reason == InterruptReason.QUOTA_EXHAUSTED:
                record.status = "failed"
                record.completed_at = datetime.utcnow()
                record.error_message = f"Free-tier quota exhausted: {interrupt_state.get('error', 'Rate limit exceeded')}"
                record.emit_event(
                    "run_failed",
                    {
                        "reason": "quota_exhausted",
                        "error": record.error_message,
                        "details": interrupt_state,
                    },
                )
                await _update_run_in_supabase(record.config, record.run_id, "failed", record.summary)
            else:
                try:
                    rev_id = uuid4()
                    raw_pid = interrupt_state.get("page_id")
                    try:
                        pid = UUID(str(raw_pid)) if raw_pid else uuid4()
                    except Exception:
                        pid = uuid4()

                    val_data = interrupt_state.get("validator_output") or {
                        "verdict": interrupt.reason.value,
                        "confidence": 0.5,
                        "relevance_notes": f"Interrupted: {interrupt.reason.value}",
                        "faithfulness_notes": interrupt_state.get("error", "Human confirmation required"),
                        "extracted_json": interrupt_state.get("extracted_json", {}),
                        "budget": interrupt_state.get("budget", {}),
                    }
                    review_url = str(interrupt_state.get("url") or interrupt_state.get("current_url") or "")
                    review = ReviewRecord(
                        review_id=rev_id,
                        run_id=record.run_id,
                        page_id=pid,
                        url=review_url,
                        validator_output=val_data,
                        checkpoint_state=interrupt_state,
                    )
                    self.reviews[rev_id] = review
                    record.emit_event(
                        "run_interrupted",
                        {
                            "reason": interrupt.reason.value,
                            "review_id": str(rev_id),
                            "details": interrupt_state,
                        },
                    )
                except Exception as rev_exc:
                    logger.exception("Failed to register review for interrupted run %s: %s", record.run_id, rev_exc)

        except Exception as exc:
            logger.exception("Supervisor run %s encountered fatal error: %s", record.run_id, exc)
            record.status = "failed"
            record.error_message = str(exc)
            record.completed_at = datetime.utcnow()
            record.emit_event("run_failed", {"error": str(exc)})
            await _update_run_in_supabase(record.config, record.run_id, "failed", record.summary)

    async def resume_run(self, review_id: UUID, decision: str) -> Optional[RunRecord]:
        review = self.get_review(review_id)
        if not review or review.status != "pending":
            return None

        review.status = "approved" if decision == "approve" else "rejected"
        review.resolved_at = datetime.utcnow()

        record = self.get_run(review.run_id)
        if not record:
            return None

        if not getattr(record, "orchestrator", None):
            record.orchestrator = SupervisorOrchestrator(
                budget_config=record.budget_config,
                config=record.config,
            )

        await _update_run_in_supabase(record.config, record.run_id, "running")

        # Relaunch supervisor loop with human decision
        checkpoint = review.checkpoint_state
        task = asyncio.create_task(
            self._run_supervisor_loop(
                record=record,
                orchestrator=record.orchestrator,
                resume_checkpoint=checkpoint,
                human_decision=decision,
            )
        )
        record.task = task
        return record

    async def redo_run(self, run_id: UUID) -> Optional[RunRecord]:
        """
        Reruns/redoes a failed or interrupted research run from scratch.
        Logs the failure event for audit trail, clears errors, and restarts supervisor execution.
        """
        record = self.get_run(run_id)
        if not record:
            return None

        previous_error = record.error_message or "Run failed"
        logger.info("Redoing research run %s after previous failure: %s", run_id, previous_error)

        # Log audit trail event of the redo attempt
        record.emit_event(
            "run_retrying",
            {
                "previous_status": record.status,
                "previous_error": previous_error,
                "message": f"Retrying research run after failure: {previous_error}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )

        # Reset execution state
        record.status = "running"
        record.error_message = None
        record.completed_at = None
        record.checkpoint_state = None
        record.summary = {
            "subtasks": [],
            "pages_processed": 0,
            "pages_passed": 0,
            "pages_uncertain": [],
            "pages_failed": 0,
            "pages_written": [],
            "tool_calls_made": 0,
            "tokens_used": 0,
            "wall_clock_seconds": 0.0,
            "errors": [],
        }

        # Fresh orchestrator
        orchestrator = SupervisorOrchestrator(
            budget_config=record.budget_config,
            config=record.config,
            provider=record.provider,
            model=record.model,
        )
        record.orchestrator = orchestrator

        async def checkpoint_callback(
            node_name: str,
            state_snapshot: dict[str, Any],
            duration_ms: int,
            status: Any,
            error_message: str | None = None,
            **kwargs: Any,
        ) -> None:
            record.summary.update({
                k: state_snapshot[k]
                for k in ("pages_processed", "pages_persisted", "tool_calls_made", "tokens_used", "wall_clock_seconds")
                if k in state_snapshot
            })
            agent_text = ""
            if node_name == "planner":
                subtasks = state_snapshot.get("subtasks", [])
                agent_text = (
                    f"Generated {len(subtasks)} research subtasks:\n"
                    + "\n".join(f"  • [{s.get('subtask_id', '')}] {s.get('description', '')}" for s in subtasks)
                )
            elif node_name == "discovery":
                urls = state_snapshot.get("urls", [])
                agent_text = (
                    f"Discovered {len(urls)} research URLs:\n"
                    + "\n".join(f"  • {u.get('url', '')} (score: {u.get('relevance_score', 0):.2f})" for u in urls[:5])
                )
            elif node_name == "extractor":
                ep = state_snapshot.get("extracted_page", {})
                title = ep.get("title", "Untitled")
                desc = ep.get("description", "")
                agent_text = f"Extracted research document:\nTitle: {title}\nSummary: {desc[:200]}"
            elif node_name == "validator":
                vr = state_snapshot.get("validation_results", {})
                first_vr = next(iter(vr.values()), {}) if vr else {}
                verdict = first_vr.get("verdict", "UNKNOWN")
                faith = first_vr.get("faithfulness_notes", "")
                agent_text = f"Validation Verdict: {verdict}\nFaithfulness: {faith}"
            elif node_name == "writer":
                p_id = state_snapshot.get("page_id", "")
                agent_text = f"Persisted research paper to knowledge base (Page ID: {p_id})"

            record.emit_event(
                "node_transition",
                {
                    "node": node_name,
                    "status": str(status),
                    "duration_ms": duration_ms,
                    "error_message": error_message,
                    "agent_text": agent_text,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "pages_processed": record.summary.get("pages_processed", 0),
                    "tool_calls_made": record.summary.get("tool_calls_made", 0),
                    "tokens_used": record.summary.get("tokens_used", 0),
                    "wall_clock_seconds": record.summary.get("wall_clock_seconds", 0),
                },
            )

        orchestrator._do_checkpoint = checkpoint_callback
        await _update_run_in_supabase(record.config, record.run_id, "running")
        task = asyncio.create_task(self._run_supervisor_loop(record, orchestrator))
        record.task = task
        return record


# Global singleton instance
run_manager = RunManager()
