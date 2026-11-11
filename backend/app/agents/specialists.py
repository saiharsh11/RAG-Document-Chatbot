"""The three specialist agents. Each one is an LLM in a tool-calling loop with its own
least-privilege MCP toolset, and each is served to the Orchestrator over A2A.

  Researcher  gathers evidence: decomposes the question, searches, rewrites weak
              queries, reads surrounding sections, and stops when evidence is enough.
  Verifier    a critic: checks every claim in a draft against its cited sources and
              may search for support before ruling a claim unsupported.
  Librarian   builds the session wiki: plans concepts, researches and writes each page,
              links pages together, and records contradictions between documents.
"""

from __future__ import annotations

import json
import re

from app.agents.loop import run_tool_agent
from app.agents.runtime import Run
from app.config import settings
from app.llm.client import gather_limited, llm, parse_json
from app.session import WikiPage
from app.tools.client import with_tools
from app.tools.server import TOOLSETS, build_tool_server

# ── Researcher ──────────────────────────────────────────────────────────────
RESEARCHER_SYSTEM = """You are the Researcher agent in a document question-answering system.
Your job is to gather the evidence needed to answer the user's question from their uploaded documents.

How to work:
- Call search_documents with short, specific queries. For multi-part or comparative questions, search each part separately.
- If results look weak or off-topic, rewrite the query (synonyms, key terms from the documents) and search again.
- Use read_source when a passage is cut off or you need surrounding context.
- Stop as soon as you have enough evidence. Do not search more than needed.
- Never invent facts. Only report what the sources say.

When finished, reply with JSON only:
{"findings": [{"point": "<fact from the sources>", "sources": ["S1", "S4"]}],
 "coverage": "complete" | "partial" | "none",
 "gaps": ["<what could not be found>"]}"""


async def researcher(run: Run, question: str, focus: list[str] | None = None) -> dict:
    task = f"Question: {question}"
    if focus:
        task += "\nThe previous answer lacked support for these points; find evidence for them:\n- " + "\n- ".join(focus)
    if run.session.docs:
        task += "\nDocuments available: " + ", ".join(d.name for d in run.session.docs.values())
    raw = await with_tools(build_tool_server(run.session, run.ledger), TOOLSETS["researcher"], lambda belt: run_tool_agent(
            run=run, agent="Researcher", job="research", system=RESEARCHER_SYSTEM, task=task, belt=belt,
            max_steps=settings.research_max_steps,
            finish_prompt="Stop searching. Reply now with the JSON findings object only.",
    ))
    try:
        out = parse_json(raw)
    except (json.JSONDecodeError, ValueError):
        out = {"findings": [], "coverage": "partial", "gaps": [], "raw": raw[:500]}
    cited = {s for f in out.get("findings", []) for s in f.get("sources", []) if run.ledger.get(s)}
    out["sources"] = sorted(cited, key=lambda s: int(s[1:])) or list(run.ledger.items)[:6]
    return out


# ── Verifier ────────────────────────────────────────────────────────────────
VERIFIER_SYSTEM = """You are the Verifier agent: a strict fact-checker for answers about uploaded documents.
You receive a question, a draft answer that cites sources like [S2], and the text of those sources.

For each factual claim in the draft:
- "supported": the cited source text clearly states it.
- "unsupported": no cited source states it. Before ruling this, you MAY call search_documents
  once or twice to look for support; if you find it, mark it supported and give the new source id.
- "contradicted": a source says the opposite.
Ignore phrasing, greetings and hedges; only judge factual claims.

Reply with JSON only:
{"claims": [{"claim": "...", "status": "supported|unsupported|contradicted", "sources": ["S1"]}],
 "verdict": "pass" | "revise",
 "missing": ["<search query that could find support for an unsupported claim>"]}
Use "revise" only if at least one claim is unsupported or contradicted."""


async def verifier(run: Run, question: str, draft: str) -> dict:
    cited = sorted({m.upper() for m in re.findall(r"S\d+", draft)}, key=lambda s: int(s[1:]))
    sources = "\n\n".join(f"[{e.sid}] {e.text[:1100]}" for s in cited if (e := run.ledger.get(s)))
    task = f"Question: {question}\n\nDraft answer:\n{draft}\n\nCited sources:\n{sources or '(none cited)'}"
    raw = await with_tools(build_tool_server(run.session, run.ledger), TOOLSETS["verifier"], lambda belt: run_tool_agent(
            run=run, agent="Verifier", job="verify", system=VERIFIER_SYSTEM, task=task, belt=belt,
            max_steps=3, finish_prompt="Give your verdict now as the JSON object only.",
            max_tokens=850,
    ))
    try:
        out = parse_json(raw)
    except (json.JSONDecodeError, ValueError):
        return {"verdict": "pass", "claims": [], "missing": [], "note": "verifier output unreadable"}
    claims = out.get("claims", [])
    out["supported"] = int(sum(c.get("status") == "supported" for c in claims))
    out["total"] = len(claims)
    if any(c.get("status") in ("unsupported", "contradicted") for c in claims):
        out["verdict"] = "revise"
    return out


