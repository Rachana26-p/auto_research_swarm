# Runbook: Supabase Database Outage (`instance_db_down`)

## 1. What `instance_db_down` Means
An `instance_db_down` alert or an Unhealthy Database state indicates that the PostgreSQL instance in your Supabase project is not accepting connections. This is typically caused by:
- Severe resource exhaustion (RAM/CPU spikes)
- Connection limit saturation (e.g. connecting via port `5432` rather than the Supavisor connection pooler on port `6543`)
- Crash recovery / WAL replay
- Platform-level maintenance or hardware migration

## 2. What the Application Does While the DB is Down
- **Backend Degraded Boot**: The FastAPI server boots up cleanly and remains running. It reports `status: degraded` on `GET /health/deep` with a 3s timeout.
- **Fast Failover (Circuit Breaker)**: The backend trips its internal Circuit Breaker to `OPEN`, immediately returning `503 Service Unavailable` with `Retry-After: 15` and code `DB_UNAVAILABLE`.
- **Run State Isolation (`paused_infra`)**: Any active research runs do NOT fail. They automatically transition to `paused_infra`, saving their state snapshot to local disk (`.langgraph_checkpoints/`).
- **Auto-Resumption**: A background monitor periodically probes `GET /health/deep`. As soon as Postgres recovers, all `paused_infra` runs resume execution from their last checkpoint with zero duplication.
- **Frontend Experience**: The Next.js dashboard displays a high-visibility global Bauhaus outage banner:
  `DATABASE UNAVAILABLE — SUPABASE INFRASTRUCTURE DOWN (AUTO-RETRYING IN X SECONDS)`
  with a manual "Retry Now" button. No blank screens or infinite spinners occur.

## 3. Step-by-Step Recovery Procedure
1. **Access Supabase Dashboard**:
   Navigate to [https://supabase.com/dashboard/project/_](https://supabase.com/dashboard/project/_).
2. **Inspect Project Health**:
   - Check the status indicator in the top navbar.
   - Go to **Reports** &rarr; **Database** to observe CPU, Memory, Disk IO, and active connection metrics.
3. **Trigger a Project / Database Restart**:
   - Navigate to **Project Settings** (the gear icon on the left sidebar).
   - Click on **General** (or **Database**).
   - Click **Restart project** (or **Restart database**).
   - Wait 2–3 minutes while the instance restarts and runs recovery checks.
4. **Verify Application Recovery**:
   - Query the backend deep health endpoint:
     ```bash
     curl -i http://localhost:8000/health/deep
     ```
   - Expect:
     ```json
     {"status": "ok", "db": "reachable", "auth": "reachable"}
     ```
   - The frontend banner will dismiss automatically, and all `paused_infra` runs will resume.

## 4. Preventing Future Outages
- Always configure the **Supavisor pooled connection string** (port `6543`, transaction mode) for high-concurrency environments rather than direct connections (port `5432`).
- Monitor database size and upgrade compute resources if research swarm indexing exceeds the 500MB free-tier allocation.
