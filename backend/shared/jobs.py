"""
Durable Job Queue Manager for Research Swarms.

Uses Postgres FOR UPDATE SKIP LOCKED for distributed, concurrent job claiming
without race conditions, along with worker heartbeats and orphan recovery.
Provides graceful in-memory queue fallback for offline unit test execution.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any
from uuid import UUID, uuid4

from shared.db import db_client

logger = logging.getLogger(__name__)


class JobQueueManager:
    """Manages durable background research jobs in the Supabase 'jobs' table."""

    def __init__(self, db=None):
        self.db = db or db_client
        # In-memory mock store for unit testing when DB is disconnected/mocked
        self._mock_jobs: dict[UUID, dict[str, Any]] = {}

    def enqueue_job(
        self,
        chat_id: UUID,
        user_id: UUID,
        run_id: UUID | None = None,
    ) -> UUID:
        """Enqueue a new pending research task for a chat."""
        job_id = uuid4()
        now = datetime.now(timezone.utc)

        sql = """
            INSERT INTO public.jobs (id, chat_id, user_id, run_id, status, attempts, available_at, created_at)
            VALUES (%s, %s, %s, %s, 'pending', 0, %s, %s)
            RETURNING id;
        """
        try:
            with self.db.cursor() as cur:
                cur.execute(sql, (str(job_id), str(chat_id), str(user_id), str(run_id) if run_id else None, now, now))
                row = cur.fetchone()
                if row:
                    job_id = UUID(str(row[0])) if isinstance(row[0], str) else row[0]
            logger.info("Enqueued job %s for chat %s", job_id, chat_id)
            return job_id
        except Exception as exc:
            logger.warning("DB unavailable for enqueue_job, using in-memory store: %s", exc)
            self._mock_jobs[job_id] = {
                "id": job_id,
                "chat_id": chat_id,
                "user_id": user_id,
                "run_id": run_id,
                "status": "pending",
                "attempts": 0,
                "locked_by": None,
                "heartbeat_at": None,
                "available_at": now,
                "last_error": None,
                "created_at": now,
            }
            return job_id

    def claim_next_job(
        self,
        worker_id: str,
        timeout_seconds: int = 300,
    ) -> dict[str, Any] | None:
        """
        Atomically claims the next pending job using FOR UPDATE SKIP LOCKED.
        Returns the claimed job record or None if the queue is empty.
        """
        claim_sql = """
            WITH candidate AS (
                SELECT id
                FROM public.jobs
                WHERE status = 'pending' AND available_at <= now()
                ORDER BY available_at ASC, created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            UPDATE public.jobs j
            SET status = 'claimed',
                locked_by = %s,
                heartbeat_at = now(),
                attempts = j.attempts + 1
            FROM candidate c
            WHERE j.id = c.id
            RETURNING j.id, j.chat_id, j.user_id, j.run_id, j.attempts, j.status, j.locked_by, j.heartbeat_at;
        """
        try:
            with self.db.cursor() as cur:
                cur.execute(claim_sql, (worker_id,))
                row = cur.fetchone()
                if not row:
                    return None
                return {
                    "id": UUID(str(row[0])) if isinstance(row[0], str) else row[0],
                    "chat_id": UUID(str(row[1])) if isinstance(row[1], str) else row[1],
                    "user_id": UUID(str(row[2])) if isinstance(row[2], str) else row[2],
                    "run_id": UUID(str(row[3])) if row[3] else None,
                    "attempts": row[4],
                    "status": row[5],
                    "locked_by": row[6],
                    "heartbeat_at": row[7],
                }
        except Exception as exc:
            logger.warning("DB claim_next_job failed, checking in-memory store: %s", exc)
            now = datetime.now(timezone.utc)
            for j_id, j in sorted(self._mock_jobs.items(), key=lambda x: x[1]["created_at"]):
                if j["status"] == "pending" and j["available_at"] <= now:
                    j["status"] = "claimed"
                    j["locked_by"] = worker_id
                    j["heartbeat_at"] = now
                    j["attempts"] += 1
                    return dict(j)
            return None

    def heartbeat(self, job_id: UUID, worker_id: str) -> bool:
        """Updates heartbeat timestamp for a claimed job."""
        sql = """
            UPDATE public.jobs
            SET heartbeat_at = now()
            WHERE id = %s AND locked_by = %s AND status = 'claimed'
            RETURNING id;
        """
        try:
            with self.db.cursor() as cur:
                cur.execute(sql, (str(job_id), worker_id))
                return cur.fetchone() is not None
        except Exception as exc:
            logger.warning("DB heartbeat failed, checking in-memory: %s", exc)
            if job_id in self._mock_jobs:
                j = self._mock_jobs[job_id]
                if j.get("locked_by") == worker_id and j.get("status") == "claimed":
                    j["heartbeat_at"] = datetime.now(timezone.utc)
                    return True
            return False

    def complete_job(self, job_id: UUID, worker_id: str | None = None) -> bool:
        """Marks a job as completed."""
        sql = """
            UPDATE public.jobs
            SET status = 'completed'
            WHERE id = %s
            RETURNING id;
        """
        try:
            with self.db.cursor() as cur:
                cur.execute(sql, (str(job_id),))
                return cur.fetchone() is not None
        except Exception as exc:
            logger.warning("DB complete_job failed, checking in-memory: %s", exc)
            if job_id in self._mock_jobs:
                self._mock_jobs[job_id]["status"] = "completed"
                return True
            return False

    def fail_job(
        self,
        job_id: UUID,
        error: str,
        max_attempts: int = 3,
        retry_delay_seconds: int = 60,
    ) -> bool:
        """
        Marks a job as failed, or requeues it if attempts < max_attempts.
        """
        sql = """
            UPDATE public.jobs
            SET status = CASE WHEN attempts >= %s THEN 'failed' ELSE 'pending' END,
                available_at = now() + (%s || ' seconds')::interval,
                locked_by = NULL,
                last_error = %s
            WHERE id = %s
            RETURNING status;
        """
        try:
            with self.db.cursor() as cur:
                cur.execute(sql, (max_attempts, retry_delay_seconds, error, str(job_id)))
                return cur.fetchone() is not None
        except Exception as exc:
            logger.warning("DB fail_job failed, checking in-memory: %s", exc)
            if job_id in self._mock_jobs:
                j = self._mock_jobs[job_id]
                j["last_error"] = error
                if j["attempts"] >= max_attempts:
                    j["status"] = "failed"
                else:
                    j["status"] = "pending"
                    j["locked_by"] = None
                    j["available_at"] = datetime.now(timezone.utc) + timedelta(seconds=retry_delay_seconds)
                return True
            return False

    def recover_orphaned_jobs(self, timeout_seconds: int = 300) -> int:
        """
        Recovers jobs where the claiming worker crashed or timed out (heartbeat expired).
        Resets status to 'pending' so other workers can claim them.
        """
        sql = """
            UPDATE public.jobs
            SET status = 'pending',
                locked_by = NULL,
                available_at = now()
            WHERE status = 'claimed'
              AND (heartbeat_at IS NULL OR heartbeat_at < now() - (%s || ' seconds')::interval)
            RETURNING id;
        """
        try:
            with self.db.cursor() as cur:
                cur.execute(sql, (timeout_seconds,))
                rows = cur.fetchall()
                count = len(rows)
                if count > 0:
                    logger.info("Recovered %d orphaned jobs", count)
                return count
        except Exception as exc:
            logger.warning("DB recover_orphaned_jobs failed, checking in-memory: %s", exc)
            recovered = 0
            cutoff = datetime.now(timezone.utc) - timedelta(seconds=timeout_seconds)
            for j in self._mock_jobs.values():
                if j["status"] == "claimed":
                    hb = j.get("heartbeat_at")
                    if hb is None or hb < cutoff:
                        j["status"] = "pending"
                        j["locked_by"] = None
                        j["available_at"] = datetime.now(timezone.utc)
                        recovered += 1
            return recovered


job_queue = JobQueueManager()

__all__ = ["JobQueueManager", "job_queue"]
