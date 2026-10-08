# Autonomous Research Swarm

Autonomous multi-agent research swarm that crawls, extracts, validates, and summarizes web pages into structured markdown knowledge files. Demonstrates a production-governed multi-agent architecture with explicit state-machine execution control, runtime tool & schema validation, prompt injection defense, and human-in-the-loop review.

---

## Architecture Overview

```
                      ┌───────────────┐
                      │ User / Client │
                      └───────┬───────┘
                              │ POST /runs (Goal & Budgets)
                              ▼
                      ┌───────────────┐
                      │    Planner    │ ◄── Groq (OpenAI-compatible) / Decompose Goal into Subtasks
                      └───────┬───────┘
                              ▼
                      ┌───────────────┐
                      │   Discovery   │ ◄── Tavily / Find & Rank Candidate URLs
                      └───────┬───────┘
                              ▼
                      ┌───────────────┐
                      │   Extractor   │ ◄── Playwright & Fetch MCP / Structured JSON
                      └───────┬───────┘
                              ▼
                      ┌───────────────┐
                      │   Validator   │ ◄── Quality, Faithfulness & Injection Gate
                      └───────┬───────┘
                              │
               ┌──────────────┼──────────────┐
        (PASS) │              │ (UNCERTAIN)  │ (FAIL)
               ▼              ▼              ▼
        ┌───────────┐   ┌───────────┐   ┌───────────┐
        │  Writer   │   │interrupt()│   │  Discard  │
        └─────┬─────┘   │ (Review)  │   └───────────┘
              │         └───────────┘
              ▼
   ┌───────────────────────┐
   │ Knowledge Base (.md)  │
   │ + Supabase (pgvector) │
   └───────────────────────┘
```

### The 5 Agent Nodes

1. **Planner (`backend/agents/planner.py`)**: Decomposes user goals into bounded subtasks with candidate domain hostnames. Pure function with strict schema validation.
2. **Discovery (`backend/agents/discovery.py`)**: Queries Tavily search, prioritizes candidate domains, filters URLs for validity and SSRF safety, and caps search volume.
3. **Extractor (`backend/agents/extractor.py`)**: Fetches target web pages via sandboxed Playwright or Fetch MCP containers. Extracts structured facts using Nemotron Ultra without inline file persistence.
4. **Validator (`backend/agents/validator.py`)**: Structural and safety quality gate. Scans for prompt injection heuristics, inspects content faithfulness, and downgrades borderline confidence to `UNCERTAIN`. Logs all verdicts to `guardrail_events`.
5. **Writer (`backend/agents/writer.py`)**: Refuses execution if verdict is not `PASS`. Generates deterministic markdown with frontmatter, executes atomic writes strictly confined to `/knowledge/`, and upserts to Supabase `pages` and `embeddings`.

### Centralized Guardrails (`backend/guardrails/`)

- **Tool Schema Validation**: Enforces Pydantic schema validation before any tool execution, blocking unknown keys or malformed parameters.
- **Untrusted Content Delimiting**: Web content is treated strictly as untrusted data and wrapped with isolation delimiters; instructions embedded inside crawled HTML are neutralized.
- **Egress & SSRF Protection**: Validates all outbound target URLs against private, loopback, and link-local IP blocks before network requests.
- **Audit Logging**: Every validation decision (both `PASS` and `BLOCK`) is logged to the central audit store and Supabase `guardrail_events`.

---

## Tech Stack

- **Backend**: Python 3.11+, LangGraph, FastAPI, Pydantic v2, Tenacity, HTTPX.
- **Frontend**: Next.js 16 (App Router), TypeScript (strict mode), Tailwind CSS, Bauhaus minimalism design tokens (`Archivo Black`, `Space Grotesk`, `Inter`, `JetBrains Mono`).
- **Database & Storage**: Supabase PostgreSQL + `pgvector` extension for semantic search embeddings.
- **MCP Tool Servers**: Playwright MCP, Fetch MCP, Filesystem MCP, Memory MCP, GitHub MCP running in Docker.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/) (running)
- Python 3.11+
- Node.js 20+ and npm

---

## Setup & Running

### 1. Configure Environment

Copy `.env.example` to `.env` and configure your credentials:

```bash
cp .env.example .env
```

Key environment variables:
- `SUPABASE_URL`: Your Supabase project URL (e.g., `https://<ref>.supabase.co`)
- `SUPABASE_PLANNER_KEY`, `SUPABASE_DISCOVERY_KEY`, `SUPABASE_EXTRACTOR_KEY`, `SUPABASE_VALIDATOR_KEY`, `SUPABASE_WRITER_KEY`: Per-agent Supabase publishable keys
- `GROQ_API_KEY`, `GROQ_MODEL`: Groq API credentials for Planner and Validator reasoning (free tier)
- `GOOGLE_API_KEY`: Google Gemini API key for embeddings (`text-embedding-004`, 768 dims) and alternative validator
- `TAVILY_API_KEY`: Search API for Discovery node (free tier)
- `EMBEDDING_DIMENSIONS`: 768 (strictly matching Gemini `text-embedding-004`)
- `API_KEY`: Secret key for authenticating API requests (default: `test-api-key`)

