"""
Authentication Precheck and Diagnostic Endpoints (WS1).

Provides POST /auth/precheck to differentiate wrong email vs wrong password
under rate-limited service-role inspection when AUTH_DETAILED_ERRORS=true.
"""

from __future__ import annotations

import logging
import os
import time
from collections import defaultdict
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# In-memory sliding rate limiter: ip -> list of timestamps, email -> list of timestamps
_IP_ATTEMPTS: dict[str, list[float]] = defaultdict(list)
_EMAIL_ATTEMPTS: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT_WINDOW = 60.0  # 1 minute
MAX_IP_CHECKS = 10
MAX_EMAIL_CHECKS = 5


class PrecheckRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)


class PrecheckResponse(BaseModel):
    detailed_enabled: bool
    exists: bool = False
    confirmed: bool = True
    disabled: bool = False
    message: str | None = None


def _check_rate_limit(ip: str, email: str) -> None:
    now = time.time()
    clean_ip_times = [t for t in _IP_ATTEMPTS[ip] if now - t < RATE_LIMIT_WINDOW]
    clean_email_times = [t for t in _EMAIL_ATTEMPTS[email] if now - t < RATE_LIMIT_WINDOW]

    _IP_ATTEMPTS[ip] = clean_ip_times
    _EMAIL_ATTEMPTS[email] = clean_email_times

    if len(clean_ip_times) >= MAX_IP_CHECKS or len(clean_email_times) >= MAX_EMAIL_CHECKS:
        logger.warning("Auth precheck rate limit exceeded for IP %s / email %s", ip, email)
        raise HTTPException(
            status_code=429,
            detail="Too many authentication precheck attempts. Please wait before retrying.",
            headers={"Retry-After": "60"},
        )

    _IP_ATTEMPTS[ip].append(now)
    _EMAIL_ATTEMPTS[email].append(now)


@router.post("/precheck", response_model=PrecheckResponse)
async def auth_precheck(payload: PrecheckRequest, request: Request) -> PrecheckResponse:
    """
    Checks if an email is registered to differentiate wrong email vs wrong password.
    Disabled when AUTH_DETAILED_ERRORS=false to prevent user-enumeration.
    """
    detailed_enabled = os.environ.get("AUTH_DETAILED_ERRORS", "true").lower() == "true"
    email = payload.email.strip().lower()

    # Extract client IP
    forwarded = request.headers.get("X-Forwarded-For")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")

    _check_rate_limit(ip, email)

    if not detailed_enabled:
        return PrecheckResponse(
            detailed_enabled=False,
            message="Invalid email or password",
        )

    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    secret_key = os.environ.get("SUPABASE_SECRET_KEY", "")

    if not supabase_url or not secret_key:
        logger.info("Auth precheck skipped: missing Supabase admin credentials")
        return PrecheckResponse(detailed_enabled=True, exists=True, confirmed=True)

    # Perform service-role lookup via Supabase Admin Auth API
    admin_url = f"{supabase_url}/auth/v1/admin/users"
    headers = {
        "apikey": secret_key,
        "Authorization": f"Bearer {secret_key}",
    }

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(admin_url, headers=headers)
            if resp.status_code == 200:
                users_data = resp.json().get("users", [])
                matching_user = next(
                    (u for u in users_data if str(u.get("email", "")).lower() == email),
                    None,
                )
                if matching_user:
                    confirmed = matching_user.get("email_confirmed_at") is not None
                    banned = matching_user.get("banned_until") is not None
                    logger.info("Auth precheck: email '%s' FOUND (confirmed: %s, IP: %s)", email, confirmed, ip)
                    return PrecheckResponse(
                        detailed_enabled=True,
                        exists=True,
                        confirmed=confirmed,
                        disabled=banned,
                    )
                else:
                    logger.info("Auth precheck: email '%s' NOT FOUND (IP: %s)", email, ip)
                    return PrecheckResponse(
                        detailed_enabled=True,
                        exists=False,
                        confirmed=False,
                    )
            elif resp.status_code == 404:
                return PrecheckResponse(detailed_enabled=True, exists=False)
            else:
                logger.warning("Supabase admin users lookup HTTP %d: %s", resp.status_code, resp.text[:200])
    except Exception as exc:
        logger.warning("Auth precheck query error: %s", exc)

    return PrecheckResponse(detailed_enabled=True, exists=True, confirmed=True)
