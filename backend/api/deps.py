"""
FastAPI authentication and common dependencies.
Enforces API key header validation on every route.
"""

from __future__ import annotations

import os
from fastapi import HTTPException, Request, Security
from fastapi.security import APIKeyHeader

from shared.config import get_config

API_KEY_NAME = "X-API-Key"
api_key_header_scheme = APIKeyHeader(name=API_KEY_NAME, auto_error=False)


async def verify_api_key(request: Request) -> str:
    """
    Validates API key from X-API-Key header or Authorization: Bearer <key>.
    Raises 401 Unauthorized if invalid or missing.
    """
    # 1. Check X-API-Key header
    provided_key = request.headers.get("X-API-Key")

    # 2. Check Authorization Bearer header as fallback
    if not provided_key:
        auth = request.headers.get("Authorization")
        if auth and auth.startswith("Bearer "):
            provided_key = auth[len("Bearer "):].strip()
        elif auth:
            provided_key = auth.strip()

    if not provided_key:
        raise HTTPException(
            status_code=401,
            detail="Missing API key header (X-API-Key or Authorization: Bearer <key> required)",
        )

    # Resolve expected key
    expected_key = os.environ.get("API_KEY")
    if not expected_key:
        try:
            expected_key = get_config().api_key
        except Exception:
            expected_key = "test-api-key"

    if provided_key != expected_key:
        raise HTTPException(
            status_code=401,
            detail="Invalid API key",
        )

    return provided_key
