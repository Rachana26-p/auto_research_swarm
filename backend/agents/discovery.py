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
import re
import time
from typing import Any
from urllib.parse import urlparse
from uuid import UUID
import xml.etree.ElementTree as ET

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


DISALLOWED_PATH_PATTERNS = re.compile(
    r"^/(?:about|about-us|company|team|careers|jobs|contact|contact-us|privacy|terms|terms-of-service|legal|pricing|press|login|signup|cookies?|support)(?:/|$)",
    re.IGNORECASE,
)

ACADEMIC_DOMAIN_PATTERNS = [
    "arxiv.org",
    "openreview.net",
    "semanticscholar.org",
    "paperswithcode.com",
    "neurips.cc",
    "iclr.cc",
    "icml.cc",
    "aclweb.org",
    "proceedings.mlr.press",
    "huggingface.co",
    "nature.com",
    "acm.org",
    "ieee.org",
    "sciencedirect.com",
    "springer.com",
]

ACADEMIC_PATH_PATTERNS = re.compile(
    r"/(?:abs|pdf|html|paper|papers|article|articles|publication|publications|preprints?|proceedings)/",
    re.IGNORECASE,
)


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


def normalize_doi(doi: str | None) -> str | None:
    """Normalizes a DOI string to lowercase 10.xxxx/... format."""
    if not doi or not isinstance(doi, str):
        return None
    cleaned = doi.strip().lower()
    cleaned = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:)", "", cleaned).strip("/")
    return cleaned if "10." in cleaned else None


def extract_arxiv_id(raw: str | None) -> str | None:
    """Extracts clean canonical arXiv ID from an ID string or URL."""
    if not raw or not isinstance(raw, str):
        return None
    m = re.search(r"(?:arxiv\.org/(?:abs|pdf|html)/)?([a-z\-]+/\d+|\d{4}\.\d{4,5}(?:v\d+)?)", raw, re.IGNORECASE)
    if m:
        base_id = re.sub(r"v\d+$", "", m.group(1).lower())
        return base_id
    return None


def deduplicate_and_rank_candidates(
    candidates: list[RankedUrl],
    candidate_domains: list[str] | None = None,
    max_urls: int = 10,
) -> list[RankedUrl]:
    """
    Deduplicates candidates across multi-source discovery (arXiv, OpenAlex, Crossref, Tavily):
    1. DOI deduplication (primary)
    2. arXiv ID deduplication (secondary)
    3. Normalized URL deduplication (tertiary)
    
    Ranks authoritative academic sources and candidate domain matches highest.
    """
    clean_candidates = [
        d.strip().lower().split(":")[0] for d in (candidate_domains or []) if d and d.strip()
    ]
    seen_dois: set[str] = set()
    seen_arxiv_ids: set[str] = set()
    seen_urls: set[str] = set()

    ranked_items: list[tuple[tuple[int, float], RankedUrl]] = []

    for item in candidates:
        is_valid, domain = validate_and_filter_url(item.url)
        if not is_valid:
            continue

        normalized_url = item.url.strip().rstrip("/")
        # Filter obvious corporate marketing/navigational pages
        try:
            path = urlparse(normalized_url).path
            if path and DISALLOWED_PATH_PATTERNS.match(path):
                continue
        except Exception:
            pass

        # 1. DOI check
        norm_doi = normalize_doi(item.doi)
        if norm_doi:
            if norm_doi in seen_dois:
                continue
            seen_dois.add(norm_doi)

        # 2. arXiv ID check
        norm_arxiv = extract_arxiv_id(item.arxiv_id or item.url)
        if norm_arxiv:
            if norm_arxiv in seen_arxiv_ids:
                continue
            seen_arxiv_ids.add(norm_arxiv)

        # 3. Normalized URL check
        if normalized_url in seen_urls:
            continue
        seen_urls.add(normalized_url)

        score = float(item.relevance_score)
        score = max(0.0, min(1.0, score))

        # Check candidate domain match
        if clean_candidates:
            is_match = any(domain == cd or domain.endswith("." + cd) for cd in clean_candidates)
            if not is_match and item.source_type not in ("arxiv", "openalex", "crossref"):
                score = round(score * 0.7, 4)
                item = item.model_copy(update={"relevance_score": score})

        # Prioritize peer-reviewed and academic repository papers
        is_academic = (
            item.source_type in ("arxiv", "openalex", "crossref")
            or any(ad in domain for ad in ACADEMIC_DOMAIN_PATTERNS)
            or bool(ACADEMIC_PATH_PATTERNS.search(normalized_url))
        )
        priority_flag = 1 if is_academic else 0

        ranked_items.append(
            (
                (priority_flag, score),
                item,
            )
        )

    ranked_items.sort(key=lambda x: (x[0][0], x[0][1]), reverse=True)
    return [r[1] for r in ranked_items[:max_urls]]


