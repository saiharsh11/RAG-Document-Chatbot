"""Parse uploaded files in memory into structured blocks (headings + paragraphs).

PyMuPDF gives us font sizes, which lets us recover document structure even when
a PDF has no table of contents. Nothing is ever written to disk.
"""

from __future__ import annotations

import re
import uuid
from collections import Counter
from dataclasses import dataclass, field

import pymupdf


@dataclass
class Block:
    text: str
    page: int            # 1-based
    kind: str            # "heading" | "para"
    level: int = 0       # heading depth (1 = top)


@dataclass
class ParsedDoc:
    doc_id: str
    name: str
    pages: int
    blocks: list[Block]
    is_scanned: bool = False
    outline: list[tuple[int, str, int]] = field(default_factory=list)  # (level, title, page)

    @property
    def char_count(self) -> int:
        return sum(len(b.text) for b in self.blocks)


class UnsupportedFile(ValueError):
    pass


_WS = re.compile(r"[ \t ]+")


def _clean(text: str) -> str:
    text = text.replace("­", "")                       # soft hyphens
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)            # de-hyphenate line breaks
    text = re.sub(r"\s*\n\s*", " ", text)
    return _WS.sub(" ", text).strip()


def parse_file(data: bytes, filename: str) -> ParsedDoc:
    name = filename.rsplit("/", 1)[-1][:120]
    lower = name.lower()
    if data[:5] == b"%PDF-":
        return _parse_pdf(data, name)
    if lower.endswith((".txt", ".md", ".markdown")):
        return _parse_text(data, name)
    raise UnsupportedFile("Only PDF, TXT and Markdown files are supported.")


def _parse_pdf(data: bytes, name: str) -> ParsedDoc:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as e:  # corrupt or encrypted
        raise UnsupportedFile(f"Could not open PDF: {e}") from e
    if doc.needs_pass:
        raise UnsupportedFile("This PDF is password-protected.")

    raw: list[tuple[str, float, bool, int]] = []  # (text, size, bold, page)
    for pno, page in enumerate(doc, start=1):
        for b in page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)["blocks"]:
            if b.get("type") != 0:
                continue
            spans = [s for line in b["lines"] for s in line["spans"] if s["text"].strip()]
            if not spans:
                continue
            text = _clean("\n".join("".join(s["text"] for s in line["spans"]) for line in b["lines"]))
            if not text:
                continue
            size = max(s["size"] for s in spans)
            bold = all(("bold" in s["font"].lower()) or (s["flags"] & 16) for s in spans)
            raw.append((text, round(size, 1), bold, pno))

    pages = doc.page_count
    outline = [(lvl, title.strip(), max(1, p)) for lvl, title, p in doc.get_toc() if title.strip()]
    doc.close()

    total_chars = sum(len(t) for t, *_ in raw)
    is_scanned = pages > 0 and total_chars / pages < 40

    # Body size = the font size that carries the most characters.
    weight = Counter()
    for t, size, _, _ in raw:
        weight[size] += len(t)
    body = weight.most_common(1)[0][0] if weight else 10.0
    heading_sizes = sorted({s for _, s, _, _ in raw if s >= body * 1.15}, reverse=True)[:4]

    blocks: list[Block] = []
    for text, size, bold, pno in raw:
        short = len(text) <= 120 and not text.endswith((".", ",", ";"))
        if short and size in heading_sizes:
            blocks.append(Block(text, pno, "heading", heading_sizes.index(size) + 1))
        elif short and bold and len(text) <= 80 and size >= body:
            blocks.append(Block(text, pno, "heading", len(heading_sizes) + 1))
        elif _is_noise(text):
            continue
        else:
            blocks.append(Block(text, pno, "para"))
    return ParsedDoc(str(uuid.uuid4())[:8], name, pages, blocks, is_scanned, outline)


def _is_noise(text: str) -> bool:
    """Page numbers, running headers and similar fragments."""
    return len(text) < 4 or bool(re.fullmatch(r"(page\s*)?\d+(\s*/\s*\d+)?", text, flags=re.I))


def _parse_text(data: bytes, name: str) -> ParsedDoc:
    text = data.decode("utf-8", errors="replace")
    blocks: list[Block] = []
    page = 1
    for i, para in enumerate(re.split(r"\n\s*\n", text)):
        para = para.strip()
        if not para:
            continue
        page = 1 + i // 12  # synthetic "pages" so citations stay navigable
        m = re.match(r"^(#{1,6})\s+(.*)", para)
        if m and "\n" not in para:
            blocks.append(Block(m.group(2).strip(), page, "heading", len(m.group(1))))
        else:
            blocks.append(Block(_clean(para), page, "para"))
    return ParsedDoc(str(uuid.uuid4())[:8], name, page, blocks)
