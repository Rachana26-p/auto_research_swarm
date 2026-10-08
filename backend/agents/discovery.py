"""
Discovery Agent — Phase 2

LangGraph node that:
1. Receives subtask and candidate domains from Planner (DiscoveryInput).
2. Executes read-only web searches using Tavily search ONLY (no Playwright, no Fetch, no filesystem).
3. Ranks candidate URLs based on search relevance and candidate domains.
4. Enforces hard constraints:
   - Tool input validates against Pydantic schema (TavilySearchInput) before execution
   - Every URL must come from actual Tavily search results — never fabricate or guess
   - Filter out malformed URLs (must start with http:// or https:// and have valid netloc)
   - Prefer results from candidate_domains (deprioritize / lower score if outside, never silently drop)
   - Bounded output: len(urls) <= max_urls
   - Empty search results produce empty list, not fabricated URLs
"""

from __future__ import annotations

import logging
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
    AgentName,
    AppConfig,
    DiscoveryInput,
    DiscoveryOutput,
    RankedUrl,
    TavilySearchInput,
    TavilySearchOutput,
    TavilySearchResult,
    ToolCall,
)
from guardrails import validate_tool_schema

logger = logging.getLogger(__name__)


def validate_and_filter_url(url: str) -> tuple[bool, str]:
    """
    Validates that a URL is a valid http:// or https:// URL with a valid hostname.
    Returns (is_valid, domain).
    """
    if not isinstance(url, str) or not url.strip():
        return False, ""

    try:
        parsed = urlparse(url.strip())
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return False, ""
        domain = parsed.netloc.lower().split(":")[0]
        if not domain or "." not in domain:
            return False, ""
        return True, domain
    except Exception:
        return False, ""


def rank_search_results(
    results: list[TavilySearchResult],
    candidate_domains: list[str],
    max_urls: int,
) -> list[RankedUrl]:
    """
    Filters, deduplicates, and ranks URLs from Tavily search results.

    Rules:
    - Filters out malformed URLs
    - Deprioritizes results outside candidate_domains (reduces relevance_score, does NOT drop)
    - Deduplicates by normalized URL
    - Bounded to max_urls
    """
    clean_candidates = [
        d.strip().lower().split(":")[0] for d in candidate_domains if d and d.strip()
    ]

    seen_urls: set[str] = set()
    ranked_candidates: list[tuple[float, RankedUrl]] = []

    for item in results:
        is_valid, domain = validate_and_filter_url(item.url)
        if not is_valid:
            logger.debug("Filtered out malformed URL from search results: %s", item.url)
            continue

        normalized_url = item.url.strip()
        if normalized_url in seen_urls:
            continue
        seen_urls.add(normalized_url)

        # Base score from Tavily result
        score = float(item.score)
        # Cap score between 0.0 and 1.0
        score = max(0.0, min(1.0, score))

        # Check candidate domain match (exact or subdomain)
        is_domain_match = False
        if clean_candidates:
            is_domain_match = any(
                domain == cd or domain.endswith("." + cd) for cd in clean_candidates
            )
            if not is_domain_match:
                # Deprioritize results outside candidate domains by multiplying by 0.7
                score = round(score * 0.7, 4)

        ranked_candidates.append(
            (
                score,
                RankedUrl(
                    url=normalized_url,
                    relevance_score=score,
                    domain=domain,
                ),
            )
        )

    # Sort descending by relevance_score
    ranked_candidates.sort(key=lambda x: x[0], reverse=True)

    final_urls = [r[1] for r in ranked_candidates[:max_urls]]
    return final_urls


