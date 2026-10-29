"""
Comprehensive Test Suite for WS5: Paper Composer, IEEEtran LaTeX Generation,
Grounding Verification Pass, Security Linter, Compiler Service, and 50-Version History.
"""

from __future__ import annotations

import re
from uuid import uuid4

import pytest

from agents.paper_composer import (
    PaperComposer,
    build_bibtex_database,
    generate_bibtex_key,
    strip_hallucinated_citations,
    verify_grounding,
)
from latex.compiler import (
    LatexCompiler,
    compile_with_auto_repair,
    parse_tex_log,
)
from latex.linter import (
    ForbiddenCommandError,
    assert_latex_safe,
    escape_latex,
    lint_latex_source,
    validate_ieee_structure,
)
from latex.versioning import (
    ConcurrencyConflictError,
    MAX_VERSIONS_PER_PAPER,
    PaperVersionManager,
)
from shared.models import (
    CompileError,
    PaperComposerInput,
    SourceRecord,
)


@pytest.fixture
def sample_sources() -> list[SourceRecord]:
    """Sample research sources with academic metadata for testing."""
    return [
        SourceRecord(
            id=uuid4(),
            chat_id=uuid4(),
            user_id=uuid4(),
            url="https://arxiv.org/abs/2401.00001",
            title="Scalable Multi-Agent Research Frameworks",
            authors=["Alice Smith", "Bob Jones"],
            venue="International Conference on Machine Learning (ICML)",
            year=2024,
            arxiv_id="2401.00001",
            bib_key="smith2024scalable",
            relevance_score=0.95,
        ),
        SourceRecord(
            id=uuid4(),
            chat_id=uuid4(),
            user_id=uuid4(),
            url="https://doi.org/10.1145/1234567.89",
            title="Grounding Generative Language Models in Scientific Workflows",
            authors=["Carol Williams", "David Brown"],
            venue="ACM Computing Surveys",
            year=2025,
            doi="10.1145/1234567.89",
            bib_key="williams2025grounding",
            relevance_score=0.92,
        ),
        SourceRecord(
            id=uuid4(),
            chat_id=uuid4(),
            user_id=uuid4(),
            url="https://example.org/autonomous-agents",
            title="Autonomous Scientific Discovery: A Review",
            authors=["Eva Green"],
            venue="IEEE Transactions on Knowledge and Data Engineering",
            year=2026,
            relevance_score=0.88,
        ),
    ]


# ==============================================================================
# 1. LaTeX Security Linter Tests
# ==============================================================================

def test_linter_allows_safe_ieee_document():
    safe_tex = r"""
    \documentclass[conference]{IEEEtran}
    \begin{document}
    \title{Safe Title}
    \maketitle
    \section{Introduction}
    Here is a safe statement.
    \end{document}
    """
    assert_latex_safe(safe_tex)
    errors = lint_latex_source(safe_tex)
    assert len(errors) == 0


@pytest.mark.parametrize(
    "malicious_snippet",
    [
        r"\write18{rm -rf /}",
        r"\immediate\write18{whoami}",
        r"\input{/etc/passwd}",
        r"\include{secrets.tex}",
        r"\openin 1=file.txt",
        r"\openout 1=evil.sh",
        r"\read 1 to \myline",
        r"\ShellEscape{cmd}",
        r"\usepackage[shellescape]{shellesc}",
        r"\csname malicious\endcsname",
        r"\catcode`\@=11",
    ],
)
def test_linter_blocks_forbidden_commands(malicious_snippet: str):
    tex = f"""
    \\documentclass[conference]{{IEEEtran}}
    \\begin{{document}}
    \\title{{Injected Title}}
    {malicious_snippet}
    \\end{{document}}
    """
    with pytest.raises(ForbiddenCommandError):
        assert_latex_safe(tex)

    errors = lint_latex_source(tex)
    assert any("Forbidden command detected" in e for e in errors)


def test_escape_latex_handles_special_characters():
    raw_text = "50% of R&D costs > $1000 #1 with {nested} data & underscore_var ~ 10^2 \\ backslash"
    escaped = escape_latex(raw_text)

    # Must escape %, &, $, #, _, {, }, ~, ^, \
    assert r"\%" in escaped
    assert r"\&" in escaped
    assert r"\$" in escaped
    assert r"\#" in escaped
    assert r"\_" in escaped
    assert r"\{" in escaped
    assert r"\}" in escaped
    assert r"\textasciitilde{}" in escaped
    assert r"\textasciicircum{}" in escaped
    assert r"\textbackslash{}" in escaped


# ==============================================================================
# 2. BibTeX Generation & Grounding Verification Tests
# ==============================================================================

