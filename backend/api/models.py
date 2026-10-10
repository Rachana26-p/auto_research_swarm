"""
Pydantic v2 request and response schemas for FastAPI API endpoints.
Ensures zero secrets in all response bodies.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class APIModel(BaseModel):
    """Base API model with strict forbidden extra keys and standard serialization."""
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# ============================================================
# RUN SCHEMAS
# ============================================================

class RunCreateRequest(APIModel):
    goal: str = Field(..., min_length=1, max_length=5000, description="Research goal")
    max_pages: int = Field(default=20, ge=1, le=100)
    max_tool_calls: int = Field(default=200, ge=1, le=1000)
    max_tokens: int = Field(default=500000, ge=1000, le=2000000)
    max_wall_seconds: float = Field(default=1800.0, ge=10.0, le=7200.0)


class RunResponse(APIModel):
    id: UUID
    goal: str
    status: str
    created_at: datetime
    completed_at: Optional[datetime] = None
    pages_processed: int = 0
    pages_persisted: int = 0
    pages_uncertain_count: int = 0
    pages_failed: int = 0
    tool_calls_made: int = 0
    tokens_used: int = 0
    wall_clock_seconds: float = 0.0
    error_message: Optional[str] = None
    max_pages: int = 20
    max_tokens: int = 500000
    max_tool_calls: int = 200


class RunSummaryResponse(APIModel):
    id: UUID
    goal: str
    status: str
    created_at: datetime
    pages_persisted: int = 0
    tokens_used: int = 0


# ============================================================
# REVIEW SCHEMAS
# ============================================================

class ReviewResponse(APIModel):
    id: UUID
    run_id: UUID
    page_id: UUID
    url: str
    status: str
    validator_output: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class ReviewActionResponse(APIModel):
    review_id: UUID
    run_id: UUID
    status: str
    message: str


# ============================================================
# KNOWLEDGE SCHEMAS
# ============================================================

class KnowledgePageSummary(APIModel):
    page_id: str
    title: str
    filename: str
    size_bytes: int


class KnowledgePageDetail(APIModel):
    page_id: str
    title: str
    filename: str
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)


# ============================================================
# GUARDRAIL EVENT SCHEMAS
# ============================================================

class GuardrailEventResponse(APIModel):
    id: UUID
    run_id: UUID
    agent_name: str
    event_type: str
    decision: str
    details: dict[str, Any]
    created_at: datetime
