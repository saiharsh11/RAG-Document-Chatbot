import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUp, BookOpen, Check, FileText, Loader2, MessageSquare, Mic, Network, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen, Power, Save, Volume2,
  ShieldCheck, ShieldAlert, Sparkles, Square, Trash2, Upload, X,
} from "lucide-react";
import { api } from "./api";
import Markdown from "./Markdown";
import Trail from "./Trail";
import WikiPanel from "./WikiPanel";
import StudioPanel from "./StudioPanel";
import DotField from "../components/DotField";
import "./workspace.css";

const PdfViewer = lazy(() => import("./PdfViewer"));

const SID_KEY = "rag.session";
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const ROUTE_LABEL = {
  direct: "Answered directly (no retrieval needed)",
  clarify: "Asked to clarify",
  blocked: "Blocked by guardrail",
  cag: "Whole document in context (CAG)",
  retrieve: "Fast path: retrieve, grade, write",
  research: "Agentic: Researcher → Writer → Verifier",
  wiki: "Answered from the session wiki",
};

const MODE_INFO = {
  auto: ["Auto", "The planner reads your question and picks the route: a quick lookup for simple facts, the Researcher and Verifier agents for comparisons and “why” questions."],
  fast: ["Fast", "One search and one answer. No agents and no fact-check, so it is the quickest and uses the least quota."],
  deep: ["Deep", "Always sends the Researcher agent to investigate, then the Verifier fact-checks every claim. Slowest, most thorough."],
};
const MODES = { auto: "Planner picks the route", fast: "Quick lookup, no agents", deep: "Agents research + fact-check" };

