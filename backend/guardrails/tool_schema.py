"""
Tool schema validation guardrail.

Ensures every tool call input and output is validated against its strict
Pydantic schema before and after execution. Logs schema violations to
guardrail_events.
"""

from __future__ import annotations

import logging
from typing import Any, Type, TypeVar
from uuid import UUID, uuid4

from pydantic import BaseModel, ValidationError

from guardrails.event_logger import log_guardrail_event
from shared.models import AgentName, GuardrailEvent, GuardrailEventType

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


def validate_tool_schema(
    schema_cls: Type[T],
    data: Any,
    tool_name: str = "tool",
    direction: str = "input",
    agent_name: AgentName = AgentName.EXTRACTOR,
    run_id: UUID | None = None,
) -> T:
    """
    Validates data against a Pydantic tool schema.
    If validation fails, logs a TOOL_SCHEMA_VIOLATION guardrail event and raises ValueError.
    If validation passes, logs a TOOL_SCHEMA_PASS guardrail event.
    """
    from guardrails.event_logger import record_guardrail_decision

    try:
        if isinstance(data, schema_cls):
            res = data
        elif hasattr(data, "model_dump"):
            res = schema_cls.model_validate(data.model_dump())
        elif isinstance(data, dict):
            res = schema_cls.model_validate(data)
        else:
            res = schema_cls.model_validate(data)

        # PASS decision
        record_guardrail_decision(
            agent_name=agent_name,
            event_type=GuardrailEventType.TOOL_SCHEMA_PASS,
            decision="PASS",
            details={
                "tool_name": tool_name,
                "direction": direction,
                "schema": schema_cls.__name__,
            },
            run_id=run_id,
        )
        return res
    except ValidationError as e:
        logger.error("%s %s schema validation failed for %s: %s", tool_name, direction, schema_cls.__name__, e)
        record_guardrail_decision(
            agent_name=agent_name,
            event_type=GuardrailEventType.TOOL_SCHEMA_VIOLATION,
            decision="BLOCK",
            details={
                "tool_name": tool_name,
                "direction": direction,
                "schema": schema_cls.__name__,
                "error": str(e),
                "data_type": type(data).__name__,
            },
            run_id=run_id,
        )
        raise ValueError(f"Invalid tool {direction}: {e}") from e


__all__ = [
    "validate_tool_schema",
]
