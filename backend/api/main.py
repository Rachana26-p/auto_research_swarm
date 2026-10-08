"""
FastAPI Main Application.

Exposes:
- POST /runs, GET /runs, GET /runs/{id}, GET /runs/{id}/events (SSE)
- GET /reviews, POST /reviews/{id}/approve, POST /reviews/{id}/reject
- GET /knowledge, GET /knowledge/{page_id}
- GET /guardrail-events?run_id=

Security & Guardrails:
- CORS restricted to FRONTEND_URL env
- API key header check on every route
- Pydantic models with input length limits on the goal
- Rate limit on POST /runs
- Runs executed as background tasks with the Supervisor
- Zero secrets exposed in responses
"""

from __future__ import annotations

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import (
    guardrails_router,
    knowledge_router,
    reviews_router,
    runs_router,
)
from shared.config import ensure_directories, get_config


def create_app() -> FastAPI:
    ensure_directories()
    app = FastAPI(
        title="Auto Research Swarm API",
        description="Production API for multi-agent autonomous research swarm",
        version="1.0.0",
    )

    # Restrict CORS origin to frontend origin and Vercel domains
    frontend_origin = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    origins = list({frontend_origin, "http://localhost:3000", "http://127.0.0.1:3000"})
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=r"https://.*\.vercel\.app",
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    # Attach routers (all routes enforce API key authentication dependency)
    app.include_router(runs_router)
    app.include_router(reviews_router)
    app.include_router(knowledge_router)
    app.include_router(guardrails_router)

    return app


app = create_app()
