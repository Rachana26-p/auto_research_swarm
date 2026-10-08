"""
Planner Agent — Phase 2

LangGraph node that:
1. Receives a research goal and constraints (PlannerInput).
2. Deconstructs the goal into a bounded list of subtasks and candidate target domains.
3. Reasoning-only execution (Claude or Gemini Pro tier via API) — no tool calls, no web requests.
4. Validates output strictly against PlannerOutput (retries once on schema failure, then raises).
5. Enforces hard constraints:
   - subtasks length <= max_subtasks
   - subtask descriptions must NOT contain URLs (hostnames/domains only)
   - domain validation (no invalid URI schemas or made up paths in candidate_domains)
   - does not fabricate domains without basis
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

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
    AppConfig,
    PlannerInput,
    PlannerOutput,
    Subtask,
    ToolCall,
)

logger = logging.getLogger(__name__)

# System prompt for planning reasoning
PLANNER_SYSTEM_PROMPT = """You are an expert research planner.
Your job is to break down a high-level research goal into a bounded, prioritized list of concrete subtasks and candidate target domains.

CRITICAL CONSTRAINTS:
1. Output MUST strictly match the following JSON schema:
{
  "subtasks": [
    {
      "subtask_id": "string (e.g. subtask_1)",
      "description": "string (clear subtask explanation, NO URLs allowed)",
      "candidate_domains": ["string (domain hostnames only, e.g. 'wikipedia.org', NOT full URLs)"]
    }
  ],
  "reasoning": "string (short justification for the subtask decomposition)"
}

2. Do NOT include full URLs in subtask descriptions or in candidate_domains.
   - Example valid domain: "arxiv.org", "nature.com", "github.com"
   - Invalid: "https://arxiv.org/abs/1234", "http://domain.com/path"
3. Do not invent obscure or fabricated domain names. If uncertain, provide fewer, reputable domains or general domains.
4. Output ONLY the JSON object, nothing else.
"""

PLANNER_USER_TEMPLATE = """Research Goal: {goal}
Maximum subtasks allowed: {max_subtasks}
Maximum domains per subtask: {max_domains_per_subtask}