def rank_search_results(
    results: list[TavilySearchResult],
    candidate_domains: list[str],
    max_urls: int,
) -> list[RankedUrl]:
    """Filters, deduplicates, and ranks URLs from Tavily search results."""
    candidates = []
    for item in results:
        is_valid, domain = validate_and_filter_url(item.url)
        if not is_valid:
            continue
        candidates.append(
            RankedUrl(
                url=item.url.strip(),
                relevance_score=max(0.0, min(1.0, float(item.score))),
                domain=domain,
                source_type="tavily",
                title=item.title,
                abstract=item.content,
            )
        )
    return deduplicate_and_rank_candidates(candidates, candidate_domains, max_urls)


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


class ArxivClient:
    """Client for querying export.arxiv.org Atom API."""

    def __init__(self, timeout: float = 12.0):
        self.timeout = timeout
        self.base_url = "http://export.arxiv.org/api/query"

    async def search(self, query: str, max_results: int = 10) -> tuple[list[RankedUrl], ToolCall]:
        start = time.perf_counter()
        params = {
            "search_query": f"all:{query}",
            "start": 0,
            "max_results": max_results,
            "sortBy": "relevance",
            "sortOrder": "descending",
        }
        candidates: list[RankedUrl] = []
        error: str | None = None
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(self.base_url, params=params)
                if resp.status_code == 200:
                    root = ET.fromstring(resp.text)
                    ns = {
                        "atom": "http://www.w3.org/2005/Atom",
                        "arxiv": "http://arxiv.org/schemas/atom",
                    }
                    for entry in root.findall("atom:entry", ns):
                        id_el = entry.find("atom:id", ns)
                        raw_id = id_el.text.strip() if id_el is not None and id_el.text else ""
                        arxiv_id = extract_arxiv_id(raw_id)
                        title_el = entry.find("atom:title", ns)
                        title = re.sub(r"\s+", " ", title_el.text.strip()) if title_el is not None and title_el.text else "Untitled Preprint"
                        summary_el = entry.find("atom:summary", ns)
                        abstract = re.sub(r"\s+", " ", summary_el.text.strip()) if summary_el is not None and summary_el.text else ""
                        published_el = entry.find("atom:published", ns)
                        year = None
                        if published_el is not None and published_el.text:
                            try:
                                year = int(published_el.text[:4])
                            except Exception:
                                pass
                        authors = []
                        for author_el in entry.findall("atom:author", ns):
                            name_el = author_el.find("atom:name", ns)
                            if name_el is not None and name_el.text:
                                authors.append(name_el.text.strip())
                        doi_el = entry.find("arxiv:doi", ns)
                        doi = doi_el.text.strip() if doi_el is not None and doi_el.text else None

                        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf" if arxiv_id else (raw_id or "https://arxiv.org")
                        candidates.append(
                            RankedUrl(
                                url=pdf_url,
                                relevance_score=0.95,
                                domain="arxiv.org",
                                source_type="arxiv",
                                doi=doi,
                                arxiv_id=arxiv_id,
                                title=title,
                                authors=authors,
                                year=year,
                                venue="arXiv",
                                abstract=abstract,
                            )
                        )
                else:
                    error = f"HTTP {resp.status_code}"
        except Exception as exc:
            error = str(exc)
            logger.warning("arXiv search failed: %s", exc)

        duration = int((time.perf_counter() - start) * 1000)
        tool_call = ToolCall(
            tool_name="arxiv_search",
            input_args={"query": query, "max_results": max_results},
            output={"count": len(candidates)},
            error=error,
            duration_ms=duration,
        )
        return candidates, tool_call


