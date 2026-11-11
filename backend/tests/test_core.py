"""Unit tests for the deterministic parts of the pipeline (no network, no models)."""

import time

import numpy as np

from app.agents.orchestrator import after_plan, after_verify, after_write, normalize_citations
from app.guard.guardian import mask_pii
from app.ingest.chunking import Chunk, choose_strategy, recursive_split
from app.ingest.parser import Block, ParsedDoc
from app.llm.client import _ModelState, _parse_duration, parse_json
from app.retrieval.index import SessionIndex
from app.session import Ledger


def test_pii_masking():
    text, n = mask_pii("Mail jane.doe@example.com or call 123456789. Card 4111 1111 1111 1111. Version 2.1.3, year 2026.")
    assert "[EMAIL]" in text and "[PHONE]" in text and "[CARD]" in text
    assert "2.1.3" in text and "2026" in text  # versions and years are not PII
    assert n == 3


def test_card_requires_luhn():
    text, n = mask_pii("Order 1234 5678 9012 3456 shipped.")
    assert n == 0 and "1234" in text


def test_citation_normalisation():
    assert normalize_citations("A 【S1】 B [S2, S3] C (S4)") == "A [S1] B [S2][S3] C [S4]"
    assert normalize_citations("D [ S5 ][ S6 ].") == "D [S5][S6]."


def test_parse_json_tolerates_fences_and_prose():
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json('Sure! {"route": "direct"} hope that helps') == {"route": "direct"}


def test_duration_parsing():
    assert _parse_duration("7.66s") == 7.66
    assert _parse_duration("1m2.5s") == 62.5
    assert _parse_duration("250ms") == 0.25


def test_token_bucket_refills():
    now = time.time()
    st = _ModelState(remaining_tokens=500, limit_tokens=8000, observed_at=now)
    assert st.wait_for(400, now) == 0
    assert 14 < st.wait_for(2500, now) < 16          # 2000 tokens at 133/s
    assert st.wait_for(9000, now) == float("inf")      # can never fit
    assert st.wait_for(2500, now + 20) == 0            # refilled after 20 s


def _doc(pages: int, headings: int = 5) -> ParsedDoc:
    blocks = [Block(f"Heading {i}", 1, "heading", 1) for i in range(headings)] + [Block("text " * 50, 1, "para")]
    return ParsedDoc("d1", "doc.pdf", pages, blocks)


def test_adaptive_strategy_by_size():
    assert choose_strategy(_doc(8))[0] == "small"
    assert choose_strategy(_doc(120))[0] == "medium"
    assert choose_strategy(_doc(900))[0] == "large"


def test_recursive_split_respects_size_and_overlaps():
    text = " ".join(f"Sentence number {i} talks about topic {i % 7}." for i in range(80))
    parts = recursive_split(text, size=300, overlap=60)
    assert all(len(p) <= 300 for p in parts)
    assert len(parts) > 5
    assert any(parts[i][-20:].split()[-1] in parts[i + 1] for i in range(len(parts) - 1))  # overlap carried over


def _index():
    idx = SessionIndex()
    texts = ["annual leave is 26 days", "remote work three days", "expense claims within 60 days", "security training"]
    chunks = [Chunk(f"c{i}", "d1", "doc.pdf", t, ["S"], 1, 1, parent_id="p0") for i, t in enumerate(texts)]
    parent = Chunk("p0", "d1", "doc.pdf", " ".join(texts), ["S"], 1, 1, kind="parent")
    rng = np.random.default_rng(0)
    vecs = rng.normal(size=(4, 384)).astype(np.float32)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
    idx.add(chunks, [parent], vecs, vecs[:1], hierarchical=False)
    return idx, vecs


def test_hybrid_search_fuses_keyword_and_dense():
    idx, vecs = _index()
    hits = idx.hybrid("expense claims deadline", vecs[1], k=4)
    ids = [h.chunk.id for h in hits]
    assert ids[0] in ("c1", "c2")          # dense favours c1, BM25 favours c2: both rank at the top
    assert {"c1", "c2"} <= set(ids[:2])


def test_remove_doc_wipes_its_chunks():
    idx, _ = _index()
    idx.remove_doc("d1")
    assert len(idx) == 0 and not idx.parents


def test_ledger_ids_are_stable():
    led = Ledger()
    c = Chunk("x", "d", "doc.pdf", "t", [], 1, 1)
    assert led.add(c, "t", 1.0).sid == "S1"
    assert led.add(c, "t", 1.0).sid == "S1"  # same chunk, same citation id
    assert led.get("[s1]") is not None


def test_graph_routing():
    assert after_plan({"route": "cag"}) == "load_all"
    assert after_write({"route": "retrieve", "mode": "auto"}) == "finalize"   # fast path skips the verifier
    assert after_write({"route": "research", "mode": "auto"}) == "verify"
    assert after_verify({"verdict": {"verdict": "revise"}, "rounds": 1, "focus": ["q"]}) == "research"
    assert after_verify({"verdict": {"verdict": "revise"}, "rounds": 2}) == "finalize"  # bounded loop
