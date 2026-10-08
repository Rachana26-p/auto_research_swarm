#!/usr/bin/env python3
"""
MCP Tool Verification Script

Verifies connectivity to all Docker MCP servers running under the 'vibe_coding'
Docker Desktop profile. Tests each MCP server's health endpoint and basic functionality.

Per CLAUDE.md:
- All external calls wrapped in try/except with explicit logging — no silent failures
- Type hints mandatory on all function signatures
- Pydantic validation for tool inputs/outputs
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from dataclasses import dataclass
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ValidationError

# Add parent to path for shared models
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shared.models import (  # noqa: E402
    PlaywrightFetchInput,
    PlaywrightFetchOutput,
    FetchMCPInput,
    FetchMCPOutput,
    FilesystemWriteInput,
    FilesystemWriteOutput,
    TavilySearchInput,
    TavilySearchOutput,
    AppConfig,
    load_config,
)

# ============================================================
# LOGGING SETUP
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("mcp_verify")


# ============================================================
# MCP SERVER DEFINITIONS
# ============================================================

@dataclass(frozen=True)
class MCPServer:
    name: str
    base_url: str
    health_path: str = "/health"
    test_tool: str | None = None
    test_input: dict[str, Any] | None = None


MCP_SERVERS = [
    MCPServer(
        name="playwright",
        base_url="http://localhost:3001",
        health_path="/health",
        test_tool="fetch",
        test_input={"url": "https://example.com", "wait_for": "networkidle", "timeout_ms": 10000},
    ),
    MCPServer(
        name="fetch",
        base_url="http://localhost:3002",
        health_path="/health",
        test_tool="fetch",
        test_input={"url": "https://example.com", "timeout_seconds": 10},
    ),
    MCPServer(
        name="filesystem",
        base_url="http://localhost:3003",
        health_path="/health",
        test_tool="write",
        test_input={"path": "/tmp/mcp_test.txt", "content": "MCP verification test", "create_parents": True},
    ),
    MCPServer(
        name="memory",
        base_url="http://localhost:3004",
        health_path="/health",
    ),
    MCPServer(
        name="github",
        base_url="http://localhost:3005",
        health_path="/health",
    ),
]


# ============================================================
# RESPONSE MODELS
# ============================================================

class HealthResponse(BaseModel):
    status: Literal["healthy", "degraded", "unhealthy"]
    version: str | None = None
    details: dict[str, Any] = {}


class MCPToolResponse(BaseModel):
    success: bool
    result: Any | None = None
    error: str | None = None


# ============================================================
# VERIFICATION FUNCTIONS
# ============================================================

async def check_health(client: httpx.AsyncClient, server: MCPServer) -> tuple[bool, str]:
    """Check MCP server health endpoint."""
    url = f"{server.base_url}{server.health_path}"
    try:
        resp = await client.get(url, timeout=5.0)
        if resp.status_code == 200:
            health = HealthResponse.model_validate(resp.json())
            return True, f"{server.name}: {health.status} (v{health.version or 'unknown'})"
        return False, f"{server.name}: HTTP {resp.status_code}"
    except httpx.ConnectError:
        return False, f"{server.name}: Connection refused (is Docker running?)"
    except httpx.TimeoutException:
        return False, f"{server.name}: Health check timeout"
    except ValidationError as e:
        return False, f"{server.name}: Invalid health response - {e}"
    except Exception as e:
        return False, f"{server.name}: Unexpected error - {e}"


async def test_tool(
    client: httpx.AsyncClient,
    server: MCPServer,
    config: AppConfig,
) -> tuple[bool, str]:
    """Test a basic tool call on the MCP server."""
    if not server.test_tool or not server.test_input:
        return True, f"{server.name}: No test tool configured (skipped)"

    url = f"{server.base_url}/tools/{server.test_tool}"
    try:
        # Validate input against Pydantic schema before sending
        if server.name == "playwright":
            validated_input = PlaywrightFetchInput.model_validate(server.test_input)
            # Override allowed_domains for test
            validated_input = validated_input.model_copy(update={"allowed_domains": ["example.com"]})
            payload = validated_input.model_dump()
        elif server.name == "fetch":
            validated_input = FetchMCPInput.model_validate(server.test_input)
            validated_input = validated_input.model_copy(update={"allowed_domains": ["example.com"]})
            payload = validated_input.model_dump()
        elif server.name == "filesystem":
            validated_input = FilesystemWriteInput.model_validate(server.test_input)
            payload = validated_input.model_dump()
        else:
            payload = server.test_input

        resp = await client.post(url, json=payload, timeout=30.0)

        if resp.status_code == 200:
            result = MCPToolResponse.model_validate(resp.json())
            if result.success:
                return True, f"{server.name}: Tool '{server.test_tool}' succeeded"
            return False, f"{server.name}: Tool returned error - {result.error}"
        return False, f"{server.name}: Tool HTTP {resp.status_code} - {resp.text[:200]}"

    except ValidationError as e:
        return False, f"{server.name}: Input validation failed - {e}"
    except httpx.ConnectError:
        return False, f"{server.name}: Connection refused during tool call"
    except httpx.TimeoutException:
        return False, f"{server.name}: Tool call timeout"
    except Exception as e:
        return False, f"{server.name}: Unexpected tool error - {e}"


async def verify_all(config: AppConfig) -> dict[str, Any]:
    """Run all MCP verification checks."""
    results = {
        "timestamp": time.time(),
        "servers": {},
        "overall": "pending",
    }

    # Override server URLs from config if provided
    server_map = {s.name: s for s in MCP_SERVERS}
    server_map["playwright"] = server_map["playwright"].__class__(
        name="playwright",
        base_url=config.playwright_mcp_url,
        health_path="/health",
        test_tool="fetch",
        test_input={"url": "https://example.com", "wait_for": "networkidle", "timeout_ms": 10000},
    )
    server_map["fetch"] = server_map["fetch"].__class__(
        name="fetch",
        base_url=config.fetch_mcp_url,
        health_path="/health",
        test_tool="fetch",
        test_input={"url": "https://example.com", "timeout_seconds": 10},
    )
    server_map["filesystem"] = server_map["filesystem"].__class__(
        name="filesystem",
        base_url=config.filesystem_mcp_url,
        health_path="/health",
        test_tool="write",
        test_input={"path": "/tmp/mcp_test.txt", "content": "MCP verification test", "create_parents": True},
    )
    server_map["memory"] = server_map["memory"].__class__(
        name="memory",
        base_url=config.memory_mcp_url,
        health_path="/health",
    )
    server_map["github"] = server_map["github"].__class__(
        name="github",
        base_url=config.github_mcp_url,
        health_path="/health",
    )

    servers_to_test = list(server_map.values())

    async with httpx.AsyncClient() as client:
        # Health checks (parallel)
        logger.info("Running health checks...")
        health_tasks = [check_health(client, s) for s in servers_to_test]
        health_results = await asyncio.gather(*health_tasks, return_exceptions=True)

        for server, result in zip(servers_to_test, health_results, strict=False):
            if isinstance(result, Exception):
                success, msg = False, f"{server.name}: Exception - {result}"
            else:
                success, msg = result

            results["servers"][server.name] = {"health": {"success": success, "message": msg}}
            status_icon = "✅" if success else "❌"
            logger.info("%s %s", status_icon, msg)

        # Tool tests (sequential to avoid rate limits)
        logger.info("Running tool tests...")
        for server in servers_to_test:
            if server.name not in results["servers"]:
                results["servers"][server.name] = {}

            health_ok = results["servers"][server.name].get("health", {}).get("success", False)
            if not health_ok:
                results["servers"][server.name]["tool"] = {
                    "success": False,
                    "message": f"{server.name}: Skipped (health check failed)",
                }
                logger.warning("⏭️  %s: Skipped tool test (health failed)", server.name)
                continue

            success, msg = await test_tool(client, server, config)
            results["servers"][server.name]["tool"] = {"success": success, "message": msg}
            status_icon = "✅" if success else "❌"
            logger.info("%s %s", status_icon, msg)

    # Determine overall status
    all_healthy = all(
        s.get("health", {}).get("success", False) and s.get("tool", {}).get("success", True)
        for s in results["servers"].values()
    )
    results["overall"] = "healthy" if all_healthy else "degraded"

    return results


def print_summary(results: dict[str, Any]) -> int:
    """Print summary and return exit code."""
    print("\n" + "=" * 60)
    print("MCP VERIFICATION SUMMARY")
    print("=" * 60)

    for name, data in results["servers"].items():
        health = data.get("health", {})
        tool = data.get("tool", {})
        health_icon = "✅" if health.get("success") else "❌"
        tool_icon = "✅" if tool.get("success") else ("⏭️" if "Skipped" in tool.get("message", "") else "❌")
        print(f"  {name:12}  Health: {health_icon}  Tool: {tool_icon}")
        if not health.get("success"):
            print(f"    └─ {health.get('message')}")
        if not tool.get("success") and "Skipped" not in tool.get("message", ""):
            print(f"    └─ {tool.get('message')}")

    print("-" * 60)
    overall_icon = "✅" if results["overall"] == "healthy" else "⚠️"
    print(f"  Overall: {overall_icon} {results['overall'].upper()}")
    print("=" * 60)

    return 0 if results["overall"] == "healthy" else 1


async def main() -> int:
    """Main entry point."""
    logger.info("Starting MCP verification (vibe_coding profile)...")

    try:
        config = load_config()
    except Exception as e:
        logger.error("Failed to load configuration: %s", e)
        logger.error("Ensure .env file exists with all required keys (see .env.example)")
        return 1

    results = await verify_all(config)
    return print_summary(results)


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)