def test_build_bibtex_database(sample_sources: list[SourceRecord]):
    bib_str, key_map = build_bibtex_database(sample_sources)

    assert "smith2024scalable" in bib_str
    assert "williams2025grounding" in bib_str
    assert "2401.00001" in bib_str
    assert "10.1145/1234567.89" in bib_str
    assert len(key_map) == 3


def test_verify_grounding_detects_valid_and_hallucinated_citations(sample_sources: list[SourceRecord]):
    bib_str, _ = build_bibtex_database(sample_sources)

    # Document citing 2 valid keys and 1 hallucinated key
    tex_doc = r"""
    \documentclass[conference]{IEEEtran}
    \begin{document}
    Prior work by \cite{smith2024scalable} and \cite{williams2025grounding} established frameworks.
    However, hallucinated claim \cite{ghost2099fake} is completely fabricated.
    \end{document}
    """

    score, valid_keys, hallucinated = verify_grounding(tex_doc, bib_str, sample_sources)

    assert "smith2024scalable" in valid_keys
    assert "williams2025grounding" in valid_keys
    assert "ghost2099fake" in hallucinated
    assert len(valid_keys) == 2
    assert len(hallucinated) == 1
    assert score == pytest.approx(2 / 3, 0.01)


def test_strip_hallucinated_citations():
    tex = r"Recent studies \cite{smith2024scalable, fakeKey1} showed results, while \cite{ghostKey2} claimed otherwise."
    cleaned = strip_hallucinated_citations(tex, ["fakeKey1", "ghostKey2"])

    assert "fakeKey1" not in cleaned
    assert "ghostKey2" not in cleaned
    assert "smith2024scalable" in cleaned


# ==============================================================================
# 3. IEEEtran Structural Validation Tests
# ==============================================================================

def test_validate_ieee_structure_complete():
    composer = PaperComposer()
    sources = [
        SourceRecord(
            id=uuid4(),
            chat_id=uuid4(),
            user_id=uuid4(),
            url="https://arxiv.org/abs/2401.00001",
            title="Multi-Agent Systems",
            authors=["A. Researcher"],
            year=2024,
            arxiv_id="2401.00001",
        )
    ]
    bib_str, key_map = build_bibtex_database(sources)
    tex = composer.generate_baseline_ieee_tex("Autonomous Research Swarms", sources, key_map)

    is_valid, missing = validate_ieee_structure(tex)
    assert is_valid is True
    assert len(missing) == 0

    # Verify presence of comparative table
    assert r"\begin{table*}" in tex or r"\begin{table}" in tex
    assert "Systematic Comparative Evaluation" in tex


def test_validate_ieee_structure_catches_missing_elements():
    incomplete_tex = r"""
    \documentclass{article}
    \begin{document}
    \section{Introduction}
    Missing title, abstract, methodology, table, conclusion.
    \end{document}
    """
    is_valid, missing = validate_ieee_structure(incomplete_tex)
    assert is_valid is False
    assert any("Document class must be IEEEtran" in m for m in missing)
    assert any("Missing required section/element: Abstract" in m for m in missing)


# ==============================================================================
# 4. TeX Log Parser & Auto-Repair Loop Tests
# ==============================================================================

def test_parse_tex_log_extracts_errors():
    mock_log = """
This is pdfTeX, Version 3.141592653-2.6-1.40.24 (TeX Live 2022)
entering extended mode
(./main.tex
LaTeX2e <2022-11-01> patch level 1
! Undefined control sequence.
l.42 \nonexistentcommand{arg}
                             The following text...
! Missing $ inserted.
l.68 In mathematical formula x_i
                                 without math mode
)
! Emergency stop.
    """
    errors = parse_tex_log(mock_log)
    assert len(errors) >= 2

    e1 = errors[0]
    assert e1.line == 42
    assert e1.error_type == "UndefinedControlSequence"
    assert "Undefined control sequence" in e1.message

    e2 = errors[1]
    assert e2.line == 68
    assert e2.error_type == "MissingDelimiter"
    assert "Missing $" in e2.message


