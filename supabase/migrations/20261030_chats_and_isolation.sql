-- ==============================================================================
-- Migration: User Authentication, Chat Isolation, LaTeX Papers, and Model Usage
-- Workstream: WS1 & WS2 Data Model and Isolation
-- Date: 2026-10-30
-- Strategy: Option A (Legacy rows migrated to a dedicated system archive chat)
-- ==============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "vector";

-- ------------------------------------------------------------------------------
-- 1. PROFILES TABLE (Mirrors auth.users, auto-created via trigger on sign-up)
-- ------------------------------------------------------------------------------
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    full_name text default '',
    avatar_url text default '',
    role text default 'researcher',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

do $$ begin
    create policy "Users can view their own profile" on public.profiles
        for select using (auth.uid() = id);
exception when duplicate_object then null;
end $$;

do $$ begin
    create policy "Users can update their own profile" on public.profiles
        for update using (auth.uid() = id);
exception when duplicate_object then null;
end $$;

-- Trigger to create profile upon new Supabase Auth user registration
create or replace function public.handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id, email, full_name)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'full_name', '')
    )
    on conflict (id) do update set
        email = excluded.email,
        updated_at = now();
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 2. CHATS TABLE (Primary research boundary)
-- ------------------------------------------------------------------------------
create table if not exists public.chats (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null default 'New Research Project',
    query text not null default '',
    params jsonb not null default '{
        "max_sources": 15,
        "max_pages": 15,
        "token_budget": 500000,
        "year_range": [2018, 2026],
        "source_types": ["paper", "web", "doc"],
        "min_pages": 5
    }'::jsonb,
    status text not null default 'draft' check (status in (
        'draft', 'queued', 'running', 'paused_infra', 'paused_quota',
        'completed', 'completed_partial', 'failed', 'cancelled'
    )),
    current_stage text default 'idle',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_opened_at timestamptz not null default now()
);

create index if not exists idx_chats_user_id on public.chats(user_id);
create index if not exists idx_chats_last_opened_at on public.chats(last_opened_at desc);

alter table public.chats enable row level security;

do $$ begin
    create policy "Users can operate only on own chats" on public.chats
        for all using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------------------------
