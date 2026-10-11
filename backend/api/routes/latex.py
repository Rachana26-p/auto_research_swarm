"""
Routes for LaTeX Survey Paper retrieval, editing, and live PDF compilation (Overleaf-style).
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel

from agents.latex_synthesizer import compile_latex, generate_latex_from_run
from api.deps import verify_api_key
from api.state import run_manager
from shared.config import get_config

router = APIRouter(prefix="/runs", tags=["latex"], dependencies=[Depends(verify_api_key)])


class LatexResponse(BaseModel):
    run_id: UUID
    latex_code: str
    status: str
    latex_path: str | None = None


class LatexUpdateRequest(BaseModel):
    latex_code: str


class CompilePdfRequest(BaseModel):
    latex_code: str | None = None


@router.get("/{run_id}/latex", response_model=LatexResponse)
async def get_run_latex(run_id: UUID) -> LatexResponse:
    """
    Get the synthesized LaTeX research survey paper for a run.
    If not yet generated, dynamically generates it on the fly from run's pages.
    """
    record = run_manager.get_run(run_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    cfg = get_config()
    k_dir = Path(cfg.knowledge_dir or "./knowledge") / str(run_id)
    tex_file = k_dir / "report.tex"

    latex_code = ""
    if tex_file.exists():
        latex_code = tex_file.read_text(encoding="utf-8")
    elif record.summary.get("latex_code"):
        latex_code = record.summary["latex_code"]
    else:
        # Generate dynamically from completed run pages
        pages = record.summary.get("pages_written", [])
        latex_code = generate_latex_from_run(
            goal=record.goal,
            pages=pages,
            summary=record.summary,
        )
        try:
            k_dir.mkdir(parents=True, exist_ok=True)
            tex_file.write_text(latex_code, encoding="utf-8")
        except Exception:
            pass

    return LatexResponse(
        run_id=run_id,
        latex_code=latex_code,
        status="ready" if latex_code else "pending",
        latex_path=str(tex_file) if tex_file.exists() else None,
    )


@router.post("/{run_id}/latex", response_model=LatexResponse)
async def update_run_latex(run_id: UUID, req: LatexUpdateRequest) -> LatexResponse:
    """
    Save user-edited LaTeX code for this run.
    """
    record = run_manager.get_run(run_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    cfg = get_config()
    k_dir = Path(cfg.knowledge_dir or "./knowledge") / str(run_id)
    k_dir.mkdir(parents=True, exist_ok=True)
    tex_file = k_dir / "report.tex"
    tex_file.write_text(req.latex_code, encoding="utf-8")
    record.summary["latex_code"] = req.latex_code

    return LatexResponse(
        run_id=run_id,
        latex_code=req.latex_code,
        status="saved",
        latex_path=str(tex_file),
    )


@router.post("/{run_id}/compile-pdf")
async def compile_run_pdf(run_id: UUID, req: CompilePdfRequest) -> Response:
    """
    Compile LaTeX code to PDF. Returns binary application/pdf.
    """
    record = run_manager.get_run(run_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    latex_source = req.latex_code
    if not latex_source:
        cfg = get_config()
        tex_file = Path(cfg.knowledge_dir or "./knowledge") / str(run_id) / "report.tex"
        if tex_file.exists():
            latex_source = tex_file.read_text(encoding="utf-8")
        elif record.summary.get("latex_code"):
            latex_source = record.summary["latex_code"]
        else:
            latex_source = generate_latex_from_run(
                goal=record.goal,
                pages=record.summary.get("pages_written", []),
                summary=record.summary,
            )

    try:
        pdf_bytes, log = compile_latex(latex_source)
        headers = {
            "Content-Type": "application/pdf",
            "Content-Disposition": f'inline; filename="report_{run_id}.pdf"',
            "X-Compilation-Log": log[:500].replace("\n", " "),
        }
        return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Compilation error: {exc}")
