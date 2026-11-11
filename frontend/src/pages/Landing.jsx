import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BookOpen, Quote, Layers, GitCompare, Mic,
  ShieldCheck, Trash2, EyeOff, Github, Folder, FileText, Search, Network, ChevronRight, ChevronDown,
} from "lucide-react";
import MarginPage from "../components/landing/MarginPage.jsx";
import Pipeline from "../components/landing/Pipeline.jsx";
import EraseField from "../components/landing/EraseField.jsx";
import WikiGraph from "../components/landing/WikiGraph.jsx";
import AgentGraph from "../components/landing/AgentGraph.jsx";
import { Magnetic, Tilt } from "../components/landing/fx.jsx";
import { useReveal, useSpotlight } from "../components/landing/useFx.js";
import "./landing.css";

const REPO = "https://github.com/saiharsh11/RAG-Document-Chatbot";

/* ─── Content ──────────────────────────────────────────────────────────── */

const THINK = [
  { title: "Guardrails read it first", body: "Before anything reaches a model, personal data is masked and the question is screened by Meta's Llama Prompt Guard 2. Rules set the floor; the classifier catches what rules miss. This is a guardrail, not an agent.", tags: ["PII masking", "Prompt Guard 2", "Rules + classifier"] },
  { title: "The Orchestrator picks a route", body: "A LangGraph workflow asks a fast model what the question needs: no retrieval, the whole document in context, a quick lookup, or a full investigation. Code then checks the choice.", tags: ["LangGraph", "Adaptive RAG", "Fast path"] },
  { title: "The Researcher gathers evidence", body: "An agent in a tool-calling loop. It decides which searches to run over MCP, rewrites weak queries, reads surrounding sections, and stops when the evidence is enough.", tags: ["Tool calling", "MCP", "Query rewrite"] },
  { title: "The Librarian builds the wiki", body: "An agent that plans the key concepts, researches each with its own searches, writes cited pages, links them, and records where documents contradict each other.", tags: ["Session wiki", "Contradictions", "Studio"] },
  { title: "The Verifier checks every claim", body: "A critic agent tests each sentence against its cited sources and may search for support. Unsupported claims send the Researcher back for evidence or get removed.", tags: ["Self-RAG", "Corrective RAG", "A2A"] },
  { title: "An answer with receipts", body: "A streamed answer where every claim links to the exact passage it came from, plus the full trail of which agent did what, with which model, and how long it took.", tags: ["Streaming", "Inline citations", "Agent trail"] },
];

const FEATURES = [
  { icon: BookOpen, title: "Session wiki", body: "Upload several files and the app compiles them into interlinked concept pages, with sources on every line." },
  { icon: Quote, title: "Answers with receipts", body: "Each claim carries a citation. Click it to open the page with the exact passage highlighted." },
  { icon: GitCompare, title: "Cross-document reasoning", body: "Compare papers side by side, trace a term across files, and catch where your sources disagree." },
  { icon: Layers, title: "Studio", body: "Turn a stack of documents into a mind map, flashcards, a quiz, or a study guide in one click." },
  { icon: Mic, title: "Speak and listen", body: "Ask by voice (Whisper) and hear answers read aloud (Orpheus or your browser)." },
  { icon: EyeOff, title: "Private by default", body: "Personal details are masked before any model sees them, and your whole session is wiped after 10 idle minutes." },
];

/* ─── Shared bits ──────────────────────────────────────────────────────── */

function Mark({ size = 26 }) {
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 26 30" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="18" height="24" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 7h10M5 11h10M5 15h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M22 9v16a3 3 0 0 1-3 3H7" stroke="#ff6b2c" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* ─── Nav ──────────────────────────────────────────────────────────────── */

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`mg-nav ${scrolled ? "is-scrolled" : ""}`}>
      <div className="mg-wrap mg-nav-inner">
        <a href="#top" className="mg-brand" aria-label="RAG Document Assistant home"><Mark /><span className="mg-brand-word">RAG Document Assistant</span></a>
        <nav className="mg-nav-links" aria-label="Sections">
          <a href="#pipeline">Pipeline</a>
          <a href="#wiki">Wiki</a>
          <a href="#how">Agents</a>
          <a href="#privacy">Privacy</a>
        </nav>
        <div className="mg-nav-right">
          <a href={REPO} target="_blank" rel="noreferrer" className="mg-nav-gh"><Github size={15} /> Source</a>
          <Link to="/app" className="mg-btn mg-btn-primary">Open workspace</Link>
        </div>
      </div>
    </header>
  );
}

/* ─── 1. Hero: headline + the annotated page ───────────────────────────── */

