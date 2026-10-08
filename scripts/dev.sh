#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Autonomous Research Swarm — Local Dev Startup Script
# Starts FastAPI backend (port 8000) and Next.js frontend (port 3000)
# ============================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== Autonomous Research Swarm: Starting Local Dev Environment ==="

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
  else
    echo "ERROR: .env file not found."
    exit 1
  fi
fi

# Ensure knowledge and checkpoint directories
mkdir -p "$ROOT_DIR/knowledge"
mkdir -p "$ROOT_DIR/.langgraph_checkpoints"

echo "[1/3] Checking Docker MCP servers..."
if command -v docker >/dev/null 2>&1; then
  docker compose -f docker-compose.mcp.yml --profile vibe_coding up -d || true
else
  echo "Docker not found; skipping Docker MCP startup."
fi

echo "[2/3] Starting FastAPI backend on http://localhost:8000..."
if [ -d "$ROOT_DIR/backend/.venv" ]; then
  "$ROOT_DIR/backend/.venv/bin/uvicorn" api.main:app --app-dir "$ROOT_DIR/backend" --host 0.0.0.0 --port 8000 --reload &
else
  uvicorn api.main:app --app-dir "$ROOT_DIR/backend" --host 0.0.0.0 --port 8000 --reload &
fi
BACKEND_PID=$!

echo "[3/3] Starting Next.js frontend on http://localhost:3000..."
cd "$ROOT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

cleanup() {
  echo "Shutting down servers..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  exit 0
}

trap cleanup INT TERM

echo "=== System running! ==="
echo "Frontend: http://localhost:3000"
echo "API Docs: http://localhost:8000/docs"
wait
