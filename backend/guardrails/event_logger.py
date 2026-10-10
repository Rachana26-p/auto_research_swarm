"""
Guardrail events logger: single centralized audit logger for all guardrail decisions.
Called on every decision, PASS included.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

import httpx

from shared.models import AppConfig, GuardrailEvent, GuardrailEventType, AgentName

logger = logging.getLogger(__name__)

# Central in-memory audit store for real-time querying (e.g. GET /guardrail-events) and testing
_EVENT_LOG: list[GuardrailEvent] = []


async def log_guardrail_event(
    config: AppConfig | None,
    event: GuardrailEvent,
) -> None:
    """
    Records a guardrail decision into the audit trail and writes to Supabase.
    Called on EVERY decision, PASS included.
    """
    _EVENT_LOG.append(event)
    logger.info(
        "Guardrail event recorded: agent=%s type=%s run_id=%s",
        event.agent_name,
        event.event_type,
        event.run_id,
    )

    if not config or not config.supabase_url:
        return

    db_event_type = event.event_type
    if hasattr(db_event_type, "value"):
        db_event_type = db_event_type.value
    db_event_type = str(db_event_type).lower()

    valid_types = {
        "tool_schema_violation",
        "content_sanitization",
        "egress_blocked",
        "validation_failed",
    }
    if db_event_type not in valid_types:
        if "schema" in db_event_type:
            db_event_type = "tool_schema_violation"
        elif "egress" in db_event_type:
            db_event_type = "egress_blocked"
        else:
            db_event_type = "content_sanitization"

    payload = {
        "id": str(event.id),
        "run_id": str(event.run_id),
        "agent_name": event.agent_name.value if hasattr(event.agent_name, "value") else str(event.agent_name),
        "event_type": db_event_type,
        "details": event.details,
        "created_at": event.created_at.isoformat(),
    }
    key = config.supabase_secret_key or config.supabase_validator_key
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    url = f"{config.supabase_url}/rest/v1/guardrail_events"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code not in (200, 201):
                logger.warning(
                    "guardrail_events insert returned HTTP %d: %s",
                    resp.status_code,
                    resp.text[:200],
                )
    except Exception as e:
        logger.warning("Failed to log guardrail event to Supabase (non-fatal): %s", e)


def record_guardrail_decision(
    agent_name: AgentName,
    event_type: GuardrailEventType,
    decision: str,  # "PASS" or "BLOCK"
    details: dict[str, Any],
    run_id: UUID | None = None,
) -> GuardrailEvent:
    """
    Synchronously records a guardrail decision into the audit log.
    Called on every decision, PASS included.
    """
    from uuid import uuid4
    d = dict(details)
    d["decision"] = decision
    event = GuardrailEvent(
        id=uuid4(),
        run_id=run_id or uuid4(),
        agent_name=agent_name,
        event_type=event_type,
        details=d,
    )
    _EVENT_LOG.append(event)
    logger.info(
        "Guardrail decision recorded [%s]: agent=%s type=%s run_id=%s",
        decision,
        event.agent_name,
        event.event_type,
        event.run_id,
    )

    # Real-time event dispatch to live run subscribers
    try:
        from api.state import run_manager
        run_record = run_manager.get_run(event.run_id)
        if run_record:
            run_record.emit_event(
                "guardrail_event",
                {
                    "id": str(event.id),
                    "agent_name": str(event.agent_name),
                    "event_type": str(event.event_type),
                    "decision": decision,
                    "details": d,
                    "created_at": event.created_at.isoformat(),
                },
            )
    except Exception:
        pass

    return event


def get_guardrail_events(run_id: UUID | str | None = None) -> list[GuardrailEvent]:
    """Retrieve recorded guardrail events, optionally filtered by run_id."""
    if run_id is None:
        return list(_EVENT_LOG)
    target = str(run_id)
    return [e for e in _EVENT_LOG if str(e.run_id) == target]


def clear_guardrail_events() -> None:
    """Clears the in-memory audit log (useful in unit testing)."""
    _EVENT_LOG.clear()


__all__ = [
    "log_guardrail_event",
    "record_guardrail_decision",
    "get_guardrail_events",
    "clear_guardrail_events",
]
