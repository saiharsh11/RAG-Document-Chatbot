import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, FileText, Folder, GitFork, Loader2, MessageSquare, Network, Search, Sparkles, TriangleAlert } from "lucide-react";
import Markdown from "./Markdown";
import Trail from "./Trail";

/* Force simulation. One step moves every node a little; `alpha` scales the forces so the
   graph settles. The initial layout runs 260 steps up front; dragging re-heats it. */
function stepSim(prev, nodes, edges, W, H, alpha, fixed) {
  const pos = new Map([...prev].map(([id, p]) => [id, { ...p }]));
  const ids = nodes.map((n) => n.id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = pos.get(ids[i]), b = pos.get(ids[j]);
      let dx = a.x - b.x, dy = a.y - b.y;
      const d2 = Math.max(dx * dx + dy * dy, 80);
      const f = ((W * H) / (ids.length * 9) / d2) * alpha;
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
    const f = (d - Math.min(W, H) * (e.type === "source" ? 0.3 : 0.24)) * 0.02 * alpha;
    a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
  }
  for (const [id, p] of pos) {
    if (fixed && id === fixed.id) { p.x = fixed.x; p.y = fixed.y; p.vx = 0; p.vy = 0; continue; }
    p.vx += (W / 2 - p.x) * 0.004 * alpha; p.vy += (H / 2 - p.y) * 0.004 * alpha;
    p.x = Math.min(W - 40, Math.max(40, p.x + p.vx * 0.5));
    p.y = Math.min(H - 24, Math.max(24, p.y + p.vy * 0.5));
    p.vx *= 0.6; p.vy *= 0.6;
  }
  return pos;
}

function layout(nodes, edges, W, H) {
  let pos = new Map(nodes.map((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    const r = n.type === "document" ? 0.15 : 0.38;
    return [n.id, { x: W / 2 + Math.cos(a) * W * r, y: H / 2 + Math.sin(a) * H * r, vx: 0, vy: 0 }];
  }));
  for (let it = 0; it < 260; it++) pos = stepSim(pos, nodes, edges, W, H, 1, null);
  return pos;
}

/* Keep part of the graph on screen however far you pan or zoom: the nodes' bounding box
   must still overlap the visible area by at least `m` pixels on each axis. */
function clampView(v, box, W, H, m = 70) {
  if (!box) return v;
  return {
    k: v.k,
    x: Math.min(W - m - box.x0 * v.k, Math.max(m - box.x1 * v.k, v.x)),
    y: Math.min(H - m - box.y0 * v.k, Math.max(m - box.y1 * v.k, v.y)),
  };
}

function bounds(pos) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pos.values()) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/* Measures the box; the view below is remounted (fresh layout) when the graph or size changes. */
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
  const key = `${graph.nodes.map((n) => n.id).join("|")}#${graph.edges.length}#${size.W}x${size.H}`;
  return (
    <div className="wk-graph" ref={box}>
      <GraphView key={key} graph={graph} W={size.W} H={size.H} active={active} onOpen={onOpen} />
    </div>
  );
}

/* Obsidian-style interaction: drag a node (its neighbours follow and the graph settles),
   drag the background to pan, scroll to zoom, click a page to open it. */
