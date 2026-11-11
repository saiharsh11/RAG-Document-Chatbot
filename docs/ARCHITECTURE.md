# Architecture

RAG Document Assistant is a private, multi-agent document Q&A system. Users upload PDFs or text files,
ask questions, and get streamed answers in which every claim cites the passage it came from. Nothing is
stored: all state lives in an in-memory session that is wiped on exit or after 10 idle minutes.

This document explains what each part is, why it was built that way, and where its limits are.

---

## 1. Request flow

```
Browser (React)                         FastAPI backend (one process)
───────────────                         ─────────────────────────────────────────────────────────────
upload ──SSE──▶ parse (PyMuPDF) → mask PII → adaptive chunking → strip injected instructions
                → embed locally (bge-small, ONNX) → per-session hybrid index (NumPy + BM25)

question ─SSE─▶ Orchestrator (LangGraph state graph)
                 guard ─▶ plan ─┬─ direct ───────────────────────────────▶ write ─▶ finalize
                                ├─ clarify ─────────────────────────────────────────▶ finalize
                                ├─ cag (whole corpus fits) ──────────────▶ write ─▶ finalize
                                ├─ retrieve ─▶ grade ─┬─(good)───────────▶ write ─▶ finalize
                                │                     └─(weak)─▶ research ┐
                                ├─ research ─▶ Researcher agent (A2A) ────┴▶ write ─▶ Verifier agent (A2A)
                                │                                                    ├─(revise)─▶ research/write
                                │                                                    └─(pass)───▶ finalize
                                └─ wiki ─▶ wiki reader (agent loop over wiki tools) ─────────────▶ finalize
```

The live **agent trail** in the UI is the `step` events emitted along this path, each with the model
used and its latency.

## 2. What is an agent here (and what is not)

The word "agent" is used only for components where **the model decides the control flow at run time**:
it chooses which tool to call, sees the result, and decides again, until it judges the task done.

| Component | What it is | Why |
|---|---|---|
| **Researcher** | Agent: tool-calling loop (`app/agents/loop.py`) | Chooses searches, rewrites weak queries, reads sections, decides when evidence is sufficient |
| **Verifier** | Agent: critic loop | Judges each claim; may search for support before ruling it unsupported |
| **Librarian** | Agent: tool-calling loop | Researches each wiki concept or Studio item with its own searches, drafts cited content, finds contradictions |
| **Orchestrator** | **LLM-routed workflow** (LangGraph) | A fast model picks a route through a fixed graph; code validates the choice. It is a planner, not an open-ended agent |
| Guardrails | Pipeline stage | Regex PII masking + Meta's Llama Prompt Guard 2 classifier. No planning, no loop |
| Retriever | Deterministic code | BM25 + dense search, RRF fusion, reranking, MMR. No LLM |
| Writer | Single LLM call | Streams the answer from the evidence it is given |

Every loop is bounded (step budget, max verification rounds) so a confused model cannot loop forever or
burn the free-tier quota. The UI labels each actor with its real kind: `agent`, `planner`, `llm`,
`pipeline`, `guardrail`.

**Design principle:** models make judgment calls; code handles anything that must be exact (PII
masking, citation validity, routing overrides, scoring). For example, the Librarian *drafts* a wiki
page as structured JSON and code saves it, which proved more reliable than hoping the model remembers
to make a final tool call.

## 3. Protocols

### MCP (agent ↔ tools)
`app/tools/server.py` defines an MCP server (`mcp` SDK, `MCPServer`) with tools such as
`search_documents`, `read_source`, `search_wiki`, `read_wiki_page`, `record_contradiction`.
A **fresh server instance is built per request and closed over one session**, so a tool can only see
that session's data. Each agent gets a least-privilege allow-list (`TOOLSETS`). There is deliberately no
file-system, shell, network or database tool. Agents discover tools with `list_tools` and call them
over the protocol through an in-process transport.

### A2A (agent ↔ agent)
`app/a2a_net/network.py` serves the Researcher, Verifier and Librarian as A2A servers (`a2a-sdk` 1.3),
each with an **Agent Card** and a JSON-RPC endpoint. The Orchestrator is an A2A client.

*Tradeoff, stated plainly:* all agents run in one process, and the client reaches them through an
in-process ASGI transport. A delegation is a real A2A JSON-RPC exchange without a network hop. This adds
some serialisation overhead versus a direct function call; the benefit is that any agent can be moved to
its own service by changing one base URL. The endpoints are internal: requests need a per-process secret,
so the public internet gets a 404. Live step telemetry flows through an in-process event bus, not A2A.

## 4. Retrieval

* **Parsing:** PyMuPDF in memory. Headings are recovered from font sizes when a PDF has no outline.
  Scanned PDFs (no text layer) are detected and rejected with a clear message (no OCR yet).
* **Adaptive chunking** (`app/ingest/chunking.py`), chosen per document:

  | Size | Strategy |
  |---|---|
  | ≤ 20 pages | Semantic chunking (split where adjacent-sentence similarity drops) + parent sections |
  | ≤ 300 pages | Heading-aware recursive chunking with overlap + parent sections |
  | > 300 pages | Heading-aware chunking + hierarchical retrieval (best sections first, then chunks) |

  Every chunk gets a **contextual header** ("Doc › Section › Subsection") for embedding and BM25.
  **Small-to-big:** children are searched, and the model sees the surrounding window of the parent section.
