import { useEffect, useState } from "react";
import { BookOpenCheck, Brain, Layers, ListChecks, Loader2, RotateCcw, Sparkles } from "lucide-react";
import Markdown from "./Markdown";
import Trail from "./Trail";
import { Empty } from "./WikiPanel";

const KINDS = [
  { id: "quiz", label: "Quiz", icon: ListChecks, text: "Multiple-choice questions with explanations." },
  { id: "flashcards", label: "Flashcards", icon: Layers, text: "Key terms and facts to flip through." },
  { id: "mindmap", label: "Mind map", icon: Brain, text: "How the main ideas branch and connect." },
  { id: "study_guide", label: "Study guide", icon: BookOpenCheck, text: "A one-page summary with likely questions." },
];

const stripLetter = (s) => String(s).replace(/^\s*[a-d][).]\s+/i, "");

function Cite({ ids, result, onCite }) {
  if (!ids?.length) return null;
  return (
    <span className="st-cites">
      {ids.map((id) => {
        const c = result.citations.find((x) => x.id === id);
        return c ? <button key={id} type="button" className="md-cite" onClick={() => onCite(c)}>{id.slice(1)}</button> : null;
      })}
    </span>
  );
}

function Quiz({ result, onCite }) {
  const [picked, setPicked] = useState({});
  const qs = result.questions || [];
  const score = qs.filter((q, i) => picked[i] === q.answer_index).length;
  const done = Object.keys(picked).length === qs.length;
  return (
    <div className="st-quiz">
      {qs.map((q, i) => (
        <div key={i} className="st-q">
          <p className="st-q-text"><span>{i + 1}</span>{q.question}</p>
          <div className="st-opts">
            {(q.options || []).map((o, j) => {
              const chosen = picked[i] === j;
              const state = picked[i] == null ? "" : j === q.answer_index ? "is-right" : chosen ? "is-wrong" : "is-faded";
              return (
                <button key={j} type="button" className={`st-opt ${state}`} disabled={picked[i] != null}
                  onClick={() => setPicked((p) => ({ ...p, [i]: j }))}>
                  <b>{"ABCD"[j]}</b> {stripLetter(o)}
                </button>
              );
            })}
          </div>
          {picked[i] != null && (
            <div className="st-expl"><Markdown text={q.explanation} citations={result.citations}
              onCite={(id) => { const c = result.citations.find((x) => x.id === id); if (c) onCite(c); }} />
              <Cite ids={q.sources} result={result} onCite={onCite} /></div>
          )}
        </div>
      ))}
      {done && <p className="st-score">Score: {score} / {qs.length} <button type="button" className="ws-link" onClick={() => setPicked({})}><RotateCcw size={13} /> retry</button></p>}
    </div>
  );
}

