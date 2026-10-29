"""Agents package for Autonomous Research Swarm."""

from .extractor import (
    extractor_node,
    run_extractor_sync,
    format_as_markdown,
    sanitize_filename,
)
from .planner import (
    planner_node,
    run_planner_sync,
)
from .discovery import (
    discovery_node,
    run_discovery_sync,
)
from .writer import (
    writer_node,
    run_writer_sync,
)
from .paper_composer import (
    PaperComposer,
    generate_bibtex_key,
    build_bibtex_database,
    verify_grounding,
    strip_hallucinated_citations,
)

__all__ = [
    "extractor_node",
    "run_extractor_sync",
    "format_as_markdown",
    "sanitize_filename",
    "planner_node",
    "run_planner_sync",
    "discovery_node",
    "run_discovery_sync",
    "writer_node",
    "run_writer_sync",
    "PaperComposer",
    "generate_bibtex_key",
    "build_bibtex_database",
    "verify_grounding",
    "strip_hallucinated_citations",
]