# ============================================================
# Autonomous Research Swarm — Local Dev Startup Script (PowerShell)
# Starts FastAPI backend (port 8000) and Next.js frontend (port 3000)
# ============================================================

$ErrorActionPreference = "Stop"
$ROOT_DIR = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT_DIR

Write-Host "=== Autonomous Research Swarm: Starting Local Dev Environment ===" -ForegroundColor Cyan

if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Write-Host "Creating .env from .env.example..."
        Copy-Item ".env.example" ".env"
    } else {
        Write-Error ".env file not found."
    }
}

# Ensure knowledge and checkpoints
New-Item -ItemType Directory -Force -Path "knowledge", ".langgraph_checkpoints" | Out-Null

Write-Host "[1/3] Starting Docker MCP servers..." -ForegroundColor Yellow
docker compose -f docker-compose.mcp.yml --profile vibe_coding up -d

Write-Host "[2/3] Starting FastAPI backend on http://localhost:8000..." -ForegroundColor Yellow
$BackendPython = Join-Path $ROOT_DIR "backend\.venv\Scripts\python.exe"
if (Test-Path $BackendPython) {
    Start-Process -FilePath $BackendPython -ArgumentList "-m", "uvicorn", "api.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000", "--reload"
} else {
    Start-Process -FilePath "uvicorn" -ArgumentList "api.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000", "--reload"
}

Write-Host "[3/3] Starting Next.js frontend on http://localhost:3000..." -ForegroundColor Yellow
Set-Location (Join-Path $ROOT_DIR "frontend")
npm run dev
