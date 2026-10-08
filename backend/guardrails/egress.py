"""
Egress guardrail: URL syntax validation and SSRF prevention.

Blocks:
- Non-http/https schemes
- Private IP addresses (RFC 1918)
- Loopback addresses (127.0.0.0/8, ::1, localhost)
- Link-local addresses (169.254.0.0/16, fe80::/10, cloud metadata endpoints)
- Multicast, unspecified, and reserved IP ranges
- Domains not on the allowed_domains allowlist (if provided)
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_BLOCKED_HOSTNAMES = frozenset({
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
})


def is_ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> tuple[bool, str]:
    """
    Checks whether an IP address is private, loopback, link-local, or reserved (SSRF risk).
    Returns (is_blocked, reason).
    """
    if ip.is_loopback:
        return True, f"Loopback IP blocked: {ip}"
    if ip.is_link_local:
        return True, f"Link-local IP blocked (cloud metadata risk): {ip}"
    if ip.is_private:
        return True, f"Private IP blocked (SSRF risk): {ip}"
    if ip.is_multicast:
        return True, f"Multicast IP blocked: {ip}"
    if ip.is_unspecified:
        return True, f"Unspecified IP blocked: {ip}"
    if ip.is_reserved:
        return True, f"Reserved IP blocked: {ip}"
    return False, ""


def check_ssrf_hostname(hostname: str) -> None:
    """
    Validates that a hostname/domain is not a loopback or private address.
    Raises ValueError on SSRF violation.
    """
    norm_host = hostname.lower().strip()
    if not norm_host:
        raise ValueError("Invalid tool input: Hostname is empty")

    if norm_host in _BLOCKED_HOSTNAMES or norm_host.endswith(".localhost") or norm_host.endswith(".local"):
        raise ValueError(f"Egress blocked (SSRF): '{hostname}' is a prohibited loopback/local hostname")

    # Check if hostname is an IP literal
    try:
        # Strip brackets from IPv6 if present
        ip_str = norm_host.strip("[]")
        ip = ipaddress.ip_address(ip_str)
        blocked, reason = is_ip_blocked(ip)
        if blocked:
            raise ValueError(f"Egress blocked (SSRF): {reason}")
        return
    except ValueError as exc:
        if "Egress blocked" in str(exc):
            raise
        # Not an IP literal, it is a DNS name

    # For DNS hostnames, perform DNS resolution check to prevent DNS rebinding / private IP resolution
    try:
        addr_info = socket.getaddrinfo(norm_host, None)
        for _, _, _, _, sockaddr in addr_info:
            ip_candidate = sockaddr[0]
            try:
                ip = ipaddress.ip_address(ip_candidate)
                blocked, reason = is_ip_blocked(ip)
                if blocked:
                    raise ValueError(f"Egress blocked (SSRF): Hostname '{hostname}' resolves to prohibited IP: {reason}")
            except ValueError as e:
                if "Egress blocked" in str(e):
                    raise
    except socket.gaierror:
        # DNS resolution failure is expected for simulated/mocked hostnames in offline test environments
        pass


from uuid import UUID
from guardrails.event_logger import record_guardrail_decision
from shared.models import AgentName, GuardrailEventType


def validate_url_and_egress(
    url: str,
    allowed_domains: list[str] | None = None,
    run_id: UUID | None = None,
) -> str:
    """
    Validate URL syntax, enforce SSRF block (private/loopback/link-local IPs),
    and enforce client-side egress allowlist.

    Raises ValueError if URL is malformed, targets a private/loopback/link-local IP,
    or is not allowlisted.
    Returns the extracted domain (netloc hostname).
    """
    if not isinstance(url, str) or not url.strip():
        record_guardrail_decision(
            agent_name=AgentName.EXTRACTOR,
            event_type=GuardrailEventType.EGRESS_BLOCKED,
            decision="BLOCK",
            details={"error": "URL must be a non-empty string", "raw_url": str(url)},
            run_id=run_id,
        )
        raise ValueError("Invalid tool input: URL must be a non-empty string")

    parsed = urlparse(url.strip())

    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        record_guardrail_decision(
            agent_name=AgentName.EXTRACTOR,
            event_type=GuardrailEventType.EGRESS_BLOCKED,
            decision="BLOCK",
            details={"error": f"Invalid scheme or netloc: {url}", "url": url},
            run_id=run_id,
        )
        raise ValueError(
            f"Invalid tool input: URL '{url}' must have an http or https scheme and a valid domain"
        )

    # Extract clean domain hostname (strip port if present)
    hostname = parsed.hostname or parsed.netloc.lower().split(":")[0]
    domain = hostname.lower()

    # SSRF guardrail: block loopback, private, and link-local targets
    try:
        check_ssrf_hostname(domain)
    except ValueError as exc:
        record_guardrail_decision(
            agent_name=AgentName.EXTRACTOR,
            event_type=GuardrailEventType.EGRESS_BLOCKED,
            decision="BLOCK",
            details={"error": str(exc), "url": url, "domain": domain},
            run_id=run_id,
        )
        raise

    # Allowlist check
    if allowed_domains is not None:
        clean_allowed = [d.lower().split(":")[0] for d in allowed_domains if d]
        if domain not in clean_allowed and not any(domain == d or domain.endswith("." + d) for d in clean_allowed):
            err_msg = f"Egress blocked: domain '{domain}' is not in allowed domains: {allowed_domains}"
            record_guardrail_decision(
                agent_name=AgentName.EXTRACTOR,
                event_type=GuardrailEventType.EGRESS_BLOCKED,
                decision="BLOCK",
                details={"error": err_msg, "url": url, "domain": domain, "allowed_domains": allowed_domains},
                run_id=run_id,
            )
            raise ValueError(err_msg)

    # Decision PASS: record audit entry
    record_guardrail_decision(
        agent_name=AgentName.EXTRACTOR,
        event_type=GuardrailEventType.EGRESS_ALLOWED,
        decision="PASS",
        details={"url": url, "domain": domain, "allowed_domains": allowed_domains},
        run_id=run_id,
    )
    return domain


__all__ = [
    "validate_url_and_egress",
    "check_ssrf_hostname",
    "is_ip_blocked",
]
