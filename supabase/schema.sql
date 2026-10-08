-- Supabase Schema for Autonomous Research Swarm
-- Run this in Supabase SQL Editor after creating the project
-- Enable required extensions

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ============================================================
-- ENUMS
-- ============================================================

create type run_status as enum ('pending', 'running', 'completed', 'failed');
create type validation_status as enum ('pending', 'passed', 'failed', 'uncertain');
create type log_status as enum ('success', 'failed', 'retry');
create type guardrail_event_type as enum (
    'tool_schema_violation',
    'content_sanitization',
    'egress_blocked',
    'validation_failed'
);

-- ============================================================
-- TABLES
-- ============================================================

-- runs: Top-level research run metadata
create table runs (
    id uuid primary key default uuid_generate_v4(),
    goal text not null,
    status run_status not null default 'pending',
    config jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    updated_at timestamptz not null default now()
);

create index idx_runs_status on runs(status);
create index idx_runs_created_at on runs(created_at desc);

-- pages: One row per URL processed in a run
create table pages (
    id uuid primary key default uuid_generate_v4(),
    run_id uuid not null references runs(id) on delete cascade,
    url text not null,
    extracted_json jsonb,
    markdown_path text,
    validation_status validation_status not null default 'pending',
    validation_reasoning text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (run_id, url)
);

create index idx_pages_run_id on pages(run_id);
create index idx_pages_validation_status on pages(validation_status);

-- agent_logs: Full audit trail of every agent decision and tool call
create table agent_logs (
    id uuid primary key default uuid_generate_v4(),
    run_id uuid not null references runs(id) on delete cascade,
    agent_name text not null,          -- 'planner', 'discovery', 'extractor', 'validator', 'writer'
    node_name text not null,           -- LangGraph node name
    input_state jsonb not null,
    output_state jsonb,
    tool_calls jsonb not null default '[]'::jsonb,
    duration_ms integer not null,
    status log_status not null,
    error_message text,
    created_at timestamptz not null default now()
);

create index idx_agent_logs_run_id on agent_logs(run_id);
create index idx_agent_logs_agent_name on agent_logs(agent_name);
create index idx_agent_logs_created_at on agent_logs(created_at desc);

