-- Migration: Update embedding dimensions from 1536 to 768 for Gemini text-embedding-004
-- Free tier compatibility migration

-- Step 1: Drop existing index if present
drop index if exists idx_embeddings_page_id;

-- Step 2: Alter embeddings table column to vector(768)
alter table if exists embeddings drop column if exists embedding cascade;
alter table embeddings add column embedding vector(768) not null;

-- Step 3: Recreate index
create index if not exists idx_embeddings_page_id on embeddings(page_id);
