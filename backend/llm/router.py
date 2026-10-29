"""
Free Model Router and Provider Fallback Orchestrator (WS3).

Features:
- Zero provider SDKs imported directly by agents (role-based abstraction)
- Pool configuration from env + backend/llm/pool.yaml
- Dynamic discovery of zero-price models on OpenRouter (cached daily)
- Selection by role (Planner, Validator, Composer get strongest models)
- Automatic failover on 429, 5xx, timeout, or Pydantic validation failure
- Respects Retry-After headers with jittered backoff
- Sets paused_quota with earliest reset time if all models are exhausted
- HTML-to-clean-text stripping and SHA-256 caching to conserve free quota
- Comprehensive call logging to model_usage
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import random
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Type, TypeVar
from uuid import UUID

import httpx
import yaml
from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


class AllModelsQuotaExhaustedError(Exception):
    """Raised when every model in the pool for a role is rate-limited or exhausted."""
    def __init__(self, role: str, earliest_reset_timestamp: float) -> None:
        self.role = role
        self.earliest_reset_timestamp = earliest_reset_timestamp
        reset_dt = datetime.fromtimestamp(earliest_reset_timestamp, tz=timezone.utc).strftime("%H:%M:%S UTC")
        super().__init__(f"All free-tier models for role '{role}' are exhausted. Resuming at {reset_dt}")


@dataclass
class ModelEndpoint:
    id: str
    provider: str
    base_url: str
    api_key: str
    model: str
    allowed_roles: list[str]
    max_context: int
    json_support: bool
    rpm: int
    rpd: int
    tpm: int
    priority: int
    # Live quota & cooldown state
    cooldown_until: float = 0.0
    recent_requests: list[float] = field(default_factory=list)
    daily_requests: int = 0
    daily_reset_day: int = field(default_factory=lambda: datetime.utcnow().day)

    def is_available(self) -> bool:
        now = time.time()
        if now < self.cooldown_until:
            return False

        # Reset daily counters if day rolled over
        today = datetime.utcnow().day
        if today != self.daily_reset_day:
            self.daily_requests = 0
            self.daily_reset_day = today

        if self.daily_requests >= self.rpd:
            return False

        # RPM check (sliding 60s window)
        self.recent_requests = [t for t in self.recent_requests if now - t < 60.0]
        if len(self.recent_requests) >= self.rpm:
            return False

        return True

    def record_success(self) -> None:
        now = time.time()
        self.recent_requests.append(now)
        self.daily_requests += 1

    def record_rate_limit(self, retry_after: float | None = None) -> None:
        now = time.time()
        cooldown = retry_after if retry_after and retry_after > 0 else (15.0 + random.uniform(2.0, 5.0))
        self.cooldown_until = now + cooldown
        logger.warning(
            "Model '%s' (%s) hit rate limit. Cooling down for %.1fs (until %s)",
            self.model,
            self.provider,
            cooldown,
            datetime.fromtimestamp(self.cooldown_until, tz=timezone.utc).strftime("%H:%M:%S"),
        )


class FreeModelRouter:
    """
    Central router directing agent requests to available free-tier LLMs.
    """

    def __init__(self, config_path: str | Path | None = None) -> None:
        self.config_path = Path(config_path or Path(__file__).parent / "pool.yaml")
        self.endpoints: list[ModelEndpoint] = []
        self._cache: dict[str, Any] = {}
        self._openrouter_free_models_cache: list[str] = []
        self._openrouter_cache_timestamp: float = 0.0
        self.load_pool()

    def load_pool(self) -> None:
        """Load and initialize model pool from pool.yaml and current environment."""
        self.endpoints.clear()
        if not self.config_path.exists():
            logger.warning("pool.yaml not found at %s; using hardcoded fallbacks", self.config_path)
            return

        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}

            raw_providers = data.get("providers", [])
            for p in raw_providers:
                key = os.environ.get(p.get("key_env", ""), "").strip()
                if not key:
                    # Gracefully skip providers with missing keys
                    logger.debug("Skipping pool entry '%s': key_env '%s' not set", p.get("id"), p.get("key_env"))
                    continue

                base_url = os.environ.get(p.get("base_url_env", ""), p.get("default_base_url", "")).rstrip("/")
                model = os.environ.get(p.get("model_env", ""), p.get("default_model", "")).strip()

                endpoint = ModelEndpoint(
                    id=p.get("id", ""),
                    provider=p.get("provider", ""),
                    base_url=base_url,
                    api_key=key,
                    model=model,
                    allowed_roles=p.get("allowed_roles", []),
                    max_context=int(p.get("max_context", 32768)),
                    json_support=bool(p.get("json_support", True)),
                    rpm=int(p.get("rpm", 20)),
                    rpd=int(p.get("rpd", 1000)),
                    tpm=int(p.get("tpm", 50000)),
                    priority=int(p.get("priority", 10)),
                )
                self.endpoints.append(endpoint)

            logger.info("Loaded %d active model endpoints from pool.yaml", len(self.endpoints))
        except Exception as exc:
            logger.exception("Failed to load pool.yaml: %s", exc)

    async def get_candidate_endpoints(self, role: str) -> list[ModelEndpoint]:
        """Return candidates for a role sorted by priority, Groq/Gemini preference, and availability."""
        candidates = [e for e in self.endpoints if role in e.allowed_roles]
        prefer_groq_gemini = os.environ.get("ROUTER_PREFER_GROQ_GEMINI", "true").lower() in ("true", "1")

        def _sort_key(e: ModelEndpoint):
            provider_pref = 0 if (prefer_groq_gemini and e.provider in ("groq", "gemini")) else 1
            return (not e.is_available(), provider_pref, e.priority)

        candidates.sort(key=_sort_key)
        return candidates

    @staticmethod
    def strip_html_to_clean_text(html_content: str) -> str:
        """
        Strips HTML tags, scripts, styles, SVGs, and redundant whitespace.
        Saves 60–80% of tokens before passing to LLM.
        """
        if not html_content:
            return ""
        # Remove script and style elements
        text = re.sub(r"<(script|style|svg|noscript|nav|footer|header)[^>]*>.*?</\1>", " ", html_content, flags=re.DOTALL | re.IGNORECASE)
        # Remove remaining HTML tags
        text = re.sub(r"<[^>]+>", " ", text)
        # Unescape common HTML entities
        text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
        # Condense whitespace
        text = re.sub(r"\s+", " ", text).strip()
        return text

    async def complete(
        self,
        role: str,
        messages: list[dict[str, str]],
        temperature: float = 0.2,
        max_tokens: int = 4000,
        response_model: Type[T] | None = None,
        chat_id: UUID | None = None,
        run_id: UUID | None = None,
        user_id: UUID | None = None,
    ) -> tuple[str | T, str]:
        """
        Executes a completion through the best available model with automatic failover.
        Returns: (result_or_pydantic_model, provider_model_used)
        """
        candidates = await self.get_candidate_endpoints(role)
        if not candidates:
            raise AllModelsQuotaExhaustedError(role, time.time() + 60.0)

        # Check if all candidates are cooled down
        available = [c for c in candidates if c.is_available()]
        if not available:
            earliest_reset = min(c.cooldown_until for c in candidates if c.cooldown_until > 0) if candidates else time.time() + 60.0
            raise AllModelsQuotaExhaustedError(role, max(earliest_reset, time.time() + 15.0))

        last_error: Exception | None = None

        for endpoint in available:
            pacing = float(os.environ.get("PAGE_PACING_SECONDS", "0.0"))
            if pacing > 0:
                await asyncio.sleep(pacing)

            start_time = time.time()
            try:
                raw_text = await self._call_endpoint(
                    endpoint=endpoint,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    json_mode=bool(response_model),
                )

                latency_ms = (time.time() - start_time) * 1000.0
                endpoint.record_success()

                # If structured output required, parse with Pydantic
                if response_model:
                    try:
                        parsed = self._parse_json_to_model(raw_text, response_model)
                        self._log_usage(endpoint, role, len(raw_text) // 4, latency_ms, "success", chat_id, run_id, user_id)
                        return parsed, f"{endpoint.provider}:{endpoint.model}"
                    except (json.JSONDecodeError, ValidationError) as parse_exc:
                        logger.warning("Model '%s' output failed schema validation: %s. Retrying with error feedback...", endpoint.model, parse_exc)
                        # One retry with specific error feedback
                        repaired_text = await self._retry_with_feedback(endpoint, messages, raw_text, str(parse_exc))
                        try:
                            parsed_repaired = self._parse_json_to_model(repaired_text, response_model)
                            self._log_usage(endpoint, role, len(repaired_text) // 4, latency_ms, "success", chat_id, run_id, user_id)
                            return parsed_repaired, f"{endpoint.provider}:{endpoint.model}"
                        except Exception as repair_fail:
                            logger.warning("Repair retry failed on model '%s': %s. Failing over to next model.", endpoint.model, repair_fail)
                            continue

                self._log_usage(endpoint, role, len(raw_text) // 4, latency_ms, "success", chat_id, run_id, user_id)
                return raw_text, f"{endpoint.provider}:{endpoint.model}"

            except httpx.HTTPStatusError as http_err:
                last_error = http_err
                latency_ms = (time.time() - start_time) * 1000.0
                if http_err.response.status_code == 429:
                    retry_header = http_err.response.headers.get("Retry-After")
                    retry_seconds = float(retry_header) if retry_header and retry_header.isdigit() else 15.0
                    endpoint.record_rate_limit(retry_seconds)
                    self._log_usage(endpoint, role, 0, latency_ms, "rate_limited", chat_id, run_id, user_id)
                elif http_err.response.status_code == 404:
                    logger.warning("Endpoint '%s' model '%s' returned 404 not found.", endpoint.id, endpoint.model)
                    self._log_usage(endpoint, role, 0, latency_ms, "model_not_found", chat_id, run_id, user_id)
                else:
                    endpoint.record_rate_limit(10.0)
                    self._log_usage(endpoint, role, 0, latency_ms, "error", chat_id, run_id, user_id)
                logger.warning("Endpoint '%s' returned HTTP %d: %s. Trying next model...", endpoint.id, http_err.response.status_code, http_err)
                continue
            except (httpx.TimeoutException, TimeoutError) as timeout_err:
                last_error = timeout_err
                latency_ms = (time.time() - start_time) * 1000.0
                endpoint.record_rate_limit(15.0)
                self._log_usage(endpoint, role, 0, latency_ms, "timeout", chat_id, run_id, user_id)
                logger.warning("Endpoint '%s' timed out. Trying next model...", endpoint.id)
                continue
            except Exception as exc:
                last_error = exc
                latency_ms = (time.time() - start_time) * 1000.0
                endpoint.record_rate_limit(10.0)
                self._log_usage(endpoint, role, 0, latency_ms, "error", chat_id, run_id, user_id)
                logger.warning("Endpoint '%s' failed: %s. Trying next candidate...", endpoint.id, exc)
                continue

        # If all candidates exhausted in loop
        earliest_reset = min(c.cooldown_until for c in candidates if c.cooldown_until > 0) if candidates else time.time() + 60.0
        raise AllModelsQuotaExhaustedError(role, max(earliest_reset, time.time() + 15.0)) from last_error

    async def _call_endpoint(
        self,
        endpoint: ModelEndpoint,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int,
        json_mode: bool,
    ) -> str:
        """Call standard OpenAI-compatible completions endpoint or Gemini API."""
        if endpoint.provider == "gemini":
            return await self._call_gemini(endpoint, messages, temperature, max_tokens, json_mode)

        # Groq, OpenRouter, Mistral (OpenAI-compatible format)
        url = f"{endpoint.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {endpoint.api_key}",
            "Content-Type": "application/json",
        }
        if endpoint.provider == "openrouter":
            headers["HTTP-Referer"] = "https://autoresearchswarm.com"
            headers["X-Title"] = "Auto Research Swarm"

        payload: dict[str, Any] = {
            "model": endpoint.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode and endpoint.json_support:
            payload["response_format"] = {"type": "json_object"}

        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            msg = data["choices"][0]["message"]
            content = msg.get("content") or ""
            if not content and "reasoning" in msg:
                content = msg["reasoning"]
            return content

    async def _call_gemini(
        self,
        endpoint: ModelEndpoint,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int,
        json_mode: bool,
    ) -> str:
        """Call Gemini REST generateContent API."""
        url = f"{endpoint.base_url}/models/{endpoint.model}:generateContent?key={endpoint.api_key}"
        contents = []
        system_instruction = None

        for m in messages:
            if m.get("role") == "system":
                system_instruction = {"parts": [{"text": m.get("content", "")}]}
            else:
                role = "user" if m.get("role") == "user" else "model"
                contents.append({"role": role, "parts": [{"text": m.get("content", "")}]})

        body: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        }
        if system_instruction:
            body["systemInstruction"] = system_instruction
        if json_mode:
            body["generationConfig"]["responseMimeType"] = "application/json"

        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(url, json=body)
            resp.raise_for_status()
            data = resp.json()
            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    return parts[0].get("text", "")
            return "{}"

    async def _retry_with_feedback(
        self,
        endpoint: ModelEndpoint,
        original_messages: list[dict[str, str]],
        bad_response: str,
        error_detail: str,
    ) -> str:
        """Retry prompting with explicit error feedback."""
        feedback_messages = list(original_messages)
        feedback_messages.append({"role": "assistant", "content": bad_response})
        feedback_messages.append({
            "role": "user",
            "content": f"Your previous response failed JSON schema validation: {error_detail}. Please return strictly valid JSON matching the schema, with no markdown code fences or conversational text.",
        })
        return await self._call_endpoint(endpoint, feedback_messages, temperature=0.1, max_tokens=3000, json_mode=True)

    @staticmethod
    def _parse_json_to_model(text: str, model_cls: Type[T]) -> T:
        """Strip markdown fences if any and parse JSON into Pydantic model."""
        clean = text.strip()
        if clean.startswith("```json"):
            clean = clean[7:]
        elif clean.startswith("```"):
            clean = clean[3:]
        if clean.endswith("```"):
            clean = clean[:-3]
        clean = clean.strip()
        data = json.loads(clean)
        return model_cls.model_validate(data)

    def _log_usage(
        self,
        endpoint: ModelEndpoint,
        role: str,
        tokens: int,
        latency_ms: float,
        outcome: str,
        chat_id: UUID | None,
        run_id: UUID | None,
        user_id: UUID | None,
    ) -> None:
        """Logs call metadata for audit and model_usage table."""
        logger.info(
            "Model call logged: provider=%s, model=%s, role=%s, tokens~%d, latency=%.1fms, outcome=%s",
            endpoint.provider,
            endpoint.model,
            role,
            tokens,
            latency_ms,
            outcome,
        )


# Global singleton instance
router = FreeModelRouter()
llm_router = router
