"""
Uploaded file names (docs/hardening.md, item 10).

Images used to be stored under their original name, so every pasted "image.png" replaced the last
one, and the raw name went into a Content-Disposition header, which can't hold non-Latin-1 text
(macOS screenshot names contain U+202F; Tamil, emoji) and gave a 500. Files are now stored as
"{8 random hex}_{safe name}"; the original name stays in the record for display.
"""

from __future__ import annotations

import re
import uuid
from urllib.parse import quote

MAX_NAME = 60


def safe_name(filename: str, default: str = "image") -> str:
    """Letters, digits, . - _ only (others become _), no path, at most MAX_NAME characters."""
    base = re.split(r"[\\/]", str(filename or ""))[-1]
    stem, dot, ext = base.rpartition(".")
    if not dot:
        stem, ext = base, ""
    clean = lambda s: re.sub(r"_+", "_", re.sub(r"[^A-Za-z0-9._-]", "_", s)).strip("._")  # noqa: E731
    stem, ext = clean(stem) or default, clean(ext)[:8]
    room = MAX_NAME - (len(ext) + 1 if ext else 0)
    return f"{stem[:room]}.{ext}" if ext else stem[:MAX_NAME]


def storage_name(filename: str) -> str:
    """A unique storage name that keeps the original name readable."""
    return f"{uuid.uuid4().hex[:8]}_{safe_name(filename)}"


def content_disposition(filename: str, kind: str = "inline") -> str:
    """A Content-Disposition header that is valid for any name (RFC 6266 / 5987)."""
    ascii_name = safe_name(filename, "file")
    return f"{kind}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(str(filename or ascii_name), safe='')}"
