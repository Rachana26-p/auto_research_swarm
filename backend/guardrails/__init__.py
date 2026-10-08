"""
Guardrails module: centralized security, schema validation, egress control,
untrusted content delimiting, and decision audit logging.
"""

from .egress import (
    validate_url_and_egress,
    check_ssrf_hostname,
    is_ip_blocked,
)
from .content_delimiters import (
    delimit_untrusted_content,
    format_extraction_user_prompt,
    format_validator_user_prompt,
    detect_injection_patterns,
)
from .tool_schema import (
    validate_tool_schema,
)
from .event_logger import (
    log_guardrail_event,
    record_guardrail_decision,
    get_guardrail_events,
    clear_guardrail_events,
)

__all__ = [
    # Egress & SSRF
    "validate_url_and_egress",
    "check_ssrf_hostname",
    "is_ip_blocked",
    # Delimiters & Injection scanning
    "delimit_untrusted_content",
    "format_extraction_user_prompt",
    "format_validator_user_prompt",
    "detect_injection_patterns",
    # Tool validation
    "validate_tool_schema",
    # Event logging
    "log_guardrail_event",
    "record_guardrail_decision",
    "get_guardrail_events",
    "clear_guardrail_events",
]