class OpenAlexClient:
    """Client for querying api.openalex.org works endpoint with polite pool headers."""

    def __init__(self, timeout: float = 12.0, email: str = "researcher@example.com"):
        self.timeout = timeout
        self.email = email
        self.base_url = "https://api.openalex.org/works"

    async def search(self, query: str, max_results: int = 10) -> tuple[list[RankedUrl], ToolCall]:
        start = time.perf_counter()
        params = {"search": query, "per-page": max_results}
        headers = {"User-Agent": f"AutoResearchSwarm/1.0 (mailto:{self.email})"}
        candidates: list[RankedUrl] = []
        error: str | None = None
        try:
            async with httpx.AsyncClient(timeout=self.timeout, headers=headers) as client:
                resp = await client.get(self.base_url, params=params)
                if resp.status_code == 200:
                    data = resp.json()
                    for item in data.get("results", []):
                        doi = normalize_doi(item.get("doi"))
                        title = item.get("title") or "Academic Publication"
                        year = item.get("publication_year")
                        authors = [
                            a.get("author", {}).get("display_name", "")
                            for a in item.get("authorships", [])
                            if a.get("author", {}).get("display_name")
                        ]
                        loc = item.get("primary_location") or {}
                        source_info = loc.get("source") or {}
                        venue = source_info.get("display_name") or ""
                        url = loc.get("pdf_url") or loc.get("landing_page_url") or (f"https://doi.org/{doi}" if doi else "")
                        if not url:
                            continue
                        is_valid, domain = validate_and_filter_url(url)
                        if not is_valid:
                            continue
                        candidates.append(
                            RankedUrl(
                                url=url,
                                relevance_score=0.90,
                                domain=domain,
                                source_type="openalex",
                                doi=doi,
                                title=title,
                                authors=authors,
                                year=year,
                                venue=venue,
                            )
                        )
                else:
                    error = f"HTTP {resp.status_code}"
        except Exception as exc:
            error = str(exc)
            logger.warning("OpenAlex search failed: %s", exc)

        duration = int((time.perf_counter() - start) * 1000)
        tool_call = ToolCall(
            tool_name="openalex_search",
            input_args={"query": query, "max_results": max_results},
            output={"count": len(candidates)},
            error=error,
            duration_ms=duration,
        )
        return candidates, tool_call


class CrossrefClient:
    """Client for querying api.crossref.org works endpoint with polite pool headers."""

    def __init__(self, timeout: float = 12.0, email: str = "researcher@example.com"):
        self.timeout = timeout
        self.email = email
        self.base_url = "https://api.crossref.org/works"

    async def search(self, query: str, max_results: int = 10) -> tuple[list[RankedUrl], ToolCall]:
        start = time.perf_counter()
        params = {"query": query, "rows": max_results}
        headers = {"User-Agent": f"AutoResearchSwarm/1.0 (mailto:{self.email})"}
        candidates: list[RankedUrl] = []
        error: str | None = None
        try:
            async with httpx.AsyncClient(timeout=self.timeout, headers=headers) as client:
                resp = await client.get(self.base_url, params=params)
                if resp.status_code == 200:
                    data = resp.json()
                    items = data.get("message", {}).get("items", [])
                    for item in items:
                        doi = normalize_doi(item.get("DOI"))
                        titles = item.get("title", [])
                        title = titles[0] if titles else "Crossref Publication"
                        authors = [
                            f"{a.get('given', '')} {a.get('family', '')}".strip()
                            for a in item.get("author", [])
                            if a.get("family")
                        ]
                        created_parts = item.get("created", {}).get("date-parts", [[None]])
                        year = created_parts[0][0] if created_parts and created_parts[0] else None
                        venues = item.get("container-title", [])
                        venue = venues[0] if venues else ""
                        url = item.get("URL") or (f"https://doi.org/{doi}" if doi else "")
                        if not url:
                            continue
                        is_valid, domain = validate_and_filter_url(url)
                        if not is_valid:
                            continue
                        candidates.append(
                            RankedUrl(
                                url=url,
                                relevance_score=0.88,
                                domain=domain,
                                source_type="crossref",
                                doi=doi,
                                title=title,
                                authors=authors,
                                year=year,
                                venue=venue,
                            )
                        )
                else:
                    error = f"HTTP {resp.status_code}"
        except Exception as exc:
            error = str(exc)
            logger.warning("Crossref search failed: %s", exc)

        duration = int((time.perf_counter() - start) * 1000)
        tool_call = ToolCall(
            tool_name="crossref_search",
            input_args={"query": query, "max_results": max_results},
            output={"count": len(candidates)},
            error=error,
            duration_ms=duration,
        )
        return candidates, tool_call