# ── Librarian ───────────────────────────────────────────────────────────────
PLAN_SYSTEM = """You plan a small wiki that explains a set of documents.
Given document names and outlines, choose the most important concepts a reader needs.
Prefer concepts that appear in more than one document (so pages can compare sources).
Reply with JSON only: {"concepts": [{"title": "<2-4 words>", "focus": "<what the page should cover>"}]}"""

LIBRARIAN_SYSTEM = """You are the Librarian agent. You research and draft one page of a wiki compiled from the user's documents.

Steps:
1. search_documents for the concept (2-3 focused searches; if several documents exist, search each one).
2. Then reply with JSON only (no tool call):
{"content": "<Markdown page, 100-220 words: a one-line definition, then key points. EVERY sentence and bullet must end with the [S#] it comes from. Link related concepts as [[Concept Title]]>",
 "source_ids": ["S1", ...], "links": ["<related concept titles>"],
 "contradictions": [{"topic": "<short>", "claim_a": "...", "source_a": "S1", "claim_b": "...", "source_b": "S4"}]}
List a contradiction whenever two different documents give different values or rules for the same thing
(e.g. an older policy and a newer update). Use [] if none.
Never add background knowledge, best practices or anything the sources do not literally say.
If the documents say nothing about the concept, reply {"content": ""}."""

GROUND_SYSTEM = """You fact-check a wiki page against the source passages it cites.
Delete every sentence or bullet that the sources do not explicitly support (including generic
background or "best practice" statements). Keep supported text and its [S#] citations unchanged.
Keep Markdown structure and [[links]]. Reply with JSON only: {"content": "<cleaned page>", "removed": <number removed>}"""


async def ground_page(run: Run, title: str, content: str, cited: list[str]) -> tuple[str, int]:
    """Grounding check (one LLM call, not an agent): strip unsupported statements before saving."""
    sources = "\n\n".join(f"[{x}] {run.ledger.get(x).text[:1200]}" for x in cited)
    msgs = [{"role": "system", "content": GROUND_SYSTEM},
            {"role": "user", "content": f"Page: {title}\n\n{content}\n\nSources:\n{sources}"}]
    # Two different model chains: if the first checker mangles the page (e.g. drops every citation), ask another.
    for job in ("verify", "fast"):
        try:
            r = await llm.chat(job, msgs, json_mode=True, max_tokens=900, usage=run.usage)
            out = r.json()
        except Exception:
            continue
        cleaned = (out.get("content") or "").strip()
        if cleaned and re.search(r"\[S\d+\]", cleaned):
            return cleaned, int(out.get("removed") or 0)
    return "", 0  # never publish an unchecked page