function Hero() {
  return (
    <section className="mg-hero" id="top">
      <div className="mg-wrap mg-hero-grid">
        <div className="mg-hero-copy">
          <span className="mg-kicker mg-fade-in">Private, multi-agent document intelligence</span>
          <h1>
            <span className="mg-line"><span>Every answer,</span></span>
            <span className="mg-line"><span>footnoted.</span></span>
          </h1>
          <p className="mg-hero-sub mg-fade-in mg-d1">
            Upload documents and a team of AI agents reads them, cross-checks each other and cites every claim.{" "}
            <span>Nothing is kept once you leave.</span>
          </p>
          <div className="mg-hero-actions mg-fade-in mg-d2">
            <Magnetic><Link to="/app" className="mg-btn mg-btn-accent">Start a session <ArrowRight size={16} /></Link></Magnetic>
            <Magnetic><a href="#pipeline" className="mg-btn mg-btn-ghost">See the pipeline</a></Magnetic>
          </div>
        </div>
        <div className="mg-hero-page mg-fade-in mg-d2">
          <MarginPage />
          <p className="mg-hint">Hover a line to see how it's read</p>
        </div>
      </div>
    </section>
  );
}

/* ─── 2. Pipeline: one passage, four stages ────────────────────────────── */

function PipelineSection() {
  return (
    <section className="mg-section" id="pipeline">
      <div className="mg-wrap">
        <div className="mg-reveal mg-sec-head">
          <span className="mg-label">The pipeline</span>
          <h2 className="mg-h2">One passage, <em>four stages.</em></h2>
          <p className="mg-lede">Follow a chunk from the page to the answer. Hover any of them to trace it through every step.</p>
        </div>
        <div className="mg-reveal"><Pipeline /></div>
      </div>
    </section>
  );
}

/* ─── 3. Footnotes statement ───────────────────────────────────────────── */

const NOTES = [
  ["Verifier agent", "Each sentence is checked against the passages it cites. Unsupported claims are removed."],
  ["Citation", "Clicking a footnote opens the document at that page, with the passage highlighted."],
  ["Session wipe", "Documents, vectors and chat live in memory and are deleted when the session ends."],
];

function Footnotes() {
  const [open, setOpen] = useState(-1);
  const fn = (i) => (
    <button type="button" className={`fn ${open === i ? "is-on" : ""}`} aria-label={`Footnote ${i + 1}`}
      onPointerEnter={() => setOpen(i)} onPointerLeave={() => setOpen(-1)} onFocus={() => setOpen(i)} onBlur={() => setOpen(-1)}>
      {i + 1}
      <span className="fn-card" role="tooltip"><b>{NOTES[i][0]}</b>{NOTES[i][1]}</span>
    </button>
  );
  return (
    <section className="mg-statement">
      <div className="mg-wrap">
        <p className="mg-statement-text mg-reveal">
          Every claim gets a footnote.{fn(0)} Every footnote opens the page it came from.{fn(1)} <em>Every page is gone when you leave.</em>{fn(2)}
        </p>
      </div>
    </section>
  );
}

/* ─── 5. Wiki: product window over the scene ───────────────────────────── */

