"""
In-memory run manager, review manager, and event bus for FastAPI API layer.
Executes supervisor runs in background asyncio tasks, streams node transitions,
and manages human-in-the-loop review approval/rejection.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
import logging
from typing import Any, AsyncGenerator, Dict, List, Optional
from uuid import UUID, uuid4

from agents.supervisor import (
    BudgetConfig,
    InterruptReason,
    SupervisorInterrupt,
    SupervisorOrchestrator,
)
from shared.config import get_config
from shared.models import AppConfig

logger = logging.getLogger(__name__)


class RunRecord:
    def __init__(
        self,
        run_id: UUID,
        goal: str,
        budget_config: BudgetConfig,
        config: AppConfig,
    ):
        self.run_id = run_id
        self.goal = goal
        self.budget_config = budget_config
        self.config = config
        self.status: str = "pending"  # pending, running, completed, interrupted, failed
        self.created_at: datetime = datetime.utcnow()
        self.completed_at: Optional[datetime] = None
        self.summary: dict[str, Any] = {
            "run_id": str(run_id),
            "goal": goal,
            "status": "pending",
            "pages_processed": 0,
            "pages_persisted": 0,
            "pages_uncertain": [],
            "pages_failed": 0,
            "tool_calls_made": 0,
            "tokens_used": 0,
            "wall_clock_seconds": 0.0,
            "errors": [],
        }
        self.events: list[dict[str, Any]] = []
        self._subscribers: list[asyncio.Queue] = []
        self.checkpoint_state: Optional[dict[str, Any]] = None
        self.orchestrator: Optional[SupervisorOrchestrator] = None
        self.task: Optional[asyncio.Task] = None
        self.error_message: Optional[str] = None

    def emit_event(self, event_type: str, data: dict[str, Any]) -> None:
        event = {
            "run_id": str(self.run_id),
            "event_type": event_type,
            "timestamp": datetime.utcnow().isoformat(),
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

    def list_runs(self) -> list[RunRecord]:
        return sorted(self.runs.values(), key=lambda r: r.created_at, reverse=True)

    def get_review(self, review_id: UUID) -> Optional[ReviewRecord]:
        return self.reviews.get(review_id)

    def list_pending_reviews(self) -> list[ReviewRecord]:
        return [r for r in self.reviews.values() if r.status == "pending"]

    async def start_run(
        self,
        goal: str,
        budget_config: BudgetConfig | None = None,
        config: AppConfig | None = None,
        run_id: UUID | None = None,
    ) -> RunRecord:
        rid = run_id or uuid4()
        cfg = config or get_config()
        b_cfg = budget_config or BudgetConfig()

        record = RunRecord(run_id=rid, goal=goal, budget_config=b_cfg, config=cfg)
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
            record.emit_event(
                "node_transition",
                {
                    "node": node_name,
                    "status": str(status),
                    "duration_ms": duration_ms,
                    "error_message": error_message,
                },
            )

        orchestrator = SupervisorOrchestrator(
            budget_config=b_cfg,
            checkpoint_fn=checkpoint_callback,
            config=cfg,
        )
        record.orchestrator = orchestrator

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
            record.completed_at = datetime.utcnow()
            record.summary.update(summary)
            record.emit_event("run_completed", {"summary": record.summary})

        except SupervisorInterrupt as interrupt:
            record.status = "interrupted"
            record.checkpoint_state = interrupt.state_snapshot
            record.summary.update(interrupt.state_snapshot)

            # If UNCERTAIN_VERDICT, create a ReviewRecord for human-in-the-loop
            if interrupt.reason == InterruptReason.UNCERTAIN_VERDICT:
                rev_id = uuid4()
                review = ReviewRecord(
                    review_id=rev_id,
                    run_id=record.run_id,
                    page_id=UUID(str(interrupt.state_snapshot.get("page_id", uuid4()))),
                    url=str(interrupt.state_snapshot.get("url", "")),
                    validator_output=interrupt.state_snapshot.get("validator_output", {}),
                    checkpoint_state=interrupt.state_snapshot,
                )
                self.reviews[rev_id] = review
                record.emit_event(
                    "run_interrupted",
                    {
                        "reason": interrupt.reason.value,
                        "review_id": str(rev_id),
                        "details": interrupt.state_snapshot,
                    },
                )
            else:
                record.emit_event(
                    "run_interrupted",
                    {"reason": interrupt.reason.value, "details": interrupt.state_snapshot},
                )

        except Exception as exc:
            logger.exception("Supervisor run %s encountered fatal error: %s", record.run_id, exc)
            record.status = "failed"
            record.error_message = str(exc)
            record.completed_at = datetime.utcnow()
            record.emit_event("run_failed", {"error": str(exc)})

    async def resume_run(self, review_id: UUID, decision: str) -> Optional[RunRecord]:
        review = self.get_review(review_id)
        if not review or review.status != "pending":
            return None

        review.status = "approved" if decision == "approve" else "rejected"
        review.resolved_at = datetime.utcnow()

        record = self.get_run(review.run_id)
        if not record or not record.orchestrator:
            return None

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


# Global singleton instance
run_manager = RunManager()
