"""Local embedding + reranking with FastEmbed (ONNX Runtime, no PyTorch, no external API).

Models load lazily on first use and are shared across sessions (they hold no user data).
CPU work runs in a worker thread so the event loop stays responsive.
"""

from __future__ import annotations

import asyncio
import logging
import threading

import numpy as np

from app.config import settings

log = logging.getLogger("models")
_lock = threading.Lock()
_embedder = None
_reranker = None


def _get_embedder():
    global _embedder
    with _lock:
        if _embedder is None:
            from fastembed import TextEmbedding

            log.info("loading embedder %s", settings.embed_model)
            _embedder = TextEmbedding(settings.embed_model, threads=settings.onnx_threads, cache_dir=settings.model_cache)
    return _embedder


def _get_reranker():
    global _reranker
    if not settings.rerank_enabled:
        return None
    with _lock:
        if _reranker is None:
            from fastembed.rerank.cross_encoder import TextCrossEncoder

            log.info("loading reranker %s", settings.rerank_model)
            _reranker = TextCrossEncoder(settings.rerank_model, threads=settings.onnx_threads, cache_dir=settings.model_cache)
    return _reranker


def embed_sync(texts: list[str]) -> np.ndarray:
    if not texts:
        return np.zeros((0, 384), dtype=np.float32)
    vecs = np.array(list(_get_embedder().embed(texts, batch_size=64)), dtype=np.float32)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-12
    return vecs


def embed_query_sync(text: str) -> np.ndarray:
    # BGE models recommend this instruction prefix for queries (not for passages).
    return embed_sync([f"Represent this sentence for searching relevant passages: {text}"])[0]


async def embed(texts: list[str]) -> np.ndarray:
    return await asyncio.to_thread(embed_sync, texts)


async def embed_query(text: str) -> np.ndarray:
    return await asyncio.to_thread(embed_query_sync, text)


def rerank_sync(query: str, docs: list[str]) -> list[float] | None:
    rr = _get_reranker()
    if rr is None or not docs:
        return None
    return [float(s) for s in rr.rerank(query, docs)]


async def rerank(query: str, docs: list[str]) -> list[float] | None:
    return await asyncio.to_thread(rerank_sync, query, docs)


def warmup() -> None:
    embed_sync(["warm up"])
    rerank_sync("warm up", ["warm up"])
