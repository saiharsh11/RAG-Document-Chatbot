"""Retrieval benchmark on BEIR SciFact (public, human-labelled; ~5k abstracts, 300 test queries).

    python eval/beir_eval.py            # downloads ~3 MB once into eval/data/ (git-ignored)

Uses exactly the same components as the app (local bge-small embeddings, BM25, RRF fusion,
MiniLM cross-encoder reranker) and reports nDCG@10 and Recall@100, the standard BEIR metrics,
so results can be compared with published baselines.
"""

from __future__ import annotations

import asyncio
import io
import json
import math
import os
import statistics
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import httpx  # noqa: E402
import numpy as np  # noqa: E402

from app.ingest.chunking import Chunk  # noqa: E402
from app.retrieval import models  # noqa: E402
from app.retrieval.index import SessionIndex, tokenize  # noqa: E402

URL = "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip"
DATA = os.path.join(HERE, "data", "scifact")


def download() -> None:
    if os.path.exists(os.path.join(DATA, "corpus.jsonl")):
        return
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    print("downloading SciFact…")
    blob = httpx.get(URL, timeout=120, follow_redirects=True).content
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        for name in z.namelist():  # extract only the expected data files, never paths outside DATA
            base = os.path.basename(name)
            if base in ("corpus.jsonl", "queries.jsonl") or name.endswith("qrels/test.tsv"):
                target = os.path.join(DATA, "test.tsv" if base == "test.tsv" else base)
                os.makedirs(DATA, exist_ok=True)
                with open(target, "wb") as f:
                    f.write(z.read(name))


def load():
    corpus = [json.loads(line) for line in open(os.path.join(DATA, "corpus.jsonl"))]
    queries = {q["_id"]: q["text"] for q in map(json.loads, open(os.path.join(DATA, "queries.jsonl")))}
    qrels: dict[str, dict[str, int]] = {}
    for i, line in enumerate(open(os.path.join(DATA, "test.tsv"))):
        if i == 0:
            continue
        qid, did, rel = line.strip().split("\t")
        qrels.setdefault(qid, {})[did] = int(rel)
    return corpus, {q: queries[q] for q in qrels}, qrels


def ndcg10(ranked: list[str], rel: dict[str, int]) -> float:
    dcg = sum(rel.get(d, 0) / math.log2(i + 2) for i, d in enumerate(ranked[:10]))
    ideal = sum(r / math.log2(i + 2) for i, r in enumerate(sorted(rel.values(), reverse=True)[:10]))
    return dcg / ideal if ideal else 0.0


def recall(ranked: list[str], rel: dict[str, int], k: int = 100) -> float:
    return len(set(ranked[:k]) & set(rel)) / len(rel)


async def main() -> int:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--rerankers", default="", help="comma-separated extra FastEmbed rerankers to compare")
    ap.add_argument("--queries", type=int, default=0, help="limit queries (0 = all 300)")
    args = ap.parse_args()
    download()
    corpus, queries, qrels = load()
    if args.queries:
        queries = dict(list(queries.items())[: args.queries])
    print(f"corpus {len(corpus)} docs · {len(queries)} test queries")

    t0 = time.perf_counter()
    idx = SessionIndex()
    chunks = [Chunk(d["_id"], d["_id"], d.get("title", ""), d["text"], [], 1, 1, parent_id=d["_id"]) for d in corpus]
    cache = os.path.join(DATA, f"vectors-{models.settings.embed_model.replace('/', '_')}.npy")
    if os.path.exists(cache):
        vecs = np.load(cache)
    else:
        vecs = models.embed_sync([c.indexed_text for c in chunks])
        np.save(cache, vecs)
    idx.add(chunks, [], vecs, np.zeros((0, vecs.shape[1]), dtype=np.float32), hierarchical=False)
    print(f"indexed locally in {time.perf_counter() - t0:.0f}s")

    from fastembed.rerank.cross_encoder import TextCrossEncoder

    extra = {name: TextCrossEncoder(name, threads=models.settings.onnx_threads, cache_dir=models.settings.model_cache)
             for name in [r for r in args.rerankers.split(",") if r]}
    scores = {"BM25 only": [], "dense only (bge-small)": [], "hybrid (RRF)": [], "hybrid + rerank (MiniLM, top-20)": []}
    scores.update({f"hybrid + rerank ({n.split('/')[-1]}, top-20)": [] for n in extra})
    recalls = {k: [] for k in scores}
    t1 = time.perf_counter()
    for qid, q in queries.items():
        qvec = models.embed_query_sync(q)
        rel = qrels[qid]
        bm = np.asarray(idx._bm25.get_scores(tokenize(q)))
        runs = {
            "BM25 only": [chunks[i].id for i in np.argsort(-bm)[:100]],
            "dense only (bge-small)": [chunks[i].id for i in np.argsort(-(idx.vectors @ qvec))[:100]],
            "hybrid (RRF)": [h.chunk.id for h in idx.hybrid(q, qvec, k=100)],
        }
        hyb = idx.hybrid(q, qvec, k=100)
        top = hyb[:20]
        rr = models.rerank_sync(q, [h.chunk.indexed_text for h in top]) or []
        reranked = [h.chunk.id for _, h in sorted(zip(rr, top), key=lambda x: -x[0])] + [h.chunk.id for h in hyb[20:]]
        runs["hybrid + rerank (MiniLM, top-20)"] = reranked
        for n, model in extra.items():
            sc = [float(x) for x in model.rerank(q, [h.chunk.indexed_text for h in top])]
            runs[f"hybrid + rerank ({n.split('/')[-1]}, top-20)"] = (
                [h.chunk.id for _, h in sorted(zip(sc, top), key=lambda x: -x[0])] + [h.chunk.id for h in hyb[20:]])
        for name, ranked in runs.items():
            scores[name].append(ndcg10(ranked, rel))
            recalls[name].append(recall(ranked, rel))
    per_q = (time.perf_counter() - t1) / len(queries) * 1000

    rows = {name: {"ndcg@10": round(statistics.mean(scores[name]), 4), "recall@100": round(statistics.mean(recalls[name]), 4)}
            for name in scores}
    out = {"dataset": "BEIR SciFact (test)", "docs": len(corpus), "queries": len(queries),
           "embedder": models.settings.embed_model, "reranker": models.settings.rerank_model,
           "ms_per_query_all_variants": round(per_q, 1), "results": rows}
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    with open(os.path.join(HERE, "results", "beir_scifact.json"), "w") as f:
        json.dump(out, f, indent=2)
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
