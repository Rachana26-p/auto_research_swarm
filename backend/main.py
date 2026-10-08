"""
Vercel deployment entrypoint for FastAPI backend service.
Exposes the ASGI application instance `app`.
"""

from api.main import app

__all__ = ["app"]
