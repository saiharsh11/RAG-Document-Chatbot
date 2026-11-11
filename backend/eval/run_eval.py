"""Evaluation harness.

Retrieval (no LLM, deterministic, runs in CI):
    python eval/run_eval.py
compares dense-only, BM25-only, hybrid (RRF) and the full pipeline (hybrid + cross-encoder rerank + MMR)
with hit@1, hit@5, recall@5 and MRR@10 against labelled (document, page) pairs.

End-to-end (calls Groq, runs the real agents):
    python eval/run_eval.py --llm [--limit 8]
adds answer correctness (expected facts present), citation precision (cited pages are relevant),
and RAGAS-style LLM-judge metrics: faithfulness (share of claims supported by the cited text) and
answer relevancy (1-5, scaled to 0-1), plus latency, LLM calls and tokens per question.

Results are written to eval/results/latest.json and eval/results/REPORT.md.
Use --min-hit5 / --min-mrr to fail the process (and CI) when quality regresses.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import statistics
import sys
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import numpy as np  # noqa: E402

from app.ingest.service import ingest  # noqa: E402
from app.retrieval import models  # noqa: E402
from app.retrieval.index import tokenize  # noqa: E402
from app.session import Ledger, Session  # noqa: E402


def normalise(text: str) -> str:
    """Models emit narrow no-break spaces and non-breaking hyphens (e.g. 'March\u202f31'); compare plain text."""
    text = re.sub(r"[\u00a0\u2000-\u200b\u202f\u205f]", " ", text)
    text = re.sub(r"[\u2010-\u2015\u2212]", "-", text)
    return re.sub(r"\s+", " ", text.replace("*", "")).lower()


def load_dataset():
    with open(os.path.join(HERE, "dataset.json")) as f:
        return json.load(f)


async def build_session(ds) -> Session:
    # The synthetic PDFs are generated, not committed: create them on first use.
    if not all(os.path.exists(os.path.join(HERE, rel)) for rel in ds["documents"]):
        import runpy
        runpy.run_path(os.path.join(HERE, "fixtures", "make_fixtures.py"))
    s = Session()
    for rel in ds["documents"]:
        with open(os.path.join(HERE, rel), "rb") as f:
            await ingest(s, f.read(), os.path.basename(rel))
    return s


def relevant(chunk, gold: set[tuple[str, int]]) -> set[tuple[str, int]]:
    return {(d, p) for d, p in gold if d == chunk.doc_name and chunk.page_start <= p <= chunk.page_end}


# ── retrieval variants ──────────────────────────────────────────────────────
def rank_dense(s: Session, q: str, qvec, k=10):
    order = np.argsort(-(s.index.vectors @ qvec))[:k]
    return [s.index.children[i] for i in order]


def rank_bm25(s: Session, q: str, qvec, k=10):
    scores = np.asarray(s.index._bm25.get_scores(tokenize(q)))
    return [s.index.children[i] for i in np.argsort(-scores)[:k]]


def rank_hybrid(s: Session, q: str, qvec, k=10):
    return [h.chunk for h in s.index.hybrid(q, qvec, k=k)]


async def rank_pipeline(s: Session, q: str, k=10):
    from app.retrieval.pipeline import retrieve

    return [e.chunk for e in await retrieve(s, q, Ledger(), k=min(k, 5))]


def score(ranked, gold):
    gold = {tuple(x) for x in gold}
    first = next((i for i, c in enumerate(ranked) if relevant(c, gold)), None)
    top5 = set().union(*(relevant(c, gold) for c in ranked[:5])) if ranked else set()
    return {
        "hit@1": float(first == 0),
        "hit@5": float(first is not None and first < 5),
        "recall@5": len(top5) / len(gold),
        "mrr": 1 / (first + 1) if first is not None and first < 10 else 0.0,
    }


def mean_metrics(rows):
    keys = rows[0].keys()
    return {k: round(statistics.mean(r[k] for r in rows), 3) for k in keys}


async def eval_retrieval(s: Session, ds) -> dict:
    variants = {"dense only": [], "BM25 only": [], "hybrid (RRF)": [], "hybrid + rerank + MMR": []}
    for item in ds["questions"]:
        qvec = await models.embed_query(item["q"])
        variants["dense only"].append(score(rank_dense(s, item["q"], qvec), item["pages"]))
        variants["BM25 only"].append(score(rank_bm25(s, item["q"], qvec), item["pages"]))
        variants["hybrid (RRF)"].append(score(rank_hybrid(s, item["q"], qvec), item["pages"]))
        variants["hybrid + rerank + MMR"].append(score(await rank_pipeline(s, item["q"]), item["pages"]))
    return {name: mean_metrics(rows) for name, rows in variants.items()}


# ── end to end ──────────────────────────────────────────────────────────────
JUDGE_FAITH = """You are grading an answer for faithfulness to its sources.
List each factual claim in the answer and whether the provided source text supports it.
Reply with JSON only: {"claims": [{"claim": "...", "supported": true|false}]}"""

JUDGE_REL = """Rate how directly and completely the answer addresses the question, from 1 (not at all) to 5 (fully).
Ignore whether it is correct. Reply with JSON only: {"score": 1-5}"""


async def judge(llm, system, user):
    r = await llm.chat("fast", [{"role": "system", "content": system}, {"role": "user", "content": user}],
                       json_mode=True, max_tokens=600)
    return r.json()


async def eval_end_to_end(s: Session, ds, limit: int | None) -> dict:
    from app.a2a_net.network import A2ADelegate
    from app.agents.orchestrator import graph
    from app.agents.runtime import Run, runs
    from app.api import app
    from app.llm.client import llm

    a2a = A2ADelegate(app)
    rows = []
    for item in ds["questions"][:limit]:
        run = Run(session=s)
        runs.add(run)
        t0 = time.perf_counter()
        try:
            state = await graph.ainvoke({"question": item["q"], "mode": "auto"},
                                        config={"configurable": {"run": run, "a2a": a2a}, "recursion_limit": 40})
        except Exception as e:  # count failures honestly instead of skipping them
            rows.append({"q": item["q"], "error": f"{type(e).__name__}: {e}"[:200]})
            continue
        finally:
            runs.remove(run.id)
        latency = time.perf_counter() - t0
        answer = state.get("answer", "")
        low = normalise(answer)
        correct = all(any(normalise(opt) in low for opt in group) for group in item["expect"])
        cited = [run.ledger.get(x) for x in state.get("sources", []) if run.ledger.get(x)]
        gold = {tuple(x) for x in item["pages"]}
        cite_prec = (sum(bool(relevant(e.chunk, gold)) for e in cited) / len(cited)) if cited else 0.0

        src = "\n\n".join(f"[{e.sid}] {e.text[:1200]}" for e in cited) or "(no sources cited)"
        try:
            f = await judge(llm, JUDGE_FAITH, f"Answer:\n{answer}\n\nSources:\n{src}")
            claims = f.get("claims", [])
            faith = (sum(bool(c.get("supported")) for c in claims) / len(claims)) if claims else 0.0
            rel = (await judge(llm, JUDGE_REL, f"Question: {item['q']}\n\nAnswer:\n{answer}")).get("score", 0) / 5
        except Exception:
            faith, rel = None, None
        rows.append({"q": item["q"], "route": state.get("route"), "correct": correct, "citation_precision": round(cite_prec, 3),
                     "faithfulness": None if faith is None else round(faith, 3), "answer_relevancy": rel,
                     "latency_s": round(latency, 2), "llm_calls": run.usage.calls,
                     "tokens": run.usage.prompt_tokens + run.usage.completion_tokens, "answer": answer[:600]})
    await a2a.aclose()

    ok = [r for r in rows if "error" not in r]

    def avg(key):
        vals = [r[key] for r in ok if r.get(key) is not None]
        return round(statistics.mean(vals), 3) if vals else None

    return {
        "questions": len(rows), "errors": len(rows) - len(ok),
        "answer_correctness": round(sum(r["correct"] for r in ok) / max(1, len(rows)), 3),
        "citation_precision": avg("citation_precision"), "faithfulness": avg("faithfulness"),
        "answer_relevancy": avg("answer_relevancy"),
        "median_latency_s": round(statistics.median([r["latency_s"] for r in ok]), 2) if ok else None,
        "mean_llm_calls": avg("llm_calls"), "mean_tokens": avg("tokens"),
        "routes": {k: sum(r.get("route") == k for r in ok) for k in {r.get("route") for r in ok}},
        "rows": rows,
    }


def report(res: dict) -> str:
    lines = [f"# Evaluation report", "", f"_Generated {res['generated']} · {res['questions']} labelled questions over a "
             f"synthetic 41-page corpus (kept out of the public repository)._", "", "## Retrieval (no LLM)", "",
             "| Variant | hit@1 | hit@5 | recall@5 | MRR@10 |", "|---|---|---|---|---|"]
    for name, m in res["retrieval"].items():
        lines.append(f"| {name} | {m['hit@1']:.2f} | {m['hit@5']:.2f} | {m['recall@5']:.2f} | {m['mrr']:.2f} |")
    e = res.get("end_to_end")
    if e:
        lines += ["", "## End to end (real agents on Groq free tier)", "",
                  f"_Measured {res.get('end_to_end_generated') or res['generated']}._", "",
                  "| Metric | Value |", "|---|---|",
                  f"| Answer correctness (expected facts present) | {e['answer_correctness']:.2f} |",
                  f"| Citation precision (cited pages are relevant) | {e['citation_precision']} |",
                  f"| Faithfulness (LLM judge, claims supported by cited text) | {e['faithfulness']} |",
                  f"| Answer relevancy (LLM judge, scaled 0-1) | {e['answer_relevancy']} |",
                  f"| Median latency | {e['median_latency_s']} s |",
                  f"| Mean LLM calls / tokens per question | {e['mean_llm_calls']} / {e['mean_tokens']} |",
                  f"| Routes taken | {e['routes']} |",
                  f"| Errors | {e['errors']} of {e['questions']} |"]
    lines += ["", "## Caveats", "",
              "- The corpus is synthetic and small; numbers show relative differences between configurations, not real-world accuracy.",
              "- LLM-judge metrics use an open model as the judge and inherit its biases; treat them as indicative.",
              "- End-to-end latency is dominated by free-tier rate limits (8k tokens/min per model)."]
    return "\n".join(lines) + "\n"


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--llm", action="store_true", help="also run the end-to-end agent evaluation (uses Groq)")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--min-hit5", type=float, default=0.0)
    ap.add_argument("--min-mrr", type=float, default=0.0)
    a = ap.parse_args()

    ds = load_dataset()
    s = await build_session(ds)
    res = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "questions": len(ds["questions"]),
           "retrieval": await eval_retrieval(s, ds)}
    latest = os.path.join(HERE, "results", "latest.json")
    if a.llm:
        res["end_to_end"] = await eval_end_to_end(s, ds, a.limit)
    elif os.path.exists(latest):
        # A retrieval-only run (e.g. the CI gate) keeps the last end-to-end results instead of erasing them.
        try:
            with open(latest) as f:
                prev = json.load(f)
            if prev.get("end_to_end"):
                res["end_to_end"] = prev["end_to_end"]
                res["end_to_end_generated"] = prev.get("end_to_end_generated") or prev.get("generated")
        except (OSError, ValueError):
            pass
    if a.llm:
        res["end_to_end_generated"] = res["generated"]

    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    with open(latest, "w") as f:
        json.dump(res, f, indent=2)
    md = report(res)
    with open(os.path.join(HERE, "results", "REPORT.md"), "w") as f:
        f.write(md)
    print(md)

    best = res["retrieval"]["hybrid + rerank + MMR"]
    failed = [m for m, v, t in [("hit@5", best["hit@5"], a.min_hit5), ("mrr", best["mrr"], a.min_mrr)] if v < t]
    if failed:
        print(f"QUALITY GATE FAILED: {', '.join(failed)} below threshold", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

_ = re  # kept for ad-hoc analysis in notebooks
