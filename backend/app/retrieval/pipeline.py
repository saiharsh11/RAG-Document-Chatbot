"""Retrieve → rerank → diversify → expand to parent context → register as citable evidence."""

from __future__ import annotations

from app.config import settings
from app.retrieval import models
from app.session import Evidence, Ledger, Session


def _window(parent_text: str, child_text: str, size: int = 1400) -> str:
    """Small-to-big: return the child's surrounding passage from its parent section."""
    if len(parent_text) <= size:
        return parent_text
    at = parent_text.find(child_text[:60])
    if at < 0:
        return child_text
    start = max(0, at - (size - len(child_text)) // 2)
    return ("…" if start else "") + parent_text[start:start + size] + ("…" if start + size < len(parent_text) else "")


async def retrieve(
    session: Session,
    query: str,
    ledger: Ledger,
    k: int | None = None,
    doc_ids: set[str] | None = None,
) -> list[Evidence]:
    k = k or settings.retrieve_final
    if not len(session.index):
        return []
    qvec = await models.embed_query(query)
    hits = session.index.hybrid(query, qvec, k=settings.retrieve_candidates, doc_ids=doc_ids)
    if not hits:
        return []

    scores = await models.rerank(query, [h.chunk.indexed_text for h in hits])
    if scores is not None:
        for h, s in zip(hits, scores):
            h.rerank_score = s
        hits.sort(key=lambda h: h.rerank_score, reverse=True)
        hits = hits[: k * 2]

    hits = session.index.mmr(hits, qvec, k)
    out = []
    for h in hits:
        parent = session.index.parent_of(h.chunk)
        text = _window(parent.text, h.chunk.text) if parent else h.chunk.text
        out.append(ledger.add(h.chunk, text, h.rerank_score if h.rerank_score is not None else h.score))
    return out


def format_evidence(items: list[Evidence], max_chars: int = 1400) -> str:
    return "\n\n".join(
        f"[{e.sid}] {e.chunk.doc_name}, p.{e.chunk.pages} — {' › '.join(e.chunk.section) or 'body'}\n{e.text[:max_chars]}"
        for e in items
    )