function GraphView({ graph, W, H, active, onOpen }) {
  const svg = useRef(null);
  const [pos, setPos] = useState(() => layout(graph.nodes, graph.edges, W, H));
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState(null);
  const [clearedFor, setClearedFor] = useState(null);   // the open page whose highlight the user dismissed
  const [grabbing, setGrabbing] = useState(false);
  const drag = useRef(null);
  const sim = useRef({ alpha: 0, raf: 0, fixed: null });
  const box = useRef(null);
  useEffect(() => { box.current = bounds(pos); }, [pos]);

  const heat = useCallback(() => {
    const s = sim.current;
    if (s.raf) return;
    const frame = () => {
      s.raf = 0;
      setPos((prev) => stepSim(prev, graph.nodes, graph.edges, W, H, s.alpha, s.fixed));
      s.alpha *= 0.93;
      if (s.fixed || s.alpha > 0.02) s.raf = requestAnimationFrame(frame);
    };
    s.raf = requestAnimationFrame(frame);
  }, [graph, W, H]);

  useEffect(() => {
    const s = sim.current;
    return () => cancelAnimationFrame(s.raf);
  }, []);

  // Zoom around the cursor. A native listener so the page itself doesn't scroll.
  useEffect(() => {
    const el = svg.current;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(3, Math.max(0.4, v.k * Math.exp(-e.deltaY * 0.0015)));
        return clampView({ k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k }, box.current, W, H);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [W, H]);

  const toGraph = (e) => {
    const r = svg.current.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  };

  // Dragging must never start a text selection (it painted the panel in the selection colour).
  const noSelect = (e) => { e.preventDefault(); window.getSelection?.()?.removeAllRanges(); };

  const onNodeDown = (e, id) => {
    e.stopPropagation();
    noSelect(e);
    try { svg.current.setPointerCapture(e.pointerId); } catch { /* capture not available */ }
    drag.current = { type: "node", id, sx: e.clientX, sy: e.clientY, moved: false };
    sim.current.fixed = { id, ...toGraph(e) };
    sim.current.alpha = Math.max(sim.current.alpha, 0.35);
    setGrabbing(true);
    heat();
  };
  const onDown = (e) => {
    noSelect(e);
    try { svg.current.setPointerCapture(e.pointerId); } catch { /* capture not available */ }
    drag.current = { type: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    setHover(null);
    setGrabbing(true);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
    if (d.type === "node") {
      sim.current.fixed = { id: d.id, ...toGraph(e) };
      sim.current.alpha = Math.max(sim.current.alpha, 0.3);
      heat();
    } else {
      setView((v) => clampView({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }, box.current, W, H));
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setGrabbing(false);
    if (d?.type === "node") {
      sim.current.fixed = null;           // release: the graph settles around the new position
      heat();
      const node = graph.nodes.find((n) => n.id === d.id);
      if (!d.moved) {
        setClearedFor(null);
        if (node && node.type !== "document") onOpen(d.id);
      }
    } else if (d?.type === "pan" && !d.moved) {
      setClearedFor(active || "none");     // a click on empty space clears the orange highlight
      setHover(null);
    }
  };

  const focus = hover || (active && active !== clearedFor ? active : null);
  const neighbours = new Set();
  if (focus) graph.edges.forEach((e) => { if (e.source === focus) neighbours.add(e.target); if (e.target === focus) neighbours.add(e.source); });
  const moved = view.x !== 0 || view.y !== 0 || view.k !== 1;

  return (
    <>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Wiki knowledge graph (drag nodes, drag to pan, scroll to zoom)"
        className={grabbing ? "is-grabbing" : ""} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
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
                onPointerDown={(e) => onNodeDown(e, n.id)}>
                <circle r={r + 8} className="gn-hit" />
                {n.type === "document" ? <rect x={-r} y={-r} width={r * 2} height={r * 2} rx="2" /> : <circle r={r} />}
                <text x={r + 6} y={4}>{n.label.length > 28 ? n.label.slice(0, 27) + "…" : n.label}</text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="wk-graph-help">drag nodes · drag to pan · scroll to zoom</div>
      {moved && <button type="button" className="wk-graph-reset" onClick={() => setView({ x: 0, y: 0, k: 1 })}>Reset view</button>}
    </>
  );
}

export default function WikiPanel({ sid, api, docs, wiki, setWiki, onCite }) {
  const [page, setPage] = useState(null);
  const [building, setBuilding] = useState(false);
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [filter, setFilter] = useState("");
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

  const q = filter.trim().toLowerCase();
  const match = (p) => !q || p.title.toLowerCase().includes(q);
  const index = wiki.pages.filter((p) => p.kind === "index" && match(p));
  const concepts = wiki.pages.filter((p) => p.kind === "concept" && match(p));
  const saved = wiki.pages.filter((p) => p.kind === "saved" && match(p));
  const contradictions = wiki.pages.filter((p) => p.kind === "contradiction" && match(p));
  const sources = docs.filter((d) => !q || d.name.toLowerCase().includes(q));
  const pageBtn = (p, Icon, extra = "") => (
    <button key={p.slug} type="button" className={`${extra} ${page?.slug === p.slug ? "is-on" : ""}`} onClick={() => open(p.slug)}>
      <Icon size={13} /> {p.kind === "contradiction" ? p.title.replace("Contradiction: ", "") : p.title}
    </button>
  );

  return (
    <div className="wk">
      <aside className="wk-tree">
        <label className="wk-search">
          <Search size={13} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search pages" aria-label="Search wiki pages" />
        </label>
        <Folder_ name="sources" count={sources.length} force={!!q}>
          {sources.map((d) => <div key={d.doc_id} className="wk-src"><FileText size={13} /> {d.name}</div>)}
        </Folder_>
        <Folder_ name="wiki" force={!!q}>
          {index.map((p) => pageBtn(p, BookOpen))}
          <Folder_ name="concepts" count={concepts.length} force={!!q}>{concepts.map((p) => pageBtn(p, GitFork))}</Folder_>
          {saved.length > 0 && <Folder_ name="saved answers" count={saved.length} force={!!q}>{saved.map((p) => pageBtn(p, MessageSquare))}</Folder_>}
          <Folder_ name="contradictions" count={contradictions.length} force={!!q}>
            {contradictions.length ? contradictions.map((p) => pageBtn(p, TriangleAlert, "is-contra")) : <p className="ws-fine wk-none">None found.</p>}
          </Folder_>
        </Folder_>
        {q && !index.length && !concepts.length && !saved.length && !contradictions.length && !sources.length && <p className="ws-fine wk-none">No pages match “{filter}”.</p>}
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

/* A collapsible folder in the wiki tree, Obsidian-style. While searching, folders stay open. */
function Folder_({ name, count, force = false, children }) {
  const [open, setOpen] = useState(true);
  const shown = open || force;
  return (
    <div className="wk-folder">
      <button type="button" className="wk-folder-head" onClick={() => setOpen(!open)} aria-expanded={shown}>
        {shown ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Folder size={13} /> {name}
        {count != null && <span className="wk-count">{count}</span>}
      </button>
      {shown && <div className="wk-folder-kids">{children}</div>}
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