const plain = (md) => (md || "").replace(/\[S\d+\]|【S\d+】/g, "").replace(/\[\[([^\]]+)\]\]/g, "$1").replace(/[*_`#>|]+/g, " ").replace(/\s+/g, " ").trim();

let currentAudio = null;
/* Orpheus (open-weight TTS on Groq) for English; the browser's own voice otherwise or as a fallback. */
async function speakAnswer(sid, text, langCode, onState) {
  window.speechSynthesis?.cancel();
  currentAudio?.pause();
  onState("loading");
  if (!langCode || langCode === "en") {
    try {
      const blob = await api.speak(sid, text);
      currentAudio = new Audio(URL.createObjectURL(blob));
      currentAudio.onended = () => onState(null);
      await currentAudio.play();
      onState("orpheus");
      return;
    } catch { /* fall back below */ }
  }
  if (!window.speechSynthesis) { onState(null); return; }
  const u = new SpeechSynthesisUtterance(plain(text).slice(0, 4000));
  u.lang = langCode || "en";
  u.onend = () => onState(null);
  window.speechSynthesis.speak(u);
  onState("browser");
}

function Mark() {
  return (
    <svg width="20" height="23" viewBox="0 0 26 30" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="18" height="24" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 7h10M5 11h10M5 15h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M22 9v16a3 3 0 0 1-3 3H7" stroke="#ff6b2c" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function Workspace() {
  const [sid, setSid] = useState(null);
  const [expires, setExpires] = useState(0);
  const [docs, setDocs] = useState([]);
  const [uploads, setUploads] = useState([]); // [{name, messages[], state}]
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("chat");
  const [wiki, setWiki] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [panels, setPanels] = useState(() => {
    try { return { left: true, right: true, ...JSON.parse(localStorage.getItem("ws-panels") || "{}") }; }
    catch { return { left: true, right: true }; }
  });
  const togglePanel = (side) => setPanels((p) => {
    const next = { ...p, [side]: !p[side] };
    try { localStorage.setItem("ws-panels", JSON.stringify(next)); } catch { /* storage blocked */ }
    return next;
  });
  const [models, setModels] = useState([]);
  const [fatal, setFatal] = useState("");
  const [warnDismissed, setWarnDismissed] = useState(false);   // "Let it end" on the one-minute warning
  const files = useRef(new Map()); // doc_id → File (kept in the browser only)

  // ── session lifecycle ────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    const s = await api.createSession();
    try { sessionStorage.setItem(SID_KEY, s.session_id); } catch { /* storage blocked */ }
    setSid(s.session_id); setExpires(s.expires_in); setWarnDismissed(false);
    setDocs([]); setMessages([]); setWiki(null); setSelected(null); setViewer(null); setUploads([]);
    files.current = new Map();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        api.models().then((m) => setModels(m.models)).catch(() => {});
        let saved = null;
        try { saved = sessionStorage.getItem(SID_KEY); } catch { /* storage blocked */ }
        if (saved) {
          try {
            const s = await api.getSession(saved);
            setSid(saved); setExpires(s.expires_in); setDocs(s.documents);
            return;
          } catch { /* expired: start fresh */ }
        }
        await startSession();
      } catch {
        setFatal("Can't reach the backend. Is it running?");
      }
    })();
  }, [startSession]);

  useEffect(() => {
    if (!sid) return undefined;
    const t = setInterval(() => setExpires((e) => Math.max(0, e - 1)), 1000);
    return () => clearInterval(t);
  }, [sid]);

  const touch = useCallback(async () => {
    if (!sid) return;
    try { const s = await api.getSession(sid); setExpires(s.expires_in); setWarnDismissed(false); } catch (e) { if (e.status === 404) startSession(); }
  }, [sid, startSession]);

  const extendSession = async () => {
    try { const s = await api.extendSession(sid); setExpires(s.expires_in); setWarnDismissed(false); }
    catch { setExpires(0); }   // already gone: the "session ended" screen takes over
  };

  const endSession = async () => {
    if (sid) await api.endSession(sid).catch(() => {});
    try { sessionStorage.removeItem(SID_KEY); } catch { /* ignore */ }
    await startSession();
  };

  // ── documents ────────────────────────────────────────────────────────────
  const upload = async (list) => {
    const arr = Array.from(list);
    if (!arr.length || !sid) return;
    setUploads((u) => [...u, ...arr.map((f) => ({ name: f.name, lines: [], state: "working" }))]);
    const byName = new Map(arr.map((f) => [f.name, f]));
    try {
      await api.upload(sid, arr, (ev) => {
        if (ev.type === "progress") setUploads((u) => u.map((x) => (x.name === ev.file ? { ...x, lines: [...x.lines, ev.message] } : x)));
        if (ev.type === "done") {
          files.current.set(ev.document.doc_id, byName.get(ev.file));
          setUploads((u) => u.filter((x) => x.name !== ev.file));
        }
        if (ev.type === "error") setUploads((u) => u.map((x) => (x.name === ev.file ? { ...x, state: "error", lines: [ev.message] } : x)));
        if (ev.type === "complete") setDocs(ev.documents);
      });
      setWiki(null);
    } catch (e) {
      setUploads((u) => u.map((x) => (x.state === "working" ? { ...x, state: "error", lines: [e.message] } : x)));
    }
    touch();
  };

  const removeDoc = async (d) => {
    await api.deleteDoc(sid, d.doc_id);
    files.current.delete(d.doc_id);
    setDocs((x) => x.filter((y) => y.doc_id !== d.doc_id));
  };

  // ── chat ─────────────────────────────────────────────────────────────────
  const abort = useRef(null);
  const busy = messages.some((m) => m.streaming);

  const send = async (text, opts = {}) => {
    if (!text.trim() || busy || !sid) return;
    const id = Date.now();
    setMessages((m) => [...m, { role: "user", content: text }, { id, role: "assistant", content: "", steps: [], streaming: true }]);
    setSelected(id);
    setTab("chat");
    const update = (fn) => setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));
    abort.current = new AbortController();
    try {
      await api.chat(sid, { message: text, mode: opts.mode || "auto", model: opts.model || undefined }, (ev) => {
        if (ev.type === "step") update((m) => ({ ...m, steps: [...m.steps, ev] }));
        else if (ev.type === "token") update((m) => ({ ...m, content: m.content + ev.text }));
        else if (ev.type === "reset") update((m) => ({ ...m, content: "", revising: true }));
        else if (ev.type === "final") update((m) => ({ ...m, ...ev, content: ev.answer, streaming: false }));
        else if (ev.type === "error") update((m) => ({ ...m, error: ev.message, streaming: false }));
      }, abort.current.signal);
    } catch (e) {
      update((m) => ({ ...m, error: e.name === "AbortError" ? "Stopped." : e.message, streaming: false }));
    }
    update((m) => ({ ...m, streaming: false }));
    touch();
  };

  const openCitation = useCallback((c) => {
    const file = files.current.get(c.doc_id);
    setViewer({ ...c, file });
    setPanels((p) => (p.right ? p : { ...p, right: true }));   // a citation opens the right panel
  }, []);

  const saveToWiki = async (m) => {
    const q = messages[messages.indexOf(m) - 1]?.content || "Saved answer";
    await api.saveToWiki(sid, { title: q.slice(0, 78), content: m.content, citations: m.citations || [] });
    setMessages((ms) => ms.map((x) => (x === m ? { ...x, saved: true } : x)));
    setWiki(await api.wiki(sid));
  };

  const active = messages.find((m) => m.id === selected);

  if (fatal) {
    return <div className="ws ws-fatal"><Mark /><h2>{fatal}</h2><p>Start it with <code>uvicorn main:app --port 8000</code> in <code>backend/</code>.</p></div>;
  }

  const hasRight = tab === "chat" || !!viewer;   // wiki and studio use the full width unless a source is open
  const warn = !!sid && expires > 0 && expires <= 60 && !warnDismissed;
  const ended = !!sid && expires === 0;

  return (
    <div className="ws">
      <header className="ws-top">
        <button type="button" className="ws-panel-btn" onClick={() => togglePanel("left")}
          aria-label={panels.left ? "Hide documents panel" : "Show documents panel"} title={panels.left ? "Hide documents panel" : "Show documents panel"}>
          {panels.left ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        </button>
        <Link to="/" className="ws-brand"><Mark /> <span>RAG Document Assistant</span></Link>
        <nav className="ws-tabs" role="tablist">
          {[["chat", MessageSquare, "Chat"], ["wiki", Network, "Wiki"], ["studio", Sparkles, "Studio"]].map(([k, Icon, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "is-on" : ""} onClick={() => setTab(k)}>
              <Icon size={15} /> {label}
              {k === "wiki" && wiki?.status === "ready" && <span className="ws-dot" />}
            </button>
          ))}
        </nav>
        <div className="ws-session">
          <span className="ws-timer" title="The session and everything in it is deleted when this reaches zero">
            <span className="ws-live" /> wipes in {fmtTime(expires)}
          </span>
          <button type="button" className="ws-btn ws-btn-danger" onClick={endSession} title="Delete everything now">
            <Power size={14} /> End session
          </button>
          {hasRight && (
            <button type="button" className="ws-panel-btn" onClick={() => togglePanel("right")}
              aria-label={panels.right ? "Hide agent trail" : "Show agent trail"} title={panels.right ? "Hide agent trail" : "Show agent trail"}>
              {panels.right ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
            </button>
          )}
        </div>
      </header>

      <div className={`ws-body ${hasRight ? "" : "is-wide"} ${panels.left ? "" : "no-left"} ${panels.right ? "" : "no-right"}`}>
        <Sidebar docs={docs} uploads={uploads} onUpload={upload} onRemove={removeDoc} />

        <main className="ws-main">
          {tab === "chat" && (
            <Chat messages={messages} selected={selected} setSelected={setSelected} send={send} busy={busy}
              stop={() => abort.current?.abort()} docs={docs} models={models} onCite={openCitation} onSave={saveToWiki}
              onWiki={() => setTab("wiki")} sid={sid} />
          )}
          {tab === "wiki" && (
            <WikiPanel sid={sid} api={api} docs={docs} wiki={wiki} setWiki={setWiki} onCite={openCitation} />
          )}
          {tab === "studio" && <StudioPanel sid={sid} api={api} docs={docs} onCite={openCitation} />}
        </main>

        <aside className="ws-inspect">
          {viewer ? (
            viewer.file && viewer.file.type === "application/pdf" ? (
              <Suspense fallback={<p className="ws-fine">Loading viewer…</p>}><PdfViewer key={`${viewer.doc_id}-${viewer.page}-${viewer.id}`} file={viewer.file} page={viewer.page} snippet={viewer.snippet} title={`${viewer.doc} · ${viewer.section || ""}`} onClose={() => setViewer(null)} /></Suspense>
            ) : (
              <div className="pdfv">
                <div className="pdfv-bar"><span className="pdfv-title">{viewer.doc} · p.{viewer.pages}</span>
                  <div className="pdfv-nav"><button type="button" onClick={() => setViewer(null)} aria-label="Close"><X size={15} /></button></div></div>
                <blockquote className="pdfv-snippet">{viewer.snippet}</blockquote>
                <p className="pdfv-note">{viewer.file ? "Text file: showing the cited passage." : "The original file isn't in this browser tab any more, so the cited passage is shown instead."}</p>
              </div>
            )
          ) : (
            <Inspector m={active} onCite={openCitation} />
          )}
        </aside>
      </div>

      {(warn || ended) && (
        <div className="ws-modal-back">
          <div className="ws-modal" role="alertdialog" aria-modal="true" aria-labelledby="ws-modal-title">
            {ended ? (
              <>
                <h3 id="ws-modal-title">Session ended</h3>
                <p>Your documents, chat, wiki and study items were wiped from the server. Nothing was kept.</p>
                <div className="ws-modal-actions">
                  <button type="button" className="ws-btn ws-btn-accent" autoFocus onClick={() => { try { sessionStorage.removeItem(SID_KEY); } catch { /* ignore */ } startSession(); }}>Start a new session</button>
                </div>
              </>
            ) : (
              <>
                <h3 id="ws-modal-title">Your session ends in {fmtTime(expires)}</h3>
                <p>When it ends, everything you uploaded and created here is wiped. Need more time?</p>
                <div className="ws-modal-actions">
                  <button type="button" className="ws-btn ws-btn-ghost" onClick={() => setWarnDismissed(true)}>Let it end</button>
                  <button type="button" className="ws-btn ws-btn-accent" autoFocus onClick={extendSession}>Extend by 5 minutes</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── sidebar ────────────────────────────────────────────────────────────────
function Sidebar({ docs, uploads, onUpload, onRemove }) {
  const input = useRef(null);
  const [drag, setDrag] = useState(false);
  return (
    <aside className="ws-side">
      <div className={`ws-drop ${drag ? "is-drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onUpload(e.dataTransfer.files); }}
        onClick={() => input.current?.click()} role="button" tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}>
        <Upload size={18} />
        <b>Add documents</b>
        <span>PDF, TXT or Markdown · drop or click</span>
        <input ref={input} type="file" multiple accept=".pdf,.txt,.md,.markdown" hidden onChange={(e) => { onUpload(e.target.files); e.target.value = ""; }} />
      </div>

      <div className="ws-docs">
        <h5>Documents</h5>
        {!docs.length && !uploads.length && <p className="ws-fine">Nothing uploaded yet.</p>}
        {uploads.map((u) => (
          <div key={u.name} className={`ws-doc is-${u.state}`}>
            <div className="ws-doc-row">{u.state === "working" ? <Loader2 size={14} className="spin" /> : <X size={14} />}<span>{u.name}</span></div>
            <p className="ws-doc-log">{u.lines[u.lines.length - 1] || "Uploading…"}</p>
          </div>
        ))}
        {docs.map((d) => (
          <div key={d.doc_id} className="ws-doc">
            <div className="ws-doc-row"><FileText size={14} /><span title={d.name}>{d.name}</span>
              <button type="button" className="ws-icon" onClick={() => onRemove(d)} aria-label={`Remove ${d.name}`}><Trash2 size={13} /></button></div>
            <div className="ws-doc-meta">
              <span>{d.pages}p</span><span>{d.chunks} chunks</span>
              <span className="ws-chip" title={d.strategy_reason}>{d.strategy}</span>
            </div>
            {(d.pii_masked > 0 || d.flagged_chunks > 0) && (
              <div className="ws-doc-flags">
                {d.pii_masked > 0 && <span><ShieldCheck size={12} /> {d.pii_masked} personal detail{d.pii_masked > 1 ? "s" : ""} masked</span>}
                {d.flagged_chunks > 0 && <span className="is-warn"><ShieldAlert size={12} /> {d.flagged_chunks} injected instruction{d.flagged_chunks > 1 ? "s" : ""} removed</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="ws-privacy">
        <h5>Privacy</h5>
        <ul>
          <li><Check size={12} /> Personal data (emails, phones, cards…) is always masked before any model sees it</li>
          <li><Check size={12} /> Files are processed in memory, never saved</li>
          <li><Check size={12} /> Embeddings run on our server, not a third party</li>
          <li><Check size={12} /> Only retrieved passages reach the LLM (Groq)</li>
          <li><Check size={12} /> Everything is wiped when the session ends or after 10 idle minutes</li>
        </ul>
      </div>
    </aside>
  );
}

// ── chat ───────────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  "Summarise the main points of these documents.",
  "Where do the documents disagree with each other?",
  "What are the key numbers and deadlines?",
];

function Chat({ messages, selected, setSelected, send, busy, stop, docs, models, onCite, onSave, onWiki, sid }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState("auto");
  const [model, setModel] = useState("");
  const [speaking, setSpeaking] = useState({});
  const [rec, setRec] = useState(null);
  const [voiceErr, setVoiceErr] = useState("");
  const end = useRef(null);

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);

  const submit = (e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    send(text.trim(), { mode, model });
    setText("");
  };

  const toggleVoice = async () => {
    setVoiceErr("");
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRec(null);
        try {
          const { text: t } = await api.transcribe(sid, new Blob(chunks, { type: r.mimeType || "audio/webm" }));
          setText((x) => (x ? `${x} ${t}` : t));
        } catch (err) { setVoiceErr(err.message); }
      };
      r.start();
      setRec(r);
    } catch { setVoiceErr("Microphone access was blocked."); }
  };

  return (
    <div className="chat">
      {!messages.length && <DotField className="chat-bgfx" />}
      <div className="chat-scroll">
        {!messages.length && (
          <div className="chat-intro">
            <h2>{docs.length ? "Ask anything about your documents." : "Upload a document to begin."}</h2>
            <p>Pick how much work goes into each answer with the mode switch below. You can watch every step on the right.</p>
            <dl className="chat-modes">
              {Object.entries(MODE_INFO).map(([k, [name, text]]) => (
                <div key={k} className={mode === k ? "is-on" : ""} onClick={() => setMode(k)}><dt>{name}</dt><dd>{text}</dd></div>
              ))}
            </dl>
            {docs.length > 0 && (
              <div className="chat-sugg">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => send(s, { mode })}>{s}</button>)}</div>
            )}
          </div>
        )}
        {messages.map((m, i) => (m.role === "user" ? (
          <div key={i} className="msg msg-user">{m.content}</div>
        ) : (
          <div key={i} className={`msg msg-ai ${selected === m.id ? "is-selected" : ""}`} onClick={() => setSelected(m.id)}>
            {m.streaming && !m.content && (
              <p className="msg-working"><Loader2 size={14} className="spin" /> {m.steps.length ? `${m.steps[m.steps.length - 1].agent}: ${m.steps[m.steps.length - 1].action}` : "Thinking…"}</p>
            )}
            {m.revising && m.streaming && <p className="msg-note">Revising after verification…</p>}
            {m.content && <Markdown text={m.content} citations={m.streaming ? null : m.citations} onCite={(id) => {
              const c = (m.citations || []).find((x) => x.id === id); if (c) onCite(c);
            }} onWiki={onWiki} />}
            {m.error && <p className="ws-error">{m.error}</p>}
            {!m.streaming && !m.error && m.route && (
              <div className="msg-foot">
                <span className="ws-chip">{m.route}</span>
                {m.verification && <Verdict v={m.verification} />}
                {m.cached && <span className="ws-chip">cached</span>}
                <span className="msg-meta">{(m.latency_ms / 1000).toFixed(1)}s · {m.usage?.calls} LLM calls</span>
                <button type="button" className="ws-link" onClick={(e) => {
                  e.stopPropagation();
                  speakAnswer(sid, m.content, "en", (st) => setSpeaking((x) => ({ ...x, [m.id]: st })));
                }} title="Read aloud (Orpheus on Groq, or your browser's voice)">
                  {speaking[m.id] === "loading" ? <Loader2 size={13} className="spin" /> : <Volume2 size={13} />}
                  {speaking[m.id] && speaking[m.id] !== "loading" ? `Playing (${speaking[m.id]})` : "Listen"}
                </button>
                {m.citations?.length > 0 && (
                  <button type="button" className="ws-link" disabled={m.saved} onClick={(e) => { e.stopPropagation(); onSave(m); }}>
                    {m.saved ? <><Check size={13} /> Saved to wiki</> : <><Save size={13} /> Save to wiki</>}
                  </button>
                )}
              </div>
            )}
            {m.notice && <p className="msg-note">{m.notice}</p>}
          </div>
        )))}
        <div ref={end} />
      </div>

      <form className="composer" onSubmit={submit}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
          placeholder={docs.length ? "Ask about your documents…" : "Upload a document, or ask what this app can do…"}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} aria-label="Message" />
        <div className="composer-bar">
          <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Answer mode" title={MODES[mode]}>
            <option value="auto">Auto</option><option value="fast">Fast</option><option value="deep">Deep</option>
          </select>
          <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Preferred answer model">
            <option value="">Best available model</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <span className="composer-hint">{MODES[mode]}</span>
          <span className="composer-sp" />
          {voiceErr && <span className="ws-error-inline">{voiceErr}</span>}
          <button type="button" className={`ws-icon-btn ${rec ? "is-rec" : ""}`} onClick={toggleVoice} aria-label={rec ? "Stop recording" : "Ask by voice"}
            title="Voice: transcribed by Whisper, never stored">
            {rec ? <Square size={14} /> : <Mic size={16} />}
          </button>
          {busy ? (
            <button type="button" className="ws-send" onClick={stop} aria-label="Stop"><Square size={14} /></button>
          ) : (
            <button type="submit" className="ws-send" disabled={!text.trim()} aria-label="Send"><ArrowUp size={16} /></button>
          )}
        </div>
      </form>
    </div>
  );
}

