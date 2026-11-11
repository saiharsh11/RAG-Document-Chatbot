# RAG Document Assistant

Private, multi-agent document intelligence. Upload PDFs or text files, ask questions, and get streamed
answers where **every claim cites the exact passage it came from**. Behind each answer, LLM agents
plan, search, cross-check and verify, and you can watch every step. Nothing is stored: the session and
everything in it is wiped when you leave.

**Live demo:** [rag-document-chatbot.vercel.app](https://rag-document-chatbot.vercel.app) ·
**Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
**Evaluation:** [backend/eval/results](backend/eval/results)

## Highlights

- **Real agents, honestly labelled.** A Researcher, a Verifier and a Librarian each run their own
  tool-calling loop, coordinated by a LangGraph Orchestrator. Tools are served over **MCP**; the
  Orchestrator delegates to agents over **A2A** (Agent Cards + JSON-RPC). The UI labels every step as
  agent, planner, LLM call, pipeline or guardrail.
- **Adaptive, corrective, self-checking RAG.** The planner chooses no retrieval, whole-document context
  (CAG), a fast lookup, or a full investigation. Retrieved passages are graded before use (CRAG), and the
  Verifier fact-checks each claim and can send the Researcher back for more evidence (Self-RAG).
- **Hybrid retrieval, run locally.** BM25 + `bge-small` embeddings fused with Reciprocal Rank Fusion,
  Jina cross-encoder reranking and MMR, with adaptive chunking by document size, contextual headers
  and small-to-big retrieval. Embeddings run on the server with ONNX, so documents are never sent to an
  embedding API.
- **Session wiki.** The Librarian compiles your documents into interlinked, cited concept pages, finds
  contradictions between documents, and shows them as a graph you can ask questions of.
- **Studio.** Cited quizzes, flashcards, mind maps and study guides, each researched by an agent.
- **Privacy by design.** In-memory sessions with automatic wipe, local PII masking, prompt-injection
  defence with Meta's Llama Prompt Guard 2, least-privilege tools, metadata-only logs.
- **Built for free tiers.** Open-weight models on Groq with per-model token buckets, fallback chains,
  quota-aware waiting and a circuit breaker.
- **Voice.** Ask by voice (Whisper) and listen to answers (Orpheus or the browser).

## Results

Retrieval on **BEIR SciFact** (5,183 abstracts, 300 human-labelled queries), same components as the app:

| Retrieval setup | nDCG@10 | Recall@100 |
|---|---|---|
| BM25 only | 0.667 | 0.886 |
| dense only (bge-small) | 0.713 | 0.942 |
| hybrid (RRF) | 0.707 | 0.965 |
| hybrid + rerank (MiniLM, top-20) | 0.695 | 0.965 |
| hybrid + rerank (bge-reranker-base, top-20) | 0.719 | 0.965 |
| hybrid + rerank (jina-reranker-v1-turbo-en, top-20) | 0.737 | 0.965 |

The app ships with **hybrid + Jina reranker** (+7.1 nDCG points over BM25). The MS MARCO MiniLM reranker *lowered* quality on scientific text, so it was replaced: measured, not assumed.

End to end, the real agents on the Groq free tier over a labelled synthetic corpus:

| Metric | Value |
|---|---|
| Answer correctness | 1.00 |
| Citation precision | 1.00 |
| Faithfulness (LLM judge) | 0.97 |
| Answer relevancy (LLM judge) | 1.00 |
| Median latency | 1.79 s |
| Errors | 0 / 16 |

16 questions over a synthetic corpus; several fixes came from studying this set's failures, so treat it as a regression test rather than an accuracy claim.

Reproduce the benchmark with `python eval/beir_eval.py` (it downloads SciFact). The end-to-end evaluation
(`eval/run_eval.py --llm`) uses a synthetic corpus that is kept out of this repository. Caveats are listed in
[REPORT.md](backend/eval/results/REPORT.md).

## Stack

| Layer | Technology |
|---|---|
| Agents | LangGraph (Orchestrator), custom tool-calling loop, MCP (`mcp` SDK), A2A (`a2a-sdk`) |
| Models | `gpt-oss-120b`, `gpt-oss-20b`, `qwen3.8-27b`, Llama Prompt Guard 2, Whisper, Orpheus (all on Groq) |
| Retrieval | FastEmbed / ONNX (`bge-small-en-v1.5`, `jina-reranker-v1-turbo-en`), `rank-bm25`, NumPy |
| Backend | FastAPI, server-sent events, PyMuPDF |
| Frontend | React 19, Vite, pdf.js |
| Quality | pytest, BEIR benchmark, RAGAS-style LLM-judge evaluation, GitHub Actions |
| Hosting | Railway (API), Vercel (web) |

## Run locally

```bash
# backend
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # add GROQ_API_KEY
.venv/bin/uvicorn main:app --port 8000

# frontend (another terminal)
cd frontend
echo "VITE_API_URL=<backend URL>" > .env.development.local
npm install && npm run dev      # open the URL Vite prints (workspace at /app)
```

## Project layout

```
backend/app/agents      Orchestrator (LangGraph), Researcher / Verifier / Librarian agents, agent loop
backend/app/a2a_net     A2A Agent Cards, servers and client
backend/app/tools       MCP tool server (one per session) and client
backend/app/retrieval   local embeddings + reranker, hybrid index, retrieval pipeline
backend/app/ingest      parsing and adaptive chunking
backend/app/guard       PII masking, prompt-injection defence
backend/app/llm         Groq client with fallbacks and rate-limit handling
backend/eval            BEIR benchmark and end-to-end evaluation scripts
frontend/src/workspace  the app: chat, agent trail, wiki graph, studio, PDF viewer
```
