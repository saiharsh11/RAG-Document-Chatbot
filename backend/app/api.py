"""HTTP API. Sessions are the unit of privacy: everything lives inside one and dies with it."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from app.a2a_net import network
from app.agents.orchestrator import graph
from app.agents.runtime import Run, runs
from app.config import CHAT_MODELS, settings
from app.ingest.service import IngestError, ingest
from app.llm.client import LLMUnavailable, llm
from app.retrieval import models
from app.session import Session, SessionFull, Turn, WikiPage, store

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.a2a = network.A2ADelegate(app)
    sweeper = asyncio.create_task(store.run_sweeper())
    asyncio.get_running_loop().run_in_executor(None, models.warmup)  # load ONNX models in the background
    yield
    sweeper.cancel()
    await app.state.a2a.aclose()
    await llm.aclose()


app = FastAPI(title="RAG Document Assistant API", version="2.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins), allow_methods=["*"],
                   allow_headers=["*"], expose_headers=["X-Session-Expires"])
network.mount(app)

_hits: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def guard_requests(request: Request, call_next):
    path = request.url.path
    # A2A endpoints are internal: only the in-process Orchestrator holds the token.
    if path.startswith(network.PREFIX) and request.headers.get("X-Internal-Token") != network.INTERNAL_TOKEN:
        return JSONResponse({"detail": "Not found"}, status_code=404)
    if request.method == "POST" and not path.startswith(network.PREFIX):
        ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0]
        q, now = _hits[ip], time.time()
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= settings.rate_limit_per_minute:
            return JSONResponse({"detail": "Too many requests. Please slow down."}, status_code=429)
        q.append(now)
    return await call_next(request)


def _session(sid: str) -> Session:
    s = store.get(sid)
    if not s:
        raise HTTPException(404, "Session not found or expired. Start a new session.")
    return s


def _sse(event: dict) -> str:
    return f"event: {event['type']}\ndata: {json.dumps(event, default=str)}\n\n"


# ── meta ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "sessions": len(store)}


@app.get("/models")
def list_models():
    return {"models": [{"id": m.id, "label": m.label, "provider": m.provider} for m in CHAT_MODELS],
            "embeddings": settings.embed_model, "reranker": settings.rerank_model if settings.rerank_enabled else None}


@app.get("/agents")
def list_agents():
    """Agent Cards (A2A) for the specialist agents. Invocation endpoints are internal."""
    return {"agents": network.public_cards(), "orchestrator": "LangGraph state graph (app/agents/orchestrator.py)",
            "guardrails": ["Llama Prompt Guard 2 (Meta) + rule-based injection screen", "local PII masking"]}


@app.get("/status")
def status():
    return {"llm": llm.status(), "sessions": len(store)}


# ── sessions ────────────────────────────────────────────────────────────────
@app.post("/sessions")
def create_session():
    try:
        s = store.create()
    except SessionFull as e:
        raise HTTPException(503, str(e))
    return {"session_id": s.id, "expires_in": s.expires_in(), "ttl_seconds": settings.session_ttl_seconds}


@app.get("/sessions/{sid}")
def get_session(sid: str):
    s = _session(sid)
    return {"session_id": s.id, "expires_in": s.expires_in(), "documents": [d.public() for d in s.docs.values()],
            "turns": len(s.history), "wiki": s.wiki.status}


@app.post("/sessions/{sid}/extend")
def extend_session(sid: str):
    """Add 5 minutes to the time left (asked for by the browser's one-minute warning), capped at the full TTL."""
    s = store.peek(sid)
    if not s:
        raise HTTPException(404, "Session not found or expired. Start a new session.")
    left = min(s.expires_in() + 300, settings.session_ttl_seconds)
    s.last_seen = time.time() - settings.session_ttl_seconds + left
    return {"session_id": s.id, "expires_in": s.expires_in()}


@app.delete("/sessions/{sid}")
def end_session(sid: str):
    return {"wiped": store.delete(sid)}


# ── documents ───────────────────────────────────────────────────────────────
@app.post("/sessions/{sid}/documents")
async def upload(sid: str, files: list[UploadFile] = File(...)):
    """Streams progress as server-sent events, then a `done` event per file."""
    s = _session(sid)
    payloads = [(f.filename or "document", await f.read()) for f in files]

    async def gen():
        for name, data in payloads:
            q: asyncio.Queue = asyncio.Queue()
            task = asyncio.create_task(_ingest(s, data, name, q))
            while True:
                ev = await q.get()
                yield _sse(ev)
                if ev["type"] in ("done", "error"):
                    break
            await task
        yield _sse({"type": "complete", "documents": [d.public() for d in s.docs.values()]})

    return StreamingResponse(gen(), media_type="text/event-stream")


async def _ingest(s: Session, data: bytes, name: str, q: asyncio.Queue) -> None:
    try:
        async with s.lock:
            info = await ingest(s, data, name, on_progress=lambda m: q.put_nowait({"type": "progress", "file": name, "message": m}))
        q.put_nowait({"type": "done", "file": name, "document": info.public()})
    except IngestError as e:
        q.put_nowait({"type": "error", "file": name, "message": str(e)})
    except Exception as e:  # never leak a traceback to the client
        log.exception("ingest failed")
        q.put_nowait({"type": "error", "file": name, "message": f"Could not process this file ({type(e).__name__})."})


@app.get("/sessions/{sid}/documents")
def documents(sid: str):
    return {"documents": [d.public() for d in _session(sid).docs.values()]}


@app.delete("/sessions/{sid}/documents/{doc_id}")
def delete_document(sid: str, doc_id: str):
    s = _session(sid)
    if s.docs.pop(doc_id, None) is None:
        raise HTTPException(404, "Document not found.")
    s.index.remove_doc(doc_id)
    s.cache.clear()
    return {"deleted": doc_id}


@app.get("/sessions/{sid}/documents/{doc_id}/outline")
def outline(sid: str, doc_id: str):
    d = _session(sid).docs.get(doc_id)
    if not d:
        raise HTTPException(404, "Document not found.")
    return {"outline": d.outline}


# ── chat ────────────────────────────────────────────────────────────────────
class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    mode: str = Field("auto", pattern="^(auto|fast|deep|wiki)$")
    model: str | None = None


@app.post("/sessions/{sid}/chat")
async def chat(sid: str, body: ChatIn, request: Request):
    """Server-sent events: step (agent trail), token, reset, final, error."""
    s = _session(sid)
    # Cache key includes the previous answer, so follow-ups ("and the second one?") never hit a stale entry.
    last = s.history[-1].content[:200] if s.history else ""
    key = f"{body.mode}:{body.message.strip().lower()}:{hash(last)}"
    run = Run(session=s, prefer_model=body.model)
    runs.add(run)

    async def work():
        run.watch_quota()
        try:
            if key in s.cache:
                cached = s.cache[key]
                run.step("Orchestrator", "cache hit", "answered from this session's cache")
                run.emit("token", text=cached["answer"])
                result = {**cached, "cached": True}
            else:
                state = await graph.ainvoke(
                    {"question": body.message.strip(), "mode": body.mode},
                    config={"configurable": {"run": run, "a2a": request.app.state.a2a}, "recursion_limit": 40},
                )
                result = {
                    "answer": state.get("answer", ""),
                    "route": state.get("route"),
                    "citations": [run.ledger.get(x).public() for x in state.get("sources", []) if run.ledger.get(x)],
                    "verification": _verdict_summary(state.get("verdict")),
                    "notice": state.get("notice", ""),
                }
                if state.get("route") not in ("blocked", "clarify"):
                    s.cache[key] = result
            s.history.append(Turn("user", body.message.strip()))
            s.history.append(Turn("assistant", result["answer"], {"citations": result["citations"], "route": result["route"]}))
            if result.get("route") not in ("blocked", "clarify"):    # session memory: embed the exchange locally
                q, a = body.message.strip(), result["answer"]
                vec = (await models.embed([f"{q}\n{a[:600]}"]))[0]
                s.memory.append({"turn": len(s.history) - 2, "question": q[:300], "answer": a[:500], "vec": vec})
            run.emit("final", **result, usage=run.usage.as_dict(),
                     latency_ms=int((time.perf_counter() - run.started) * 1000))
        except LLMUnavailable as e:
            run.emit("error", message=llm_error_message(str(e)), detail=str(e)[:300])
        except Exception as e:
            log.exception("chat failed")
            run.emit("error", message=f"Something went wrong ({type(e).__name__}).")
        finally:
            runs.remove(run.id)

    task = asyncio.create_task(work())

    async def gen():
        while True:
            ev = await run.queue.get()
            yield _sse(ev)
            if ev["type"] in ("final", "error"):
                break
        await task

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


def _verdict_summary(v: dict | None) -> dict | None:
    if not v:
        return None
    if v.get("verdict") == "unverified":
        return {"verdict": "unverified", "supported": 0, "total": 0, "claims": []}
    return {"verdict": v.get("verdict"), "supported": v.get("supported"), "total": v.get("total"),
            "claims": v.get("claims", [])[:12]}


@app.get("/sessions/{sid}/history")
def history(sid: str):
    return {"turns": [{"role": t.role, "content": t.content, "meta": t.meta, "at": t.at} for t in _session(sid).history]}


# ── wiki ────────────────────────────────────────────────────────────────────
@app.post("/sessions/{sid}/wiki/build")
async def build_wiki(sid: str, request: Request):
    s = _session(sid)
    if not s.docs:
        raise HTTPException(400, "Upload at least one document first.")
    if s.wiki.status == "building":
        raise HTTPException(409, "The wiki is already being built.")
    run = Run(session=s)
    runs.add(run)

    async def work():
        run.watch_quota()
        try:
            run.step("Orchestrator", "delegated", "→ Librarian over A2A")
            out = await request.app.state.a2a.send("librarian", {"run_id": run.id})
            if out.get("error"):
                s.wiki.status = "error"
                run.emit("error", message=llm_error_message(out["error"], "The wiki could not be built right now. Please try again shortly."),
                         detail=out["error"][:300])
            else:
                run.emit("final", **out, graph=s.wiki.graph(s.docs), usage=run.usage.as_dict(),
                         latency_ms=int((time.perf_counter() - run.started) * 1000))
        finally:
            runs.remove(run.id)

    task = asyncio.create_task(work())

    async def gen():
        while True:
            ev = await run.queue.get()
            yield _sse(ev)
            if ev["type"] in ("final", "error"):
                break
        await task

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/sessions/{sid}/wiki")
def wiki(sid: str):
    s = _session(sid)
    return {"status": s.wiki.status, "pages": [p.public(full=False) for p in s.wiki.pages.values()],
            "graph": s.wiki.graph(s.docs)}


@app.get("/sessions/{sid}/wiki/{slug}")
def wiki_page(sid: str, slug: str):
    p = _session(sid).wiki.find(slug)
    if not p:
        raise HTTPException(404, "Page not found.")
    return p.public()


class SaveIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    content: str = Field(min_length=1, max_length=8000)
    citations: list[dict] = []


@app.post("/sessions/{sid}/wiki/save")
def save_to_wiki(sid: str, body: SaveIn):
    """'Save to wiki': keep a useful answer as a page for the rest of the session."""
    s = _session(sid)
    page = s.wiki.upsert(WikiPage(body.title, body.content, "saved", body.citations[:12], []))
    if s.wiki.status == "empty":
        s.wiki.status = "ready"
    return page.public()


# ── studio ──────────────────────────────────────────────────────────────────
class StudioIn(BaseModel):
    kind: str = Field(pattern="^(quiz|flashcards|mindmap|study_guide)$")
    topic: str = Field("", max_length=200)


@app.post("/sessions/{sid}/studio")
async def studio(sid: str, body: StudioIn, request: Request):
    """The Librarian agent researches the documents, then produces cited study material. SSE stream."""
    s = _session(sid)
    if not s.docs:
        raise HTTPException(400, "Upload at least one document first.")
    run = Run(session=s)
    runs.add(run)

    async def work():
        run.watch_quota()
        try:
            run.step("Orchestrator", "delegated", f"→ Librarian over A2A (studio: {body.kind})")
            out = await request.app.state.a2a.send("librarian", {"run_id": run.id, "skill": "studio",
                                                                "kind": body.kind, "topic": body.topic})
            if out.get("error"):
                run.emit("error", message=llm_error_message(out["error"], "Couldn't create that right now. Please try again shortly."), detail=out["error"][:300])
            else:
                s.studio[body.kind] = {"result": out, "steps": run.steps, "topic": body.topic}   # kept for the session
                run.emit("final", result=out, usage=run.usage.as_dict(),
                         latency_ms=int((time.perf_counter() - run.started) * 1000))
        finally:
            runs.remove(run.id)

    task = asyncio.create_task(work())

    async def gen():
        while True:
            ev = await run.queue.get()
            yield _sse(ev)
            if ev["type"] in ("final", "error"):
                break
        await task

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/sessions/{sid}/studio")
def studio_items(sid: str):
    """Studio items already made in this session, so switching views never loses them."""
    return {"items": _session(sid).studio}


# ── voice ───────────────────────────────────────────────────────────────────
@app.post("/sessions/{sid}/transcribe")
async def transcribe(sid: str, audio: UploadFile = File(...)):
    _session(sid)
    data = await audio.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "Recording is too long.")
    try:
        text = await llm.transcribe(data, audio.filename or "question.webm", audio.content_type or "audio/webm")
    except LLMUnavailable as e:
        raise HTTPException(503, str(e))
    return {"text": text}


def llm_error_message(detail: str, busy: str = "All models are busy right now (free-tier limits). Please try again in a minute.") -> str:
    """Tell users the truth: a rejected API key is a server setup problem, not a busy model."""
    d = (detail or "").lower()
    if "401" in d or "invalid api key" in d or "no models configured" in d:
        return "The AI service isn't configured correctly on the server (its API key was rejected). Please try again later."
    return busy


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=6000)


def _speakable(md: str) -> str:
    import re as _re
    t = _re.sub(r"\[S\d+\]|【S\d+】", "", md)
    t = _re.sub(r"\[\[([^\]]+)\]\]", r"\1", t)
    t = _re.sub(r"[*_`#>|]+", " ", t)
    t = _re.sub(r"-{3,}", " ", t)
    return _re.sub(r"\s+", " ", t).strip()[:1500]


@app.post("/sessions/{sid}/speak")
async def speak(sid: str, body: SpeakIn):
    """Read an answer aloud with Orpheus. The client falls back to the browser's own voice on failure."""
    _session(sid)
    try:
        audio = await llm.speak(_speakable(body.text))
    except LLMUnavailable as e:
        raise HTTPException(503, str(e))
    return Response(audio, media_type="audio/wav")
