"""End-to-end smoke test against a running backend.

    python eval/smoke.py <API_URL> file1.pdf [file2.pdf ...] -q "question" -q "question"

Prints the live agent trail, the answer, citations and verification for each question.
"""

from __future__ import annotations

import argparse
import json
import sys
import time

import httpx


def sse(resp):
    event = None
    for line in resp.iter_lines():
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            yield event, json.loads(line[5:])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("files", nargs="*")
    ap.add_argument("-q", "--question", action="append", default=[])
    ap.add_argument("--mode", default="auto")
    ap.add_argument("--wiki", action="store_true")
    a = ap.parse_args()

    c = httpx.Client(base_url=a.base, timeout=300)
    sid = c.post("/sessions").json()["session_id"]
    print(f"session {sid[:8]}…")
    if a.files:
        files = [("files", (f.rsplit("/", 1)[-1], open(f, "rb"), "application/pdf")) for f in a.files]
        with c.stream("POST", f"/sessions/{sid}/documents", files=files) as r:
            for ev, d in sse(r):
                if ev == "progress":
                    print(f"  · {d['file']}: {d['message']}")
                elif ev == "done":
                    doc = d["document"]
                    print(f"  ✓ {doc['name']}: {doc['pages']}p, {doc['chunks']} chunks, strategy={doc['strategy']}, "
                          f"pii_masked={doc['pii_masked']}, quarantined={doc['flagged_chunks']}")
                elif ev == "error":
                    print(f"  ✗ {d['file']}: {d['message']}")

    if a.wiki:
        print("\n=== build wiki")
        with c.stream("POST", f"/sessions/{sid}/wiki/build") as r:
            for ev, d in sse(r):
                if ev == "step":
                    print(f"  [{d['t_ms']:>6}ms] {d['agent']:<12} {d['action']:<22} {d.get('detail', '')}")
                elif ev in ("final", "error"):
                    print("  →", {k: v for k, v in d.items() if k not in ("graph", "t_ms", "type")})
        w = c.get(f"/sessions/{sid}/wiki").json()
        for p in w["pages"]:
            print(f"  page: {p['title']} ({p['kind']}) links={p['links'][:4]} sources={len(p['sources'])}")

    for q in a.question:
        print(f"\n=== Q: {q}")
        t0 = time.time()
        answer = []
        with c.stream("POST", f"/sessions/{sid}/chat", json={"message": q, "mode": a.mode}) as r:
            for ev, d in sse(r):
                if ev == "step":
                    extra = f" ({d['model']})" if d.get("model") else ""
                    print(f"  [{d['t_ms']:>6}ms] {d['agent']:<12} {d['action']:<20} {d.get('detail', '')}{extra}")
                elif ev == "token":
                    answer.append(d["text"])
                elif ev == "reset":
                    answer = []
                    print("  ↺ answer reset:", d.get("reason"))
                elif ev == "final":
                    print(f"\n  ANSWER ({d['route']}, {d['latency_ms']}ms, {d['usage']['calls']} LLM calls, "
                          f"{d['usage']['prompt_tokens'] + d['usage']['completion_tokens']} tokens):")
                    print("  " + d["answer"].replace("\n", "\n  "))
                    for cit in d["citations"]:
                        print(f"    [{cit['id']}] {cit['doc']} p.{cit['pages']} — {cit['section']}")
                    if d.get("verification"):
                        v = d["verification"]
                        print(f"  verification: {v['verdict']} ({v['supported']}/{v['total']} supported)")
                    if d.get("notice"):
                        print("  notice:", d["notice"])
                elif ev == "error":
                    print("  ERROR:", d["message"], d.get("detail", ""))
        print(f"  ({time.time() - t0:.1f}s wall)")
    c.delete(f"/sessions/{sid}")
    print("\nsession wiped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
