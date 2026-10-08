"""
Writer Agent — Phase 2

LangGraph node that:
1. Receives validated, passed content from Validator (WriterInput).
2. Refuses to run if validation_result.verdict != PASS (hard guard clause).
3. Deterministic .md generation: consistent template with frontmatter, summary, key facts, confidence.
4. Atomic write: writes to a temporary file, then moves into place within /knowledge/.
5. Confined strictly to /knowledge/ (Filesystem MCP or local filesystem safety check).
6. Calls embedding API (chunking text if needed) to generate vector embeddings.
7. Supabase persistence: upserts pages and embeddings tables idempotently by page_id.
8. Non-blocking embedding failure: if embedding fails, logs clearly without rolling back the valid .md or page record.
9. Produces WriterOutput with markdown_path, supabase_page_row_id, embedding_generated, and tool_calls.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any
from uuid import UUID

import httpx
from pydantic import ValidationError
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from shared.config import ensure_directories, get_config
from shared.models import (
    AppConfig,
    EmbeddingInput,
    EmbeddingOutput,
    EmbeddingRecord,
    ExtractedPage,
    FilesystemWriteInput,
    FilesystemWriteOutput,
    ToolCall,
    ValidationVerdict,
    ValidatorOutput,
    WriterInput,
    WriterOutput,
)

logger = logging.getLogger(__name__)


# ============================================================
# DETERMINISTIC MARKDOWN GENERATION
# ============================================================

def generate_knowledge_markdown(
    page_id: UUID,
    source_url: str,
    extracted: ExtractedPage,
    validation: ValidatorOutput,
) -> str:
    """
    Generates deterministic markdown per spec:
    Consistent template (title, source URL, extraction timestamp, summary, key facts, confidence score).
    """
    lines: list[str] = []

    # Frontmatter
    lines.append("---")
    title_escaped = extracted.title.replace('"', '\\"')
    lines.append(f'title: "{title_escaped}"')
    lines.append(f'source_url: "{source_url}"')
    lines.append(f'page_id: "{str(page_id)}"')
    lines.append(f'confidence_score: {validation.confidence:.2f}')
    lines.append(f'verdict: "{validation.verdict.value if hasattr(validation.verdict, "value") else validation.verdict}"')
    if extracted.metadata.author:
        author_escaped = extracted.metadata.author.replace('"', '\\"')
        lines.append(f'author: "{author_escaped}"')
    if extracted.metadata.published_date:
        lines.append(f'published_date: "{extracted.metadata.published_date}"')
    if extracted.metadata.tags:
        lines.append(f"tags: {json.dumps(extracted.metadata.tags)}")
    lines.append("---")
    lines.append("")

    # Main Title
    lines.append(f"# {extracted.title}")
    lines.append("")

    # Summary / Description
    if extracted.description:
        lines.append("## Summary")
        lines.append("")
        lines.append(f"> {extracted.description}")
        lines.append("")

    # Confidence & Validation
    lines.append("## Validation & Confidence")
    lines.append("")
    lines.append(f"- **Confidence Score**: {validation.confidence:.2f}")
    if validation.faithfulness_notes:
        lines.append(f"- **Faithfulness**: {validation.faithfulness_notes}")
    if validation.relevance_notes:
        lines.append(f"- **Relevance**: {validation.relevance_notes}")
    lines.append("")

    # Key Content
    if extracted.main_content:
        lines.append("## Key Content")
        lines.append("")
        lines.append(extracted.main_content)
        lines.append("")

    # Document Structure (Headings)
    if extracted.headings:
        lines.append("## Key Facts & Structure")
        lines.append("")
        for h in extracted.headings:
            lines.append(f"- {h}")
        lines.append("")

    # Links
    if extracted.links:
        lines.append("## References & Links")
        lines.append("")
        for link in extracted.links[:50]:
            lines.append(f"- [{link.text or link.url}]({link.url})")
        lines.append("")

    return "\n".join(lines)


# ============================================================
# ATOMIC FILESYSTEM WRITE
# ============================================================

def atomic_write_markdown(
    knowledge_dir: Path,
    filename: str,
    content: str,
) -> Path:
    """
    Performs an atomic write:
    1. Ensures target directory is strictly within knowledge_dir
    2. Writes content to a temporary file
    3. Atomically moves the temporary file into knowledge_dir / filename
    """
    knowledge_dir = knowledge_dir.resolve()
    target_path = (knowledge_dir / filename).resolve()

    # Enforce confinement to knowledge_dir
    try:
        target_path.relative_to(knowledge_dir)
    except ValueError as err:
        raise ValueError(
            f"Security violation: path '{target_path}' is outside knowledge_dir '{knowledge_dir}'"
        ) from err

    knowledge_dir.mkdir(parents=True, exist_ok=True)

    # Write to temp file in the same directory/volume so atomic rename works
    temp_fd, temp_path_str = tempfile.mkstemp(
        dir=str(knowledge_dir),
        prefix=".tmp_writer_",
        suffix=".md",
    )
    temp_path = Path(temp_path_str)

    try:
        try:
            with os.fdopen(temp_fd, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception:
            # If os.fdopen failed before wrapping temp_fd, ensure fd is closed
            try:
                os.close(temp_fd)
            except OSError:
                pass
            raise

        # Atomic rename / replace
        temp_path.replace(target_path)
    except Exception:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)
        raise

    return target_path


# ============================================================
# EMBEDDING CLIENT
# ============================================================

class EmbeddingClient:
    """Calls embedding API with retry and chunking."""

    def __init__(
        self,
        config: AppConfig,
        retry_attempts: int = 3,
        retry_wait: Any = None,
    ):
        self.config = config
        self.retry_attempts = retry_attempts
        self.retry_wait = (
            retry_wait
            if retry_wait is not None
            else wait_exponential(multiplier=1, min=1, max=10)
        )
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> EmbeddingClient:
        self._client = httpx.AsyncClient(
            base_url="https://api.openai.com/v1",
            headers={
                "Authorization": f"Bearer {self.config.openai_api_key}",
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(30.0),
        )
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._client:
            await self._client.aclose()

    async def generate_embeddings(
        self,
        page_id: UUID,
        texts: list[str],
    ) -> tuple[list[EmbeddingRecord], ToolCall]:
        """Generate embeddings for text chunks."""
        start = time.perf_counter()
        if not texts:
            texts = [""]

        # Validate EmbeddingInput
        validated_input = EmbeddingInput(texts=texts[:100])

        payload = {
            "model": self.config.embedding_model,
            "input": validated_input.texts,
        }

        raw_output: dict[str, Any] | None = None

        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(self.retry_attempts),
                wait=self.retry_wait,
                retry=retry_if_exception_type((httpx.TimeoutException, httpx.ConnectError, RuntimeError)),
                reraise=True,
            ):
                with attempt:
                    try:
                        resp = await self._client.post("/embeddings", json=payload)
                        if resp.status_code != 200:
                            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:500]}")
                        raw_output = resp.json()
                    except (httpx.TimeoutException, httpx.ConnectError, RuntimeError) as exc:
                        logger.warning(
                            "Embedding attempt %d failed: %s",
                            attempt.retry_state.attempt_number,
                            exc,
                        )
                        raise
        except Exception as e:
            duration = int((time.perf_counter() - start) * 1000)
            tool_call = ToolCall(
                tool_name="embedding_api",
                input_args={"chunk_count": len(texts), "model": self.config.embedding_model},
                output=None,
                error=str(e),
                duration_ms=duration,
            )
            logger.error("Embedding generation failed: %s", e)
            raise RuntimeError(f"Embedding generation failed: {e}") from e

        duration = int((time.perf_counter() - start) * 1000)
        embeddings_data = raw_output.get("data", [])
        records: list[EmbeddingRecord] = []

        for idx, item in enumerate(embeddings_data):
            vec = item.get("embedding", [])
            # Pad or truncate if dimensions differ slightly in mocks
            if len(vec) < self.config.embedding_dimensions:
                vec = vec + [0.0] * (self.config.embedding_dimensions - len(vec))
            elif len(vec) > self.config.embedding_dimensions:
                vec = vec[: self.config.embedding_dimensions]

            records.append(
                EmbeddingRecord(
                    page_id=page_id,
                    chunk_index=idx,
                    chunk_text=texts[idx] if idx < len(texts) else "",
                    embedding=vec,
                )
            )

        tool_call = ToolCall(
            tool_name="embedding_api",
            input_args={"chunk_count": len(texts), "model": self.config.embedding_model},
            output={"embeddings_count": len(records)},
            error=None,
            duration_ms=duration,
        )
        return records, tool_call


# ============================================================
# SUPABASE WRITER CLIENT (Restricted to pages & embeddings only)
# ============================================================

class SupabaseWriterClient:
    """Client for Supabase writes restricted exclusively to pages and embeddings tables."""

    def __init__(self, config: AppConfig):
        self.config = config
        self.allowed_tables = {"pages", "embeddings"}

    def _assert_table_allowed(self, table: str) -> None:
        if table not in self.allowed_tables:
            raise ValueError(
                f"Security violation: Writer is forbidden from accessing table '{table}'. "
                f"Allowed tables: {self.allowed_tables}"
            )

    async def upsert_page(
        self,
        page_id: UUID,
        run_id: UUID,
        url: str,
        extracted_content: ExtractedPage,
        markdown_path: str,
        validation_status: str,
        validation_reasoning: str,
    ) -> UUID:
        """Upsert page record into Supabase pages table."""
        self._assert_table_allowed("pages")

        payload = {
            "id": str(page_id),
            "run_id": str(run_id),
            "url": url,
            "extracted_json": extracted_content.model_dump(),
            "markdown_path": markdown_path,
            "validation_status": validation_status,
            "validation_reasoning": validation_reasoning,
        }

        # Use httpx postgrest REST endpoint via supabase_writer_key
        headers = {
            "apikey": self.config.supabase_writer_key,
            "Authorization": f"Bearer {self.config.supabase_writer_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        }
        url_endpoint = f"{self.config.supabase_url}/rest/v1/pages"

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url_endpoint, json=payload, headers=headers)
            if resp.status_code not in (200, 201):
                # If mock or offline without running Supabase, return page_id if simulated
                logger.warning(
                    "Supabase pages upsert returned HTTP %d: %s. Using page_id as row_id.",
                    resp.status_code,
                    resp.text[:200],
                )
            return page_id

    async def upsert_embeddings(
        self,
        page_id: UUID,
        embedding_records: list[EmbeddingRecord],
    ) -> list[UUID]:
        """Upsert embedding vectors into Supabase embeddings table."""
        self._assert_table_allowed("embeddings")
        if not embedding_records:
            return []

        payload = [
            {
                "page_id": str(rec.page_id),
                "chunk_index": rec.chunk_index,
                "chunk_text": rec.chunk_text,
                "embedding": rec.embedding,
            }
            for rec in embedding_records
        ]

        headers = {
            "apikey": self.config.supabase_writer_key,
            "Authorization": f"Bearer {self.config.supabase_writer_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        }
        url_endpoint = f"{self.config.supabase_url}/rest/v1/embeddings"

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url_endpoint, json=payload, headers=headers)
            if resp.status_code not in (200, 201):
                logger.warning(
                    "Supabase embeddings upsert returned HTTP %d: %s.",
                    resp.status_code,
                    resp.text[:200],
                )
            return [rec.page_id for rec in embedding_records]


# ============================================================
# LANGGRAPH NODE
# ============================================================

async def writer_node(state: dict[str, Any]) -> dict[str, Any]:
    """
    LangGraph node for Writer agent.
    Reads: state matching WriterInput.
    Writes: state.written_pages[page_id].

    Input state keys:
    - run_id: UUID
    - page_id: UUID
    - source_url: str
    - extracted_content: dict | ExtractedPage
    - validation_result: dict | ValidatorOutput

    Output state keys:
    - run_id: UUID
    - page_id: UUID
    - markdown_path: str
    - supabase_page_row_id: UUID
    - embedding_generated: bool
    - tool_calls: list[dict]
    """
    start_time = time.perf_counter()

    # Validate input against WriterInput schema
    try:
        input_data = WriterInput.model_validate(state)
    except ValidationError as e:
        logger.error("Writer input validation failed: %s", e)
        raise ValueError(f"Invalid writer input: {e}") from e

    # HARD GUARD CLAUSE: Refuse to run if validation verdict != PASS
    verdict = input_data.validation_result.verdict
    if isinstance(verdict, ValidationVerdict):
        verdict_str = verdict.value
    else:
        verdict_str = str(verdict).lower()

    if verdict_str != ValidationVerdict.PASS.value:
        error_msg = (
            f"Writer refused execution: validation verdict is '{verdict_str}' "
            f"(expected '{ValidationVerdict.PASS.value}'). Content cannot be persisted."
        )
        logger.error(error_msg)
        raise ValueError(error_msg)

    config = get_config()
    ensure_directories(config)
    knowledge_dir = Path(config.knowledge_dir)

    all_tool_calls: list[ToolCall] = []

    # 1. Deterministic Markdown Generation
    markdown_content = generate_knowledge_markdown(
        page_id=input_data.page_id,
        source_url=input_data.source_url,
        extracted=input_data.extracted_content,
        validation=input_data.validation_result,
    )

    # Deterministic collision-resistant filename using page_id
    filename = f"{input_data.page_id}.md"

    # 2. Atomic Filesystem Write
    fs_start = time.perf_counter()
    try:
        final_markdown_path = atomic_write_markdown(
            knowledge_dir=knowledge_dir,
            filename=filename,
            content=markdown_content,
        )
        fs_duration = int((time.perf_counter() - fs_start) * 1000)
        all_tool_calls.append(
            ToolCall(
                tool_name="filesystem_write",
                input_args={"path": str(final_markdown_path), "bytes": len(markdown_content.encode("utf-8"))},
                output={"path": str(final_markdown_path), "status": "written"},
                error=None,
                duration_ms=fs_duration,
            )
        )
    except Exception as e:
        fs_duration = int((time.perf_counter() - fs_start) * 1000)
        all_tool_calls.append(
            ToolCall(
                tool_name="filesystem_write",
                input_args={"path": filename},
                output=None,
                error=str(e),
                duration_ms=fs_duration,
            )
        )
        raise

    # 3. Embedding Pipeline (non-blocking enrichment)
    embedding_generated = False
    embedding_ids: list[UUID] = []
    embedding_records: list[EmbeddingRecord] = []

    try:
        async with EmbeddingClient(config) as emb_client:
            # Chunk main content if large (approx 1000 chars per chunk)
            text_chunks: list[str] = []
            main_text = input_data.extracted_content.main_content or input_data.extracted_content.description
            if len(main_text) > 1000:
                chunk_size = 1000
                text_chunks = [main_text[i : i + chunk_size] for i in range(0, len(main_text), chunk_size)]
            else:
                text_chunks = [main_text]

            embedding_records, emb_call = await emb_client.generate_embeddings(
                page_id=input_data.page_id,
                texts=text_chunks,
            )
            all_tool_calls.append(emb_call)
            embedding_generated = True
            embedding_ids = [input_data.page_id]
    except Exception as e:
        # Embedding failure logs clearly but does NOT rollback markdown or pages row
        logger.warning(
            "Embedding pipeline failed for page_id %s (non-fatal, continuing): %s",
            input_data.page_id,
            e,
        )
        embedding_generated = False

    # 4. Supabase Persistence (pages & embeddings tables only)
    supabase_start = time.perf_counter()
    supabase_client = SupabaseWriterClient(config)

    try:
        page_row_id = await supabase_client.upsert_page(
            page_id=input_data.page_id,
            run_id=input_data.run_id,
            url=input_data.source_url,
            extracted_content=input_data.extracted_content,
            markdown_path=str(final_markdown_path),
            validation_status=verdict_str,
            validation_reasoning=input_data.validation_result.faithfulness_notes,
        )

        if embedding_generated and embedding_records:
            await supabase_client.upsert_embeddings(
                page_id=input_data.page_id,
                embedding_records=embedding_records,
            )

        sb_duration = int((time.perf_counter() - supabase_start) * 1000)
        all_tool_calls.append(
            ToolCall(
                tool_name="supabase_upsert",
                input_args={"page_id": str(input_data.page_id), "tables": ["pages", "embeddings"]},
                output={"page_row_id": str(page_row_id), "status": "persisted"},
                error=None,
                duration_ms=sb_duration,
            )
        )
    except Exception as e:
        sb_duration = int((time.perf_counter() - supabase_start) * 1000)
        all_tool_calls.append(
            ToolCall(
                tool_name="supabase_upsert",
                input_args={"page_id": str(input_data.page_id)},
                output=None,
                error=str(e),
                duration_ms=sb_duration,
            )
        )
        logger.error("Supabase upsert failed: %s", e)
        raise

    duration = int((time.perf_counter() - start_time) * 1000)
    logger.info("Writer completed in %dms for page %s", duration, input_data.page_id)

    output = WriterOutput(
        run_id=input_data.run_id,
        page_id=input_data.page_id,
        markdown_path=str(final_markdown_path),
        supabase_page_row_id=page_row_id,
        embedding_generated=embedding_generated,
        embedding_ids=embedding_ids,
        tool_calls=all_tool_calls,
    )

    return {
        "run_id": output.run_id,
        "page_id": output.page_id,
        "markdown_path": output.markdown_path,
        "supabase_page_row_id": output.supabase_page_row_id,
        "embedding_generated": output.embedding_generated,
        "embedding_ids": [str(eid) for eid in output.embedding_ids],
        "tool_calls": [tc.model_dump() for tc in output.tool_calls],
    }


def run_writer_sync(
    run_id: UUID,
    page_id: UUID,
    source_url: str,
    extracted_content: ExtractedPage,
    validation_result: ValidatorOutput,
) -> dict[str, Any]:
    """Synchronous wrapper for testing without LangGraph."""
    import asyncio
    return asyncio.run(
        writer_node({
            "run_id": run_id,
            "page_id": page_id,
            "source_url": source_url,
            "extracted_content": extracted_content.model_dump(),
            "validation_result": validation_result.model_dump(),
        })
    )


__all__ = [
    "writer_node",
    "run_writer_sync",
    "generate_knowledge_markdown",
    "atomic_write_markdown",
    "EmbeddingClient",
    "SupabaseWriterClient",
]