function Flashcards({ result, onCite }) {
  const [flipped, setFlipped] = useState({});
  return (
    <div className="st-cards">
      {(result.cards || []).map((c, i) => (
        <button key={i} type="button" className={`st-card ${flipped[i] ? "is-flipped" : ""}`} onClick={() => setFlipped((f) => ({ ...f, [i]: !f[i] }))}>
          <span className="st-card-inner">
            <span className="st-card-face st-front">{c.front}</span>
            <span className="st-card-face st-back">
              <Markdown text={c.back} citations={result.citations}
                onCite={(id) => { const x = result.citations.find((y) => y.id === id); if (x) onCite(x); }} />
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function MindMap({ result, onCite }) {
  // Tidy left-to-right tree layout.
  const nodes = [];
  const edges = [];
  let leafY = 0;
  const walk = (n, depth, parent) => {
    const id = nodes.length;
    const node = { id, label: n.label || n.title || "", depth, sources: n.sources || [], y: 0 };
    nodes.push(node);
    if (parent != null) edges.push([parent, id]);
    const kids = n.children || [];
    if (!kids.length) { node.y = leafY++; return node.y; }
    const ys = kids.map((k) => walk(k, depth + 1, id));
    node.y = (Math.min(...ys) + Math.max(...ys)) / 2;
    return node.y;
  };
  walk({ label: result.title, children: result.children || [] }, 0, null);
  const ROW = 34, COL = 230;
  const H = Math.max(200, leafY * ROW + 40);
  const W = (Math.max(...nodes.map((n) => n.depth)) + 1) * COL + 40;
  const P = (n) => ({ x: 20 + n.depth * COL, y: 20 + n.y * ROW + ROW / 2 });
  return (
    <div className="st-mind"><svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: Math.min(W, 900) }}>
      {edges.map(([a, b], i) => {
        const p = P(nodes[a]), q = P(nodes[b]);
        const mx = (p.x + q.x) / 2 + 30;
        return <path key={i} d={`M${p.x + 8},${p.y} C${mx},${p.y} ${mx},${q.y} ${q.x - 6},${q.y}`} className={`mm-edge d${nodes[b].depth}`} />;
      })}
      {nodes.map((n) => {
        const p = P(n);
        return (
          <g key={n.id} transform={`translate(${p.x},${p.y})`} className={`mm-node d${n.depth}`}
            onClick={() => { const c = result.citations.find((x) => x.id === n.sources[0]); if (c) onCite(c); }}
            style={{ cursor: n.sources.length ? "pointer" : "default" }}>
            <circle r={n.depth === 0 ? 7 : 4.5} />
            <text x={12} y={4}>{n.label.length > 34 ? n.label.slice(0, 33) + "…" : n.label}{n.sources.length ? ` [${n.sources.map((s) => s.slice(1)).join(",")}]` : ""}</text>
          </g>
        );
      })}
    </svg></div>
  );
}

export default function StudioPanel({ sid, api, docs, onCite }) {
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(null);
  const [liveSteps, setLiveSteps] = useState([]);
  const [items, setItems] = useState({});        // kind → { result, steps, topic }, kept for the session
  const [current, setCurrent] = useState(null);
  const [error, setError] = useState("");

  // Items made earlier in this session live on the server (in memory), so they survive
  // switching tabs and page refreshes, and are wiped with the session.
  useEffect(() => {
    if (!sid) return;
    api.studioItems(sid).then((d) => {
      const saved = d.items || {};
      setItems((prev) => ({ ...saved, ...prev }));
      setCurrent((c) => c || Object.keys(saved)[0] || null);
    }).catch(() => {});
  }, [api, sid]);

  if (!docs.length) return <Empty icon={Sparkles} title="No documents yet" text="Upload files, and the Librarian agent will research them to build quizzes, flashcards, mind maps and study guides." />;

  const run = async (kind) => {
    setBusy(kind); setCurrent(kind); setLiveSteps([]); setError("");
    const steps = [];
    try {
      await api.studio(sid, { kind, topic }, (ev) => {
        if (ev.type === "step") { steps.push(ev); setLiveSteps([...steps]); }
        if (ev.type === "final") setItems((prev) => ({ ...prev, [kind]: { result: ev.result, steps, topic } }));
        if (ev.type === "error") setError(ev.message);
      });
    } catch (e) { setError(e.message); }
    setBusy(null);
  };

  // Show a finished item straight away; only build it if it doesn't exist yet (or the focus changed).
  const open = (kind) => {
    const have = items[kind];
    if (have && (have.topic || "") === topic) { setCurrent(kind); setError(""); return; }
    run(kind);
  };

  const item = current ? items[current] : null;
  const result = item?.result;
  const building = busy && busy === current;

  return (
    <div className="st">
      <div className="st-head">
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Optional focus, e.g. “expense rules” (default: everything)" aria-label="Studio topic" />
        <div className="st-kinds">
          {KINDS.map((k) => (
            <div key={k.id} className="st-kind-wrap">
              <button type="button" className={`st-kind ${current === k.id ? "is-on" : ""}`} onClick={() => open(k.id)} disabled={!!busy}>
                {busy === k.id ? <Loader2 size={18} className="spin" /> : <k.icon size={18} />}
                <b>{k.label}{items[k.id] && <span className="st-ready" title="Made in this session">ready</span>}</b><span>{k.text}</span>
              </button>
              {items[k.id] && (
                <button type="button" className="st-rebuild" onClick={() => run(k.id)} disabled={!!busy}
                  title={`Rebuild the ${k.label.toLowerCase()}`} aria-label={`Rebuild the ${k.label.toLowerCase()}`}>
                  <RotateCcw size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="ws-fine">Each item is researched by the Librarian agent with its own searches, and every fact links to its source. Items stay here until the session ends.</p>
      </div>
      {error && <p className="ws-error">{error}</p>}
      {building && <Trail steps={liveSteps} live />}
      {result && !building && (
        <div className="st-result">
          <div className="st-result-head">
            <h3>{result.title}</h3>
            <div className="st-result-tools">
              <details><summary>How this was made ({item.steps?.length || 0} steps)</summary><Trail steps={item.steps || []} compact /></details>
              <button type="button" className="ws-link" onClick={() => run(current)} disabled={!!busy}><RotateCcw size={13} /> Regenerate</button>
            </div>
          </div>
          {result.kind === "quiz" && <Quiz key={result.title} result={result} onCite={onCite} />}
          {result.kind === "flashcards" && <Flashcards key={result.title} result={result} onCite={onCite} />}
          {result.kind === "mindmap" && <MindMap result={result} onCite={onCite} />}
          {result.kind === "study_guide" && (
            <div className="st-guide"><Markdown text={result.markdown} citations={result.citations}
              onCite={(id) => { const c = result.citations.find((x) => x.id === id); if (c) onCite(c); }} /></div>
          )}
        </div>
      )}
    </div>
  );
}
