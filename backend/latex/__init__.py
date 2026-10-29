"""
LaTeX compilation, security linting, escaping, and versioning package (WS5).
"""

from .linter import (
    lint_latex_source,
    assert_latex_safe,
    escape_latex,
    validate_ieee_structure,
    ForbiddenCommandError,
)
from .compiler import (
    LatexCompiler,
    parse_tex_log,
    compile_with_auto_repair,
)
from .versioning import (
    PaperVersionManager,
    ConcurrencyConflictError,
    MAX_VERSIONS_PER_PAPER,
)

__all__ = [
    "lint_latex_source",
    "assert_latex_safe",
    "escape_latex",
    "validate_ieee_structure",
    "ForbiddenCommandError",
    "LatexCompiler",
    "parse_tex_log",
    "compile_with_auto_repair",
    "PaperVersionManager",
    "ConcurrencyConflictError",
    "MAX_VERSIONS_PER_PAPER",
]