-- guardrail_events: Every validation/rejection event for audit
create table guardrail_events (
    id uuid primary key default uuid_generate_v4(),
    run_id uuid not null references runs(id) on delete cascade,
    agent_name text not null,
    event_type guardrail_event_type not null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index idx_guardrail_events_run_id on guardrail_events(run_id);
create index idx_guardrail_events_agent on guardrail_events(agent_name);
create index idx_guardrail_events_type on guardrail_events(event_type);

-- embeddings: pgvector storage for page chunks
-- Using 1536 dimensions for OpenAI text-embedding-3-small (free tier compatible)
create table embeddings (
    id uuid primary key default uuid_generate_v4(),
    page_id uuid not null references pages(id) on delete cascade,
    embedding vector(1536) not null,
    chunk_index integer not null,
    chunk_text text not null,
    created_at timestamptz not null default now(),
    unique (page_id, chunk_index)
);

create index idx_embeddings_page_id on embeddings(page_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Per-agent least-privilege scopes enforced at database level
-- ============================================================

alter table runs enable row level security;
alter table pages enable row level security;
alter table agent_logs enable row level security;
alter table guardrail_events enable row level security;
alter table embeddings enable row level security;

-- Helper: current_user_role() returns the JWT claim 'role' set by the API key
-- Each agent uses a different API key with a distinct 'role' claim

-- PLANNER: read/write runs only
create policy planner_runs_all on runs
    for all to planner
    using (true) with check (true);

create policy planner_pages_select on pages
    for select to planner using (true);

create policy planner_logs_insert on agent_logs
    for insert to planner with check (true);

create policy planner_guardrails_insert on guardrail_events
    for insert to planner with check (true);

-- DISCOVERY: read runs, write pages (url only), write logs/guardrails
create policy discovery_runs_select on runs
    for select to discovery using (true);

create policy discovery_pages_upsert on pages
    for insert to discovery with check (true);

create policy discovery_pages_update_url on pages
    for update to discovery using (true) with check (true);

create policy discovery_logs_insert on agent_logs
    for insert to discovery with check (true);

create policy discovery_guardrails_insert on guardrail_events
    for insert to discovery with check (true);

-- EXTRACTOR: read pages (url), write pages (extracted_json), write logs/guardrails
create policy extractor_pages_select on pages
    for select to extractor using (true);

create policy extractor_pages_update_extract on pages
    for update to extractor using (true)
    with check (
        -- Only allow updating extracted_json, not validation fields
        (OLD.extracted_json IS DISTINCT FROM NEW.extracted_json) AND
        (OLD.validation_status IS NOT DISTINCT FROM NEW.validation_status) AND
        (OLD.validation_reasoning IS NOT DISTINCT FROM NEW.validation_reasoning) AND
        (OLD.markdown_path IS NOT DISTINCT FROM NEW.markdown_path)
    );

create policy extractor_logs_insert on agent_logs
    for insert to extractor with check (true);

create policy extractor_guardrails_insert on guardrail_events
    for insert to extractor with check (true);

-- VALIDATOR: read pages, write pages (validation_*), write logs/guardrails
create policy validator_pages_select on pages
    for select to validator using (true);

create policy validator_pages_update_validation on pages
    for update to validator using (true)
    with check (
        -- Only allow updating validation fields
        (OLD.validation_status IS DISTINCT FROM NEW.validation_status) AND
        (OLD.validation_reasoning IS NOT DISTINCT FROM NEW.validation_reasoning) AND
        (OLD.extracted_json IS NOT DISTINCT FROM NEW.extracted_json) AND
        (OLD.url IS NOT DISTINCT FROM NEW.url) AND
        (OLD.markdown_path IS NOT DISTINCT FROM NEW.markdown_path)
    );

create policy validator_logs_insert on agent_logs
    for insert to validator with check (true);

create policy validator_guardrails_insert on guardrail_events
    for insert to validator with check (true);

-- WRITER: read pages, write pages (markdown_path), write embeddings, write logs/guardrails
create policy writer_pages_select on pages
    for select to writer using (true);

create policy writer_pages_update_markdown on pages
    for update to writer using (true)
    with check (
        -- Only allow updating markdown_path
        (OLD.markdown_path IS DISTINCT FROM NEW.markdown_path) AND
        (OLD.extracted_json IS NOT DISTINCT FROM NEW.extracted_json) AND
        (OLD.validation_status IS NOT DISTINCT FROM NEW.validation_status) AND
        (OLD.validation_reasoning IS NOT DISTINCT FROM NEW.validation_reasoning) AND
        (OLD.url IS NOT DISTINCT FROM NEW.url)
    );

create policy writer_embeddings_all on embeddings
    for all to writer using (true) with check (true);

create policy writer_logs_insert on agent_logs
    for insert to writer with check (true);

create policy writer_guardrails_insert on guardrail_events
    for insert to writer with check (true);

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

create trigger runs_updated_at
    before update on runs for each row execute function update_updated_at_column();

create trigger pages_updated_at
    before update on pages for each row execute function update_updated_at_column();

-- ============================================================
-- HELPER VIEWS (optional, for debugging/dashboard)
-- ============================================================

create view run_summary as
select
    r.id,
    r.goal,
    r.status,
    r.created_at,
    r.completed_at,
    count(p.id) as total_pages,
    count(p.id) filter (where p.validation_status = 'passed') as passed_pages,
    count(p.id) filter (where p.validation_status = 'failed') as failed_pages,
    count(p.id) filter (where p.validation_status = 'uncertain') as uncertain_pages,
    count(p.id) filter (where p.validation_status = 'pending') as pending_pages
from runs r
left join pages p on p.run_id = r.id
group by r.id;