class TavilyClient:
    """Client for calling Tavily Search API with schema validation, retry, and error logging."""

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

    async def __aenter__(self) -> TavilyClient:
        self._client = httpx.AsyncClient(
            base_url="https://api.tavily.com",
            timeout=httpx.Timeout(30.0),
        )
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._client:
            await self._client.aclose()

    async def search(
        self,
        search_input: TavilySearchInput,
    ) -> tuple[TavilySearchOutput, ToolCall]:
        """
        Executes Tavily search with Pydantic validation before execution, retry, and audit logging.
        """
        start = time.perf_counter()

        # Validate input against TavilySearchInput schema before execution via guardrails
        validated_input = validate_tool_schema(
            TavilySearchInput,
            search_input,
            tool_name="tavily_search",
            direction="input",
            agent_name=AgentName.DISCOVERY,
        )

        payload = {
            "api_key": self.config.tavily_api_key,
            "query": validated_input.query,
            "max_results": validated_input.max_results,
            "search_depth": validated_input.search_depth,
        }
        if validated_input.include_domains:
            payload["include_domains"] = validated_input.include_domains
        if validated_input.exclude_domains:
            payload["exclude_domains"] = validated_input.exclude_domains

        raw_output: dict[str, Any] | None = None

        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(self.retry_attempts),
                wait=self.retry_wait,
                retry=retry_if_exception_type((httpx.TimeoutException, httpx.ConnectError, RuntimeError)),
                reraise=True,
            ):
                with attempt:
                    try:
                        resp = await self._client.post("/search", json=payload)
                        if resp.status_code != 200:
                            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:500]}")
                        raw_output = resp.json()
                    except (httpx.TimeoutException, httpx.ConnectError, RuntimeError) as exc:
                        logger.warning(
                            "Tavily search attempt %d failed: %s",
                            attempt.retry_state.attempt_number,
                            exc,
                        )
                        raise
        except Exception as e:
            duration = int((time.perf_counter() - start) * 1000)
            tool_call = ToolCall(
                tool_name="tavily_search",
                input_args=validated_input.model_dump(),
                output=None,
                error=str(e),
                duration_ms=duration,
            )
            logger.error("Tavily search failed after retries: %s", e)
            raise RuntimeError(f"Tavily search failed: {e}") from e

        duration = int((time.perf_counter() - start) * 1000)

        # Parse Tavily results into TavilySearchOutput schema
        try:
            raw_results = raw_output.get("results", []) if raw_output else []
            formatted_results = []
            for r in raw_results:
                formatted_results.append(
                    TavilySearchResult(
                        url=r.get("url", ""),
                        title=r.get("title", ""),
                        content=r.get("content", ""),
                        score=float(r.get("score", 0.5)),
                        raw_content=r.get("raw_content"),
                    )
                )

            validated_output = TavilySearchOutput(
                query=validated_input.query,
                results=formatted_results,
                response_time=float(raw_output.get("response_time", duration / 1000.0)) if raw_output else 0.0,
            )
        except (ValidationError, ValueError) as e:
            tool_call = ToolCall(
                tool_name="tavily_search",
                input_args=validated_input.model_dump(),
                output=raw_output,
                error=f"Output validation failed: {e}",
                duration_ms=duration,
            )
            logger.error("Tavily output validation failed: %s", e)
            raise ValueError(f"Invalid tool output: {e}") from e

        tool_call = ToolCall(
            tool_name="tavily_search",
            input_args=validated_input.model_dump(),
            output={"result_count": len(validated_output.results)},
            error=None,
            duration_ms=duration,
        )
        logger.info("Tavily search succeeded in %dms with %d results", duration, len(validated_output.results))
        return validated_output, tool_call


