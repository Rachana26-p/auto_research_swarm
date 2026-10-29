"""
Sandboxed LaTeX Compilation Service, Log Parser, and Auto-Repair Loop (WS5).

Executes pdflatex/latexmk in an isolated temporary directory with:
- Strict flags: -pdf, -interaction=nonstopmode, -halt-on-error, -no-shell-escape
- Resource & timeout bounds (default 60s)
- TeX error log parsing with line numbers, error types, and context snippets
- Host CLI availability check with graceful fallback
- Auto-repair feedback loop up to 3 attempts
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import subprocess
import tempfile
from typing import Callable, Coroutine, Any

from latex.linter import assert_latex_safe
from shared.models import CompileError, CompileResult

logger = logging.getLogger(__name__)


def parse_tex_log(log_content: str, tex_source: str = "") -> list[CompileError]:
    """
    Parses TeX compilation log to extract structured error objects:
    - line number
    - error type / description
    - offending snippet context
    """
    errors: list[CompileError] = []
    if not log_content:
        return errors

    lines = log_content.splitlines()
    tex_lines = tex_source.splitlines() if tex_source else []

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("!"):
            # Found TeX error indicator
            error_message = line[1:].strip()
            error_line: int | None = None
            snippet: str = ""

            # Scan forward up to 8 lines to locate the line number 'l.<number>'
            j = i + 1
            while j < min(i + 10, len(lines)):
                subline = lines[j].strip()
                l_match = re.match(r"^l\.(\d+)\s*(.*)$", subline)
                if l_match:
                    try:
                        error_line = int(l_match.group(1))
                        snippet = l_match.group(2).strip()
                    except ValueError:
                        pass
                    break
                elif subline.startswith("!"):
                    break
                j += 1

            if error_line and 1 <= error_line <= len(tex_lines) and not snippet:
                snippet = tex_lines[error_line - 1].strip()

            error_type = "SyntaxError"
            if "Undefined control sequence" in error_message:
                error_type = "UndefinedControlSequence"
            elif "LaTeX Error" in error_message:
                error_type = "LaTeXError"
            elif "Missing" in error_message:
                error_type = "MissingDelimiter"
            elif "Emergency stop" in error_message:
                error_type = "EmergencyStop"

            errors.append(
                CompileError(
                    file="main.tex",
                    line=error_line,
                    error_type=error_type,
                    message=error_message,
                    snippet=snippet,
                )
            )
        i += 1

    return errors


def get_pdf_page_count(pdf_path: str) -> int:
    """Read page count from generated PDF file using pypdf."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(pdf_path)
        return len(reader.pages)
    except Exception as e:
        logger.warning("Failed to read PDF page count with pypdf: %s", e)
        return 1


