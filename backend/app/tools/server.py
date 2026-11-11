"""MCP tool server. Agents discover and call these tools over the Model Context Protocol.

A fresh server instance is built per request and closed over ONE session, so a
tool can only ever see that session's documents and wiki. There is deliberately
no file-system, shell, network or database tool.
"""

from __future__ import annotations

import json
import time

from mcp.server.mcpserver import MCPServer

from app.retrieval.pipeline import retrieve
from app.session import Ledger, Session, WikiPage, slugify


def _match_docs(session: Session, document: str) -> set[str] | None:
    if not document:
        return None
    d = document.lower()
    ids = {i.doc_id for i in session.docs.values() if d in i.name.lower() or d == i.doc_id}
    return ids or None


def build_tool_server(session: Session, ledger: Ledger) -> MCPServer:
    srv = MCPServer("rag-document-tools")

    @srv.tool()
    async def search_documents(query: str, document: str = "", k: int = 4) -> str:
        """Hybrid keyword + semantic search over the uploaded documents, reranked.
        Returns passages with source_ids like S3 that MUST be used for citations.
        Use short, specific queries. Optionally restrict to one document by name."""
        evs = await retrieve(session, query, ledger, k=max(1, min(int(k), 6)), doc_ids=_match_docs(session, document))
        if not evs:
            return json.dumps({"results": [], "note": "No matching passages. Try different keywords."})
        return json.dumps({"results": [
            {"source_id": e.sid, "document": e.chunk.doc_name, "pages": e.chunk.pages,
             "section": " › ".join(e.chunk.section), "text": e.text[:800]} for e in evs]})

    @srv.tool()
    async def read_source(source_id: str) -> str:
        """Read the full surrounding section for a source_id returned by search_documents."""
        ev = ledger.get(source_id)
        if not ev:
            return json.dumps({"error": f"Unknown source_id {source_id}"})
        parent = session.index.parent_of(ev.chunk)
        return json.dumps({"source_id": ev.sid, "document": ev.chunk.doc_name, "pages": ev.chunk.pages,
                           "text": (parent.text if parent else ev.text)[:2500]})

    @srv.tool()
    async def list_documents() -> str:
        """List uploaded documents with page counts and their top-level outline."""
        return json.dumps([{"document": d.name, "pages": d.pages, "outline": d.outline[:15]}
                           for d in session.docs.values()])

    @srv.tool()
    async def list_wiki_pages() -> str:
        """List the pages in the session wiki."""
        return json.dumps([{"title": p.title, "kind": p.kind} for p in session.wiki.pages.values()])

    @srv.tool()
    async def read_wiki_page(title: str) -> str:
        """Read one wiki page by title."""
        p = session.wiki.find(title)
        return json.dumps(p.public() if p else {"error": f"No wiki page titled {title}"})

    @srv.tool()
    async def search_wiki(query: str) -> str:
        """Keyword search across wiki pages (titles, text and source document names).
        Returns matching page titles, the documents each page draws on, and excerpts."""
        terms = [t for t in query.lower().replace("_", " ").replace(".pdf", "").split() if len(t) > 2]
        scored = []
        for p in session.wiki.pages.values():
            docs = " ".join(src.get("doc", "") for src in p.sources)
            body = f"{p.title} {p.content} {docs}".lower().replace("_", " ").replace(".pdf", "")
            s = sum(body.count(t) for t in terms) + 5 * sum(t in p.title.lower() for t in terms)
            if s:
                scored.append((s, p))
        scored.sort(key=lambda x: -x[0])
        if not scored:  # fall back to the most useful pages rather than nothing
            scored = [(0, p) for p in session.wiki.pages.values() if p.kind in ("contradiction", "concept")]
        return json.dumps([{"title": p.title, "kind": p.kind, "documents": sorted({x.get("doc", "") for x in p.sources}),
                            "excerpt": p.content[:500]} for _, p in scored[:6]])

    @srv.tool()
    async def write_wiki_page(title: str, content: str, source_ids: list[str], links: list[str] | None = None) -> str:
        """Create or replace a wiki page. content is Markdown that cites sources as [S#]
        and links other pages as [[Page Title]]. source_ids lists every source cited."""
        sources = []
        for sid in source_ids:
            ev = ledger.get(sid)
            if ev:
                sources.append({**ev.public(), "id": ev.sid})
        if not sources:
            return json.dumps({"error": "A wiki page needs at least one valid source_id from search_documents."})
        page = session.wiki.upsert(WikiPage(title.strip()[:80], content.strip()[:6000], "concept", sources,
                                            [l.strip() for l in (links or []) if l.strip()][:12], time.time()))
        return json.dumps({"saved": page.slug})

    @srv.tool()
    async def record_contradiction(topic: str, claim_a: str, source_a: str, claim_b: str, source_b: str) -> str:
        """Record that two sources disagree about a topic. Cite both sides with source_ids."""
        a, b = ledger.get(source_a), ledger.get(source_b)
        if not a or not b:
            return json.dumps({"error": "Both source ids must come from search_documents."})
        content = (f"**{a.chunk.doc_name}** (p.{a.chunk.pages}) says: {claim_a} [{a.sid}]\n\n"
                   f"**{b.chunk.doc_name}** (p.{b.chunk.pages}) says: {claim_b} [{b.sid}]")
        page = session.wiki.upsert(WikiPage(f"Contradiction: {topic}"[:80], content, "contradiction",
                                            [a.public(), b.public()], [topic], time.time()))
        return json.dumps({"saved": page.slug})

    return srv


# Which tools each agent may use (least privilege).
TOOLSETS = {
    "researcher": ["search_documents", "read_source", "list_documents", "search_wiki", "read_wiki_page"],
    "verifier": ["search_documents", "read_source"],
    "librarian": ["search_documents", "read_source", "record_contradiction"],
    "wiki_reader": ["search_wiki", "read_wiki_page", "list_wiki_pages"],
}

_ = slugify  # re-exported for callers that build page links
