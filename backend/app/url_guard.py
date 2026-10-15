"""
Links participants paste (an image URL, a knowledge-base link) are fetched by our server, so they
must not reach our own network (docs/hardening.md, P1 "SSRF"): http and https only, and every host
must resolve to public addresses. Redirects are followed by hand and each hop is checked again
(a public link could otherwise redirect to http://169.254.169.254/ or http://localhost/).
"""

from __future__ import annotations

import ipaddress
import socket
from typing import Optional
from urllib.parse import urljoin, urlsplit

MAX_REDIRECTS = 5


class UnsafeUrlError(ValueError):
    """A link we won't fetch (the message is shown to the learner)."""


def _blocked(ip: str) -> bool:
    addr = ipaddress.ip_address(ip.split("%", 1)[0])
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved
            or addr.is_multicast or addr.is_unspecified or not addr.is_global)


def check_public_url(url: str) -> str:
    """The URL if it is http(s) to a public host; otherwise UnsafeUrlError."""
    parts = urlsplit(str(url or "").strip())
    if parts.scheme.lower() not in ("http", "https"):
        raise UnsafeUrlError("Only http:// and https:// links can be used.")
    host = parts.hostname
    if not host:
        raise UnsafeUrlError("That link has no website name.")
    try:
        infos = socket.getaddrinfo(host, parts.port or (443 if parts.scheme.lower() == "https" else 80), proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError, ValueError):
        raise UnsafeUrlError("That website couldn't be found. Check the link.")
    if not infos or any(_blocked(info[4][0]) for info in infos):
        raise UnsafeUrlError("That link points to a private or local address, which can't be used.")
    return url


def next_hop(current: str, location: Optional[str]) -> str:
    """The checked target of a redirect."""
    if not location:
        raise UnsafeUrlError("The website redirected without saying where.")
    return check_public_url(urljoin(current, location))


def safe_requests_get(session, url: str, **kwargs):
    """requests GET that checks the URL and every redirect hop."""
    kwargs.pop("allow_redirects", None)
    current = check_public_url(url)
    for _ in range(MAX_REDIRECTS + 1):
        resp = session.get(current, allow_redirects=False, **kwargs)
        if resp.status_code in (301, 302, 303, 307, 308):
            current = next_hop(current, resp.headers.get("Location"))
            continue
        return resp
    raise UnsafeUrlError("Too many redirects.")
