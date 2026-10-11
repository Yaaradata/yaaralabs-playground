"""RAG Chatbot text pipeline (pure functions, no I/O): extract, clean, chunk, keyword search, check answers.

Chunking modes
  sections  one chunk per numbered paragraph ("5.5.4. ..."), the way a regulation is written and
            cited. A heading-only paragraph ("5.5. Business Continuity Plan:") becomes context for
            the paragraphs under it; very short sibling items (6.2.1 ... 6.2.5) are kept together;
            long paragraphs are split with an overlap.
  words     fixed windows of N words with an overlap of M words, ignoring the document's structure.
Every chunk keeps where it came from: document, page(s) and paragraph number(s).
"""

from __future__ import annotations

import io
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

MAX_PAGES = 80
MAX_WORDS = 60_000
SECTION_MAX_WORDS = 220  # longer paragraphs are split
SECTION_SPLIT = (180, 30)  # window and overlap used to split them
TINY_WORDS = 25  # sibling items shorter than this are kept together
WORD_LIMITS = (20, 400)  # allowed fixed-window sizes

_PAGE_FOOTER = re.compile(r"^\s*page\s+\d+\s+of\s+\d+\s*$", re.I)
_SECTION = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){0,3})\.\s+(?=\S)")
_TOKEN = re.compile(r"[a-z0-9]+(?:[.+][a-z0-9]+)*")
STOP = frozenset("""a an and are as at be been being but by can could did do does for from had has have how i if in into is it
its may might must no not of on or our shall should so such than that the their them then there these they this those to
under up was we were what when where which who whom why will with would you your about above after again all also any
each per under until upon via""".split())


class TextError(ValueError):
    """The file can't be used (400)."""


# ── extraction ─────────────────────────────────────────────────


def extract_pdf(data: bytes) -> List[str]:
    """Text of each page. Scanned (image-only) PDFs have no text layer and are refused."""
    import pdfplumber

    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            if len(pdf.pages) > MAX_PAGES:
                raise TextError(f"That PDF has {len(pdf.pages)} pages; the limit is {MAX_PAGES}.")
            pages = [(p.extract_text() or "").replace("\x00", "") for p in pdf.pages]
    except TextError:
        raise
    except Exception as e:
        raise TextError(f"Couldn't read that PDF ({type(e).__name__}).") from e
    if sum(len(p.strip()) for p in pages) < 40:
        raise TextError("No text found in that PDF. It looks scanned (a picture of text); use a PDF with real text.")
    return pages


