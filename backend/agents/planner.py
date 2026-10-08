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


class LLMPlanner:
    """LLM client for Planner reasoning with retry and strict schema validation."""

    def __init__(
        self,
        config: AppConfig,
        retry_attempts: int = 3,
        retry_wait: Any = None,
    ):
        self.config = config
        self.retry_attempts = retry_attempts
        self.retry_wait = (
            retry_wait
            if retry_wait is not None
            else wait_exponential(multiplier=1, min=1, max=10)
        )
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> LLMPlanner:
        # Use OpenRouter or Anthropic depending on available key; default to openrouter
        if self.config.anthropic_api_key and not self.config.openrouter_api_key:
            self._client = httpx.AsyncClient(
                base_url="https://api.anthropic.com/v1",
                headers={
                    "x-api-key": self.config.anthropic_api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                timeout=httpx.Timeout(60.0),
            )
            self._is_anthropic = True
        else:
            self._client = httpx.AsyncClient(
                base_url=self.config.openrouter_base_url,
                headers={
                    "Authorization": f"Bearer {self.config.openrouter_api_key}",
                    "Content-Type": "application/json",
                },
                timeout=httpx.Timeout(60.0),
            )
            self._is_anthropic = False
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._client:
            await self._client.aclose()

    async def plan(
        self,
        input_data: PlannerInput,
    ) -> tuple[PlannerOutput, ToolCall]:
        """
        Calls LLM to generate plan.
        Retries once if response fails schema/constraint validation, then raises.
        """
        start = time.perf_counter()
        user_prompt = PLANNER_USER_TEMPLATE.format(
            goal=input_data.goal,
            max_subtasks=input_data.max_subtasks,
            max_domains_per_subtask=input_data.max_domains_per_subtask,
        )

        last_error: Exception | None = None
        raw_json_str = ""

        # Retry once on schema / constraint failure (up to 2 attempts total)
        for attempt_idx in range(2):
            try:
                raw_json_str = await self._call_llm(user_prompt)
                parsed = json.loads(raw_json_str)

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

            except (json.JSONDecodeError, ValidationError, ValueError) as err:
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
            output={"raw": raw_json_str[:500]} if raw_json_str else None,
            error=str(last_error),
            duration_ms=duration,
        )
        raise ValueError(f"Planner output validation failed after retry: {last_error}") from last_error

    async def _call_llm(self, user_prompt: str) -> str:
        """Execute external call with retry."""
        payload = {
            "model": self.config.claude_model or self.config.nemotron_model,
            "messages": [
                {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        }

        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(self.retry_attempts),
            wait=self.retry_wait,
            retry=retry_if_exception_type((httpx.TimeoutException, httpx.ConnectError, RuntimeError)),
            reraise=True,
        ):
            with attempt:
                try:
                    resp = await self._client.post("/chat/completions", json=payload)
                    if resp.status_code != 200:
                        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:500]}")
                    data = resp.json()
                    return data["choices"][0]["message"]["content"]
                except (httpx.TimeoutException, httpx.ConnectError, RuntimeError) as exc:
                    logger.warning(
                        "Planner LLM attempt %d failed: %s",
                        attempt.retry_state.attempt_number,
                        exc,
                    )
                    raise


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
