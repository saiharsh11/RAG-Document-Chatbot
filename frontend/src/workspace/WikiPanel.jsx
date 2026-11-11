import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, FileText, GitFork, Loader2, MessageSquare, Network, Sparkles, TriangleAlert } from "lucide-react";
import Markdown from "./Markdown";
import Trail from "./Trail";

/* Force-directed layout computed once (no animation loop). */
function layout(nodes, edges, W, H) {
  const pos = new Map(nodes.map((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    const r = n.type === "document" ? 0.15 : 0.38;
    return [n.id, { x: W / 2 + Math.cos(a) * W * r, y: H / 2 + Math.sin(a) * H * r, vx: 0, vy: 0 }];
  }));
  const ids = nodes.map((n) => n.id);
  for (let it = 0; it < 260; it++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i]), b = pos.get(ids[j]);
        let dx = a.x - b.x, dy = a.y - b.y;
        const d2 = Math.max(dx * dx + dy * dy, 80);
        const f = (W * H) / (ids.length * 9) / d2;
        const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const e of edges) {
      const a = pos.get(e.source), b = pos.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - Math.min(W, H) * (e.type === "source" ? 0.3 : 0.24)) * 0.02;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const p of pos.values()) {
      p.vx += (W / 2 - p.x) * 0.004; p.vy += (H / 2 - p.y) * 0.004;
      p.x = Math.min(W - 40, Math.max(40, p.x + p.vx * 0.5));
      p.y = Math.min(H - 24, Math.max(24, p.y + p.vy * 0.5));
      p.vx *= 0.6; p.vy *= 0.6;
    }
  }
  return pos;
}