Decompose this goal into at most {max_subtasks} subtasks with up to {max_domains_per_subtask} candidate domains each.
Output valid JSON only."""

URL_PATTERN = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)


def validate_subtask_constraints(
    subtasks: list[Subtask],
    max_subtasks: int,
    max_domains_per_subtask: int,
) -> list[Subtask]:
    """
    Validates domain-only and no-URL constraints on subtasks.
    Raises ValueError on violation.
    """
    if len(subtasks) > max_subtasks:
        raise ValueError(f"Exceeded max_subtasks ({len(subtasks)} > {max_subtasks})")

    cleaned_subtasks: list[Subtask] = []
    for s in subtasks:
        # Check description for URLs
        if URL_PATTERN.search(s.description):
            raise ValueError(
                f"Subtask '{s.subtask_id}' description contains a URL: {s.description}"
            )

        # Check candidate domains are hostnames only
        cleaned_domains: list[str] = []
        for d in s.candidate_domains:
            domain_str = d.strip().lower()
            if not domain_str:
                continue
            if "://" in domain_str or "/" in domain_str:
                raise ValueError(
                    f"Candidate domain '{d}' is not a valid hostname (contains scheme or path)"
                )
            # Basic hostname check
            if not re.match(r"^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", domain_str):
                raise ValueError(f"Candidate domain '{d}' is not a valid hostname")
            cleaned_domains.append(domain_str)

        if len(cleaned_domains) > max_domains_per_subtask:
            cleaned_domains = cleaned_domains[:max_domains_per_subtask]

        cleaned_subtasks.append(
            Subtask(
                subtask_id=s.subtask_id,
                description=s.description,
                candidate_domains=cleaned_domains,
            )
        )

    return cleaned_subtasks


from shared.providers import get_llm_provider

# ============================================================
# LLM PLANNER CLIENT
# ============================================================

class LLMPlanner:
    """Client for calling reasoning model via unified provider abstraction (Groq / Gemini)."""

    def __init__(
        self,
        config: AppConfig,
        retry_attempts: int = 2,
        retry_wait: Any = None,
    ):
        self.config = config
        self.retry_attempts = retry_attempts
        self.retry_wait = retry_wait
        self._provider = get_llm_provider(role="reasoning", config=config)

    async def __aenter__(self) -> LLMPlanner:
        return self

    async def __aexit__(self, *args: Any) -> None:
        pass

    async def plan(
        self,
        input_data: PlannerInput,
    ) -> tuple[PlannerOutput, ToolCall]:
        """
        Calls reasoning LLM via provider to generate plan.
        Retries once if response fails schema/constraint validation, then raises.
        """
        start = time.perf_counter()
        user_prompt = PLANNER_USER_TEMPLATE.format(
            goal=input_data.goal,
            max_subtasks=input_data.max_subtasks,
            max_domains_per_subtask=input_data.max_domains_per_subtask,
        )

        last_error: Exception | None = None
        parsed: dict[str, Any] | None = None

        # Retry once on schema / constraint failure (up to 2 attempts total)
        for attempt_idx in range(2):
            try:
                parsed = await self._call_llm(user_prompt)

                if not isinstance(parsed, dict):
                    raise ValueError(f"LLM output must be a JSON object, got {type(parsed).__name__}")

                # Build candidate output dict
                parsed_with_run = {
                    "run_id": input_data.run_id,
                    "subtasks": parsed.get("subtasks", []),
                    "reasoning": parsed.get("reasoning", ""),
                }

                # Validate against PlannerOutput strictly
                output_model = PlannerOutput.model_validate(parsed_with_run, strict=True)

                # Validate domain & URL hard constraints
                validated_subtasks = validate_subtask_constraints(
                    subtasks=output_model.subtasks,
                    max_subtasks=input_data.max_subtasks,
                    max_domains_per_subtask=input_data.max_domains_per_subtask,
                )

                final_output = PlannerOutput(
                    run_id=input_data.run_id,
                    subtasks=validated_subtasks,
                    reasoning=output_model.reasoning,
                )

                duration = int((time.perf_counter() - start) * 1000)
                tool_call = ToolCall(
                    tool_name="planner_reasoning",
                    input_args={"goal": input_data.goal, "run_id": str(input_data.run_id)},
                    output=final_output.model_dump(),
                    error=None,
                    duration_ms=duration,
                )
                return final_output, tool_call

            except (ValidationError, ValueError) as err:
                last_error = err
                logger.warning(
                    "Planner validation attempt %d failed: %s. Retrying once if attempt < 2.",
                    attempt_idx + 1,
                    err,
                )
                # Augment prompt with error feedback for the second attempt
                user_prompt += (
                    f"\n\nPREVIOUS OUTPUT FAILED VALIDATION: {err}. "
                    "Ensure valid JSON matching the schema with hostnames only and no URLs in descriptions."
                )

        duration = int((time.perf_counter() - start) * 1000)
        tool_call = ToolCall(
            tool_name="planner_reasoning",
            input_args={"goal": input_data.goal, "run_id": str(input_data.run_id)},
            output=parsed,
            error=str(last_error),
            duration_ms=duration,
        )
        raise ValueError(f"Planner output validation failed after retry: {last_error}") from last_error

    async def _call_llm(self, user_prompt: str) -> dict[str, Any]:
        """Execute reasoning call via unified LLMProvider."""
        data, _ = await self._provider.complete_json(
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=PLANNER_SYSTEM_PROMPT,
            temperature=0.2,
        )
        return data


async def planner_node(state: dict[str, Any]) -> dict[str, Any]:
    """
    LangGraph node for Planner Agent.
    Pure function: reads state.goal (and run_id), writes state.subtasks.

    Input state keys:
    - run_id: UUID | str
    - goal: str
    - max_subtasks: int (optional, default 5)
    - max_domains_per_subtask: int (optional, default 3)

    Output state keys:
    - subtasks: list[dict]
    - reasoning: str
    - tool_calls: list[dict]
    """
    start_time = time.perf_counter()

    # Validate input against schema
    try:
        input_data = PlannerInput.model_validate(state)
    except ValidationError as e:
        logger.error("Planner input validation failed: %s", e)
        raise ValueError(f"Invalid planner input: {e}") from e

    config = get_config()
    logger.info("Planner starting for run %s: '%s'", input_data.run_id, input_data.goal[:80])

    async with LLMPlanner(config) as planner:
        output, tool_call = await planner.plan(input_data)

    duration = int((time.perf_counter() - start_time) * 1000)
    logger.info(
        "Planner completed for run %s in %dms with %d subtasks",
        input_data.run_id,
        duration,
        len(output.subtasks),
    )

    return {
        "run_id": output.run_id,
        "subtasks": [s.model_dump() for s in output.subtasks],
        "reasoning": output.reasoning,
        "tool_calls": [tool_call.model_dump()],
    }


def run_planner_sync(
    goal: str,
    run_id: UUID,
    max_subtasks: int = 5,
    max_domains_per_subtask: int = 3,
) -> dict[str, Any]:
    """Synchronous wrapper for testing without LangGraph."""
    import asyncio
    return asyncio.run(
        planner_node({
            "goal": goal,
            "run_id": run_id,
            "max_subtasks": max_subtasks,
            "max_domains_per_subtask": max_domains_per_subtask,
        })
    )


__all__ = [
    "planner_node",
    "run_planner_sync",
    "LLMPlanner",
    "validate_subtask_constraints",
    "PLANNER_SYSTEM_PROMPT",
    "PLANNER_USER_TEMPLATE",
]
