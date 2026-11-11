"""Upload → parse → mask PII → chunk (adaptive) → screen for injection → embed → index."""

from __future__ import annotations

import asyncio
import time

from app.config import settings
from app.guard.guardian import mask_pii, sanitize_chunks
from app.ingest.chunking import chunk_document
from app.ingest.parser import ParsedDoc, UnsupportedFile, parse_file
from app.retrieval import models
from app.session import DocInfo, Session


class IngestError(ValueError):
    pass


async def ingest(session: Session, data: bytes, filename: str, on_progress=None) -> DocInfo:
    t0 = time.perf_counter()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise IngestError(f"File is larger than {settings.max_upload_mb} MB.")
    if len(session.docs) >= settings.max_docs_per_session:
        raise IngestError(f"A session can hold up to {settings.max_docs_per_session} documents.")

    try:
        doc: ParsedDoc = await asyncio.to_thread(parse_file, data, filename)
    except UnsupportedFile as e:
        raise IngestError(str(e)) from e
    del data  # drop the raw bytes as early as possible

    if doc.is_scanned:
        raise IngestError("This PDF looks scanned (images, no text layer). OCR isn't supported yet.")
    if not doc.blocks:
        raise IngestError("No readable text found in this file.")
    if session.total_pages + doc.pages > settings.max_pages_per_session:
        raise IngestError(f"Sessions are limited to {settings.max_pages_per_session} pages in total.")

    _p(on_progress, f"Parsed {doc.pages} pages")
    # PII masking is mandatory: there is no setting to turn it off.
    pii = 0
    for b in doc.blocks:
        b.text, n = mask_pii(b.text)
        pii += n
    if pii:
        _p(on_progress, f"Masked {pii} personal details")

    children, parents, report = await asyncio.to_thread(chunk_document, doc, models.embed_sync)
    _p(on_progress, f"Chunked: {report.reason}")

    # Sanitise children (what we search) and parents (what models read) in one pass.
    cleaned, removed = await sanitize_chunks([c.text for c in children])
    if removed:
        cleaned_parents, _ = await sanitize_chunks([p.text for p in parents])
        for c, t in zip(children + parents, cleaned + cleaned_parents):
            c.text = t
        children = [c for c in children if c.text.strip()]
        _p(on_progress, f"Removed {removed} embedded instruction(s) (prompt-injection defence)")

    _p(on_progress, f"Embedding {len(children)} chunks locally")
    vectors = await models.embed([c.indexed_text for c in children])
    section_vecs = await models.embed([f"{p.header}\n{p.text[:800]}" for p in parents])
    session.index.add(children, parents, vectors, section_vecs, hierarchical=report.strategy == "large")
    session.cache.clear()

    outline = [t for _, t, _ in doc.outline][:40] or [b.text for b in doc.blocks if b.kind == "heading"][:40]
    info = DocInfo(doc.doc_id, doc.name, doc.pages, doc.char_count, report, outline, pii, removed)
    session.docs[doc.doc_id] = info
    _p(on_progress, f"Ready in {time.perf_counter() - t0:.1f}s")
    return info


def _p(cb, msg: str) -> None:
    if cb:
        cb(msg)
