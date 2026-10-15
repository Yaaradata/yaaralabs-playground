"""
Label names for text and image projects (docs/hardening.md, item 9).

Labels go into URLs (DELETE .../labels/{label}) and into storage paths (images/{pid}/{label}/...).
"cats/dogs", "Q&A?" or "#1" could be created but never deleted. A label is now: trimmed, 1-50
characters, none of / ? # % \\ and no control characters, and not a second spelling of an existing
label that differs only by case. Letters in any script (Tamil, Hindi, ...) are fine. The frontend
applies the same rule (frontend/lib/labels.ts).
"""

from __future__ import annotations

import re
from typing import Iterable

MAX_LABEL = 50
_FORBIDDEN = re.compile(r"[/?#%\\\x00-\x1f\x7f]")


class LabelError(ValueError):
    """The label can't be used (the message is shown to the learner)."""


def clean_label(label: str, existing: Iterable[str] = ()) -> str:
    """The label as it will be stored, or LabelError."""
    name = " ".join(str(label or "").split())
    if not name:
        raise LabelError("Enter a label name.")
    if len(name) > MAX_LABEL:
        raise LabelError(f"A label can be at most {MAX_LABEL} characters.")
    if _FORBIDDEN.search(name):
        raise LabelError("A label can't contain / ? # % or \\.")
    for other in existing or ():
        other = " ".join(str(other or "").split())
        if other.lower() == name.lower() and other != name:
            raise LabelError(f'There is already a label called "{other}".')
    return name