function Graph({ graph, active, onOpen }) {
  const box = useRef(null);
  const [size, setSize] = useState({ W: 720, H: 460 });
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 50 && height > 50) setSize({ W: Math.round(width), H: Math.round(height) });
    });
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const { W, H } = size;
  const [hover, setHover] = useState(null);
  const pos = useMemo(() => layout(graph.nodes, graph.edges, W, H), [graph, W, H]);
  const focus = hover || active;
  const neighbours = useMemo(() => {
    const s = new Set();
    if (!focus) return s;
    graph.edges.forEach((e) => { if (e.source === focus) s.add(e.target); if (e.target === focus) s.add(e.source); });
    return s;
  }, [focus, graph]);

  return (
    <div className="wk-graph" ref={box}>
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Wiki knowledge graph">
      {graph.edges.map((e, i) => {
        const a = pos.get(e.source), b = pos.get(e.target);
        if (!a || !b) return null;
        const on = focus && (e.source === focus || e.target === focus);
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`ge ge-${e.type} ${on ? "is-on" : ""} ${focus && !on ? "is-dim" : ""}`} />;
      })}
      {graph.nodes.map((n) => {
        const p = pos.get(n.id);
        const on = focus === n.id || neighbours.has(n.id);
        const r = n.type === "document" ? 9 : n.type === "index" ? 6 : 7;
        return (
          <g key={n.id} transform={`translate(${p.x},${p.y})`} className={`gn gn-${n.type} ${on ? "is-on" : ""} ${focus && !on ? "is-dim" : ""}`}
            onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(null)}
            onClick={() => n.type !== "document" && onOpen(n.id)} style={{ cursor: n.type === "document" ? "default" : "pointer" }}>
            {n.type === "document" ? <rect x={-r} y={-r} width={r * 2} height={r * 2} rx="2" /> : <circle r={r} />}
            <text x={r + 6} y={4}>{n.label.length > 28 ? n.label.slice(0, 27) + "…" : n.label}</text>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

export default function WikiPanel({ sid, api, docs, wiki, setWiki, onCite }) {
  const [page, setPage] = useState(null);
  const [building, setBuilding] = useState(false);
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);   // { question, content, steps, citations, streaming, error }

  // Ask the wiki in place: the wiki-reader agent answers here, without leaving this tab.
  const ask = async (q) => {
    if (!q || answer?.streaming) return;
    setQuestion("");
    setAnswer({ question: q, content: "", steps: [], citations: [], streaming: true, error: "" });
    const update = (fn) => setAnswer((a) => (a ? fn(a) : a));
    try {
      await api.chat(sid, { message: q, mode: "wiki" }, (ev) => {
        if (ev.type === "step") update((a) => ({ ...a, steps: [...a.steps, ev] }));
        else if (ev.type === "token") update((a) => ({ ...a, content: a.content + ev.text }));
        else if (ev.type === "reset") update((a) => ({ ...a, content: "" }));
        else if (ev.type === "final") update((a) => ({ ...a, content: ev.answer, citations: ev.citations || [] }));
        else if (ev.type === "error") update((a) => ({ ...a, error: ev.message }));
      });
    } catch (e) { update((a) => ({ ...a, error: e.message })); }
    update((a) => ({ ...a, streaming: false }));
  };

  const refresh = async () => setWiki(await api.wiki(sid));
  const open = async (slugOrTitle) => {
    try { setAnswer(null); setPage(await api.wikiPage(sid, slugOrTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))); }
    catch { /* page may not exist (dangling link) */ }
  };

  // Open the overview once the wiki is ready (state is set in the promise callback, not synchronously).
  useEffect(() => {
    if (wiki?.status !== "ready" || page) return;
    const first = wiki.pages.find((p) => p.kind === "index") || wiki.pages[0];
    if (first) api.wikiPage(sid, first.slug).then(setPage).catch(() => {});
  }, [wiki, page, api, sid]);

  const build = async () => {
    setBuilding(true); setSteps([]); setError("");
    try {
      await api.buildWiki(sid, (ev) => {
        if (ev.type === "step") setSteps((s) => [...s, ev]);
        if (ev.type === "error") setError(ev.message);
      });
      await refresh();
    } catch (e) { setError(e.message); }
    setBuilding(false);
  };

  if (!docs.length) {
    return <Empty icon={BookOpen} title="No documents yet" text="Upload one or more files, then the Librarian agent can compile them into a linked wiki." />;
  }

  if (!wiki || wiki.status !== "ready") {
    return (
      <div className="wk-empty">
        <div className="wk-empty-copy">
          <Network size={22} />
          <h3>Compile a session wiki</h3>
          <p>The Librarian agent plans the key concepts across your {docs.length} document{docs.length > 1 ? "s" : ""}, researches each one with its own searches, writes cited pages, links them, and records where documents contradict each other.</p>
          <button type="button" className="ws-btn ws-btn-accent" onClick={build} disabled={building}>
            {building ? <><Loader2 size={15} className="spin" /> Building…</> : <><Sparkles size={15} /> Build wiki</>}
          </button>
          <p className="ws-fine">On the free tier this takes 30 to 90 seconds.</p>
          {error && <p className="ws-error">{error}</p>}
        </div>
        {steps.length > 0 && <div className="wk-empty-trail"><Trail steps={steps} live={building} /></div>}
      </div>
    );
  }

  const concepts = wiki.pages.filter((p) => p.kind === "concept" || p.kind === "saved");
  const contradictions = wiki.pages.filter((p) => p.kind === "contradiction");

  return (
    <div className="wk">
      <aside className="wk-tree">
        {wiki.pages.filter((p) => p.kind === "index").map((p) => (
          <button key={p.slug} type="button" className={page?.slug === p.slug ? "is-on" : ""} onClick={() => open(p.slug)}><BookOpen size={13} /> {p.title}</button>
        ))}
        <h5>Concepts</h5>
        {concepts.map((p) => (
          <button key={p.slug} type="button" className={page?.slug === p.slug ? "is-on" : ""} onClick={() => open(p.slug)}>
            {p.kind === "saved" ? <MessageSquare size={13} /> : <GitFork size={13} />} {p.title}
          </button>
        ))}
        <h5>Contradictions</h5>
        {contradictions.length ? contradictions.map((p) => (
          <button key={p.slug} type="button" className={`is-contra ${page?.slug === p.slug ? "is-on" : ""}`} onClick={() => open(p.slug)}><TriangleAlert size={13} /> {p.title.replace("Contradiction: ", "")}</button>
        )) : <p className="ws-fine">None found.</p>}
        <h5>Sources</h5>
        {docs.map((d) => <div key={d.doc_id} className="wk-src"><FileText size={13} /> {d.name}</div>)}
        <button type="button" className="ws-btn ws-btn-ghost wk-rebuild" onClick={build} disabled={building}>
          {building ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Rebuild
        </button>
      </aside>
      <div className="wk-main">
        <Graph graph={wiki.graph} active={page?.slug} onOpen={open} />
        <form className="wk-ask" onSubmit={(e) => { e.preventDefault(); ask(question.trim()); }}>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask the wiki…" aria-label="Ask the wiki" />
          <button type="submit" className="ws-btn ws-btn-primary" disabled={answer?.streaming || !question.trim()}>
            {answer?.streaming ? <Loader2 size={14} className="spin" /> : "Ask"}
          </button>
        </form>
      </div>
      <article className="wk-page">
        {answer ? (
          <>
            <div className="wk-answer-head">
              <span className="wk-kind">Answer from the wiki</span>
              <button type="button" className="ws-btn ws-btn-ghost" onClick={() => setAnswer(null)}>Back to page</button>
            </div>
            <h2>{answer.question}</h2>
            {answer.steps.length > 0 && <div className="wk-answer-trail"><Trail steps={answer.steps} live={answer.streaming} /></div>}
            {answer.content
              ? <Markdown text={answer.content} citations={answer.streaming ? null : answer.citations} onWiki={open}
                  onCite={(id) => { const c = answer.citations.find((x) => x.id === id); if (c) onCite(c); }} />
              : answer.streaming && <p className="ws-fine"><Loader2 size={13} className="spin" /> Reading the wiki…</p>}
            {answer.error && <p className="ws-error">{answer.error}</p>}
          </>
        ) : page ? (
          <>
            <span className={`wk-kind wk-kind-${page.kind}`}>{page.kind}</span>
            <h2>{page.title}</h2>
            <Markdown text={page.content} citations={page.sources} onWiki={open}
              onCite={(sid2) => { const c = page.sources.find((s) => s.id === sid2); if (c) onCite(c); }} />
            {page.sources.length > 0 && (
              <div className="wk-sources">
                <h5>Sources</h5>
                {page.sources.map((c, i) => (
                  <button key={i} type="button" onClick={() => onCite(c)}><b>{c.id}</b> {c.doc} · p.{c.pages}</button>
                ))}
              </div>
            )}
          </>
        ) : <p className="ws-fine">Select a page or a node in the graph.</p>}
      </article>
      {building && <div className="wk-overlay"><Trail steps={steps} live /></div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, text }) {
  return (
    <div className="ws-empty">
      <Icon size={22} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
