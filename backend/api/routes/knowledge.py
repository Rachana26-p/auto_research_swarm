"""
Routes for querying persisted knowledge base articles.
"""

from __future__ import annotations

from pathlib import Path
import re
from fastapi import APIRouter, Depends, HTTPException

from api.deps import verify_api_key
from api.models import KnowledgePageDetail, KnowledgePageSummary
from shared.config import get_config

router = APIRouter(prefix="/knowledge", tags=["knowledge"], dependencies=[Depends(verify_api_key)])


def _find_page_file(knowledge_dir: Path, page_id: str) -> Path | None:
    """Locate a markdown file matching page_id either exactly or as a suffix."""
    clean_id = page_id.strip().lower()
    if not knowledge_dir.exists():
        return None

    for p in knowledge_dir.glob("*.md"):
        stem = p.stem.lower()
        if clean_id in stem or stem == clean_id:
            return p
    return None


@router.get("", response_model=list[KnowledgePageSummary])
async def list_knowledge_pages() -> list[KnowledgePageSummary]:
    """List all persisted markdown research summaries in the knowledge base."""
    try:
        config = get_config()
        k_dir = Path(config.knowledge_dir)
    except Exception:
        k_dir = Path("./knowledge")

    if not k_dir.exists():
        return []

    summaries = []
    for file_path in k_dir.glob("*.md"):
        # Derive page_id and title from file
        stem = file_path.stem
        # Extract title from first line or filename
        title = stem.replace("_", " ").title()
        try:
            content = file_path.read_text(encoding="utf-8")
            match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
            if match:
                title = match.group(1).strip()
        except Exception:
            pass

        summaries.append(
            KnowledgePageSummary(
                page_id=stem,
                title=title,
                filename=file_path.name,
                size_bytes=file_path.stat().st_size,
            )
        )
    return summaries


@router.get("/{page_id}", response_model=KnowledgePageDetail)
async def get_knowledge_page(page_id: str) -> KnowledgePageDetail:
    """Retrieve full content and metadata for a specific knowledge base page."""
    try:
        config = get_config()
        k_dir = Path(config.knowledge_dir)
    except Exception:
        k_dir = Path("./knowledge")
    target_file = _find_page_file(k_dir, page_id)

    if not target_file or not target_file.exists():
        raise HTTPException(status_code=404, detail=f"Knowledge page '{page_id}' not found")

    content = target_file.read_text(encoding="utf-8")
    title = target_file.stem.replace("_", " ").title()
    match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    if match:
        title = match.group(1).strip()

    return KnowledgePageDetail(
        page_id=page_id,
        title=title,
        filename=target_file.name,
        content=content,
        metadata={"file_path": str(target_file)},
    )
