# Autonomous Research Swarm — Production Deployment Guide

This guide outlines the production deployment of both the **Next.js Frontend** and the **FastAPI + LangGraph Backend**.

---

## Architecture Overview

```
                      +-----------------------------+
                      |   User Browser (Client)     |
                      +--------------+--------------+
                                     |
               +---------------------+---------------------+
               |                                           |
               v (Auth / Storage)                          v (Pages / UI / API proxy)
      +------------------+                       +-------------------+
      |  Supabase Cloud  |                       |  Next.js Frontend |
      |  PostgREST + Auth|                       |  (Vercel / Docker)|
      +--------+---------+                       +---------+---------+
               ^                                           |
               |                                           | /api/* Proxy
               |                                           v
               |                                 +-------------------+
               +---------------------------------+  FastAPI Backend  |
                     (DB audit / knowledge)      |  (Render / Docker)|
                                                 +---------+---------+
                                                           |
                                          +----------------+----------------+
                                          |                |                |
                                          v                v                v
                                        Groq             Gemini         OpenRouter
                                   (qwen3.8-27b)    (gemma-4-26b)      (nemotron)
```

---

## Option 1: Cloud Deployment (Recommended: Vercel + Render / Railway)

### Part A: Deploy the Backend (Render or Railway)

1. **Push your code to GitHub / GitLab**.
2. **Create a new Web Service on Render** (or Railway):
   - **Repository**: Your repository.
   - **Root Directory**: `backend`
   - **Environment**: Python 3.11
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn api.main:app --host 0.0.0.0 --port $PORT`
3. **Configure Environment Variables** on Render / Railway:
   Refer to [`backend/.env.production.example`](file:///d:/auto_research_swarm/backend/.env.production.example):
   | Key | Value / Description |
   | :--- | :--- |
   | `SUPABASE_URL` | `https://your-project.supabase.co` |
   | `SUPABASE_SECRET_KEY` | `your_supabase_secret_service_role_key` |
   | `SUPABASE_PUBLISHABLE_KEY` | `your_supabase_anon_key` |
   | `SUPABASE_ANON_KEY` | `your_supabase_anon_key` |
   | `GROQ_API_KEY` | Your Groq API key |
   | `GROQ_MODEL` | `qwen/qwen3.8-27b` |
   | `GROQ_FAST_MODEL` | `openai/gpt-oss-20b` |
   | `GOOGLE_API_KEY` | Your Google Gemini API key |
   | `GEMINI_MODEL` | `gemma-4-26b-a4b-it` |
   | `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` |
   | `PAGE_PACING_SECONDS` | `2.0` |
   | `ROUTER_PREFER_GROQ_GEMINI` | `true` |
   | `API_KEY` | `your-secure-internal-api-key` |
   | `BACKEND_API_KEY` | `your-secure-internal-api-key` |
   | `FRONTEND_URL` | Your frontend URL (e.g. `https://your-app.vercel.app`) or `*` |
4. **Verify Backend Health**:
   Once deployed, test: `https://<your-backend-url>/health/deep`. It should return:
   ```json
   {"status":"ok","db":"reachable","auth":"reachable"}
   ```

---

### Part B: Deploy the Frontend (Vercel)

1. **Create a New Project on Vercel**:
   - **Root Directory**: Select `frontend`
   - **Framework Preset**: Next.js (detected automatically)
2. **Configure Environment Variables** in Vercel Project Settings:
   Refer to [`frontend/.env.production.example`](file:///d:/auto_research_swarm/frontend/.env.production.example):
   | Key | Value |
   | :--- | :--- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://your-project.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `your_supabase_anon_key` |
   | `SUPABASE_URL` | `https://your-project.supabase.co` |
   | `SUPABASE_ANON_KEY` | `your_supabase_anon_key` |
   | `BACKEND_SERVICE_URL` | `https://<your-deployed-backend-url>` |
   | `BACKEND_API_URL` | `https://<your-deployed-backend-url>` |
   | `BACKEND_API_KEY` | `your-secure-internal-api-key` (matches backend) |
   | `API_KEY` | `your-secure-internal-api-key` |
3. **Deploy**:
   Click **Deploy**. Next.js will build the static pages and deploy edge middleware.

---

## Option 2: Self-Hosted Docker Compose (Single VPS / Server)

If you have a Linux VPS (DigitalOcean Droplet, AWS EC2, Hetzner, etc.):

1. **Clone the repository on the server**:
   ```bash
   git clone <your-repo-url> /opt/auto_research_swarm
   cd /opt/auto_research_swarm
   ```
2. **Create the production `.env` file**:
   ```bash
   cp backend/.env.production.example .env
   ```
3. **Launch the entire stack**:
   ```bash
   docker compose up -d --build
   ```
   This starts:
   - `frontend` on port `3000`
   - `backend` on port `8000`
   - Supporting MCP servers (Playwright, Fetch, Filesystem, Memory, GitHub)
4. **Configure a Reverse Proxy (Nginx / Caddy)**:
   Point your domain name (port 80/443 with SSL) to port `3000`.

---

## Post-Deployment Checklist

- [ ] `/api/health/deep` returns HTTP 200 with `status: ok`.
- [ ] User registration and login succeeds via Supabase Auth without network errors.
- [ ] Sidepanel remains hidden on `/sign-in` and only displays inside authenticated sessions.
- [ ] Launching a research topic completes smoothly and writes articles without rate-limit exhaustion.
- [ ] In-App LaTeX Studio renders and compiles PDF versions cleanly.
