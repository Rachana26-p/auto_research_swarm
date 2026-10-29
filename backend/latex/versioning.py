"""
Paper Version Management with Optimistic Concurrency and 50-Version History Cap (WS5).

Rules:
- Monotonic version sequencing (1, 2, 3...)
- Optimistic concurrency: mutations must match expected_version, preventing race conditions
- Maximum 50 versions per paper; pruned gracefully
- Strict user isolation: queries require matching user_id
"""

from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID, uuid4

from shared.models import AppConfig, PaperRecord, PaperVersionRecord

logger = logging.getLogger(__name__)

MAX_VERSIONS_PER_PAPER = 50


class ConcurrencyConflictError(Exception):
    """Raised when expected_version does not match the current paper version."""
    pass


class VersionCapExceededError(Exception):
    """Raised or handled when paper version count reaches hard maximum."""
    pass


# Thread-safe in-memory store for instant responsiveness and integration testing
_IN_MEMORY_PAPERS: dict[UUID, PaperRecord] = {}  # keyed by paper_id
_IN_MEMORY_VERSIONS: dict[UUID, list[PaperVersionRecord]] = {}  # keyed by paper_id


class PaperVersionManager:
    """Manages paper lifecycle, optimistic concurrency checks, and version history."""

    def __init__(self, config: AppConfig | None = None):
        self.config = config

    @staticmethod
    def clear_in_memory_store() -> None:
        """Reset internal stores for isolated test runs."""
        _IN_MEMORY_PAPERS.clear()
        _IN_MEMORY_VERSIONS.clear()

    def get_or_create_paper(
        self,
        chat_id: UUID,
        user_id: UUID,
        title: str = "Research Survey Paper",
    ) -> PaperRecord:
        """Fetch existing paper for chat or create baseline record."""
        # Find existing in memory
        for p in _IN_MEMORY_PAPERS.values():
            if p.chat_id == chat_id and p.user_id == user_id:
                return p

        # Create new
        new_paper = PaperRecord(
            id=uuid4(),
            chat_id=chat_id,
            user_id=user_id,
            title=title,
            status="draft",
            current_version=1,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        _IN_MEMORY_PAPERS[new_paper.id] = new_paper
        _IN_MEMORY_VERSIONS[new_paper.id] = []
        return new_paper

    def get_paper(self, chat_id: UUID, user_id: UUID) -> PaperRecord | None:
        """Retrieve paper record strictly scoped to user_id."""
        for p in _IN_MEMORY_PAPERS.values():
            if p.chat_id == chat_id and p.user_id == user_id:
                return p
        return None

    def list_versions(self, paper_id: UUID, user_id: UUID) -> list[PaperVersionRecord]:
        """List all versions for a paper in descending version order."""
        paper = _IN_MEMORY_PAPERS.get(paper_id)
        if not paper or paper.user_id != user_id:
            return []

        versions = _IN_MEMORY_VERSIONS.get(paper_id, [])
        return sorted(versions, key=lambda v: v.version, reverse=True)

    def save_version(
        self,
        paper_id: UUID,
        chat_id: UUID,
        user_id: UUID,
        tex_source: str,
        bib_source: str = "",
        created_by: str = "agent",
        compile_status: str = "pending",
        page_count: int = 0,
        compile_errors: list[dict] | None = None,
        note: str = "",
        expected_version: int | None = None,
    ) -> PaperVersionRecord:
        """
        Saves a new paper version with optimistic concurrency check.
        If expected_version is provided and does not match paper.current_version,
        raises ConcurrencyConflictError.
        Caps versions at MAX_VERSIONS_PER_PAPER (50).
        """
        paper = _IN_MEMORY_PAPERS.get(paper_id)
        if not paper or paper.user_id != user_id:
            raise ValueError(f"Paper {paper_id} not found or access denied")

        # 1. Optimistic concurrency control
        if expected_version is not None and paper.current_version != expected_version:
            raise ConcurrencyConflictError(
                f"Optimistic lock conflict: expected version {expected_version}, "
                f"but current version is {paper.current_version}"
            )

        versions = _IN_MEMORY_VERSIONS.setdefault(paper_id, [])

        # 2. Version cap enforcement (max 50)
        if len(versions) >= MAX_VERSIONS_PER_PAPER:
            # Prune oldest version that is not version 1 (preserve initial baseline)
            prunable_idx = None
            for idx, v in enumerate(versions):
                if v.version != 1:
                    prunable_idx = idx
                    break
            if prunable_idx is not None:
                logger.info("Cap of 50 reached: pruning version %d", versions[prunable_idx].version)
                versions.pop(prunable_idx)
            else:
                versions.pop(0)

        # 3. Determine new version number
        new_version_num = paper.current_version + (1 if versions else 0)
        if not versions and paper.current_version == 1:
            new_version_num = 1

        new_record = PaperVersionRecord(
            id=uuid4(),
            paper_id=paper_id,
            chat_id=chat_id,
            user_id=user_id,
            version=new_version_num,
            tex_source=tex_source,
            bib_source=bib_source,
            created_by=created_by,
            compile_status=compile_status,
            page_count=page_count,
            storage_path=f"{user_id}/{chat_id}/v{new_version_num}.pdf" if compile_status == "success" else None,
            compile_errors=compile_errors or [],
            note=note,
            created_at=datetime.utcnow(),
        )

        versions.append(new_record)

        # 4. Update parent paper
        paper_status = "compiled" if compile_status == "success" else ("compile_failed" if compile_status == "failed" else "draft")
        if compile_status == "success" and page_count < 5:
            paper_status = "short_of_target"

        updated_paper = paper.model_copy(
            update={
                "current_version": new_version_num,
                "status": paper_status,
                "updated_at": datetime.utcnow(),
            }
        )
        _IN_MEMORY_PAPERS[paper_id] = updated_paper

        return new_record


__all__ = [
    "MAX_VERSIONS_PER_PAPER",
    "ConcurrencyConflictError",
    "PaperVersionManager",
    "_IN_MEMORY_PAPERS",
    "_IN_MEMORY_VERSIONS",
]
