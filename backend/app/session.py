"""In-memory sessions. A session owns everything a user uploads or generates.

Nothing here is persisted: when a session ends (explicitly, or after the idle
timeout) its object is dropped and Python frees the memory. There is no disk,
database or log that holds document text, questions or answers.
"""

from __future__ import annotations

import asyncio
import re
import secrets
import time
from dataclasses import dataclass, field

from app.config import settings
from app.ingest.chunking import Chunk, ChunkingReport
from app.retrieval.index import SessionIndex


@dataclass
class DocInfo:
    doc_id: str
    name: str
    pages: int
    chars: int
    report: ChunkingReport
    outline: list[str]
    pii_masked: int = 0
    flagged_chunks: int = 0

    def public(self) -> dict:
        return {
            "doc_id": self.doc_id, "name": self.name, "pages": self.pages,
            "chunks": self.report.children, "sections": self.report.parents,
            "strategy": self.report.strategy, "strategy_reason": self.report.reason,
            "pii_masked": self.pii_masked, "flagged_chunks": self.flagged_chunks,
        }


@dataclass
class Evidence:
    """One citable source handed to a model. Its id ([S1], [S2]…) is what answers cite."""

    sid: str
    chunk: Chunk
    text: str               # what the model saw (parent section, trimmed)
    score: float

    def public(self) -> dict:
        c = self.chunk
        return {"id": self.sid, "doc_id": c.doc_id, "doc": c.doc_name, "pages": c.pages,
                "page": c.page_start, "section": " › ".join(c.section), "snippet": c.text[:400]}


class Ledger:
    """Per-request registry of evidence so every citation maps to a real passage."""

    def __init__(self) -> None:
        self.items: dict[str, Evidence] = {}
        self._by_chunk: dict[str, str] = {}

    def add(self, chunk: Chunk, text: str, score: float) -> Evidence:
        if chunk.id in self._by_chunk:
            return self.items[self._by_chunk[chunk.id]]
        sid = f"S{len(self.items) + 1}"
        ev = Evidence(sid, chunk, text, score)
        self.items[sid] = ev
        self._by_chunk[chunk.id] = sid
        return ev

    def get(self, sid: str) -> Evidence | None:
        return self.items.get(sid.strip("[] ").upper())


@dataclass
class WikiPage:
    title: str
    content: str
    kind: str = "concept"                     # concept | entity | contradiction | saved
    sources: list[dict] = field(default_factory=list)
    links: list[str] = field(default_factory=list)
    updated: float = field(default_factory=time.time)

    @property
    def slug(self) -> str:
        return slugify(self.title)

    def public(self, full: bool = True) -> dict:
        d = {"slug": self.slug, "title": self.title, "kind": self.kind,
             "links": self.links, "sources": self.sources, "updated": self.updated}
        if full:
            d["content"] = self.content
        return d


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


@dataclass
class Wiki:
    pages: dict[str, WikiPage] = field(default_factory=dict)
    status: str = "empty"                     # empty | building | ready | error
    progress: list[str] = field(default_factory=list)

    def upsert(self, page: WikiPage) -> WikiPage:
        self.pages[page.slug] = page
        return page

    def find(self, title_or_slug: str) -> WikiPage | None:
        return self.pages.get(slugify(title_or_slug))

    def graph(self, docs: dict[str, DocInfo]) -> dict:
        nodes = [{"id": f"doc:{d.doc_id}", "label": d.name, "type": "document"} for d in docs.values()]
        edges = []
        for p in self.pages.values():
            nodes.append({"id": p.slug, "label": p.title, "type": p.kind})
            for link in p.links:
                if slugify(link) in self.pages:
                    edges.append({"source": p.slug, "target": slugify(link), "type": "link"})
            for doc_id in {s.get("doc_id") for s in p.sources if s.get("doc_id")}:
                edges.append({"source": p.slug, "target": f"doc:{doc_id}", "type": "source"})
        return {"nodes": nodes, "edges": edges}


@dataclass
class Turn:
    role: str            # "user" | "assistant"
    content: str
    meta: dict = field(default_factory=dict)
    at: float = field(default_factory=time.time)


class Session:
    def __init__(self) -> None:
        self.id = secrets.token_urlsafe(18)
        self.created = time.time()
        self.last_seen = self.created
        self.docs: dict[str, DocInfo] = {}
        self.index = SessionIndex()
        self.history: list[Turn] = []
        self.wiki = Wiki()
        self.cache: dict[str, dict] = {}
        self.lock = asyncio.Lock()
        self.tokens_used = 0

    def touch(self) -> None:
        self.last_seen = time.time()

    @property
    def total_pages(self) -> int:
        return sum(d.pages for d in self.docs.values())

    @property
    def corpus_tokens(self) -> int:
        return sum(len(p.text) for p in self.index.parents.values()) // 4

    def expires_in(self) -> int:
        return max(0, int(self.last_seen + settings.session_ttl_seconds - time.time()))

    def wipe(self) -> None:
        """Drop every reference to user data."""
        self.docs.clear()
        self.index = SessionIndex()
        self.history.clear()
        self.wiki = Wiki()
        self.cache.clear()


class SessionFull(Exception):
    pass


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._task: asyncio.Task | None = None

    def create(self) -> Session:
        self.sweep()
        if len(self._sessions) >= settings.max_sessions:
            raise SessionFull("The server is at capacity. Please try again in a few minutes.")
        s = Session()
        self._sessions[s.id] = s
        return s

    def get(self, sid: str) -> Session | None:
        s = self._sessions.get(sid)
        if s is None:
            return None
        if s.expires_in() == 0:
            self.delete(sid)
            return None
        s.touch()
        return s

    def delete(self, sid: str) -> bool:
        s = self._sessions.pop(sid, None)
        if s:
            s.wipe()
        return s is not None

    def sweep(self) -> int:
        expired = [sid for sid, s in self._sessions.items() if s.expires_in() == 0]
        for sid in expired:
            self.delete(sid)
        return len(expired)

    def __len__(self) -> int:
        return len(self._sessions)

    async def run_sweeper(self) -> None:
        while True:
            await asyncio.sleep(60)
            self.sweep()


store = SessionStore()
