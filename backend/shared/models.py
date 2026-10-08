"""
Shared Pydantic models for inter-agent communication and state.

Per CLAUDE.md Code Standards:
- Pydantic v2 models for every inter-agent message and tool call input/output
- No raw dicts crossing agent boundaries
- All function signatures must have type hints
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator


# ============================================================
# ENUMS (mirror Supabase enums)
# ============================================================

class RunStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ValidationStatus(str, Enum):
    PENDING = "pending"
    PASSED = "passed"
    FAILED = "failed"
    UNCERTAIN = "uncertain"


class ValidationVerdict(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    UNCERTAIN = "uncertain"  # triggers human review, not auto-reject


class LogStatus(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"
    RETRY = "retry"


class GuardrailEventType(str, Enum):
    TOOL_SCHEMA_VIOLATION = "tool_schema_violation"
    CONTENT_SANITIZATION = "content_sanitization"
    EGRESS_BLOCKED = "egress_blocked"
    VALIDATION_FAILED = "validation_failed"
    EGRESS_ALLOWED = "egress_allowed"
    TOOL_SCHEMA_PASS = "tool_schema_pass"
    GUARDRAIL_PASS = "guardrail_pass"


class AgentName(str, Enum):
    PLANNER = "planner"
    DISCOVERY = "discovery"
    EXTRACTOR = "extractor"
    VALIDATOR = "validator"
    WRITER = "writer"


# ============================================================
# BASE MODELS
# ============================================================

class BaseSchema(BaseModel):
    """Base config for all shared models."""
    model_config = ConfigDict(
        extra="forbid",           # Reject unknown fields — strict schema validation
        frozen=True,              # Immutable after creation
        validate_assignment=True, # Validate on mutation attempts
        str_strip_whitespace=True,
        use_enum_values=True,     # Serialize enums as values
    )


class ExtractedLink(BaseSchema):
    url: str
    text: str


class ExtractedImage(BaseSchema):
    url: str
    alt: str


class ExtractedMetadata(BaseSchema):
    author: str | None = None
    published_date: str | None = None
    modified_date: str | None = None
    tags: list[str] = Field(default_factory=list)


class ExtractedPage(BaseSchema):
    title: str
    description: str
    main_content: str
    headings: list[str] = Field(default_factory=list)
    links: list[ExtractedLink] = Field(default_factory=list)
    images: list[ExtractedImage] = Field(default_factory=list)
    metadata: ExtractedMetadata = Field(default_factory=ExtractedMetadata)


class TimestampedMixin(BaseModel):
    """Mixin for created_at / updated_at fields."""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class RunBase(BaseSchema):
    """Research run input/output."""
    id: UUID = Field(default_factory=uuid4)
    goal: str = Field(min_length=1, max_length=5000)
    status: RunStatus = RunStatus.PENDING
    config: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None


class RunCreate(BaseSchema):
    goal: str = Field(min_length=1, max_length=5000)
    config: dict[str, Any] = Field(default_factory=dict)


class RunUpdate(BaseSchema):
    status: RunStatus | None = None
    config: dict[str, Any] | None = None
    completed_at: datetime | None = None


class PageBase(BaseSchema, TimestampedMixin):
    """Per-page extraction record."""
    id: UUID = Field(default_factory=uuid4)
    run_id: UUID
    url: str = Field(min_length=1, max_length=2048)
    extracted_json: dict[str, Any] | None = None
    markdown_path: str | None = None
    validation_status: ValidationStatus = ValidationStatus.PENDING
    validation_reasoning: str | None = None


class PageCreate(BaseSchema):
    run_id: UUID
    url: str = Field(min_length=1, max_length=2048)


class PageExtractUpdate(BaseSchema):
    """Extractor-only update: extracted_json only."""
    extracted_json: dict[str, Any] = Field(
        description="Structured extraction output. Must not contain validation or markdown fields."
    )

    @field_validator("extracted_json")
    @classmethod
    def validate_no_forbidden_keys(cls, v: dict[str, Any]) -> dict[str, Any]:
        forbidden = {"validation_status", "validation_reasoning", "markdown_path", "url"}
        if overlap := forbidden & v.keys():
            raise ValueError(f"extracted_json must not contain forbidden keys: {overlap}")
        return v


class PageValidationUpdate(BaseSchema):
    """Validator-only update: validation fields only."""
    validation_status: ValidationStatus
    validation_reasoning: str = Field(min_length=1, max_length=5000)


class PageMarkdownUpdate(BaseSchema):
    """Writer-only update: markdown_path only."""
    markdown_path: str = Field(min_length=1, max_length=1024)


# ============================================================
# AGENT LOG & GUARDRAIL EVENTS
# ============================================================

class ToolCall(BaseSchema):
    """Single tool invocation record."""
    tool_name: str
    input_args: dict[str, Any]
    output: dict[str, Any] | None = None
    error: str | None = None
    duration_ms: int = Field(ge=0)
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class AgentLogEntry(BaseSchema):
    """Audit log entry for one agent node execution."""
    id: UUID = Field(default_factory=uuid4)
    run_id: UUID
    agent_name: AgentName
    node_name: str
    input_state: dict[str, Any]
    output_state: dict[str, Any] | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)
    duration_ms: int
    status: LogStatus
    error_message: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class GuardrailEvent(BaseSchema):
    """Guardrail rejection/validation event."""
    id: UUID = Field(default_factory=uuid4)
    run_id: UUID
    agent_name: AgentName
    event_type: GuardrailEventType
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ============================================================
# LANGGRAPH STATE (snake_case keys per Code Standards)
# ============================================================

class Subtask(BaseSchema):
    """Subtask produced by Planner."""
    subtask_id: str = Field(min_length=1)
    description: str = Field(min_length=1)
    candidate_domains: list[str] = Field(default_factory=list)  # hostnames only, not full URLs


class PlannerInput(BaseSchema):
    """Input to Planner node."""
    run_id: UUID
    goal: str = Field(min_length=1)
    max_subtasks: int = Field(default=5, ge=1)
    max_domains_per_subtask: int = Field(default=3, ge=1)


class PlannerOutput(BaseSchema):
    """Output from Planner node."""
    run_id: UUID
    subtasks: list[Subtask] = Field(default_factory=list)
    reasoning: str = Field(min_length=1)  # short justification, for audit log
    tool_calls: list[ToolCall] = Field(default_factory=list)
    tokens_used: int = 0


class RankedUrl(BaseSchema):
    """Candidate URL found and ranked by Discovery."""
    url: str = Field(min_length=1)
    relevance_score: float = Field(ge=0.0, le=1.0)
    domain: str = Field(min_length=1)


class DiscoveryInput(BaseSchema):
    """Input to Discovery node."""
    run_id: UUID
    subtask_id: str = Field(min_length=1)
    description: str = Field(min_length=1)
    candidate_domains: list[str] = Field(default_factory=list)
    max_urls: int = Field(default=10, ge=1)


class DiscoveryOutput(BaseSchema):
    """Output from Discovery node."""
    run_id: UUID
    subtask_id: str = Field(min_length=1)
    urls: list[RankedUrl] = Field(default_factory=list)
    tool_calls: list[ToolCall] = Field(default_factory=list)
    tokens_used: int = 0


class ExtractorInput(BaseSchema):
    """Input to Extractor node."""
    url: str
    run_id: UUID
    page_id: UUID


class ExtractorOutput(BaseSchema):
    """Output from Extractor node (pure extraction output)."""
    extracted_page: ExtractedPage
    source_content: str = ""
    tool_calls: list[ToolCall] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _normalize_extracted_output(cls, data: Any) -> Any:
        if isinstance(data, dict):
            data = dict(data)
            if "extracted_page" not in data and "extracted_json" in data:
                data["extracted_page"] = data.pop("extracted_json")
            elif "extracted_json" in data:
                data.pop("extracted_json")
        return data

    @property
    def extracted_json(self) -> dict[str, Any]:
        return self.extracted_page.model_dump()


class ValidatorInput(BaseSchema):
    """Input to Validator node (per validator.md)."""
    run_id: UUID
    page_id: UUID
    url: str
    extracted_content: ExtractedPage
    source_content: str  # Raw fetched content for faithfulness check
    subtask_description: str = Field(default="", description="Subtask description for relevance checking")

    @model_validator(mode="before")
    @classmethod
    def _normalize_validator_input(cls, data: Any) -> Any:
        if isinstance(data, dict):
            data = dict(data)
            if "extracted_content" not in data and "extracted_json" in data:
                data["extracted_content"] = data.pop("extracted_json")
            elif "extracted_json" in data:
                data.pop("extracted_json")
            if "url" not in data and "source_url" in data:
                data["url"] = data.pop("source_url")
            elif "source_url" in data:
                data.pop("source_url")
            if "source_content" not in data and "original_page_content" in data:
                data["source_content"] = data.pop("original_page_content")
            elif "original_page_content" in data:
                data.pop("original_page_content")
        return data

    @property
    def extracted_json(self) -> dict[str, Any]:
        return self.extracted_content.model_dump()


class ValidatorOutput(BaseSchema):
    """Output from Validator node (per validator.md & writer.md)."""
    run_id: UUID
    page_id: UUID
    verdict: ValidationVerdict
    confidence: float = Field(ge=0.0, le=1.0)
    faithfulness_notes: str = ""
    relevance_notes: str = ""
    safety_flags: list[str] = Field(default_factory=list)
    validation_status: ValidationStatus | None = None
    validation_reasoning: str | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)


class WriterInput(BaseSchema):
    """Input to Writer node (per writer.md)."""
    run_id: UUID
    page_id: UUID
    source_url: str = Field(min_length=1)
    extracted_content: ExtractedPage
    validation_result: ValidatorOutput  # must be verdict == PASS


class WriterOutput(BaseSchema):
    """Output from Writer node (per writer.md)."""
    run_id: UUID
    page_id: UUID
    markdown_path: str = Field(min_length=1)
    supabase_page_row_id: UUID
    embedding_generated: bool
    embedding_ids: list[UUID] = Field(default_factory=list)
    tool_calls: list[ToolCall] = Field(default_factory=list)


class SupervisorRunSummary(BaseSchema):
    """Run execution summary returned by supervisor."""
    run_id: str
    goal: str
    pages_processed: int = 0
    pages_passed: int = 0
    pages_failed: int = 0
    pages_uncertain: list[dict[str, Any]] = Field(default_factory=list)
    pages_written: list[dict[str, Any]] = Field(default_factory=list)
    errors: list[dict[str, Any]] = Field(default_factory=list)
    subtasks: list[dict[str, Any]] = Field(default_factory=list)
    tool_calls_made: int = 0
    tokens_used: int = 0


# ============================================================
# MCP TOOL SCHEMAS (validated before execution per Code Standards)
# ============================================================

class PlaywrightFetchInput(BaseSchema):
    """Input for Playwright MCP fetch."""
    url: str = Field(min_length=1, max_length=2048)
    wait_for: Literal["load", "domcontentloaded", "networkidle"] = "networkidle"
    timeout_ms: int = Field(default=30000, ge=1000, le=120000)
    allowed_domains: list[str] | None = None  # Egress allowlist


class PlaywrightFetchOutput(BaseSchema):
    """Output from Playwright MCP fetch."""
    html: str
    url: str
    title: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class FetchMCPInput(BaseSchema):
    """Input for Fetch MCP (lighter weight than Playwright)."""
    url: str = Field(min_length=1, max_length=2048)
    headers: dict[str, str] | None = None
    timeout_seconds: int = Field(default=30, ge=1, le=120)
    allowed_domains: list[str] | None = None


class FetchMCPOutput(BaseSchema):
    """Output from Fetch MCP."""
    content: str
    url: str
    content_type: str | None = None
    status_code: int


class FilesystemWriteInput(BaseSchema):
    """Input for Filesystem MCP write (Writer agent only)."""
    path: str = Field(min_length=1, max_length=1024)
    content: str
    create_parents: bool = True


class FilesystemWriteOutput(BaseSchema):
    """Output from Filesystem MCP write."""
    path: str
    bytes_written: int


class TavilySearchInput(BaseSchema):
    """Input for Tavily search (Discovery agent only)."""
    query: str = Field(min_length=1, max_length=500)
    max_results: int = Field(default=10, ge=1, le=20)
    search_depth: Literal["basic", "advanced"] = "basic"
    include_domains: list[str] | None = None
    exclude_domains: list[str] | None = None


class TavilySearchResult(BaseSchema):
    """Single Tavily search result."""
    url: str
    title: str
    content: str
    score: float = Field(ge=0.0, le=1.0)
    raw_content: str | None = None


class TavilySearchOutput(BaseSchema):
    """Output from Tavily search."""
    query: str
    results: list[TavilySearchResult]
    response_time: float


# ============================================================
# EMBEDDING MODELS
# ============================================================

class EmbeddingInput(BaseSchema):
    """Input for embedding generation."""
    texts: list[str] = Field(min_length=1, max_length=100)


class EmbeddingOutput(BaseSchema):
    """Output from embedding API."""
    embeddings: list[list[float]]
    model: str
    usage: dict[str, int] = Field(default_factory=dict)


class EmbeddingRecord(BaseSchema):
    """Single embedding record for pgvector storage."""
    page_id: UUID
    chunk_index: int
    chunk_text: str
    embedding: list[float] = Field(min_length=1536, max_length=1536)


# ============================================================
# CONFIGURATION MODEL
# ============================================================

class AppConfig(BaseSchema):
    """Validated application configuration from environment."""
    supabase_url: str
    supabase_planner_key: str
    supabase_discovery_key: str
    supabase_extractor_key: str
    supabase_validator_key: str
    supabase_writer_key: str
    tavily_api_key: str
    openrouter_api_key: str
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    nemotron_model: str = "nvidia/nemotron-3-ultra"
    anthropic_api_key: str
    claude_model: str = "claude-3-5-sonnet-20241022"
    google_api_key: str | None = None
    gemini_model: str = "gemini-1.5-pro"
    openai_api_key: str
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    playwright_mcp_url: str = "http://localhost:3001"
    fetch_mcp_url: str = "http://localhost:3002"
    filesystem_mcp_url: str = "http://localhost:3003"
    memory_mcp_url: str = "http://localhost:3004"
    github_mcp_url: str = "http://localhost:3005"
    knowledge_dir: str = "./knowledge"
    langgraph_checkpoint_dir: str = "./.langgraph_checkpoints"
    log_level: str = "INFO"
    log_format: str = "json"
    extractor_max_tokens: int = 8000
    extractor_timeout_seconds: int = 60
    discovery_max_results: int = 10
    validator_confidence_threshold: float = Field(default=0.85, ge=0.0, le=1.0)
    api_key: str = "test-api-key"
    frontend_url: str = "http://localhost:3000"

    @field_validator("supabase_url")
    @classmethod
    def validate_supabase_url(cls, v: str) -> str:
        if not v.startswith("https://") or not v.endswith(".supabase.co"):
            raise ValueError("SUPABASE_URL must be a valid Supabase project URL")
        return v


# ============================================================
# FACTORY FUNCTIONS (for creating validated configs)
# ============================================================

def load_config() -> AppConfig:
    """Load and validate configuration from environment."""
    import os
    from dotenv import load_dotenv

    load_dotenv()
    default_key = (
        os.getenv("SUPABASE_SECRET_KEY")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_PUBLISHABLE_KEY")
        or ""
    )
    return AppConfig(
        supabase_url=os.getenv("SUPABASE_URL", ""),
        supabase_planner_key=os.getenv("SUPABASE_PLANNER_KEY") or default_key,
        supabase_discovery_key=os.getenv("SUPABASE_DISCOVERY_KEY") or default_key,
        supabase_extractor_key=os.getenv("SUPABASE_EXTRACTOR_KEY") or default_key,
        supabase_validator_key=os.getenv("SUPABASE_VALIDATOR_KEY") or default_key,
        supabase_writer_key=os.getenv("SUPABASE_WRITER_KEY") or default_key,
        tavily_api_key=os.getenv("TAVILY_API_KEY", ""),
        openrouter_api_key=os.getenv("OPENROUTER_API_KEY", ""),
        openrouter_base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        nemotron_model=os.getenv("NEMOTRON_MODEL", "nvidia/nemotron-3-ultra"),
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
        claude_model=os.getenv("CLAUDE_MODEL", "claude-3-5-sonnet-20241022"),
        google_api_key=os.getenv("GOOGLE_API_KEY"),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-1.5-pro"),
        openai_api_key=os.getenv("OPENAI_API_KEY", ""),
        embedding_model=os.getenv("EMBEDDING_MODEL", "text-embedding-3-small"),
        embedding_dimensions=int(os.getenv("EMBEDDING_DIMENSIONS", "1536")),
        playwright_mcp_url=os.getenv("PLAYWRIGHT_MCP_URL", "http://localhost:3001"),
        fetch_mcp_url=os.getenv("FETCH_MCP_URL", "http://localhost:3002"),
        filesystem_mcp_url=os.getenv("FILESYSTEM_MCP_URL", "http://localhost:3003"),
        memory_mcp_url=os.getenv("MEMORY_MCP_URL", "http://localhost:3004"),
        github_mcp_url=os.getenv("GITHUB_MCP_URL", "http://localhost:3005"),
        knowledge_dir=os.getenv("KNOWLEDGE_DIR", "./knowledge"),
        langgraph_checkpoint_dir=os.getenv("LANGGRAPH_CHECKPOINT_DIR", "./.langgraph_checkpoints"),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        log_format=os.getenv("LOG_FORMAT", "json"),
        extractor_max_tokens=int(os.getenv("EXTRACTOR_MAX_TOKENS", "8000")),
        extractor_timeout_seconds=int(os.getenv("EXTRACTOR_TIMEOUT_SECONDS", "60")),
        discovery_max_results=int(os.getenv("DISCOVERY_MAX_RESULTS", "10")),
        validator_confidence_threshold=float(os.getenv("VALIDATOR_CONFIDENCE_THRESHOLD", "0.85")),
        api_key=os.getenv("API_KEY", "test-api-key"),
        frontend_url=os.getenv("FRONTEND_URL", "http://localhost:3000"),
    )


__all__ = [
    # Enums
    "RunStatus",
    "ValidationStatus",
    "ValidationVerdict",
    "LogStatus",
    "GuardrailEventType",
    "AgentName",
    # Base
    "BaseSchema",
    "TimestampedMixin",
    "ExtractedLink",
    "ExtractedImage",
    "ExtractedMetadata",
    "ExtractedPage",
    # Run
    "RunBase",
    "RunCreate",
    "RunUpdate",
    # Page
    "PageBase",
    "PageCreate",
    "PageExtractUpdate",
    "PageValidationUpdate",
    "PageMarkdownUpdate",
    # Logs
    "ToolCall",
    "AgentLogEntry",
    "GuardrailEvent",
    # LangGraph State
    "Subtask",
    "PlannerInput",
    "PlannerOutput",
    "RankedUrl",
    "DiscoveryInput",
    "DiscoveryOutput",
    "ExtractorInput",
    "ExtractorOutput",
    "ValidatorInput",
    "ValidatorOutput",
    "WriterInput",
    "WriterOutput",
    "SupervisorRunSummary",
    # MCP Tools
    "PlaywrightFetchInput",
    "PlaywrightFetchOutput",
    "FetchMCPInput",
    "FetchMCPOutput",
    "FilesystemWriteInput",
    "FilesystemWriteOutput",
    "TavilySearchInput",
    "TavilySearchResult",
    "TavilySearchOutput",
    # Embeddings
    "EmbeddingInput",
    "EmbeddingOutput",
    "EmbeddingRecord",
    # Config
    "AppConfig",
    "load_config",
]