async def librarian(run: Run) -> dict:
    s = run.session
    s.wiki.status = "building"
    outlines = "\n".join(f"- {d.name} ({d.pages} pages): " + "; ".join(d.outline[:20]) for d in s.docs.values())
    run.step("Librarian", "planning", f"{len(s.docs)} document(s)")
    plan = await llm.chat("fast", [{"role": "system", "content": PLAN_SYSTEM},
                                   {"role": "user", "content": f"Documents:\n{outlines}\n\nChoose up to {settings.wiki_max_concepts} concepts."}],
                          json_mode=True, max_tokens=700, usage=run.usage)
    concepts = (plan.json().get("concepts") or [])[: settings.wiki_max_concepts]
    titles = [c["title"].strip() for c in concepts if c.get("title")]
    run.step("Librarian", "planned", ", ".join(titles))

    async def write(c: dict, attempt: int = 1) -> None:
        task = (f"Concept: {c['title']}\nFocus: {c.get('focus', '')}\n"
                f"Other wiki pages you may link: {', '.join(t for t in titles if t != c['title'])}")
        try:
            raw = await with_tools(build_tool_server(s, run.ledger), TOOLSETS["librarian"], lambda belt: run_tool_agent(
                run=run, agent="Librarian", job="research", system=LIBRARIAN_SYSTEM, task=task,
                belt=belt, max_steps=4, max_tokens=1100,
                finish_prompt="Stop searching. Reply now with the JSON page object only."))
        except Exception as e:  # one page failing must not sink the whole wiki
            run.step("Librarian", "failed", f"{c['title']}: {type(e).__name__}")
            return
        # The agent drafts; code saves. Structured output is more reliable than hoping
        # the model remembers to make a final tool call.
        try:
            page = parse_json(raw)
        except (json.JSONDecodeError, ValueError):
            page = {}
        content = (page.get("content") or "").strip()
        cited = [x for x in dict.fromkeys(page.get("source_ids") or re.findall(r"S\d+", content)) if run.ledger.get(x)]
        if not content or not cited:
            if attempt == 1:  # an empty draft is usually model variance, not missing evidence: try once more
                run.step("Librarian", "retrying", f"{c['title']}: empty draft")
                return await write(c, attempt=2)
            run.step("Librarian", "skipped", f"{c['title']}: the documents don't cover it")
            return
        content, removed = await ground_page(run, c["title"], content, cited)
        if removed:
            run.step("Librarian", "grounding check", f"{c['title']}: removed {removed} unsupported statement(s)")
        cited = [x for x in cited if f"[{x}]" in content] or cited
        if not content or not re.search(r"\[S\d+\]", content):
            run.step("Librarian", "skipped", f"{c['title']}: nothing survived the grounding check")
            return
        s.wiki.upsert(WikiPage(c["title"].strip()[:80], content[:6000], "concept",
                               [run.ledger.get(x).public() for x in cited],
                               [l for l in (page.get("links") or []) if l in titles and l != c["title"]][:12]))
        run.step("Librarian", "wrote page", f"{c['title']} · {len(cited)} sources")
        for k in page.get("contradictions") or []:
            a, b = run.ledger.get(str(k.get("source_a", ""))), run.ledger.get(str(k.get("source_b", "")))
            if not a or not b or a.chunk.doc_id == b.chunk.doc_id:
                continue  # a contradiction must be between two different documents
            topic = (k.get("topic") or c["title"]).strip()[:60]
            s.wiki.upsert(WikiPage(
                f"Contradiction: {topic}",
                f"**{a.chunk.doc_name}** (p.{a.chunk.pages}): {k.get('claim_a', '')} [{a.sid}]\n\n"
                f"**{b.chunk.doc_name}** (p.{b.chunk.pages}): {k.get('claim_b', '')} [{b.sid}]",
                "contradiction", [a.public(), b.public()], [c["title"]]))
            run.step("Librarian", "found contradiction", f"{topic}: {a.chunk.doc_name} vs {b.chunk.doc_name}")

    # One page at a time: parallel writers just exhaust the per-minute token budget faster.
    await gather_limited([write(c) for c in concepts], limit=1)

    overview = "\n".join(f"- [[{p.title}]]" for p in s.wiki.pages.values() if p.kind == "concept")
    contradictions = "\n".join(f"- [[{p.title}]]" for p in s.wiki.pages.values() if p.kind == "contradiction")
    s.wiki.upsert(WikiPage("Overview", f"## Concepts\n{overview or '_none yet_'}\n\n## Contradictions\n{contradictions or '_none found_'}",
                           "index", [], [p.title for p in s.wiki.pages.values()]))
    s.wiki.status = "ready"
    written = [t for t in titles if s.wiki.find(t)]
    return {"pages": len(s.wiki.pages), "concepts": titles, "written": written}


# ── Studio (study material, researched by the Librarian agent) ──────────────
STUDIO_FORMATS = {
    "quiz": ('{"title": "...", "questions": [{"question": "...", "options": ["a", "b", "c", "d"], '
             '"answer_index": 0, "explanation": "... [S#]", "sources": ["S1"]}]}', "6 multiple-choice questions"),
    "flashcards": ('{"title": "...", "cards": [{"front": "<term or question>", "back": "<answer> [S#]", "sources": ["S1"]}]}',
                   "10 flashcards"),
    "mindmap": ('{"title": "<central topic>", "children": [{"label": "...", "sources": ["S1"], '
                '"children": [{"label": "...", "sources": ["S2"], "children": []}]}]}',
                "a mind map with 4-6 branches and 2-4 leaves each"),
    "study_guide": ('{"title": "...", "markdown": "<Markdown study guide: summary, key terms, likely exam questions; '
                    'cite facts as [S#]>", "sources": ["S1"]}', "a one-page study guide"),
}