* **CAG:** if the whole corpus fits the context budget, retrieval is skipped and the full text is used.
* **Index:** per-session NumPy matrix + `rank-bm25`. For a few thousand chunks a brute-force matrix
  product is fast, and the index is garbage-collected with the session (no vector DB to clean up).
* **Search:** dense + BM25 fused with **Reciprocal Rank Fusion**, Jina cross-encoder rerank of the top 20,
  then **MMR** for diversity. Corrective RAG grades the passages before use.
* **Models:** `BAAI/bge-small-en-v1.5` embeddings and `jinaai/jina-reranker-v1-turbo-en` (Apache-2.0), both run locally through
  **FastEmbed / ONNX Runtime** (no PyTorch, no embedding API). Documents never leave the server to be embedded.

## 5. Models and free-tier engineering

All chat models are open-weight, served by Groq:

| Job | Chain (first available wins) |
|---|---|
| Answers, wiki pages | gpt-oss-120b → qwen3.8-27b → gpt-oss-20b |
| Research loops | gpt-oss-20b → gpt-oss-120b → qwen3.8-27b |
| Verification | qwen3.8-27b → gpt-oss-20b → gpt-oss-120b (a different model checks the writer) |
| Routing, grading | gpt-oss-20b → qwen3.8-27b → gpt-oss-120b |
| Injection screening | meta-llama/llama-prompt-guard-2-86m |
| Voice in / out | whisper-large-v3-turbo / Orpheus (browser speech as fallback) |

The free tier allows about 8,000 tokens per minute **per model**, so `app/llm/client.py`:
mirrors Groq's rate-limit headers into a **token bucket per model** (the quota refills continuously),
skips models that cannot fit a request, **waits for quota** instead of failing when every model is
saturated, trips a **circuit breaker** on errors, caps output per model (Qwen allows 1,000 output
tokens/minute), and accounts tokens per request (shown in the UI) and per day (optional hard budget).
Spreading jobs across three models triples effective throughput.

## 6. Privacy

* No accounts, no database, no files on disk. Uploads are parsed from memory; raw bytes are dropped
  after parsing. Sessions expire after 10 idle minutes and can be ended instantly.
* PII (emails, phones, cards with Luhn check, IBANs, SSNs, IPs) is **always** masked locally **before** chunking. There is no setting to turn it off. Tradeoff: the assistant can never quote contact details from a document.
* Prompt injection: questions are screened by Prompt Guard 2; injected sentences inside documents are
  removed at ingestion (rules find candidates, the classifier confirms) and the model is told to treat
  source text as data.
* Logs contain timings and model names, never content.
* Honest limit: the passages needed for an answer are sent to Groq for inference. Enable Zero Data
  Retention in the Groq console for the strongest guarantee.

## 7. Evaluation

Two layers:

1. **Retrieval on BEIR SciFact** (`eval/beir_eval.py`): 5,183 abstracts, 300 human-labelled test
   queries, standard nDCG@10 / Recall@100. Results in `eval/results/beir_scifact.json`:

| Retrieval setup | nDCG@10 | Recall@100 |
|---|---|---|
| BM25 only | 0.667 | 0.886 |
| dense only (bge-small) | 0.713 | 0.942 |
| hybrid (RRF) | 0.707 | 0.965 |
| hybrid + rerank (MiniLM, top-20) | 0.695 | 0.965 |
| hybrid + rerank (bge-reranker-base, top-20) | 0.719 | 0.965 |
| hybrid + rerank (jina-reranker-v1-turbo-en, top-20) | 0.737 | 0.965 |

   Our BM25 (0.667) is in line with the BM25 baseline commonly reported for SciFact (~0.665), which
   sanity-checks the harness. Hybrid fusion raises recall@100 (0.94 → 0.97) but not nDCG@10 on its own;
   the gain at the top comes from reranking. The MS MARCO MiniLM reranker the app first used made
   results *worse* (0.695), most likely a domain mismatch (web queries vs scientific claims), so the
   default was switched to the Jina reranker after measuring (0.737).
2. **End to end on a labelled synthetic corpus** (`eval/run_eval.py --llm`; the corpus is kept out of the
   public repository): runs the real agents and
   scores answer correctness, citation precision, and RAGAS-style LLM-judge faithfulness and answer
   relevancy, plus latency, calls and tokens. Results in `eval/results/REPORT.md`.

CI (`.github/workflows/ci.yml`) runs the unit tests and the frontend lint + build on every push. The
retrieval quality gate (`eval/run_eval.py --min-hit5 0.9 --min-mrr 0.8`) and the end-to-end evaluation
run locally against the synthetic corpus.

See `eval/results/` for the latest numbers and the caveats that come with them.

## 8. Known limitations

* Free-tier latency: agentic answers take several seconds to tens of seconds when the per-minute quota
  is saturated. A paid tier removes most of this without code changes.
* Models are not deterministic: occasionally an agent skips a wiki page or the planner picks a heavier
  route than needed. The evaluation suite measures how often.
* No OCR for scanned PDFs; tables are extracted as text, not structure.
* The synthetic end-to-end set is small; it tests the pipeline, not real-world accuracy.
* Single process: sessions live in one server's memory, so horizontal scaling would need sticky
  sessions or an external session store (which would conflict with the zero-storage goal).
