"""
Configuration loader with validation.

Per CLAUDE.md Code Standards:
- All external calls wrapped in try/except with explicit logging
- Type hints mandatory
- Pydantic validation for all config
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path

from .models import AppConfig, load_config as _load_config

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    """
    Load and cache application configuration.

    Raises:
        ValueError: If required environment variables are missing or invalid.
    """
    try:
        config = _load_config()
        logger.info("Configuration loaded successfully")
        logger.debug("Supabase URL: %s", config.supabase_url)
        logger.debug("Playwright MCP: %s", config.playwright_mcp_url)
        logger.debug("Fetch MCP: %s", config.fetch_mcp_url)
        logger.debug("Filesystem MCP: %s", config.filesystem_mcp_url)
        return config
    except Exception as e:
        logger.exception("Failed to load configuration")
        raise ValueError(f"Configuration error: {e}") from e


def validate_mcp_connectivity(config: AppConfig | None = None) -> dict[str, bool]:
    """
    Quick synchronous check of MCP server availability.
    Used for startup validation before running agents.
    """
    import httpx

    cfg = config or get_config()
    servers = {
        "playwright": cfg.playwright_mcp_url,
        "fetch": cfg.fetch_mcp_url,
        "filesystem": cfg.filesystem_mcp_url,
        "memory": cfg.memory_mcp_url,
        "github": cfg.github_mcp_url,
    }

    results = {}
    for name, url in servers.items():
        try:
            resp = httpx.get(f"{url}/health", timeout=3.0)
            results[name] = resp.status_code == 200
            if results[name]:
                logger.info("MCP %s: reachable at %s", name, url)
            else:
                logger.warning("MCP %s: unhealthy (HTTP %d)", name, resp.status_code)
        except Exception as e:
            results[name] = False
            logger.warning("MCP %s: unreachable at %s - %s", name, url, e)

    return results


def ensure_directories(config: AppConfig | None = None) -> None:
    """Ensure required directories exist."""
    try:
        cfg = config or get_config()
        dirs = [
            Path(cfg.knowledge_dir),
            Path(cfg.langgraph_checkpoint_dir),
        ]
    except Exception:
        dirs = [
            Path("./knowledge"),
            Path("./.langgraph_checkpoints"),
        ]

    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
        logger.debug("Ensured directory exists: %s", d)


# Backwards compatibility
load_config = get_config

__all__ = ["get_config", "validate_mcp_connectivity", "ensure_directories", "load_config"]