STUDIO_SYSTEM = """You are the Librarian agent creating study material from the user's documents.
First research: call search_documents several times to cover the topic broadly (different sub-topics,
each document if several exist), and read_source when a passage is cut off. Then produce {what}.
Every fact must come from the sources and carry its source ids. Reply with JSON only, in this shape:
{shape}"""


def _valid_sources(run: Run, obj):
    """Recursively drop source ids that don't exist in the ledger (no invented citations)."""
    if isinstance(obj, dict):
        out = {k: _valid_sources(run, v) for k, v in obj.items()}
        if isinstance(out.get("sources"), list):
            out["sources"] = [x for x in out["sources"] if isinstance(x, str) and run.ledger.get(x)]
        return out
    if isinstance(obj, list):
        return [_valid_sources(run, v) for v in obj]
    return obj


async def studio(run: Run, kind: str, topic: str = "") -> dict:
    shape, what = STUDIO_FORMATS[kind]
    docs = ", ".join(d.name for d in run.session.docs.values())
    task = f"Topic: {topic or 'the main ideas across all documents'}\nDocuments: {docs}"
    raw = await with_tools(build_tool_server(run.session, run.ledger), TOOLSETS["researcher"], lambda belt: run_tool_agent(
        run=run, agent="Librarian", job="research", system=STUDIO_SYSTEM.format(what=what, shape=shape), task=task,
        belt=belt, max_steps=5, max_tokens=1800,
        finish_prompt=f"Stop searching. Produce {what} now as the JSON object only."))
    try:
        data = _valid_sources(run, parse_json(raw))
    except (json.JSONDecodeError, ValueError):
        return {"error": "The agent's output could not be read. Please try again."}
    if kind == "study_guide" and data.get("markdown"):
        guide_cites = [x for x in dict.fromkeys(re.findall(r"S\d+", data["markdown"])) if run.ledger.get(x)]
        cleaned, removed = await ground_page(run, data.get("title", "Study guide"), data["markdown"], guide_cites)
        if cleaned:
            data["markdown"] = cleaned
            if removed:
                run.step("Librarian", "grounding check", f"removed {removed} unsupported statement(s)")
    used = sorted({x for x in re.findall(r"S\d+", json.dumps(data)) if run.ledger.get(x)}, key=lambda x: int(x[1:]))
    data["citations"] = [run.ledger.get(x).public() for x in used]
    data["kind"] = kind
    run.step("Librarian", "created", f"{kind.replace('_', ' ')} · {len(used)} sources")
    return data


# ── Wiki reader (answers from the compiled wiki) ────────────────────────────
WIKI_READER_SYSTEM = """You answer questions using ONLY the session wiki (pages compiled from the user's documents).
Use list_wiki_pages, search_wiki and read_wiki_page. Cite pages as [[Page Title]] and keep any [S#] citations
that appear in the page text. If the wiki does not cover the question, say so plainly.

The user is looking at the wiki in the app: a list of pages and a graph where each dot is a page or a
source document and each line is a link between pages or a citation of a document. Questions such as
"what is this graph / wiki / map about?" are about the wiki itself: describe its main topics, how they
connect and which documents they come from, using the wiki map below and the pages you read."""


def wiki_map(session) -> str:
    """A compact outline of the wiki (titles, kinds, links, sources) so the reader knows what exists."""
    wiki = session.wiki
    docs = {d.doc_id: d.name for d in session.docs.values()}
    lines = [f"Source documents: {', '.join(docs.values()) or 'none'}", f"Pages ({len(wiki.pages)}):"]
    for p in wiki.pages.values():
        cited = sorted({docs.get(x.get('doc_id'), '') for x in p.sources} - {''})
        lines.append(f"- [{p.kind}] {p.title}"
                     + (f" → links: {', '.join(p.links[:6])}" if p.links else "")
                     + (f" · from: {', '.join(cited)}" if cited else ""))
    return "\n".join(lines)


async def wiki_reader(run: Run, question: str) -> str:
    task = f"Wiki map:\n{wiki_map(run.session)}\n\nQuestion: {question}"
    return await with_tools(build_tool_server(run.session, run.ledger), TOOLSETS["wiki_reader"], lambda belt: run_tool_agent(
        run=run, agent="Librarian", job="research", system=WIKI_READER_SYSTEM,
        task=task, belt=belt, max_steps=4, finish_prompt="Answer now from what you have read."))
