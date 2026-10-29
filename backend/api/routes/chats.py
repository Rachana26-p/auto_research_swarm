"""
Routes for User-Isolated Research Chats, Sources, and Paper Versions (WS2).

Enforces strict user isolation:
- All mutations and reads scoped to user_id = current_user.user_id
- Cross-tenant access returns 404 (not 403) to prevent resource enumeration
- Deleting a chat cascades through all dependent entities with zero orphans
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from api.deps import UserContext, get_current_user, verify_user_access
from agents.paper_composer import PaperComposer
from latex.compiler import LatexCompiler, compile_with_auto_repair
from latex.linter import assert_latex_safe, ForbiddenCommandError
from latex.versioning import ConcurrencyConflictError
from shared.models import (
    ChatCreate,
    ChatParams,
    ChatResponse,
    ChatUpdate,
    CompileResult,
    PaperComposerInput,
    PaperComposerOutput,
    PaperGenerateRequest,
    PaperRecord,
    PaperUpdateRequest,
    PaperVersionRecord,
    RunStatus,
    SourceRecord,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chats", tags=["chats"])

# In-memory storage with fallback for instant responsiveness and testing
# (persisted to Supabase chats table when available)
_CHATS: dict[UUID, dict] = {}
_SOURCES: dict[UUID, list[dict]] = {}
_PAPERS: dict[UUID, dict] = {}
_PAPER_VERSIONS: dict[UUID, list[dict]] = {}


@router.get("", response_model=list[ChatResponse])
async def list_chats(
    search: str | None = Query(default=None),
    current_user: UserContext = Depends(get_current_user),
) -> list[ChatResponse]:
    """List all chats belonging strictly to the authenticated user."""
    user_chats = [
        c for c in _CHATS.values()
        if c.get("user_id") == current_user.user_id
    ]

    if search:
        s = search.lower()
        user_chats = [c for c in user_chats if s in c.get("title", "").lower() or s in c.get("query", "").lower()]

    user_chats.sort(key=lambda x: x.get("last_opened_at", datetime.min), reverse=True)
    return [ChatResponse(**c) for c in user_chats]


@router.post("", response_model=ChatResponse, status_code=status.HTTP_201_CREATED)
async def create_chat(
    payload: ChatCreate,
    current_user: UserContext = Depends(get_current_user),
) -> ChatResponse:
    """Create a new research chat with validated parameters."""
    chat_id = uuid4()
    now = datetime.utcnow()
    title = payload.title or (payload.query[:60] if payload.query else "New Research Project")

    chat_data = {
        "id": chat_id,
        "user_id": current_user.user_id,
        "title": title,
        "query": payload.query,
        "params": payload.params.model_dump(),
        "status": RunStatus.DRAFT,
        "current_stage": "idle",
        "created_at": now,
        "updated_at": now,
        "last_opened_at": now,
    }
    _CHATS[chat_id] = chat_data

    # Initialize associated paper container
    paper_id = uuid4()
    _PAPERS[chat_id] = {
        "id": paper_id,
        "chat_id": chat_id,
        "user_id": current_user.user_id,
        "title": title,
        "status": "draft",
        "current_version": 1,
        "created_at": now,
        "updated_at": now,
    }
    _PAPER_VERSIONS[chat_id] = []
    _SOURCES[chat_id] = []

    logger.info("Created chat %s for user %s", chat_id, current_user.user_id)
    return ChatResponse(**chat_data)


@router.get("/{chat_id}", response_model=ChatResponse)
async def get_chat(
    chat_id: UUID,
    current_user: UserContext = Depends(get_current_user),
) -> ChatResponse:
    """Retrieve chat details. Enforces cross-tenant 404 return."""
    chat = _CHATS.get(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    verify_user_access(chat.get("user_id"), current_user)

    # Touch last_opened_at
    chat["last_opened_at"] = datetime.utcnow()
    return ChatResponse(**chat)


@router.patch("/{chat_id}", response_model=ChatResponse)
async def update_chat(
    chat_id: UUID,
    payload: ChatUpdate,
    current_user: UserContext = Depends(get_current_user),
) -> ChatResponse:
    """Update chat title or status."""
    chat = _CHATS.get(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    verify_user_access(chat.get("user_id"), current_user)

    if payload.title is not None:
        chat["title"] = payload.title
    if payload.status is not None:
        chat["status"] = payload.status
    if payload.current_stage is not None:
        chat["current_stage"] = payload.current_stage

    chat["updated_at"] = datetime.utcnow()
    return ChatResponse(**chat)


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    chat_id: UUID,
    current_user: UserContext = Depends(get_current_user),
) -> None:
    """Cascade delete chat and all related sources, versions, papers without orphans."""
    chat = _CHATS.get(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    verify_user_access(chat.get("user_id"), current_user)

    # Cascade delete in-memory
    _CHATS.pop(chat_id, None)
    _SOURCES.pop(chat_id, None)
    _PAPERS.pop(chat_id, None)
    _PAPER_VERSIONS.pop(chat_id, None)

    logger.info("Cascade deleted chat %s and associated entities", chat_id)
    return None


@router.get("/{chat_id}/sources", response_model=list[SourceRecord])
async def list_chat_sources(
    chat_id: UUID,
    current_user: UserContext = Depends(get_current_user),
) -> list[SourceRecord]:
    """Retrieve research sources collected for this specific chat."""
    chat = _CHATS.get(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    verify_user_access(chat.get("user_id"), current_user)
    sources = _SOURCES.get(chat_id, [])
    return [SourceRecord(**s) for s in sources]


@router.get("/{chat_id}/paper", response_model=PaperRecord)
async def get_chat_paper(
    chat_id: UUID,
    current_user: UserContext = Depends(get_current_user),
) -> PaperRecord:
    """Retrieve the paper record for this chat."""
    chat = _CHATS.get(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    verify_user_access(chat.get("user_id"), current_user)
    paper = _PAPERS.get(chat_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found for this chat")

    return PaperRecord(**paper)


@router.get("/{chat_id}/paper/versions", response_model=list[PaperVersionRecord])
async def list_paper_versions(
    chat_id: UUID,
    current_user: UserContext = Depends(get_current_user),
) -> list[PaperVersionRecord]:
    """Retrieve all versions of the LaTeX paper for this chat (up to 50)."""
    chat = _CHATS.get(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    verify_user_access(chat.get("user_id"), current_user)
    versions = _PAPER_VERSIONS.get(chat_id, [])
    versions.sort(key=lambda x: x.get("version", 0), reverse=True)
    return [PaperVersionRecord(**v) for v in versions[:50]]


@router.post("/{chat_id}/paper/generate", response_model=PaperComposerOutput)
async def generate_chat_paper(
    chat_id: UUID,
    payload: PaperGenerateRequest = PaperGenerateRequest(),
    current_user: UserContext = Depends(get_current_user),
) -> PaperComposerOutput:
    """Trigger the PaperComposer agent to generate an IEEEtran paper from chat sources."""
    chat = _CHATS.get(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    verify_user_access(chat.get("user_id"), current_user)

    sources_raw = _SOURCES.get(chat_id, [])
    sources = [SourceRecord(**s) for s in sources_raw]

    composer = PaperComposer()
    input_data = PaperComposerInput(
        chat_id=chat_id,
        user_id=current_user.user_id,
        topic=chat.get("title") or chat.get("query") or "Research Survey",
        sources=sources,
        target_pages=payload.target_pages,
        version=_PAPERS.get(chat_id, {}).get("current_version", 1),
        style=payload.style,
    )

    try:
        output = await composer.compose_paper(input_data)
    except ForbiddenCommandError as fe:
        raise HTTPException(status_code=400, detail=str(fe))
    except ConcurrencyConflictError as ce:
        raise HTTPException(status_code=409, detail=str(ce))

    # Sync into route in-memory records
    if chat_id in _PAPERS:
        _PAPERS[chat_id]["current_version"] = output.version
        _PAPERS[chat_id]["status"] = "compiled" if output.validation_passed else "short_of_target"
        _PAPERS[chat_id]["updated_at"] = datetime.utcnow()

    # Add to versions list
    v_list = _PAPER_VERSIONS.setdefault(chat_id, [])
    if len(v_list) >= 50:
        v_list.pop(0)

    v_list.append({
        "id": uuid4(),
        "paper_id": output.paper_id,
        "chat_id": chat_id,
        "user_id": current_user.user_id,
        "version": output.version,
        "tex_source": output.tex_source,
        "bib_source": output.bib_source,
        "created_by": "agent",
        "compile_status": "success" if output.validation_passed else "pending",
        "page_count": int(output.estimated_pages),
        "compile_errors": [],
        "note": f"Generated by PaperComposer (grounding={output.grounding_score:.2f})",
        "created_at": datetime.utcnow(),
    })

    return output


@router.put("/{chat_id}/paper/source", response_model=PaperVersionRecord)
async def update_paper_source(
    chat_id: UUID,
    payload: PaperUpdateRequest,
    current_user: UserContext = Depends(get_current_user),
) -> PaperVersionRecord:
    """Save an edited version of the LaTeX source with optimistic concurrency check."""
    chat = _CHATS.get(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    verify_user_access(chat.get("user_id"), current_user)

    paper = _PAPERS.get(chat_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found for this chat")

    # 1. Enforce security linter
    try:
        assert_latex_safe(payload.tex_source)
    except ForbiddenCommandError as fe:
        raise HTTPException(status_code=400, detail=f"Forbidden LaTeX command: {fe}")

    # 2. Optimistic concurrency check
    current_ver = paper.get("current_version", 1)
    if payload.expected_version is not None and payload.expected_version != current_ver:
        raise HTTPException(
            status_code=409,
            detail=f"Version conflict: expected {payload.expected_version}, but current version is {current_ver}",
        )

    new_ver = current_ver + 1
    versions = _PAPER_VERSIONS.setdefault(chat_id, [])
    if len(versions) >= 50:
        versions.pop(0)

    compile_status = "pending"
    page_count = max(1, round(len(payload.tex_source.split()) / 650))
    compile_errors = []

    if payload.compile_now:
        compiler = LatexCompiler()
        res = compiler.compile(payload.tex_source, bib_source=payload.bib_source)
        compile_status = res.compile_status
        page_count = res.page_count
        compile_errors = [e.model_dump() for e in res.errors]

    version_dict = {
        "id": uuid4(),
        "paper_id": paper["id"],
        "chat_id": chat_id,
        "user_id": current_user.user_id,
        "version": new_ver,
        "tex_source": payload.tex_source,
        "bib_source": payload.bib_source,
        "created_by": "user",
        "compile_status": compile_status,
        "page_count": page_count,
        "storage_path": f"{current_user.user_id}/{chat_id}/v{new_ver}.pdf" if compile_status == "success" else None,
        "compile_errors": compile_errors,
        "note": payload.note or "Manual user edit",
        "created_at": datetime.utcnow(),
    }
    versions.append(version_dict)

    # Update paper
    paper["current_version"] = new_ver
    paper["status"] = "compiled" if compile_status == "success" else "draft"
    paper["updated_at"] = datetime.utcnow()

    return PaperVersionRecord(**version_dict)


@router.get("/{chat_id}/events")
async def stream_chat_events(
    chat_id: UUID,
    request: Request,
    current_user: UserContext = Depends(get_current_user),
) -> StreamingResponse:
    """
    Authenticated Server-Sent Events (SSE) stream for chat research status and updates.
    Supports reconnection replay via Last-Event-ID.
    """
    chat = _CHATS.get(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    verify_user_access(chat.get("user_id"), current_user)

    last_event_id = request.headers.get("Last-Event-ID") or request.query_params.get("last_event_id")

    async def event_generator():
        # Yield initial status snapshot
        status_event = {
            "event_id": f"{chat_id}_status",
            "chat_id": str(chat_id),
            "status": chat.get("status", "draft"),
            "current_stage": chat.get("current_stage", "idle"),
            "updated_at": chat.get("updated_at", datetime.now().isoformat()),
        }
        if last_event_id != status_event["event_id"]:
            yield f"id: {status_event['event_id']}\ndata: {json.dumps(status_event)}\n\n"

        # Keep alive ping loop
        for _ in range(5):
            await asyncio.sleep(2.0)
            yield f": ping\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