function Tree({ name, open = true, children }) {
  const [o, setO] = useState(open);
  return (
    <div className="lw-tree">
      <button type="button" onClick={() => setO(!o)}>{o ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Folder size={13} /> {name}</button>
      {o && <div className="lw-tree-kids">{children}</div>}
    </div>
  );
}

function WikiSection() {
  const [focus, setFocus] = useState(null);
  const onFocus = useCallback((n) => setFocus(n), []);
  return (
    <section className="mg-section mg-wiki mg-trigger" id="wiki">
      <div className="mg-wrap">
        <div className="mg-wiki-head mg-reveal">
          <h2 className="mg-h2">Your files become a <em>living wiki.</em></h2>
          <p className="mg-lede">Drop in several documents and the Librarian agent compiles concept pages, links them together and flags where sources disagree. Explore it as a graph, or ask it questions.</p>
        </div>
        <div className="mg-reveal">
          <Tilt max={4}>
            <div className="lw" data-spot>
              <div className="lw-bar"><i /><i /><i /><span>session wiki</span></div>
              <div className="lw-grid">
                <aside className="lw-side">
                  <div className="lw-search"><Search size={13} /> Search pages</div>
                  <Tree name="sources">
                    {["attention-paper.pdf", "rag-survey.pdf", "lecture-notes.docx"].map((f) => <div key={f} className="lw-file"><FileText size={13} /> {f}</div>)}
                  </Tree>
                  <Tree name="wiki">
                    <Tree name="concepts">{["Self-attention", "Dense retrieval", "Reranking", "Embeddings"].map((f) => <div key={f} className={`lw-file ${focus === f ? "is-on" : ""}`}>{f}</div>)}</Tree>
                    <Tree name="entities" open={false}><div className="lw-file">Transformer</div></Tree>
                    <Tree name="contradictions"><div className={`lw-file lw-contra ${focus === "Hallucination" ? "is-on" : ""}`}>Hallucination rates</div></Tree>
                  </Tree>
                </aside>
                <div className="lw-graph">
                  <div className="lw-graph-top"><Network size={13} /> Graph view <span>{focus ? `[[${focus}]]` : "hover a concept"}</span></div>
                  <WikiGraph className="lw-canvas" onFocus={onFocus} />
                </div>
                <aside className="lw-chat">
                  <div className="lw-chat-h">Ask the wiki</div>
                  <p className="lw-chat-note">Answers come from wiki pages. Save useful ones back as new pages.</p>
                  <div className="mg-pv-q">Where do the two papers disagree?</div>
                  <div className="lw-ans">
                    <b>Contradiction found</b>
                    <p>The survey reports retrieval <mark>reduces hallucination</mark><span className="mg-cite">2</span>; the lecture notes cite a case where noisy chunks <mark>increased it</mark><span className="mg-cite">3</span></p>
                  </div>
                  <div className="lw-input">Ask a question…</div>
                  <div className="lw-actions"><span className="lw-btn">Send</span><span className="lw-btn lw-btn-accent">Save to wiki</span></div>
                </aside>
              </div>
            </div>
          </Tilt>
        </div>
      </div>
    </section>
  );
}

/* ─── 6. How it thinks (sticky agent graph) ────────────────────────────── */

function HowItThinks() {
  const [active, setActive] = useState(0);
  const refs = useRef([]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(Number(e.target.dataset.i)); }),
      { rootMargin: "-45% 0px -45% 0px" }
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <section className="mg-section" id="how">
      <div className="mg-wrap">
        <div className="mg-reveal">
          <span className="mg-label">How it thinks</span>
          <h2 className="mg-h2">Three agents and a planner. <em>One answer</em> you can trust.</h2>
          <p className="mg-lede">Each specialist agent runs its own tool-calling loop over MCP and takes work from the Orchestrator over the A2A protocol. Models make the judgment calls; code handles anything that has to be exact.</p>
        </div>
        <div className="mg-think">
          <div className="mg-think-steps">
            {THINK.map((s, i) => (
              <div key={s.title} data-i={i} ref={(el) => (refs.current[i] = el)} className={`mg-think-step ${active === i ? "is-active" : ""}`}>
                <span className="mg-num">0{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <div className="mg-tags">{s.tags.map((t) => <span key={t} className="mg-chip">{t}</span>)}</div>
              </div>
            ))}
          </div>
          <div className="mg-think-viz"><div className="mg-think-sticky mg-dots"><AgentGraph active={active} /></div></div>
        </div>
      </div>
    </section>
  );
}

/* ─── 7. Features ──────────────────────────────────────────────────────── */

