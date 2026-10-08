"""
Routes for querying guardrail audit trail events.
"""

from __future__ import annotations

from uuid import UUID
from fastapi import APIRouter, Depends, Query

from api.deps import verify_api_key
from api.models import GuardrailEventResponse
from guardrails import get_guardrail_events

router = APIRouter(prefix="/guardrail-events", tags=["guardrails"], dependencies=[Depends(verify_api_key)])


@router.get("", response_model=list[GuardrailEventResponse])
async def list_guardrail_events(
    run_id: UUID | None = Query(default=None, description="Filter guardrail events by run ID"),
) -> list[GuardrailEventResponse]:
    """
    Retrieve guardrail audit log decisions, optionally filtered by run_id.
    Includes both PASS and BLOCK decisions across all agents.
    """
    raw_events = get_guardrail_events(run_id=run_id)
    return [
        GuardrailEventResponse(
            id=ev.id,
            run_id=ev.run_id,
            agent_name=str(ev.agent_name.value if hasattr(ev.agent_name, "value") else ev.agent_name),
            event_type=str(ev.event_type.value if hasattr(ev.event_type, "value") else ev.event_type),
            decision=str(ev.details.get("decision", "UNKNOWN")),
            details=ev.details,
            created_at=ev.created_at,
        )
        for ev in raw_events
    ]