async def discovery_node(state: dict[str, Any]) -> dict[str, Any]:
    """
    LangGraph node for Discovery agent.
    Reads: subtask state (DiscoveryInput).
    Writes: state.discovered_urls[subtask_id] (DiscoveryOutput).

    Queries multi-source academic repository network:
    - arXiv API (preprints)
    - OpenAlex API (works, polite pool)
    - Crossref API (publications, polite pool)
    - Tavily Search (web search)

    Performs 3-stage deduplication (DOI -> arXiv ID -> Normalized URL).
    """
    start_time = time.perf_counter()

    # Validate input against DiscoveryInput schema
    _discovery_fields = {
        "run_id", "subtask_id", "description", "candidate_domains", "max_urls",
        "enable_academic", "provider", "model",
    }
    discovery_state = {k: v for k, v in state.items() if k in _discovery_fields} if isinstance(state, dict) else state
    try:
        input_data = DiscoveryInput.model_validate(discovery_state)
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
    all_candidates: list[RankedUrl] = []

    # Build targeted academic search query from subtask description
    raw_query = input_data.description.strip()
    query_lower = raw_query.lower()
    if not any(k in query_lower for k in ("paper", "arxiv", "survey", "benchmark", "proceedings", "conference")):
        search_query = f"{raw_query} research paper"
    else:
        search_query = raw_query

    # 1. Tavily Search (Primary web search)
    candidate_academic = [
        d for d in (input_data.candidate_domains or [])
        if any(ad in d.lower() for ad in ACADEMIC_DOMAIN_PATTERNS)
    ]
    include_domains = candidate_academic if candidate_academic else None

    search_input = TavilySearchInput(
        query=search_query,
        max_results=min(20, max(input_data.max_urls, 5)),
        search_depth="basic",
        include_domains=include_domains,
    )

    tavily_candidates: list[RankedUrl] = []
    async with TavilyClient(config) as client:
        try:
            search_output, tool_call = await client.search(search_input)
            all_tool_calls.append(tool_call)
            for r in search_output.results:
                is_valid, domain = validate_and_filter_url(r.url)
                if is_valid:
                    tavily_candidates.append(
                        RankedUrl(
                            url=r.url.strip(),
                            relevance_score=max(0.0, min(1.0, float(r.score))),
                            domain=domain,
                            source_type="tavily",
                            title=r.title,
                            abstract=r.content,
                        )
                    )
        except Exception as e:
            if input_data.candidate_domains:
                try:
                    fallback_input = TavilySearchInput(
                        query=search_query,
                        max_results=min(20, max(input_data.max_urls, 5)),
                        search_depth="basic",
                        include_domains=None,
                    )
                    search_output, fallback_call = await client.search(fallback_input)
                    all_tool_calls.append(fallback_call)
                    for r in search_output.results:
                        is_valid, domain = validate_and_filter_url(r.url)
                        if is_valid:
                            tavily_candidates.append(
                                RankedUrl(
                                    url=r.url.strip(),
                                    relevance_score=max(0.0, min(1.0, float(r.score))),
                                    domain=domain,
                                    source_type="tavily",
                                    title=r.title,
                                    abstract=r.content,
                                )
                            )
                except Exception:
                    pass
            else:
                logger.warning("Tavily search exception in discovery_node: %s", e)

    all_candidates.extend(tavily_candidates)

    # Academic Search Network (arXiv, OpenAlex, Crossref)
    if input_data.enable_academic:
        # 2. arXiv Academic Preprints Search
        try:
            arxiv_client = ArxivClient(timeout=8.0)
            arxiv_items, arxiv_call = await arxiv_client.search(
                query=raw_query,
                max_results=min(10, max(input_data.max_urls, 3)),
            )
            all_tool_calls.append(arxiv_call)
            all_candidates.extend(arxiv_items)
        except Exception as exc:
            logger.debug("arXiv search in discovery_node skipped/failed: %s", exc)

        # 3. OpenAlex Search (Polite pool)
        try:
            openalex_client = OpenAlexClient(timeout=8.0)
            openalex_items, openalex_call = await openalex_client.search(
                query=raw_query,
                max_results=min(10, max(input_data.max_urls, 3)),
            )
            all_tool_calls.append(openalex_call)
            all_candidates.extend(openalex_items)
        except Exception as exc:
            logger.debug("OpenAlex search in discovery_node skipped/failed: %s", exc)

        # 4. Crossref Search (Polite pool)
        try:
            crossref_client = CrossrefClient(timeout=8.0)
            crossref_items, crossref_call = await crossref_client.search(
                query=raw_query,
                max_results=min(10, max(input_data.max_urls, 3)),
            )
            all_tool_calls.append(crossref_call)
            all_candidates.extend(crossref_items)
        except Exception as exc:
            logger.debug("Crossref search in discovery_node skipped/failed: %s", exc)

    # Run multi-source deduplication & ranking
    ranked_urls = deduplicate_and_rank_candidates(
        candidates=all_candidates,
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
        "Discovery completed in %dms for subtask %s: found %d URLs across %d sources",
        duration,
        input_data.subtask_id,
        len(output.urls),
        len(all_candidates),
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
    "ArxivClient",
    "OpenAlexClient",
    "CrossrefClient",
    "validate_and_filter_url",
    "rank_search_results",
    "deduplicate_and_rank_candidates",
    "normalize_doi",
    "extract_arxiv_id",
]

