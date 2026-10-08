-- Supabase Schema for Autonomous Research Swarm
-- Fully idempotent and copy-paste executable in the Supabase SQL Editor
-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ============================================================
-- ENUMS (Safe creation avoiding duplicate_object errors)
-- ============================================================
do $$ begin
    create type run_status as enum ('pending', 'running', 'completed', 'failed');
exception when duplicate_object then null;
end $$;

do $$ begin
    create type validation_status as enum ('pending', 'passed', 'failed', 'uncertain');
exception when duplicate_object then null;
end $$;

do $$ begin
    create type log_status as enum ('success', 'failed', 'retry');
exception when duplicate_object then null;
end $$;

do $$ begin
    create type guardrail_event_type as enum (
        'tool_schema_violation',
        'content_sanitization',
        'egress_blocked',
        'validation_failed'
    );
exception when duplicate_object then null;
end $$;

-- ============================================================
-- OPTIONAL AGENT ROLES (Safe creation)
-- ============================================================
do $$ begin
    create role planner nologin;
    create role discovery nologin;
    create role extractor nologin;
    create role validator nologin;
    create role writer nologin;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- TABLES
-- ============================================================

-- runs: Top-level research run metadata
create table if not exists runs (
    id uuid primary key default uuid_generate_v4(),
    goal text not null,
    status run_status not null default 'pending',
    config jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    updated_at timestamptz not null default now()
);

create index if not exists idx_runs_status on runs(status);
create index if not exists idx_runs_created_at on runs(created_at desc);

-- pages: One row per URL processed in a run
create table if not exists pages (
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

create index if not exists idx_pages_run_id on pages(run_id);
create index if not exists idx_pages_validation_status on pages(validation_status);

-- agent_logs: Full audit trail of every agent decision and tool call
create table if not exists agent_logs (
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

create index if not exists idx_agent_logs_run_id on agent_logs(run_id);
create index if not exists idx_agent_logs_agent_name on agent_logs(agent_name);
create index if not exists idx_agent_logs_created_at on agent_logs(created_at desc);

-- guardrail_events: Every validation/rejection event for audit
create table if not exists guardrail_events (
    id uuid primary key default uuid_generate_v4(),
    run_id uuid not null references runs(id) on delete cascade,
    agent_name text not null,
    event_type guardrail_event_type not null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_guardrail_events_run_id on guardrail_events(run_id);
create index if not exists idx_guardrail_events_agent on guardrail_events(agent_name);
create index if not exists idx_guardrail_events_type on guardrail_events(event_type);

-- embeddings: pgvector storage for page chunks
-- Using 768 dimensions for Gemini embeddings (free tier)
create table if not exists embeddings (
    id uuid primary key default uuid_generate_v4(),
    page_id uuid not null references pages(id) on delete cascade,
    embedding vector(768) not null,
    chunk_index integer not null,
    chunk_text text not null,
    created_at timestamptz not null default now(),
    unique (page_id, chunk_index)
);

create index if not exists idx_embeddings_page_id on embeddings(page_id);

-- ============================================================
-- SCHEMA & TABLE PERMISSIONS
-- ============================================================
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- ============================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================

alter table runs enable row level security;
alter table pages enable row level security;
alter table agent_logs enable row level security;
alter table guardrail_events enable row level security;
alter table embeddings enable row level security;

-- Drop any existing policies to allow re-running cleanly
drop policy if exists "allow_runs_access" on runs;
drop policy if exists "allow_pages_access" on pages;
drop policy if exists "allow_agent_logs_access" on agent_logs;
drop policy if exists "allow_guardrail_events_access" on guardrail_events;
drop policy if exists "allow_embeddings_access" on embeddings;

-- Publishable keys connect via PostgREST role anon / authenticated.
-- Least-privilege access is enforced at the backend wrapper level (data_access.py).
create policy "allow_runs_access" on runs
    for all to anon, authenticated, service_role
    using (true) with check (true);

create policy "allow_pages_access" on pages
    for all to anon, authenticated, service_role
    using (true) with check (true);

create policy "allow_agent_logs_access" on agent_logs
    for all to anon, authenticated, service_role
    using (true) with check (true);

create policy "allow_guardrail_events_access" on guardrail_events
    for all to anon, authenticated, service_role
    using (true) with check (true);

create policy "allow_embeddings_access" on embeddings
    for all to anon, authenticated, service_role
    using (true) with check (true);

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists runs_updated_at on runs;
create trigger runs_updated_at
    before update on runs for each row execute function update_updated_at_column();

drop trigger if exists pages_updated_at on pages;
create trigger pages_updated_at
    before update on pages for each row execute function update_updated_at_column();

-- ============================================================
-- HELPER VIEWS
-- ============================================================

create or replace view run_summary as
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