def extract_text_file(data: bytes) -> List[str]:
    """A .txt or .md file, cut into pages of about 500 words at paragraph breaks."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    text = text.replace("\r\n", "\n").replace("\x00", "")
    if len(text.strip()) < 20:
        raise TextError("That file is empty.")
    pages, cur, n = [], [], 0
    for para in re.split(r"\n\s*\n", text):
        w = len(para.split())
        if cur and n + w > 500:
            pages.append("\n\n".join(cur))
            cur, n = [], 0
        cur.append(para.strip())
        n += w
    if cur:
        pages.append("\n\n".join(cur))
    return [p for p in pages if p.strip()]


def check_size(pages: Sequence[str]) -> int:
    words = sum(len(p.split()) for p in pages)
    if words > MAX_WORDS:
        raise TextError(f"That document has {words:,} words; the limit is {MAX_WORDS:,}.")
    return words


# ── structure ──────────────────────────────────────────────────


@dataclass
class Line:
    page: int
    text: str


@dataclass
class Section:
    num: str  # '5.5.4' | 'intro'
    page: int
    lines: List[Line] = field(default_factory=list)
    title: str = ""

    @property
    def parent(self) -> str:
        return self.num.rsplit(".", 1)[0] if "." in self.num else ""

    def body(self) -> List[Line]:
        return self.lines[1:] if self.title else self.lines


def clean_lines(pages: Sequence[str]) -> List[Line]:
    out = []
    for i, page in enumerate(pages, 1):
        for raw in page.split("\n"):
            t = " ".join(raw.split())
            if t and not _PAGE_FOOTER.match(t):
                out.append(Line(i, t))
    return out


def parse_sections(pages: Sequence[str]) -> List[Section]:
    sections: List[Section] = []
    cur = Section("intro", 1)
    for line in clean_lines(pages):
        m = _SECTION.match(line.text)
        if m:
            if cur.lines:
                sections.append(cur)
            cur = Section(m.group(1), line.page)
            rest = line.text[m.end():].strip()
            line = Line(line.page, rest)
            if not rest:
                continue
        cur.lines.append(line)
    if cur.lines:
        sections.append(cur)
    for s in sections:
        if s.num != "intro" and sum(len(l.text.split()) for l in s.lines) <= 8:
            # heading-only paragraph, possibly on two lines: "5.1. Governance structure and processes / Governance structure"
            s.lines = [Line(s.page, " ".join(l.text for l in s.lines))]
        first = s.lines[0].text if s.lines else ""
        if s.num != "intro" and len(s.lines) > 1 and len(first.split()) <= 8 and not first.endswith((",", ";")):
            s.title = first.rstrip(":")
        elif s.num != "intro" and len(s.lines) == 1 and len(first.split()) <= 8:
            s.title = first.rstrip(":")  # heading-only paragraph: "2. Segregation of activities"
    return sections


# ── chunks ─────────────────────────────────────────────────────


@dataclass
class Chunk:
    text: str
    pages: List[int]
    paras: List[str]  # paragraph numbers covered, in order
    context: str = ""  # nearest heading, e.g. "Business Continuity Plan"

    @property
    def words(self) -> int:
        return len(self.text.split())

    def label(self) -> str:
        if not self.paras or self.paras == ["intro"]:
            return "opening"
        nums = [p for p in self.paras if p != "intro"]
        return nums[0] if len(nums) == 1 else f"{nums[0]}–{nums[-1]}"

    def page_label(self) -> str:
        return f"p. {self.pages[0]}" if len(set(self.pages)) == 1 else f"pp. {min(self.pages)}–{max(self.pages)}"


def _windows(words: List[Tuple[str, int, str]], size: int, overlap: int) -> List[List[Tuple[str, int, str]]]:
    step = max(1, size - overlap)
    out = []
    for start in range(0, len(words), step):
        win = words[start:start + size]
        if not win:
            break
        out.append(win)
        if start + size >= len(words):
            break
    return out


def _from_words(win: List[Tuple[str, int, str]], context: str = "") -> Chunk:
    paras: List[str] = []
    for _, _, p in win:
        if not paras or paras[-1] != p:
            paras.append(p)
    return Chunk(" ".join(w for w, _, _ in win), sorted({pg for _, pg, _ in win}), paras, context)


def _tagged_words(sections: Sequence[Section], with_numbers: bool) -> List[Tuple[str, int, str]]:
    words = []
    for s in sections:
        first = True
        for line in s.lines:
            toks = line.text.split()
            if first and with_numbers and s.num != "intro":
                toks = [f"{s.num}."] + toks
            first = False
            words.extend((t, line.page, s.num) for t in toks)
    return words


def chunk_words(pages: Sequence[str], size: int, overlap: int) -> List[Chunk]:
    size = max(WORD_LIMITS[0], min(WORD_LIMITS[1], int(size)))
    overlap = max(0, min(size // 2, int(overlap)))
    words = _tagged_words(parse_sections(pages), with_numbers=True)
    return [_from_words(w) for w in _windows(words, size, overlap)]


def chunk_sections(pages: Sequence[str]) -> List[Chunk]:
    sections = parse_sections(pages)
    titles = {s.num: s.title for s in sections if s.title}

    def context_of(num: str) -> str:
        parts = num.split(".")
        for i in range(len(parts) - 1, 0, -1):
            t = titles.get(".".join(parts[:i]))
            if t:
                return t
        return ""

    # one unit per paragraph that has a body; heading-only paragraphs become context
    units: List[Tuple[Section, List[Tuple[str, int, str]]]] = []
    for s in sections:
        body = s.body()
        if not body:
            continue
        toks = []
        if s.title:
            toks.extend((t, s.page, s.num) for t in s.title.split())
        for line in body:
            toks.extend((t, line.page, s.num) for t in line.text.split())
        units.append((s, toks))

    # keep very short sibling items together (6.2.1 ... 6.2.5)
    merged: List[Tuple[str, List[Tuple[str, int, str]]]] = []
    for s, toks in units:
        last = merged[-1] if merged else None
        if (last and len(toks) < TINY_WORDS and s.num != "intro" and last[0] == s.parent and len(last[1]) < SECTION_MAX_WORDS
                and _short_group(last[1])):
            last[1].extend(toks)
        else:
            merged.append((s.parent if (s.num != "intro" and len(toks) < TINY_WORDS) else f"#{s.num}", toks))

    chunks = []
    for key, toks in merged:
        first_para = toks[0][2]
        ctx = context_of(first_para) if first_para != "intro" else ""
        if len(toks) > SECTION_MAX_WORDS:
            for win in _windows(toks, *SECTION_SPLIT):
                chunks.append(_from_words(win, ctx))
        else:
            chunks.append(_from_words(toks, ctx))
    return chunks


def _short_group(toks: List[Tuple[str, int, str]]) -> bool:
    """A group made only of short items (so a long paragraph never swallows the next item)."""
    sizes = Counter(p for _, _, p in toks)
    return all(n < TINY_WORDS for n in sizes.values())


def make_chunks(pages: Sequence[str], mode: str, size: int = 60, overlap: int = 10) -> List[Chunk]:
    if mode == "sections":
        return chunk_sections(pages)
    if mode == "words":
        return chunk_words(pages, size, overlap)
    raise ValueError("Unknown chunking mode.")


# ── keyword search (TF-IDF) ────────────────────────────────────


def _stem(w: str) -> str:
    for suf in ("ations", "ation", "ings", "ing", "ies", "ers", "ed", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)] + ("y" if suf == "ies" else "")
    return w


def terms(text: str) -> List[str]:
    return [_stem(t) for t in _TOKEN.findall(text.lower()) if t not in STOP and len(t) > 1]


class KeywordIndex:
    """TF-IDF over the chunks (sublinear tf, smooth idf, cosine). Rebuilt in memory, it is cheap."""

    def __init__(self, texts: Sequence[str]):
        docs = [Counter(terms(t)) for t in texts]
        n = len(docs)
        df = Counter(t for d in docs for t in d)
        self.idf = {t: math.log((1 + n) / (1 + c)) + 1 for t, c in df.items()}
        self.vecs = [self._vec(d) for d in docs]

    def _vec(self, counts: Counter) -> Dict[str, float]:
        v = {t: (1 + math.log(c)) * self.idf.get(t, 0.0) for t, c in counts.items() if t in self.idf}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        return {t: x / norm for t, x in v.items()}

    def scores(self, query: str) -> Tuple[List[float], List[str]]:
        q = Counter(terms(query))
        qv = self._vec(q)
        out = [sum(w * d.get(t, 0.0) for t, w in qv.items()) for d in self.vecs]
        return out, sorted(t for t in q if t not in self.idf)  # (scores, query words no chunk contains)

    def matched(self, i: int, query: str) -> List[str]:
        return sorted({t for t in terms(query) if t in self.vecs[i]})


# ── answers ────────────────────────────────────────────────────

_CITE = re.compile(r"\[(\s*\d+\s*(?:[,;–-]\s*\d+\s*)*)\]")
_DECLINE = re.compile(
    r"(do(?:es)?n[’']?t (?:say|cover|contain|mention|state|specify|provide|include)|"
    r"do(?:es)? not (?:say|cover|contain|mention|state|specify|provide|include)|"
    r"not (?:in|covered by|mentioned in|stated in|found in|specified in|provided in) the (?:document|passage|text|circular|context)|"
    r"no (?:information|mention|details?) (?:about|on|regarding|of)|"
    r"(?:cannot|can[’']?t|unable to) (?:find|answer|determine|confirm)|isn[’']?t (?:in|covered|mentioned|stated))",
    re.I,
)


def citations(text: str) -> List[int]:
    """Passage numbers cited as [2], [1, 3] or [2-4] (1-based, in order, unique)."""
    out: List[int] = []
    for group in _CITE.findall(text or ""):
        nums = [int(x) for x in re.findall(r"\d+", group)]
        if re.search(r"[–-]", group) and len(nums) == 2 and 0 < nums[1] - nums[0] < 10:
            nums = list(range(nums[0], nums[1] + 1))
        for n in nums:
            if n not in out:
                out.append(n)
    return out


def declines(text: str) -> bool:
    return bool(_DECLINE.search(text or ""))


def norm_answer(text: str) -> str:
    t = (text or "").lower().replace("’", "'")
    t = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", t)
    return " ".join(re.sub(r"[^a-z0-9.:+ ]", " ", t).split())


def check_answer(answer: str, expect: Dict[str, object]) -> Dict[str, object]:
    """Automatic check against a test question.
    expect = {"trap": bool, "all": [[alternatives], ...], "any": [[alternatives], ...], "min": int}
    trap: right when the answer says the documents don't cover it.
    all:  every group must have one alternative in the answer.
    any:  at least `min` groups must (for "name two of these five")."""
    a = norm_answer(answer)
    if expect.get("trap"):
        ok = declines(answer)
        return {"pass": ok, "reason": "said the documents don't cover it" if ok else "answered instead of saying it isn't covered"}
    missing = [g[0] for g in expect.get("all", []) if not any(norm_answer(x) in a for x in g)]
    groups = expect.get("any", [])
    hits = [g[0] for g in groups if any(norm_answer(x) in a for x in g)]
    need = int(expect.get("min", 0) or 0)
    ok = not missing and len(hits) >= need
    if ok:
        reason = "has the expected facts"
    elif missing:
        reason = "missing: " + ", ".join(str(m) for m in missing)
    else:
        reason = f"named {len(hits)} of the {need} needed"
    if not ok and declines(answer):
        reason = "said it isn't covered, but the documents do cover it"
    return {"pass": ok, "reason": reason}
