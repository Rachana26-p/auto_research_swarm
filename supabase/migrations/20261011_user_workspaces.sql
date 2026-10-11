-- Migration: User-isolated Projects, Chats, and Workspaces
-- Supports Gemini-like multi-turn chats, project grouping, and Groq/Gemini model switching.

create extension if not exists "uuid-ossp";

-- Projects table (isolated to user)
create table if not exists projects (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid references auth.users(id) on delete cascade,
    name text not null,
    description text default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_projects_user_id on projects(user_id);

-- Alter runs to support user and project isolation
do $$ begin
    alter table runs add column if not exists user_id uuid references auth.users(id) on delete set null;
    alter table runs add column if not exists project_id uuid references projects(id) on delete set null;
    alter table runs add column if not exists model_provider text default 'gemini';
exception when others then null;
end $$;

-- Chats table (Gemini-like conversational runs & chats)
create table if not exists chats (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid references auth.users(id) on delete cascade,
    project_id uuid references projects(id) on delete set null,
    title text not null default 'New Research Chat',
    model_provider text not null default 'gemini', -- 'gemini' | 'groq'
    model_name text not null default 'gemini-1.5-flash',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_chats_user_id on chats(user_id);
create index if not exists idx_chats_updated_at on chats(updated_at desc);

-- Chat Messages
create table if not exists chat_messages (
    id uuid primary key default uuid_generate_v4(),
    chat_id uuid not null references chats(id) on delete cascade,
    role text not null, -- 'user' | 'assistant' | 'system'
    content text not null,
    metadata jsonb default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_chat_id on chat_messages(chat_id);

-- Enable Row Level Security (RLS)
alter table projects enable row level security;
alter table chats enable row level security;
alter table chat_messages enable row level security;

-- RLS Policies
do $$ begin
    create policy "Users can manage own projects" on projects
        for all using (auth.uid() = user_id or auth.uid() is null);
exception when duplicate_object then null;
end $$;

do $$ begin
    create policy "Users can manage own chats" on chats
        for all using (auth.uid() = user_id or auth.uid() is null);
exception when duplicate_object then null;
end $$;

do $$ begin
    create policy "Users can manage own chat messages" on chat_messages
        for all using (
            exists (
                select 1 from chats
                where chats.id = chat_messages.chat_id
                and (chats.user_id = auth.uid() or auth.uid() is null)
            )
        );
exception when duplicate_object then null;
end $$;
