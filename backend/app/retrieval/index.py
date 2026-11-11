"""Per-session in-memory hybrid index.

A tiny, purpose-built vector store: a NumPy matrix of normalised embeddings plus a
BM25 keyword index over the same chunks. It lives inside the session object and is
garbage-collected when the session is wiped, which is exactly the privacy property
we want (no files, no database, nothing to clean up). For a few thousand chunks a
brute-force matrix product is faster than an ANN index.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np
from rank_bm25 import BM25Okapi

from app.ingest.chunking import Chunk

_TOKEN = re.compile(r"[a-z0-9]+")
_STOP = set("a an the of to in on for and or is are was were be by with as at from that this it its into than then".split())


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP]


@dataclass
class Hit:
    chunk: Chunk
    score: float            # fused (or reranked) score
    dense_rank: int | None
    sparse_rank: int | None
    rerank_score: float | None = None


class SessionIndex:
    def __init__(self) -> None:
        self.children: list[Chunk] = []
        self.parents: dict[str, Chunk] = {}
        self.vectors = np.zeros((0, 384), dtype=np.float32)
        self.section_vectors = np.zeros((0, 384), dtype=np.float32)
        self.section_ids: list[str] = []
        self._bm25: BM25Okapi | None = None
        self.large_docs: set[str] = set()

    def __len__(self) -> int:
        return len(self.children)

    def add(self, children: list[Chunk], parents: list[Chunk], vectors: np.ndarray,
            section_vectors: np.ndarray, hierarchical: bool) -> None:
        self.children.extend(children)
        self.parents.update({p.id: p for p in parents})
        self.vectors = np.vstack([self.vectors, vectors]) if len(self.vectors) else vectors
        self.section_ids.extend(p.id for p in parents)
        self.section_vectors = (np.vstack([self.section_vectors, section_vectors])
                                if len(self.section_vectors) else section_vectors)
        if hierarchical and children:
            self.large_docs.add(children[0].doc_id)
        self._rebuild_bm25()

    def remove_doc(self, doc_id: str) -> None:
        keep = [i for i, c in enumerate(self.children) if c.doc_id != doc_id]
        self.children = [self.children[i] for i in keep]
        self.vectors = self.vectors[keep] if keep else np.zeros((0, 384), dtype=np.float32)
        skeep = [i for i, pid in enumerate(self.section_ids) if self.parents[pid].doc_id != doc_id]
        self.section_ids = [self.section_ids[i] for i in skeep]
        self.section_vectors = self.section_vectors[skeep] if skeep else np.zeros((0, 384), dtype=np.float32)
        self.parents = {k: v for k, v in self.parents.items() if v.doc_id != doc_id}
        self.large_docs.discard(doc_id)
        self._rebuild_bm25()

    def _rebuild_bm25(self) -> None:
        corpus = [tokenize(c.indexed_text) for c in self.children]
        self._bm25 = BM25Okapi(corpus) if corpus else None

    # ── search ──────────────────────────────────────────────────────────────
    def hybrid(self, query: str, qvec: np.ndarray, k: int = 20, doc_ids: set[str] | None = None,
               rrf_k: int = 60) -> list[Hit]:
        """Dense + BM25, fused with Reciprocal Rank Fusion (rank-based, so no score calibration needed)."""
        if not self.children:
            return []
        allowed = np.ones(len(self.children), dtype=bool)
        if doc_ids:
            allowed &= np.array([c.doc_id in doc_ids for c in self.children])
        allowed &= self._hierarchical_mask(qvec)

        dense = self.vectors @ qvec
        dense[~allowed] = -np.inf
        dense_order = [i for i in np.argsort(-dense)[: k * 2] if np.isfinite(dense[i])]

        sparse_order: list[int] = []
        q_tokens = tokenize(query)
        if self._bm25 is not None and q_tokens:
            sparse = np.asarray(self._bm25.get_scores(q_tokens))
            sparse[~allowed] = -np.inf
            sparse_order = [i for i in np.argsort(-sparse)[: k * 2] if np.isfinite(sparse[i]) and sparse[i] > 0]

        fused: dict[int, float] = {}
        d_rank = {i: r for r, i in enumerate(dense_order)}
        s_rank = {i: r for r, i in enumerate(sparse_order)}
        for i in set(dense_order) | set(sparse_order):
            fused[i] = (1 / (rrf_k + d_rank[i]) if i in d_rank else 0) + (1 / (rrf_k + s_rank[i]) if i in s_rank else 0)
        top = sorted(fused, key=fused.get, reverse=True)[:k]
        return [Hit(self.children[i], fused[i], d_rank.get(i), s_rank.get(i)) for i in top]

    def _hierarchical_mask(self, qvec: np.ndarray, top_sections: int = 12) -> np.ndarray:
        """For very large documents, restrict search to the best-matching sections first."""
        mask = np.ones(len(self.children), dtype=bool)
        if not self.large_docs or not len(self.section_vectors):
            return mask
        sims = self.section_vectors @ qvec
        best = {self.section_ids[i] for i in np.argsort(-sims)[:top_sections]}
        for i, c in enumerate(self.children):
            if c.doc_id in self.large_docs and c.parent_id not in best:
                mask[i] = False
        return mask

    def mmr(self, hits: list[Hit], qvec: np.ndarray, k: int, lam: float = 0.75) -> list[Hit]:
        """Maximal Marginal Relevance: keep relevance high while avoiding near-duplicate chunks."""
        if len(hits) <= k:
            return hits
        idx = {id(c): i for i, c in enumerate(self.children)}
        vecs = np.array([self.vectors[idx[id(h.chunk)]] for h in hits])
        rel = vecs @ qvec
        chosen: list[int] = []
        while len(chosen) < k:
            best, best_score = -1, -np.inf
            for i in range(len(hits)):
                if i in chosen:
                    continue
                redundancy = max((float(vecs[i] @ vecs[j]) for j in chosen), default=0.0)
                score = lam * rel[i] - (1 - lam) * redundancy
                if score > best_score:
                    best, best_score = i, score
            chosen.append(best)
        return [hits[i] for i in chosen]

    def parent_of(self, chunk: Chunk) -> Chunk | None:
        return self.parents.get(chunk.parent_id)
