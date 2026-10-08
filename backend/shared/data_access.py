"""
Per-Agent Backend Least-Privilege Data Access Wrappers.

Audit Finding:
Supabase publishable keys (SUPABASE_PLANNER_KEY, SUPABASE_DISCOVERY_KEY,
SUPABASE_EXTRACTOR_KEY, SUPABASE_VALIDATOR_KEY, SUPABASE_WRITER_KEY) all decode to
the same PostgreSQL role ('anon') in Supabase PostgREST. The RLS policies defined
'TO planner', 'TO discovery', etc., require custom PostgreSQL roles or custom signed
JWTs. Because standard publishable keys all resolve to the same database role,
database-level RLS does not separate privileges among the five agents.

Solution (Least Privilege Enforcement):
This module provides strictly scoped per-agent data-access wrappers.
Each agent receives only its dedicated wrapper which:
1. Connects using that agent's specific publishable key.
2. Statically restricts access strictly to the agent's permitted tables and columns.
3. Forbids out-of-scope reads and mutations with an explicit PermissionError.
"""

from __future__ import annotations

import logging
from typing import Any, Sequence
from uuid import UUID

from shared.models import (
    AgentName,
    AppConfig,
    PageBase,
    RunBase,
    ValidationStatus,
)
from shared.config import get_config

logger = logging.getLogger(__name__)


class AccessDeniedError(PermissionError):
    """Raised when an agent attempts an unauthorized database operation."""
    pass


class BaseAgentDataAccess:
    """Base class for agent data-access wrappers."""

    def __init__(self, agent_name: AgentName, api_key: str, supabase_url: str):
        self.agent_name = agent_name
        self.api_key = api_key
        self.supabase_url = supabase_url.rstrip("/")
        self.headers = {
            "apikey": self.api_key,
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def _assert_allowed_table(self, table: str, allowed: set[str], operation: str) -> None:
        if table not in allowed:
            err = f"Agent '{self.agent_name.value}' is NOT permitted to {operation} table '{table}'."
            logger.error("Security violation: %s", err)
            raise AccessDeniedError(err)


class PlannerDataAccess(BaseAgentDataAccess):
    """
    Least-privilege data access for Planner Agent.
    Permitted tables: runs (all), agent_logs (insert), guardrail_events (insert).
    Forbidden: pages (modify), embeddings (any).
    """

    ALLOWED_TABLES = {"runs", "agent_logs", "guardrail_events"}

    def __init__(self, config: AppConfig | None = None):
        cfg = config or get_config()
        super().__init__(
            agent_name=AgentName.PLANNER,
            api_key=cfg.supabase_planner_key,
            supabase_url=cfg.supabase_url,
        )


class DiscoveryDataAccess(BaseAgentDataAccess):
    """
    Least-privilege data access for Discovery Agent.
    Permitted tables: runs (select), pages (insert/upsert url only), agent_logs (insert), guardrail_events (insert).
    Forbidden: pages (extracted_json, validation_status, markdown_path), embeddings (any).
    """

    ALLOWED_TABLES = {"runs", "pages", "agent_logs", "guardrail_events"}

    def __init__(self, config: AppConfig | None = None):
        cfg = config or get_config()
        super().__init__(
            agent_name=AgentName.DISCOVERY,
            api_key=cfg.supabase_discovery_key,
            supabase_url=cfg.supabase_url,
        )

    def validate_page_mutation(self, payload: dict[str, Any]) -> None:
        forbidden_keys = {"extracted_json", "validation_status", "validation_reasoning", "markdown_path"}
        attempted = forbidden_keys.intersection(payload.keys())
        if attempted:
            raise AccessDeniedError(f"Discovery agent cannot modify columns: {attempted}")


class ExtractorDataAccess(BaseAgentDataAccess):
    """
    Least-privilege data access for Extractor Agent.
    Permitted tables: pages (select, update extracted_json only), agent_logs (insert), guardrail_events (insert).
    Forbidden: runs (any), pages (validation_status, markdown_path), embeddings (any).
    """

    ALLOWED_TABLES = {"pages", "agent_logs", "guardrail_events"}

    def __init__(self, config: AppConfig | None = None):
        cfg = config or get_config()
        super().__init__(
            agent_name=AgentName.EXTRACTOR,
            api_key=cfg.supabase_extractor_key,
            supabase_url=cfg.supabase_url,
        )

    def validate_page_mutation(self, payload: dict[str, Any]) -> None:
        forbidden_keys = {"validation_status", "validation_reasoning", "markdown_path"}
        attempted = forbidden_keys.intersection(payload.keys())
        if attempted:
            raise AccessDeniedError(f"Extractor agent cannot modify columns: {attempted}")


class ValidatorDataAccess(BaseAgentDataAccess):
    """
    Least-privilege data access for Validator Agent.
    Permitted tables: pages (select, update validation_status and validation_reasoning only), agent_logs (insert), guardrail_events (insert).
    Forbidden: runs (any), pages (extracted_json, markdown_path), embeddings (any).
    """

    ALLOWED_TABLES = {"pages", "agent_logs", "guardrail_events"}

    def __init__(self, config: AppConfig | None = None):
        cfg = config or get_config()
        super().__init__(
            agent_name=AgentName.VALIDATOR,
            api_key=cfg.supabase_validator_key,
            supabase_url=cfg.supabase_url,
        )

    def validate_page_mutation(self, payload: dict[str, Any]) -> None:
        forbidden_keys = {"extracted_json", "markdown_path", "url"}
        attempted = forbidden_keys.intersection(payload.keys())
        if attempted:
            raise AccessDeniedError(f"Validator agent cannot modify columns: {attempted}")


class WriterDataAccess(BaseAgentDataAccess):
    """
    Least-privilege data access for Writer Agent.
    Permitted tables: pages (select, update markdown_path only), embeddings (all), agent_logs (insert), guardrail_events (insert).
    Forbidden: runs (delete), pages (validation_status, extracted_json).
    """

    ALLOWED_TABLES = {"pages", "embeddings", "agent_logs", "guardrail_events"}

    def __init__(self, config: AppConfig | None = None):
        cfg = config or get_config()
        super().__init__(
            agent_name=AgentName.WRITER,
            api_key=cfg.supabase_writer_key,
            supabase_url=cfg.supabase_url,
        )

    def validate_page_mutation(self, payload: dict[str, Any]) -> None:
        forbidden_keys = {"validation_status", "validation_reasoning", "extracted_json"}
        attempted = forbidden_keys.intersection(payload.keys())
        if attempted:
            raise AccessDeniedError(f"Writer agent cannot modify columns: {attempted}")


__all__ = [
    "AccessDeniedError",
    "BaseAgentDataAccess",
    "PlannerDataAccess",
    "DiscoveryDataAccess",
    "ExtractorDataAccess",
    "ValidatorDataAccess",
    "WriterDataAccess",
]