-- 3. DURABLE JOBS QUEUE
-- ------------------------------------------------------------------------------
create table if not exists public.jobs (
    id uuid primary key default uuid_generate_v4(),
    chat_id uuid not null references public.chats(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    run_id uuid,
    status text not null default 'pending' check (status in ('pending', 'claimed', 'completed', 'failed')),
    attempts int not null default 0,
    locked_by text,
    heartbeat_at timestamptz,
    available_at timestamptz not null default now(),
    last_error text,
    created_at timestamptz not null default now()
);

create index if not exists idx_jobs_status_available on public.jobs(status, available_at);
create index if not exists idx_jobs_chat_id on public.jobs(chat_id);

alter table public.jobs enable row level security;

do $$ begin
    create policy "Users can see own jobs" on public.jobs
        for all using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------------------------
-- 4. SOURCES (Canonical crawled & API research documents)
-- ------------------------------------------------------------------------------
create table if not exists public.sources (
    id uuid primary key default uuid_generate_v4(),
    chat_id uuid not null references public.chats(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    canonical_id text not null, -- DOI, arXiv ID, or Normalized URL
    title text not null,
    authors text[] default '{}'::text[],
    venue text default '',
    year int,
    source_type text not null default 'web' check (source_type in ('arxiv', 'crossref', 'openalex', 'tavily', 'web', 'pdf')),
    evidence_level text not null default 'full_text' check (evidence_level in ('full_text', 'abstract_only')),
    content_hash text not null,
    extracted jsonb not null default '{}'::jsonb,
    verdict text not null default 'pass' check (verdict in ('pass', 'fail', 'uncertain')),
    confidence float not null default 1.0,
    safety_flags text[] default '{}'::text[],
    markdown text not null default '',
    bib_key text,
    created_at timestamptz not null default now()
);

create index if not exists idx_sources_chat_id on public.sources(chat_id);
create index if not exists idx_sources_canonical_id on public.sources(canonical_id);
create unique index if not exists idx_sources_chat_canonical on public.sources(chat_id, canonical_id);

alter table public.sources enable row level security;

do $$ begin
    create policy "Users can manage own sources" on public.sources
        for all using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------------------------
-- 5. CHAT-SCOPED VECTOR EMBEDDINGS
-- ------------------------------------------------------------------------------
create table if not exists public.chat_embeddings (
    id uuid primary key default uuid_generate_v4(),
    chat_id uuid not null references public.chats(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    source_id uuid references public.sources(id) on delete cascade,
    chunk_index int not null default 0,
    content text not null,
    embedding vector(768) not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_chat_embeddings_chat_id on public.chat_embeddings(chat_id);
create index if not exists idx_chat_embeddings_user_id on public.chat_embeddings(user_id);

alter table public.chat_embeddings enable row level security;

do $$ begin
    create policy "Users can access own embeddings" on public.chat_embeddings
        for all using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

-- Strict chat-isolated vector similarity search
create or replace function match_chat_embeddings (
    query_embedding vector(768),
    match_threshold float,
    match_count int,
    filter_chat_id uuid
)
returns table (
    id uuid,
    source_id uuid,
    content text,
    similarity float
)
language plpgsql
security invoker
as $$
begin
    return query
    select
        ce.id,
        ce.source_id,
        ce.content,
        1 - (ce.embedding <=> query_embedding) as similarity
    from public.chat_embeddings ce
    where ce.chat_id = filter_chat_id
      and 1 - (ce.embedding <=> query_embedding) > match_threshold
    order by similarity desc
    limit match_count;
end;
$$;

-- ------------------------------------------------------------------------------
-- 6. PAPERS AND VERSIONS (LaTeX Synthesis)
-- ------------------------------------------------------------------------------
create table if not exists public.papers (
    id uuid primary key default uuid_generate_v4(),
    chat_id uuid not null unique references public.chats(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null default 'Research Survey Paper',
    status text not null default 'draft' check (status in ('draft', 'compiled', 'compile_failed', 'short_of_target')),
    current_version int not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_papers_chat_id on public.papers(chat_id);
create index if not exists idx_papers_user_id on public.papers(user_id);

alter table public.papers enable row level security;

do $$ begin
    create policy "Users can manage own papers" on public.papers
        for all using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

create table if not exists public.paper_versions (
    id uuid primary key default uuid_generate_v4(),
    paper_id uuid not null references public.papers(id) on delete cascade,
    chat_id uuid not null references public.chats(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    version int not null,
    tex_source text not null default '',
    bib_source text not null default '',
    created_by text not null default 'agent' check (created_by in ('agent', 'user')),
    compile_status text not null default 'pending' check (compile_status in ('pending', 'success', 'failed')),
    page_count int default 0,
    storage_path text, -- e.g. {user_id}/{chat_id}/{version}.pdf
    compile_errors jsonb default '[]'::jsonb,
    note text default '',
    created_at timestamptz not null default now()
);

create index if not exists idx_paper_versions_paper_id on public.paper_versions(paper_id, version desc);
create unique index if not exists idx_paper_version_unique on public.paper_versions(paper_id, version);

alter table public.paper_versions enable row level security;

do $$ begin
    create policy "Users can access own paper versions" on public.paper_versions
        for all using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------------------------
-- 7. MODEL USAGE AUDIT LOG
-- ------------------------------------------------------------------------------
create table if not exists public.model_usage (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid references auth.users(id) on delete set null,
    chat_id uuid references public.chats(id) on delete set null,
    run_id uuid,
    provider text not null,
    model text not null,
    role text not null check (role in ('planner', 'discovery', 'extractor', 'validator', 'writer', 'paper_composer', 'router')),
    prompt_tokens int default 0,
    completion_tokens int default 0,
    total_tokens int default 0,
    latency_ms float not null default 0.0,
    outcome text not null default 'success' check (outcome in ('success', 'rate_limited', 'timeout', 'error')),
    created_at timestamptz not null default now()
);

create index if not exists idx_model_usage_user_id on public.model_usage(user_id);
create index if not exists idx_model_usage_chat_id on public.model_usage(chat_id);
create index if not exists idx_model_usage_provider on public.model_usage(provider, model);

alter table public.model_usage enable row level security;

do $$ begin
    create policy "Users can view own model usage" on public.model_usage
        for select using (auth.uid() = user_id or auth.uid() is null);
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------------------------
-- 8. EXTEND EXISTING TABLES (RUNS, AGENT_LOGS, GUARDRAIL_EVENTS)
-- ------------------------------------------------------------------------------
alter table if exists public.runs add column if not exists chat_id uuid references public.chats(id) on delete cascade;
alter table if exists public.agent_logs add column if not exists chat_id uuid references public.chats(id) on delete cascade;
alter table if exists public.agent_logs add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table if exists public.guardrail_events add column if not exists chat_id uuid references public.chats(id) on delete cascade;
alter table if exists public.guardrail_events add column if not exists user_id uuid references auth.users(id) on delete set null;

-- ------------------------------------------------------------------------------
-- 9. OPTION A: MIGRATION OF LEGACY ROWS
-- ------------------------------------------------------------------------------
-- Ensure a system user exists or create a placeholder if needed, then attach legacy runs
do $$
declare
    v_admin_user_id uuid;
    v_legacy_chat_id uuid;
begin
    -- Pick the first auth user as owner of existing unassigned runs, or null
    select id into v_admin_user_id from auth.users order by created_at asc limit 1;

    if v_admin_user_id is not null then
        -- Create a legacy chat archive container
        insert into public.chats (user_id, title, query, status, current_stage)
        values (
            v_admin_user_id,
            'Legacy Archive (Pre-Auth Runs)',
            'System preserved benchmark runs prior to multi-user chat isolation.',
            'completed',
            'archived'
        )
        returning id into v_legacy_chat_id;

        -- Attach orphaned runs to the legacy chat
        update public.runs
        set chat_id = v_legacy_chat_id, user_id = v_admin_user_id
        where chat_id is null;

        update public.agent_logs
        set chat_id = v_legacy_chat_id, user_id = v_admin_user_id
        where chat_id is null;

        update public.guardrail_events
        set chat_id = v_legacy_chat_id, user_id = v_admin_user_id
        where chat_id is null;
    end if;
end $$;

-- ------------------------------------------------------------------------------
-- 10. PRIVATE STORAGE BUCKET: papers
-- ------------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('papers', 'papers', false)
on conflict (id) do update set public = false;

do $$ begin
    create policy "Users can upload own paper PDFs"
        on storage.objects for insert
        with check (
            bucket_id = 'papers' and
            auth.uid()::text = (storage.foldername(name))[1]
        );
exception when duplicate_object then null;
end $$;

do $$ begin
    create policy "Users can read own paper PDFs"
        on storage.objects for select
        using (
            bucket_id = 'papers' and
            auth.uid()::text = (storage.foldername(name))[1]
        );
exception when duplicate_object then null;
end $$;

do $$ begin
    create policy "Users can delete own paper PDFs"
        on storage.objects for delete
        using (
            bucket_id = 'papers' and
            auth.uid()::text = (storage.foldername(name))[1]
        );
exception when duplicate_object then null;
end $$;
