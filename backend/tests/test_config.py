"""
Unit tests for configuration loading and validation.

Per CLAUDE.md Testing standards:
- Each component gets at least one unit test
- Guardrail rejection paths tested explicitly
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from pydantic import ValidationError

from shared.models import AppConfig, load_config
from shared.config import validate_mcp_connectivity, ensure_directories


class TestAppConfig:
    """Tests for AppConfig validation."""

    def test_valid_config_loads(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test that a valid configuration loads successfully."""
        env_vars = {
            "SUPABASE_URL": "https://test.supabase.co",
            "SUPABASE_PLANNER_KEY": "planner_key",
            "SUPABASE_DISCOVERY_KEY": "discovery_key",
            "SUPABASE_EXTRACTOR_KEY": "extractor_key",
            "SUPABASE_VALIDATOR_KEY": "validator_key",
            "SUPABASE_WRITER_KEY": "writer_key",
            "TAVILY_API_KEY": "tavily_key",
            "OPENROUTER_API_KEY": "openrouter_key",
            "ANTHROPIC_API_KEY": "anthropic_key",
            "OPENAI_API_KEY": "openai_key",
        }
        for k, v in env_vars.items():
            monkeypatch.setenv(k, v)

        config = load_config()
        assert config.supabase_url == "https://test.supabase.co"
        assert config.nemotron_model == "nvidia/nemotron-3-ultra"
        assert config.embedding_dimensions == 1536

    def test_invalid_supabase_url_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test that invalid Supabase URL is rejected."""
        env_vars = {
            "SUPABASE_URL": "http://invalid.com",
            "SUPABASE_PLANNER_KEY": "x",
            "SUPABASE_DISCOVERY_KEY": "x",
            "SUPABASE_EXTRACTOR_KEY": "x",
            "SUPABASE_VALIDATOR_KEY": "x",
            "SUPABASE_WRITER_KEY": "x",
            "TAVILY_API_KEY": "x",
            "OPENROUTER_API_KEY": "x",
            "ANTHROPIC_API_KEY": "x",
            "OPENAI_API_KEY": "x",
        }
        for k, v in env_vars.items():
            monkeypatch.setenv(k, v)

        with pytest.raises(ValidationError) as exc_info:
            load_config()
        assert "SUPABASE_URL must be a valid Supabase project URL" in str(exc_info.value)

    def test_missing_required_key_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test that missing required keys are rejected."""
        # Don't set any env vars - all should be missing
        with pytest.raises(ValidationError):
            load_config()

    def test_confidence_threshold_bounds(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test validator confidence threshold bounds."""
        base_env = {
            "SUPABASE_URL": "https://test.supabase.co",
            "SUPABASE_PLANNER_KEY": "x",
            "SUPABASE_DISCOVERY_KEY": "x",
            "SUPABASE_EXTRACTOR_KEY": "x",
            "SUPABASE_VALIDATOR_KEY": "x",
            "SUPABASE_WRITER_KEY": "x",
            "TAVILY_API_KEY": "x",
            "OPENROUTER_API_KEY": "x",
            "ANTHROPIC_API_KEY": "x",
            "OPENAI_API_KEY": "x",
        }

        # Valid: 0.0
        monkeypatch.setenv("VALIDATOR_CONFIDENCE_THRESHOLD", "0.0")
        for k, v in base_env.items():
            monkeypatch.setenv(k, v)
        config = load_config()
        assert config.validator_confidence_threshold == 0.0

        # Valid: 1.0
        monkeypatch.setenv("VALIDATOR_CONFIDENCE_THRESHOLD", "1.0")
        config = load_config()
        assert config.validator_confidence_threshold == 1.0

        # Invalid: > 1.0
        monkeypatch.setenv("VALIDATOR_CONFIDENCE_THRESHOLD", "1.5")
        with pytest.raises(ValidationError):
            load_config()

        # Invalid: < 0.0
        monkeypatch.setenv("VALIDATOR_CONFIDENCE_THRESHOLD", "-0.1")
        with pytest.raises(ValidationError):
            load_config()


class TestMCPValidation:
    """Tests for MCP input/output validation."""

    def test_playwright_fetch_input_validation(self) -> None:
        """Test Playwright fetch input schema validation."""
        from shared.models import PlaywrightFetchInput

        # Valid input
        valid = PlaywrightFetchInput(
            url="https://example.com",
            wait_for="networkidle",
            timeout_ms=30000,
            allowed_domains=["example.com"],
        )
        assert valid.url == "https://example.com"

        # Invalid: missing required field
        with pytest.raises(ValidationError):
            PlaywrightFetchInput(wait_for="networkidle")

        # Invalid: URL too long
        with pytest.raises(ValidationError):
            PlaywrightFetchInput(url="x" * 3000)

        # Invalid: timeout out of bounds
        with pytest.raises(ValidationError):
            PlaywrightFetchInput(url="https://example.com", timeout_ms=500)

    def test_fetch_mcp_input_validation(self) -> None:
        """Test Fetch MCP input schema validation."""
        from shared.models import FetchMCPInput

        valid = FetchMCPInput(
            url="https://example.com",
            timeout_seconds=30,
            allowed_domains=["example.com"],
        )
        assert valid.timeout_seconds == 30

        with pytest.raises(ValidationError):
            FetchMCPInput(url="https://example.com", timeout_seconds=0)

    def test_filesystem_write_input_validation(self) -> None:
        """Test Filesystem write input schema validation."""
        from shared.models import FilesystemWriteInput

        valid = FilesystemWriteInput(
            path="/tmp/test.txt",
            content="hello",
            create_parents=True,
        )
        assert valid.path == "/tmp/test.txt"

        with pytest.raises(ValidationError):
            FilesystemWriteInput(path="", content="x")

    def test_tavily_search_input_validation(self) -> None:
        """Test Tavily search input schema validation."""
        from shared.models import TavilySearchInput

        valid = TavilySearchInput(
            query="test query",
            max_results=10,
            search_depth="basic",
        )
        assert valid.max_results == 10

        with pytest.raises(ValidationError):
            TavilySearchInput(query="x", max_results=25)  # > 20

        with pytest.raises(ValidationError):
            TavilySearchInput(query="x", search_depth="invalid")


class TestPageUpdates:
    """Tests for page update models (enforce agent boundaries)."""

    def test_extractor_update_forbids_validation_fields(self) -> None:
        """Extractor must not write validation fields."""
        from shared.models import PageExtractUpdate

        # Valid: only extracted_json
        valid = PageExtractUpdate(extracted_json={"title": "Test", "content": "Body"})
        assert valid.extracted_json["title"] == "Test"

        # Invalid: contains validation_status
        with pytest.raises(ValidationError) as exc_info:
            PageExtractUpdate(extracted_json={"validation_status": "passed"})
        assert "forbidden keys" in str(exc_info.value)

        # Invalid: contains markdown_path
        with pytest.raises(ValidationError):
            PageExtractUpdate(extracted_json={"markdown_path": "/tmp/x.md"})

    def test_validator_update_only_validation_fields(self) -> None:
        """Validator must only write validation fields."""
        from shared.models import PageValidationUpdate

        valid = PageValidationUpdate(
            validation_status="passed",
            validation_reasoning="Content matches source",
        )
        assert getattr(valid.validation_status, "value", valid.validation_status) == "passed"

    def test_writer_update_only_markdown_path(self) -> None:
        """Writer must only write markdown_path."""
        from shared.models import PageMarkdownUpdate

        valid = PageMarkdownUpdate(markdown_path="/knowledge/page_1.md")
        assert valid.markdown_path == "/knowledge/page_1.md"


class TestEnsureDirectories:
    """Test directory creation."""

    def test_ensure_directories_creates_paths(self, tmp_path: Path) -> None:
        """Test that ensure_directories creates required paths."""
        from shared.models import AppConfig
        from shared.config import ensure_directories

        config = AppConfig(
            supabase_url="https://test.supabase.co",
            supabase_planner_key="x",
            supabase_discovery_key="x",
            supabase_extractor_key="x",
            supabase_validator_key="x",
            supabase_writer_key="x",
            tavily_api_key="x",
            openrouter_api_key="x",
            anthropic_api_key="x",
            openai_api_key="x",
            knowledge_dir=str(tmp_path / "knowledge"),
            langgraph_checkpoint_dir=str(tmp_path / "checkpoints"),
        )

        ensure_directories(config)
        assert (tmp_path / "knowledge").exists()
        assert (tmp_path / "checkpoints").exists()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])