function Features() {
  return (
    <section className="mg-section" id="features">
      <div className="mg-wrap">
        <div className="mg-reveal">
          <span className="mg-label">Features</span>
          <h2 className="mg-h2">More than a chat box <em>over a PDF.</em></h2>
        </div>
        <div className="mg-feat">
          {FEATURES.map((f, i) => (
            <article key={f.title} className="mg-feat-card" data-spot>
              <span className="mg-num">0{i + 1}</span>
              <div className="mg-feat-icon"><f.icon size={20} strokeWidth={1.6} /></div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── 8. Privacy ───────────────────────────────────────────────────────── */

function Privacy() {
  const tl = [
    ["Read", "Your file is parsed in memory. It is never written to disk."],
    ["Indexed", "Chunks and vectors live in a store that belongs to your session alone."],
    ["Answered", "Agents work only inside your session. Logs keep timings, never content."],
    ["Forgotten", "End the session or go idle, and every trace of it is wiped."],
  ];
  return (
    <section className="mg-section mg-privacy" id="privacy">
      <div className="mg-wrap">
        <div className="mg-reveal">
          <span className="mg-label">Privacy by design</span>
          <h2 className="mg-h2">Read. Answered. <em>Forgotten.</em></h2>
          <p className="mg-lede">No accounts, no database, no history on a server. The app only ever sees the files you choose to give it, and only for as long as you're here.</p>
        </div>
        <div className="mg-timeline">
          {tl.map(([h, p], i) => (
            <div key={h} className="mg-tl"><span className="mg-num">0{i + 1}</span><h4>{h}</h4><p>{p}</p></div>
          ))}
        </div>
        <div className="mg-promise">
          <div data-spot><EyeOff size={18} /> Personal data is masked before any model sees it.</div>
          <div data-spot><ShieldCheck size={18} /> Tools are scoped to your session. No file system, no shell.</div>
          <div data-spot><Trash2 size={18} /> Sessions wipe after 10 idle minutes. We keep nothing.</div>
        </div>
        <p className="mg-honest">
          To be precise: embeddings and reranking run on our own server, so your documents are never sent to an embedding API.
          Only the passages needed for an answer are sent to Groq, which runs the open models. The app itself stores nothing.
        </p>
      </div>
    </section>
  );
}

/* ─── 9. Stack + evaluation ────────────────────────────────────────────── */

function Stack() {
  const chain = [
    ["openai/gpt-oss-120b", "Writes answers and wiki pages", "Writer", true],
    ["openai/gpt-oss-20b", "Planning, grading, research loops", "Fast lane"],
    ["qwen/qwen3.8-27b", "Verifier, and fallback for both", "Critic"],
    ["bge-small + Jina reranker (ONNX)", "Embeddings and reranking, on our server", "Local"],
  ];
  const evals = [
    ["0.737", "nDCG@10 on BEIR SciFact (300 queries), hybrid + rerank"],
    ["0.667", "the same benchmark with BM25 alone"],
    ["0.97", "faithfulness: claims supported by cited text (LLM judge)"],
    ["1.00", "citation precision on the labelled end-to-end set"],
  ];
  return (
    <section className="mg-section" id="stack">
      <div className="mg-wrap">
        <div className="mg-reveal">
          <span className="mg-label">Under the hood</span>
          <h2 className="mg-h2">Open models. <em>Measured,</em> not guessed.</h2>
        </div>
        <div className="mg-stack">
          <div className="mg-panel" data-spot>
            <span className="mg-label">Model chain</span>
            <h3>The right model for each job.</h3>
            <p>Small models make quick judgment calls, a large one writes, and a different model checks the work. Every chain falls back automatically and waits for quota instead of failing.</p>
            <div className="mg-chain">
              {chain.map(([m, d, r, p], i) => (
                <div key={m} className={`mg-chain-row ${p ? "is-primary" : ""}`}>
                  <span className="mg-num">0{i + 1}</span><div><b>{m}</b><span>{d}</span></div><em>{r}</em>
                </div>
              ))}
            </div>
          </div>
          <div className="mg-panel" data-spot>
            <span className="mg-label">Evaluation</span>
            <h3>Measured on a public benchmark.</h3>
            <p>Retrieval is scored on BEIR SciFact with human relevance labels; answers are scored end to end with RAGAS-style metrics. CI fails the build if retrieval quality drops.</p>
            <div className="mg-evals">{evals.map(([h, d]) => <div key={h} className="mg-eval"><b>{h}</b><span>{d}</span></div>)}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── 10. Closing + footer over a halftone field ──────────────────────── */

function Closing() {
  return (
    <section className="mg-close">
      <div className="mg-close-top">
      <EraseField className="mg-close-field" />
      <div className="mg-wrap mg-close-inner">
        <span className="mg-hint mg-hint-left">Move your cursor over the page to make it forget</span>
        <h2 className="mg-reveal">You ask. It answers. <em>Then it forgets.</em></h2>
        <div className="mg-hero-actions mg-reveal">
          <Magnetic><Link to="/app" className="mg-btn mg-btn-accent">Start a session <ArrowRight size={16} /></Link></Magnetic>
          <Magnetic><a href={REPO} target="_blank" rel="noreferrer" className="mg-btn mg-btn-ghost"><Github size={15} /> View source</a></Magnetic>
        </div>
      </div>
      </div>
      <footer className="mg-foot mg-wrap">
        <div className="mg-foot-grid">
          <a href="#top" className="mg-brand mg-foot-brand"><Mark size={40} /><span className="mg-brand-word">RAG Document Assistant</span></a>
          <div><h5>Product</h5><ul><li><Link to="/app">Workspace</Link></li><li><a href="#wiki">Session wiki</a></li><li><a href="#features">Features</a></li></ul></div>
          <div><h5>System</h5><ul><li><a href="#how">Agents</a></li><li><a href="#stack">Models</a></li><li><a href="#stack">Evaluation</a></li></ul></div>
          <div><h5>Trust</h5><ul><li><a href="#privacy">Privacy</a></li><li><a href={REPO} target="_blank" rel="noreferrer">Source code</a></li></ul></div>
        </div>
        <div className="mg-foot-base"><span>© {new Date().getFullYear()} RAG Document Assistant</span><span>Nothing you upload is stored</span></div>
      </footer>
    </section>
  );
}

export default function Landing() {
  const root = useRef(null);
  useReveal();
  useSpotlight(root);
  return (
    <div className="mg" ref={root}>
      <Nav />
      <main>
        <Hero />
        <PipelineSection />
        <Footnotes />
        <WikiSection />
        <HowItThinks />
        <Features />
        <Privacy />
        <Stack />
        <Closing />
      </main>
    </div>
  );
}
