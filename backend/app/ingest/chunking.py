"""Adaptive chunking. The strategy is chosen from the document's size and structure.

  small  (≤ 20 pages)   semantic chunking (split where meaning shifts) + parent sections
  medium (≤ 300 pages)  structure-aware chunking (by heading) with overlap + parent sections
  large  (> 300 pages)  structure-aware chunking with larger parents, retrieved hierarchically
                        (find the right sections first, then the right chunks inside them)

Every child chunk gets a contextual header ("Doc › Section › Subsection") prepended
for embedding and keyword search, which measurably helps retrieval of short chunks.
Children are what we search; parents are what we hand the model (small-to-big).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from app.ingest.parser import ParsedDoc


@dataclass
class Chunk:
    id: str
    doc_id: str
    doc_name: str
    text: str                    # display text (no header)
    section: list[str]
    page_start: int
    page_end: int
    parent_id: str = ""
    kind: str = "child"          # "child" | "parent"

    @property
    def header(self) -> str:
        return " › ".join([self.doc_name, *self.section])

    @property
    def indexed_text(self) -> str:
        return f"{self.header}\n{self.text}"

    @property
    def pages(self) -> str:
        return str(self.page_start) if self.page_start == self.page_end else f"{self.page_start}–{self.page_end}"


@dataclass
class Section:
    path: list[str]
    paras: list[tuple[str, int]] = field(default_factory=list)  # (text, page)


@dataclass
class ChunkingReport:
    strategy: str
    reason: str
    children: int
    parents: int
    avg_child_chars: int


SIZES = {  # target characters (~4 chars ≈ 1 token; bge-small reads up to 512 tokens)
    "small": dict(child=700, overlap=120, parent=2400),
    "medium": dict(child=900, overlap=150, parent=3000),
    "large": dict(child=1000, overlap=150, parent=4500),
}


def choose_strategy(doc: ParsedDoc) -> tuple[str, str]:
    has_structure = sum(b.kind == "heading" for b in doc.blocks) >= 3 or len(doc.outline) >= 3
    if doc.pages <= 20:
        return "small", f"{doc.pages} pages: semantic chunking + parent sections"
    if doc.pages <= 300:
        how = "heading-aware" if has_structure else "recursive (no headings found)"
        return "medium", f"{doc.pages} pages: {how} chunking with overlap + parent sections"
    return "large", f"{doc.pages} pages: heading-aware chunking + hierarchical (section-first) retrieval"


def sections(doc: ParsedDoc) -> list[Section]:
    out: list[Section] = []
    path: list[tuple[int, str]] = []
    cur = Section([])
    for b in doc.blocks:
        if b.kind == "heading":
            if cur.paras:
                out.append(cur)
            path = [p for p in path if p[0] < b.level] + [(b.level, b.text[:80])]
            cur = Section([t for _, t in path])
        else:
            cur.paras.append((b.text, b.page))
    if cur.paras:
        out.append(cur)
    return out


_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENT.split(text) if s.strip()]


def recursive_split(text: str, size: int, overlap: int) -> list[str]:
    """Split on paragraph → sentence → word boundaries, with character overlap."""
    if len(text) <= size:
        return [text]
    units = split_sentences(text)
    if len(units) <= 1:
        units = text.split(" ")
        joiner = " "
    else:
        joiner = " "
    chunks, cur = [], ""
    for u in units:
        if len(u) > size:  # pathological sentence
            for i in range(0, len(u), size - overlap):
                chunks.append(u[i:i + size])
            continue
        if cur and len(cur) + len(u) + 1 > size:
            chunks.append(cur)
            tail = cur[-overlap:]
            cur = (tail[tail.find(" ") + 1:] if " " in tail else tail) + joiner + u
        else:
            cur = f"{cur}{joiner}{u}" if cur else u
    if cur:
        chunks.append(cur)
    return chunks


def semantic_split(sentences: list[str], embed: Callable[[list[str]], np.ndarray], max_chars: int) -> list[str]:
    """Break where adjacent sentence windows are least similar (topic shifts)."""
    if len(sentences) < 4:
        return [" ".join(sentences)]
    windows = [" ".join(sentences[max(0, i - 1): i + 2]) for i in range(len(sentences))]
    vecs = embed(windows)
    sims = np.sum(vecs[:-1] * vecs[1:], axis=1)          # cosine (vectors are normalised)
    cut = np.percentile(sims, 20)                          # lowest 20% similarities = boundaries
    chunks, cur = [], ""
    for i, s in enumerate(sentences):
        cur = f"{cur} {s}".strip()
        boundary = i < len(sims) and sims[i] <= cut and len(cur) >= max_chars * 0.35
        if boundary or len(cur) >= max_chars:
            chunks.append(cur)
            cur = ""
    if cur:
        if chunks and len(cur) < max_chars * 0.25:
            chunks[-1] += " " + cur
        else:
            chunks.append(cur)
    return chunks


def chunk_document(
    doc: ParsedDoc,
    embed: Callable[[list[str]], np.ndarray] | None = None,
) -> tuple[list[Chunk], list[Chunk], ChunkingReport]:
    tier, reason = choose_strategy(doc)
    cfg = SIZES[tier]
    children: list[Chunk] = []
    parents: list[Chunk] = []

    for si, sec in enumerate(sections(doc)):
        # Parent sections: contiguous paragraphs up to the parent size.
        groups: list[list[tuple[str, int]]] = [[]]
        for para in sec.paras:
            if sum(len(t) for t, _ in groups[-1]) + len(para[0]) > cfg["parent"] and groups[-1]:
                groups.append([])
            groups[-1].append(para)

        for gi, group in enumerate(groups):
            pid = f"{doc.doc_id}-p{si}.{gi}"
            ptext = " ".join(t for t, _ in group)
            pages = [p for _, p in group]
            parents.append(Chunk(pid, doc.doc_id, doc.name, ptext, sec.path, min(pages), max(pages), kind="parent"))

            if tier == "small" and embed is not None:
                pieces = semantic_split(split_sentences(ptext), embed, cfg["child"])
            else:
                pieces = recursive_split(ptext, cfg["child"], cfg["overlap"])

            # Map each piece back to the page(s) it came from.
            offsets, pos = [], 0
            for t, p in group:
                offsets.append((pos, pos + len(t) + 1, p))
                pos += len(t) + 1
            cursor = 0
            for ci, piece in enumerate(pieces):
                start = ptext.find(piece[:40], max(0, cursor - cfg["overlap"]))
                start = start if start >= 0 else cursor
                end = start + len(piece)
                cursor = end
                pg = [p for a, b, p in offsets if a < end and b > start] or [min(pages)]
                children.append(Chunk(f"{pid}.c{ci}", doc.doc_id, doc.name, piece, sec.path, min(pg), max(pg), parent_id=pid))

    avg = int(sum(len(c.text) for c in children) / max(1, len(children)))
    return children, parents, ChunkingReport(tier, reason, len(children), len(parents), avg)
