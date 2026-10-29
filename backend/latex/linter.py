"""
LaTeX Security Linter, Escaping Utilities, and IEEEtran Structural Validator (WS5).

Guarantees:
- Strict rejection of malicious TeX primitives (shell escape, arbitrary file write/read).
- Safe escaping of dynamic untrusted text.
- Validation of required IEEEtran conference sections and comparative table.
"""

from __future__ import annotations

import re

# Primitives and macros that allow shell escape, filesystem read/write, or dynamic macro injection
FORBIDDEN_COMMAND_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("write18", re.compile(r"\\write18\b", re.IGNORECASE)),
    ("immediate_write", re.compile(r"\\immediate\s*\\write\b", re.IGNORECASE)),
    ("input", re.compile(r"(?:\\input|\\@@input)\b(?!\s*\{IEEEtran\})", re.IGNORECASE)),
    ("include", re.compile(r"\\include(?:only)?\b", re.IGNORECASE)),
    ("openin", re.compile(r"\\openin\b", re.IGNORECASE)),
    ("openout", re.compile(r"\\openout\b", re.IGNORECASE)),
    ("read", re.compile(r"\\read\b", re.IGNORECASE)),
    ("shell_escape", re.compile(r"\\(?:ShellEscape\b|usepackage\[[^\]]*\]\{shellesc\})", re.IGNORECASE)),
    ("catcode", re.compile(r"\\catcode\b", re.IGNORECASE)),
    ("csname", re.compile(r"\\csname\b", re.IGNORECASE)),
    ("primitive", re.compile(r"\\primitive\b", re.IGNORECASE)),
]


class ForbiddenCommandError(ValueError):
    """Raised when a forbidden or unsafe LaTeX command is detected."""
    pass


def strip_comments(tex_source: str) -> str:
    """Strip LaTeX comments (% ...) while preserving escaped percent signs (\\%)."""
    lines = []
    for line in tex_source.splitlines():
        # Match unescaped percent sign
        parts = re.split(r"(?<!\\)%", line, maxsplit=1)
        lines.append(parts[0])
    return "\n".join(lines)


def lint_latex_source(tex_source: str) -> list[str]:
    """
    Scans LaTeX source for dangerous commands and syntax violations.
    Returns a list of error descriptions (empty list if safe).
    """
    errors: list[str] = []
    clean_code = strip_comments(tex_source)

    for name, pattern in FORBIDDEN_COMMAND_PATTERNS:
        match = pattern.search(clean_code)
        if match:
            errors.append(f"Forbidden command detected: '{match.group(0)}' (policy: {name})")

    if "\\documentclass" not in clean_code:
        errors.append("Missing \\documentclass declaration")

    if "\\begin{document}" not in clean_code or "\\end{document}" not in clean_code:
        errors.append("Missing \\begin{document} or \\end{document} environment")

    return errors


def assert_latex_safe(tex_source: str) -> None:
    """
    Validates that the LaTeX source contains no forbidden commands.
    Raises ForbiddenCommandError if any violation is found.
    """
    errors = lint_latex_source(tex_source)
    forbidden = [e for e in errors if e.startswith("Forbidden command")]
    if forbidden:
        raise ForbiddenCommandError("; ".join(forbidden))


LATEX_ESCAPE_MAP = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}
LATEX_ESCAPE_REGEX = re.compile(r"[\\&%$#_{}~^]")


def escape_latex(text: str) -> str:
    """
    Safely escapes untrusted text for inclusion inside LaTeX body paragraphs using single-pass regex.
    Special characters handled: &, %, $, #, _, {, }, ~, ^, \\
    """
    if not text:
        return ""
    return LATEX_ESCAPE_REGEX.sub(lambda m: LATEX_ESCAPE_MAP[m.group(0)], text)


REQUIRED_IEEE_SECTIONS = [
    ("Title", re.compile(r"\\title\{", re.IGNORECASE)),
    ("Abstract", re.compile(r"\\begin\{abstract\}", re.IGNORECASE)),
    ("Keywords", re.compile(r"\\begin\{(?:IEEE)?keywords\}", re.IGNORECASE)),
    ("Section: Introduction", re.compile(r"\\section\{.*Introduction.*\}", re.IGNORECASE)),
    ("Section: Literature Survey / Related Work", re.compile(r"\\section\{.*(?:Literature|Related Work|Prior Work).*\}", re.IGNORECASE)),
    ("Comparative Table", re.compile(r"\\begin\{table\*?\}", re.IGNORECASE)),
    ("Section: Methodology", re.compile(r"\\section\{.*Methodology.*\}", re.IGNORECASE)),
    ("Section: Findings / Analysis", re.compile(r"\\section\{.*(?:Analysis|Findings|Results|Thematic).*\}", re.IGNORECASE)),
    ("Section: Discussion / Limitations", re.compile(r"\\section\{.*(?:Discussion|Limitations).*\}", re.IGNORECASE)),
    ("Section: Conclusion", re.compile(r"\\section\{.*Conclusion.*\}", re.IGNORECASE)),
]


def validate_ieee_structure(tex_source: str) -> tuple[bool, list[str]]:
    """
    Validates that the document adheres to the mandatory IEEEtran conference layout.
    Returns (is_valid, missing_elements).
    """
    clean_code = strip_comments(tex_source)
    missing: list[str] = []

    if not re.search(r"\\documentclass(?:\[[^\]]*\])?\{IEEEtran\}", clean_code, re.IGNORECASE):
        missing.append("Document class must be IEEEtran")

    for section_name, pattern in REQUIRED_IEEE_SECTIONS:
        if not pattern.search(clean_code):
            missing.append(f"Missing required section/element: {section_name}")

    return len(missing) == 0, missing


__all__ = [
    "FORBIDDEN_COMMAND_PATTERNS",
    "ForbiddenCommandError",
    "lint_latex_source",
    "assert_latex_safe",
    "escape_latex",
    "validate_ieee_structure",
    "strip_comments",
]