async def discovery_node(state: dict[str, Any]) -> dict[str, Any]:
    """
    LangGraph node for Discovery agent.
    Reads: subtask state (DiscoveryInput).
    Writes: state.discovered_urls[subtask_id] (DiscoveryOutput).

    Input state keys:
    - run_id: UUID | str
    - subtask_id: str
    - description: str
    - candidate_domains: list[str]
    - max_urls: int (optional, default 10)

    Output state keys:
    - run_id: UUID
    - subtask_id: str
    - urls: list[dict]
    - tool_calls: list[dict]
    """
    start_time = time.perf_counter()

    # Validate input against DiscoveryInput schema
    try:
        input_data = DiscoveryInput.model_validate(state)
    except ValidationError as e:
        logger.error("Discovery input validation failed: %s", e)
        raise ValueError(f"Invalid discovery input: {e}") from e

    config = get_config()
    logger.info(
        "Discovery starting for run %s, subtask %s: '%s'",
        input_data.run_id,
        input_data.subtask_id,
        input_data.description[:80],
    )

    all_tool_calls: list[ToolCall] = []

    # Build search query from subtask description
    search_query = input_data.description.strip()

    search_input = TavilySearchInput(
        query=search_query,
        max_results=min(20, max(input_data.max_urls, 5)),
        search_depth="basic",
        include_domains=input_data.candidate_domains if input_data.candidate_domains else None,
    )

    ranked_urls: list[RankedUrl] = []

    async with TavilyClient(config) as client:
        try:
            search_output, tool_call = await client.search(search_input)
            all_tool_calls.append(tool_call)

            # Rank and filter results
            ranked_urls = rank_search_results(
                results=search_output.results,
                candidate_domains=input_data.candidate_domains,
                max_urls=input_data.max_urls,
            )

        except Exception as e:
            # If constrained search by include_domains returned 0 results or failed,
            # retry once without domain restriction if candidate_domains was specified
            if input_data.candidate_domains:
                logger.warning(
                    "Tavily search with candidate_domains failed or yielded zero, retrying open search: %s",
                    e,
                )
                fallback_input = TavilySearchInput(
                    query=search_query,
                    max_results=min(20, max(input_data.max_urls, 5)),
                    search_depth="basic",
                    include_domains=None,
                )
                search_output, fallback_call = await client.search(fallback_input)
                all_tool_calls.append(fallback_call)

                ranked_urls = rank_search_results(
                    results=search_output.results,
                    candidate_domains=input_data.candidate_domains,
                    max_urls=input_data.max_urls,
                )
            else:
                raise

    # If include_domains search returned 0 results, do open fallback search
    if not ranked_urls and input_data.candidate_domains:
        logger.info("Search with include_domains returned 0 results. Falling back to open search.")
        fallback_input = TavilySearchInput(
            query=search_query,
            max_results=min(20, max(input_data.max_urls, 5)),
            search_depth="basic",
            include_domains=None,
        )
        async with TavilyClient(config) as client:
            search_output, fallback_call = await client.search(fallback_input)
            all_tool_calls.append(fallback_call)
            ranked_urls = rank_search_results(
                results=search_output.results,
                candidate_domains=input_data.candidate_domains,
                max_urls=input_data.max_urls,
            )

    output = DiscoveryOutput(
        run_id=input_data.run_id,
        subtask_id=input_data.subtask_id,
        urls=ranked_urls,
    )

    duration = int((time.perf_counter() - start_time) * 1000)
    logger.info(
        "Discovery completed in %dms for subtask %s: found %d URLs",
        duration,
        input_data.subtask_id,
        len(output.urls),
    )

    return {
        "run_id": output.run_id,
        "subtask_id": output.subtask_id,
        "urls": [u.model_dump() for u in output.urls],
        "tool_calls": [tc.model_dump() for tc in all_tool_calls],
    }


def run_discovery_sync(
    run_id: UUID,
    subtask_id: str,
    description: str,
    candidate_domains: list[str],
    max_urls: int = 10,
) -> dict[str, Any]:
    """Synchronous wrapper for testing without LangGraph."""
    import asyncio
    return asyncio.run(
        discovery_node({
            "run_id": run_id,
            "subtask_id": subtask_id,
            "description": description,
            "candidate_domains": candidate_domains,
            "max_urls": max_urls,
        })
    )


__all__ = [
    "discovery_node",
    "run_discovery_sync",
    "TavilyClient",
    "validate_and_filter_url",
    "rank_search_results",
]
