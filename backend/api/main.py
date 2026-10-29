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
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.routes import (
    auth_router,
    chats_router,
    guardrails_router,
    knowledge_router,
    latex_router,
    reviews_router,
    runs_router,
)
from shared.config import ensure_directories, get_config
from shared.db import db_client, DatabaseUnavailableError


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

    # Attach routers (all routes enforce authentication dependencies)
    app.include_router(auth_router)
    app.include_router(chats_router)
    app.include_router(runs_router)
    app.include_router(reviews_router)
    app.include_router(knowledge_router)
    app.include_router(guardrails_router)
    app.include_router(latex_router)

    # Database Outage Resilience (WS0)
    @app.exception_handler(DatabaseUnavailableError)
    async def database_unavailable_handler(request: Request, exc: DatabaseUnavailableError) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            headers={"Retry-After": str(exc.retry_after)},
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "retry_after": exc.retry_after,
                }
            },
        )

    @app.get("/health", tags=["health"])
    async def health_liveness() -> dict[str, str]:
        """Liveness check: requires zero external dependencies, always returns 200."""
        return {"status": "healthy", "service": "auto-research-swarm"}

    @app.get("/health/deep", tags=["health"])
    async def health_deep() -> JSONResponse:
        """
        Deep reachability check: probes Supabase DB and Auth with 3s timeout.
        Returns status with no internal secrets or technical details.
        """
        health_data = await db_client.check_deep_health()
        status_code = 200 if health_data.get("status") == "ok" else 503
        headers = {"Retry-After": "15"} if status_code == 503 else {}
        return JSONResponse(status_code=status_code, content=health_data, headers=headers)

    return app


app = create_app()