function Verdict({ v }) {
  if (v.verdict === "unverified") return <span className="ws-chip is-warn">not verified</span>;
  if (v.verdict === "pass") return <span className="ws-chip is-good"><ShieldCheck size={12} /> verified {v.supported}/{v.total}</span>;
  return <span className="ws-chip is-warn">{v.supported}/{v.total} claims supported</span>;
}

// ── inspector ──────────────────────────────────────────────────────────────
function Inspector({ m, onCite }) {
  if (!m) {
    return (
      <div className="insp-empty">
        <BookOpen size={20} />
        <h4>Agent trail</h4>
        <p>Every step the system takes to answer appears here: the guardrail, the plan, each agent's tool calls, the models used and how long each step took.</p>
        <div className="insp-legend">
          <span className="trail-kind k-agent">agent</span> chooses its own tools in a loop
          <span className="trail-kind k-planner">planner</span> LLM picks the route through a fixed graph
          <span className="trail-kind k-llm">llm</span> a single model call
          <span className="trail-kind k-pipeline">pipeline</span> deterministic code
          <span className="trail-kind k-guardrail">guardrail</span> safety check
        </div>
      </div>
    );
  }
  return (
    <div className="insp">
      {m.route && <p className="insp-route">{ROUTE_LABEL[m.route] || m.route}</p>}
      <h5>Trail</h5>
      <Trail steps={m.steps} live={m.streaming} />
      {m.citations?.length > 0 && (
        <>
          <h5>Sources</h5>
          <div className="insp-cites">
            {m.citations.map((c) => (
              <button key={c.id} type="button" className="insp-cite" onClick={() => onCite(c)}>
                <span className="md-cite">{c.id.slice(1)}</span>
                <span><b>{c.doc}</b> · p.{c.pages}{c.section ? ` · ${c.section}` : ""}<em>{c.snippet}</em></span>
              </button>
            ))}
          </div>
        </>
      )}
      {m.verification?.claims?.length > 0 && (
        <>
          <h5>Verifier's claim check</h5>
          <ul className="insp-claims">
            {m.verification.claims.map((c, i) => (
              <li key={i} className={`is-${c.status}`}><span>{c.status}</span>{c.claim}</li>
            ))}
          </ul>
        </>
      )}
      {m.usage && (
        <>
          <h5>Cost</h5>
          <p className="insp-usage">{m.usage.calls} LLM calls · {m.usage.prompt_tokens + m.usage.completion_tokens} tokens ·
            {" "}{Object.entries(m.usage.by_model || {}).map(([k, v]) => `${k} ×${v.calls}`).join(", ")}</p>
        </>
      )}
    </div>
  );
}