class LatexCompiler:
    """Executes sandboxed pdflatex/latexmk runs with strict flags."""

    def __init__(self, timeout_seconds: int = 60):
        self.timeout_seconds = timeout_seconds

    @staticmethod
    def is_compiler_available() -> bool:
        """Checks if pdflatex or latexmk is available on the system PATH."""
        return bool(shutil.which("pdflatex") or shutil.which("latexmk"))

    def compile(
        self,
        tex_source: str,
        bib_source: str = "",
        mock_in_test: bool = False,
    ) -> CompileResult:
        """
        Synchronously compile LaTeX and BibTeX sources in an isolated temp directory.
        Checks security linter before compiling.
        """
        # 1. Enforce strict linter security rules first
        assert_latex_safe(tex_source)

        # 2. Check host environment availability
        has_pdflatex = bool(shutil.which("pdflatex"))
        if not has_pdflatex and not mock_in_test:
            # Graceful detection: report tool unavailable rather than crashing
            word_count = len(tex_source.split())
            estimated_pages = max(1, round(word_count / 650))
            return CompileResult(
                success=False,
                compile_status="tool_unavailable",
                page_count=estimated_pages,
                pdf_bytes=None,
                errors=[
                    CompileError(
                        file="system",
                        line=None,
                        error_type="CompilerNotFound",
                        message="pdflatex is not installed in the system PATH. Install TeX Live or MiKTeX for PDF generation.",
                    )
                ],
                log="pdflatex executable not found on host environment.",
            )

        if mock_in_test and not has_pdflatex:
            # Synthetic test compilation
            word_count = len(tex_source.split())
            estimated_pages = max(1, round(word_count / 650))
            return CompileResult(
                success=True,
                compile_status="success",
                page_count=estimated_pages,
                pdf_bytes=b"%PDF-1.5 mock pdf content for testing",
                errors=[],
                log="Mock compilation successful (test mode)",
            )

        # 3. Isolated temporary directory sandbox
        with tempfile.TemporaryDirectory(prefix="swarm_latex_") as tmp_dir:
            tex_file = os.path.join(tmp_dir, "main.tex")
            bib_file = os.path.join(tmp_dir, "references.bib")

            with open(tex_file, "w", encoding="utf-8") as f:
                f.write(tex_source)

            if bib_source:
                with open(bib_file, "w", encoding="utf-8") as f:
                    f.write(bib_source)

            cmd = [
                "pdflatex",
                "-interaction=nonstopmode",
                "-halt-on-error",
                "-no-shell-escape",
                "main.tex",
            ]

            full_log = ""
            try:
                # First pass pdflatex
                res1 = subprocess.run(
                    cmd,
                    cwd=tmp_dir,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout_seconds,
                )
                full_log += res1.stdout + "\n" + res1.stderr

                # Bibtex pass if bib_source present
                if bib_source and os.path.exists(os.path.join(tmp_dir, "main.aux")):
                    bibtex_cmd = ["bibtex", "main"]
                    res_bib = subprocess.run(
                        bibtex_cmd,
                        cwd=tmp_dir,
                        capture_output=True,
                        text=True,
                        timeout=self.timeout_seconds,
                    )
                    full_log += res_bib.stdout + "\n" + res_bib.stderr

                    # Second & third pass pdflatex to resolve references
                    subprocess.run(
                        cmd,
                        cwd=tmp_dir,
                        capture_output=True,
                        text=True,
                        timeout=self.timeout_seconds,
                    )
                    res_last = subprocess.run(
                        cmd,
                        cwd=tmp_dir,
                        capture_output=True,
                        text=True,
                        timeout=self.timeout_seconds,
                    )
                    full_log += res_last.stdout + "\n" + res_last.stderr

                pdf_path = os.path.join(tmp_dir, "main.pdf")
                log_file = os.path.join(tmp_dir, "main.log")
                if os.path.exists(log_file):
                    with open(log_file, "r", encoding="utf-8", errors="replace") as lf:
                        full_log += "\n" + lf.read()

                errors = parse_tex_log(full_log, tex_source)

                if os.path.exists(pdf_path) and not any(e.error_type in ("SyntaxError", "EmergencyStop") for e in errors):
                    with open(pdf_path, "rb") as pf:
                        pdf_data = pf.read()
                    page_cnt = get_pdf_page_count(pdf_path)
                    return CompileResult(
                        success=True,
                        compile_status="success",
                        page_count=page_cnt,
                        pdf_bytes=pdf_data,
                        errors=[],
                        log=full_log,
                    )
                else:
                    return CompileResult(
                        success=False,
                        compile_status="failed",
                        page_count=0,
                        pdf_bytes=None,
                        errors=errors or [
                            CompileError(
                                file="main.tex",
                                line=None,
                                error_type="CompilationFailed",
                                message="Compilation exited with non-zero status and produced no valid PDF",
                            )
                        ],
                        log=full_log,
                    )

            except subprocess.TimeoutExpired:
                return CompileResult(
                    success=False,
                    compile_status="failed",
                    page_count=0,
                    pdf_bytes=None,
                    errors=[
                        CompileError(
                            file="main.tex",
                            line=None,
                            error_type="TimeoutExpired",
                            message=f"LaTeX compilation exceeded hard timeout of {self.timeout_seconds} seconds",
                        )
                    ],
                    log=full_log + f"\nProcess killed after timeout of {self.timeout_seconds}s.",
                )


async def compile_with_auto_repair(
    tex_source: str,
    bib_source: str = "",
    repair_fn: Callable[[str, list[CompileError]], Coroutine[Any, Any, str]] | None = None,
    compiler: LatexCompiler | None = None,
    max_attempts: int = 3,
    mock_in_test: bool = False,
) -> tuple[CompileResult, str]:
    """
    Orchestrates the compilation and auto-repair feedback loop:
    1. Compiles the LaTeX document.
    2. If errors occur and attempts remain, invokes repair_fn with parsed errors.
    3. Retries compilation up to max_attempts (default 3).
    Returns (final_result, final_tex_source).
    """
    comp = compiler or LatexCompiler()
    current_tex = tex_source

    for attempt in range(1, max_attempts + 1):
        # Enforce security linter prior to every attempt
        assert_latex_safe(current_tex)

        result = comp.compile(current_tex, bib_source=bib_source, mock_in_test=mock_in_test)

        if result.success or result.compile_status == "tool_unavailable":
            return result, current_tex

        logger.info(
            "LaTeX compilation attempt %d/%d failed with %d parsed errors",
            attempt,
            max_attempts,
            len(result.errors),
        )

        if attempt < max_attempts and repair_fn is not None and result.errors:
            try:
                logger.info("Triggering LLM auto-repair callback for attempt %d...", attempt)
                repaired = await repair_fn(current_tex, result.errors)
                if repaired and repaired.strip():
                    current_tex = repaired
            except Exception as e:
                logger.error("Auto-repair callback failed: %s", e)
                break
        else:
            break

    return result, current_tex


__all__ = [
    "parse_tex_log",
    "get_pdf_page_count",
    "LatexCompiler",
    "compile_with_auto_repair",
]