@pytest.mark.asyncio
async def test_compile_auto_repair_loop_fixes_error():
    broken_tex = r"""
    \documentclass[conference]{IEEEtran}
    \begin{document}
    \title{Test Paper}
    \maketitle
    \section{Introduction}
    \badcommand
    \end{document}
    """

    class MockCompiler:
        def __init__(self):
            self.attempts = 0

        def compile(self, tex: str, bib_source: str = "", mock_in_test: bool = False):
            self.attempts += 1
            if r"\badcommand" in tex:
                from shared.models import CompileResult
                return CompileResult(
                    success=False,
                    compile_status="failed",
                    page_count=0,
                    errors=[CompileError(file="main.tex", line=7, error_type="UndefinedControlSequence", message="Undefined control sequence")],
                    log="! Undefined control sequence.\nl.7 \\badcommand",
                )
            else:
                from shared.models import CompileResult
                return CompileResult(
                    success=True,
                    compile_status="success",
                    page_count=5,
                    pdf_bytes=b"%PDF-1.5 test",
                    errors=[],
                    log="Success",
                )

    mock_comp = MockCompiler()

    async def mock_repair(current_tex: str, errors: list[CompileError]) -> str:
        # LLM replaces \badcommand with valid text
        return current_tex.replace(r"\badcommand", "Repaired text content.")

    result, final_tex = await compile_with_auto_repair(
        tex_source=broken_tex,
        bib_source="",
        repair_fn=mock_repair,
        compiler=mock_comp,
        max_attempts=3,
        mock_in_test=True,
    )

    assert result.success is True
    assert result.compile_status == "success"
    assert r"\badcommand" not in final_tex
    assert "Repaired text content" in final_tex


# ==============================================================================
# 5. Paper Version Management & Optimistic Concurrency Tests
# ==============================================================================

def test_version_manager_monotonic_and_optimistic_concurrency():
    manager = PaperVersionManager()
    manager.clear_in_memory_store()

    chat_id = uuid4()
    user_id = uuid4()

    # 1. Create paper
    paper = manager.get_or_create_paper(chat_id, user_id, title="Quantum Computing Survey")
    assert paper.current_version == 1

    # 2. Save version 1
    v1 = manager.save_version(
        paper_id=paper.id,
        chat_id=chat_id,
        user_id=user_id,
        tex_source="\\documentclass{IEEEtran}...",
        expected_version=1,
    )
    assert v1.version == 1

    # 3. Save version 2 with correct expected_version=1
    v2 = manager.save_version(
        paper_id=paper.id,
        chat_id=chat_id,
        user_id=user_id,
        tex_source="\\documentclass{IEEEtran} v2...",
        expected_version=1,
    )
    assert v2.version == 2

    # 4. Conflict: caller expects version 1, but paper is already at version 2
    with pytest.raises(ConcurrencyConflictError) as exc_info:
        manager.save_version(
            paper_id=paper.id,
            chat_id=chat_id,
            user_id=user_id,
            tex_source="Conflicting concurrent edit...",
            expected_version=1,
        )
    assert "Optimistic lock conflict" in str(exc_info.value)


def test_version_history_cap_at_50():
    manager = PaperVersionManager()
    manager.clear_in_memory_store()

    chat_id = uuid4()
    user_id = uuid4()
    paper = manager.get_or_create_paper(chat_id, user_id, title="Version Cap Test")

    # Add 55 versions
    for i in range(1, 56):
        cur_ver = manager.get_paper(chat_id, user_id).current_version
        manager.save_version(
            paper_id=paper.id,
            chat_id=chat_id,
            user_id=user_id,
            tex_source=f"Version {i} content",
            expected_version=cur_ver if i > 1 else None,
        )

    versions = manager.list_versions(paper.id, user_id)
    assert len(versions) == MAX_VERSIONS_PER_PAPER  # 50
    # Baseline version 1 is preserved
    assert any(v.version == 1 for v in versions)


# ==============================================================================
# 6. End-to-End PaperComposer Integration Test
# ==============================================================================

@pytest.mark.asyncio
async def test_paper_composer_full_workflow(
    sample_sources: list[SourceRecord],
    monkeypatch: pytest.MonkeyPatch,
):
    manager = PaperVersionManager()
    manager.clear_in_memory_store()

    # Fast offline mock for LLM router
    async def mock_complete(*args, **kwargs):
        return None, "mock_provider:mock_model"

    monkeypatch.setattr("agents.paper_composer.llm_router.complete", mock_complete)

    composer = PaperComposer(version_manager=manager)

    chat_id = uuid4()
    user_id = uuid4()

    input_data = PaperComposerInput(
        chat_id=chat_id,
        user_id=user_id,
        topic="Scalable Autonomous Multi-Agent Swarms",
        sources=sample_sources,
        target_pages=5,
        version=1,
    )

    output = await composer.compose_paper(input_data, compile_pdf=True, mock_in_test=True)

    assert output.chat_id == chat_id
    assert output.version == 1
    assert output.grounding_score >= 0.90
    assert output.validation_passed is True
    assert len(output.sections) >= 5
    assert output.estimated_pages >= 1

    # Check that paper record and version history were persisted
    paper = manager.get_paper(chat_id, user_id)
    assert paper is not None
    versions = manager.list_versions(paper.id, user_id)
    assert len(versions) == 1
    assert versions[0].version == 1