### 2. Run with Docker Compose (Recommended)

Starts the MCP tool servers, FastAPI backend, and Next.js frontend together:

```bash
docker compose up -d
```

- **Frontend**: http://localhost:3000
- **FastAPI API**: http://localhost:8000
- **Interactive API Docs**: http://localhost:8000/docs

### 3. Run Locally (Development)

Using the automated dev scripts:

**Linux / macOS:**
```bash
chmod +x scripts/dev.sh
./scripts/dev.sh
```

**Windows (PowerShell):**
```powershell
.\scripts\dev.ps1
```

Or manually:

```bash
# Terminal 1: MCP Tool Servers
docker compose -f docker-compose.mcp.yml --profile vibe_coding up -d

# Terminal 2: Backend
backend/.venv/Scripts/uvicorn api.main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload

# Terminal 3: Frontend
cd frontend
npm run dev
```

---

## Frontend Routes

- `/` : Goal submission form (goal text, max pages, max tokens) and recent runs table with Bauhaus status indicators.
- `/runs/[id]` : Real-time run monitor driven by Server-Sent Events (SSE), 5-node `RunTimeline`, live tool invocation log, budget bars, and run guardrail decisions.
- `/reviews` : Human-in-the-loop queue for `UNCERTAIN` extractions with side-by-side content, safety flags, and Approve / Reject buttons that resume execution.
- `/knowledge` : Searchable catalog of completed research files.
- `/knowledge/[id]` : Safe escaped markdown viewer (zero `dangerouslySetInnerHTML`).
- `/guardrails` : Central audit trail table filterable by run ID and verdict (`PASS`/`BLOCK`).

---

## Testing & Evaluation

### Backend Test Suite
```bash
backend/.venv/Scripts/pytest backend/tests -v
```

### Frontend Typecheck & Build
```bash
cd frontend
npm run lint
npx tsc --noEmit
npm run build
```

### Benchmark Evaluation
Run the automated benchmark of 10 research goals and 5 adversarial injection pages:
```bash
backend/.venv/Scripts/python backend/scripts/evaluate.py
```
Outputs `results.json` and a formatted results table.

---

## Deployment Environment Variables (Render & Vercel)

For production deployments on cloud platforms (empty values template):

### Backend (Render / Cloud Run)
```env
SUPABASE_URL=
SUPABASE_PLANNER_KEY=
SUPABASE_DISCOVERY_KEY=
SUPABASE_EXTRACTOR_KEY=
SUPABASE_VALIDATOR_KEY=
SUPABASE_WRITER_KEY=
TAVILY_API_KEY=
GROQ_API_KEY=
GROQ_MODEL=
GOOGLE_API_KEY=
GEMINI_MODEL=
GEMINI_EMBEDDING_MODEL=
EMBEDDING_MODEL=
EMBEDDING_DIMENSIONS=768
API_KEY=
FRONTEND_URL=
KNOWLEDGE_DIR=./knowledge
LANGGRAPH_CHECKPOINT_DIR=./.langgraph_checkpoints
LOG_LEVEL=INFO
LOG_FORMAT=json
```

### Frontend (Vercel)
```env
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_API_KEY=
```
*(Note: Never configure Supabase secret keys or service-role keys in the frontend).*

---

## Verified Free-Tier Provider Specifications

| Provider / Role | Environment Variables | Verified Free-Tier Limits | Official Documentation Checked |
| :--- | :--- | :--- | :--- |
| **Groq**<br>*(Planner & Validator reasoning)* | `GROQ_API_KEY`<br>`GROQ_MODEL` | 30 RPM, 6,000–30,000 TPM, 1,000–14,400 RPD (depends on model) | [Groq Rate Limits & Tier Specs](https://console.groq.com/docs/rate-limits) |
| **Google Gemini**<br>*(Alternative validator & embeddings)* | `GOOGLE_API_KEY`<br>`GEMINI_MODEL`<br>`GEMINI_EMBEDDING_MODEL` | 15 RPM, 1,500 RPD, 1,000,000 TPM; `text-embedding-004` output dimensionality = 768 | [Gemini API Embedding Guide](https://ai.google.dev/gemini-api/docs/embeddings)<br>[Gemini Rate Limits](https://ai.google.dev/gemini-api/docs/models/gemini#rate-limits) |
| **Tavily Search**<br>*(Discovery crawler)* | `TAVILY_API_KEY` | 1,000 monthly credits free, 20 RPM | [Tavily Pricing & Limits](https://docs.tavily.com) |

