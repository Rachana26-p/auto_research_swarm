"""
Routes for managing research runs and streaming node transition events.
"""

from __future__ import annotations

import asyncio
import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from agents.supervisor import BudgetConfig
from api.deps import verify_api_key
from api.models import RunCreateRequest, RunResponse, RunSummaryResponse
from api.rate_limiter import rate_limit_runs
from api.state import RunRecord, run_manager

router = APIRouter(prefix="/runs", tags=["runs"], dependencies=[Depends(verify_api_key)])


def _to_run_response(record: RunRecord) -> RunResponse:
    s = record.summary
    b = record.budget_config
    return RunResponse(
        id=record.run_id,
        goal=record.goal,
        status=record.status,
        created_at=record.created_at,
        completed_at=record.completed_at,
        pages_processed=s.get("pages_processed", 0),
        pages_persisted=s.get("pages_persisted", 0),
        pages_uncertain_count=len(s.get("pages_uncertain", [])),
        pages_failed=s.get("pages_failed", 0),
        tool_calls_made=s.get("tool_calls_made", 0),
        tokens_used=s.get("tokens_used", 0),
        wall_clock_seconds=float(s.get("wall_clock_seconds", 0.0)),
        error_message=record.error_message,
        max_pages=b.max_pages if b else 20,
        max_tokens=b.max_tokens if b else 500000,
        max_tool_calls=b.max_tool_calls if b else 200,
    )


@router.post(
    "",
    response_model=RunResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_runs)],
)
async def create_run(req: RunCreateRequest) -> RunResponse:
    """
    Launch a new research run with budget limits as a background task.
    Enforces goal length limits and rate limits.
    """
    b_cfg = BudgetConfig(
        max_pages=req.max_pages,
        max_tool_calls=req.max_tool_calls,
        max_tokens=req.max_tokens,
        max_wall_seconds=req.max_wall_seconds,
    )
    record = await run_manager.start_run(goal=req.goal, budget_config=b_cfg)
    return _to_run_response(record)


@router.get("", response_model=list[RunSummaryResponse])
async def list_runs() -> list[RunSummaryResponse]:
    """List all research runs and their status."""
    runs = run_manager.list_runs()
    return [
        RunSummaryResponse(
            id=r.run_id,
            goal=r.goal,
            status=r.status,
            created_at=r.created_at,
            pages_persisted=r.summary.get("pages_persisted", 0),
            tokens_used=r.summary.get("tokens_used", 0),
        )
        for r in runs
    ]


@router.get("/{run_id}", response_model=RunResponse)
async def get_run(run_id: UUID) -> RunResponse:
    """Get full details and execution metrics for a specific run."""
    record = run_manager.get_run(run_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    return _to_run_response(record)


@router.get("/{run_id}/events")
async def stream_run_events(run_id: UUID) -> StreamingResponse:
    """
    Server-Sent Events (SSE) stream of node transitions and status changes.
    """
    record = run_manager.get_run(run_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    async def event_generator():
        queue = record.add_subscriber()
        try:
            # Yield historical events first
            for past_event in list(record.events):
                yield f"data: {json.dumps(past_event)}\n\n"

            # If already terminal, close stream
            if record.status in ("completed", "failed"):
                return

            # Listen for new events
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("event_type") in ("run_completed", "run_failed"):
                        break
                except asyncio.TimeoutError:
                    # Keep-alive ping comment
                    yield ": ping\n\n"
                    if record.status in ("completed", "failed"):
                        break
        finally:
            record.remove_subscriber(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
