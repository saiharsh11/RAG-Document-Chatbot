import { Link } from "react-router-dom";
import {
  ArrowRight,
  FileText,
  Quote,
  Gauge,
  Lock,
  Layers,
  Upload,
  MessagesSquare,
  Sparkle,
  Zap,
  Check,
} from "lucide-react";

const models = [
  {
    name: "openai/gpt-oss-120b",
    tag: "Deepest reasoning",
    desc: "The heavyweight. Best for dense contracts, research papers, and multi-step questions.",
    stats: ["120B params", "Highest accuracy", "Long answers"],
  },
  {
    name: "llama-3.3-70b-versatile",
    tag: "Balanced default",
    desc: "Strong reasoning at a comfortable speed. The right pick for most documents.",
    stats: ["70B params", "Great all-rounder", "Reliable citations"],
  },
  {
    name: "llama-3.1-8b-instant",
    tag: "Fastest",
    desc: "Near-instant replies for quick lookups, summaries, and skimming long files.",
    stats: ["8B params", "Sub-second start", "Low cost"],
  },
];

const features = [
  {
    icon: FileText,
    title: "PDF and Word, natively",
    body: "Drop in a .pdf or .docx. Layout, headings, and tables are parsed before anything is indexed.",
  },
  {
    icon: Quote,
    title: "Answers with receipts",
    body: "Every response is grounded in retrieved passages, so you can trace a claim back to the page it came from.",
  },
  {
    icon: Layers,
    title: "Three models, one switch",
    body: "Swap between open-source models mid-conversation. Same document, different depth and speed.",
  },
  {
    icon: Gauge,
    title: "Built for long files",
    body: "Chunking and retrieval tuned for hundred-page documents, not just two-page memos.",
  },
  {
    icon: Lock,
    title: "Your document stays yours",
    body: "Documents are processed for your session only — no training, no silent retention.",
  },
  {
    icon: Zap,
    title: "Open-source stack",
    body: "Built on LangChain and LangGraph, so the retrieval pipeline is inspectable end to end.",
  },
];

const steps = [
  { icon: Upload, title: "Upload", body: "Add a PDF or Word file. It's parsed and embedded in seconds." },
  { icon: Sparkle, title: "Pick a model", body: "Choose depth or speed from three open-source models." },
  { icon: MessagesSquare, title: "Ask anything", body: "Get grounded answers with the source passages attached." },
];

export default function Landing() {
  return (
    <div className="theme-rag min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span
              className="grid size-8 place-items-center rounded-lg text-sm font-bold text-primary-foreground"
              style={{ backgroundImage: "var(--gradient-rag)" }}
            >
              R
            </span>
            <span className="text-sm font-semibold tracking-tight">RAG Document Chatbot</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#models" className="transition-colors hover:text-foreground">Models</a>
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
          </nav>
          <Link
            to="/app"
            className="rounded-full border border-border bg-secondary px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary/70"
          >
            Open the app
          </Link>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="rag-grid pointer-events-none absolute inset-0" aria-hidden="true" />
          <div
            className="pointer-events-none absolute left-1/2 top-[-12rem] size-[36rem] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
            style={{ backgroundImage: "var(--gradient-rag)" }}
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-6xl px-6 pb-24 pt-20 md:pt-28">
            <div className="mx-auto max-w-3xl text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs text-muted-foreground">
                <span className="size-1.5 rounded-full bg-accent" />
                Powered by LangChain + LangGraph
              </span>
              <h1 className="mt-6 text-4xl font-semibold leading-[1.05] md:text-6xl">
                Stop scrolling through documents.{" "}
                <span
                  className="bg-clip-text text-transparent"
                  style={{ backgroundImage: "var(--gradient-rag)" }}
                >
                  Just ask them.
                </span>
              </h1>
              <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
                Upload a PDF or Word file and get straight answers grounded in the actual text —
                with your pick of three open-source models, from instant to deeply analytical.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  to="/app"
                  className="group inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
                  style={{ backgroundImage: "var(--gradient-rag)", boxShadow: "var(--glow-rag)" }}
                >
                  Upload a document
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <a
                  href="#models"
                  className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Compare the models
                </a>
              </div>
            </div>

            {/* Product mock */}
            <div
              className="mx-auto mt-16 max-w-4xl overflow-hidden rounded-2xl border border-border bg-card"
              style={{ boxShadow: "var(--shadow-rag)" }}
            >
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <span className="size-2.5 rounded-full bg-muted-foreground/30" />
                <span className="size-2.5 rounded-full bg-muted-foreground/30" />
                <span className="size-2.5 rounded-full bg-muted-foreground/30" />
                <span className="ml-3 text-xs text-muted-foreground">RAG Chat</span>
              </div>
              <div className="grid gap-0 md:grid-cols-[220px_1fr]">
                <aside className="hidden border-r border-border p-4 md:block">
                  <p className="text-[10px] font-semibold tracking-widest text-muted-foreground">MODEL</p>
                  <div className="mt-2 space-y-1.5">
                    {models.map((m, i) => (
                      <div
                        key={m.name}
                        className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-[11px] ${
                          i === 0
                            ? "bg-primary/20 text-foreground ring-1 ring-primary/40"
                            : "text-muted-foreground"
                        }`}
                      >
                        {i === 0 && <Check className="size-3 text-primary" />}
                        <span className="truncate">{m.name}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-6 text-[10px] font-semibold tracking-widest text-muted-foreground">DOCUMENT</p>
                  <div className="mt-2 rounded-lg border border-border bg-secondary/40 p-3">
                    <FileText className="size-4 text-accent" />
                    <p className="mt-2 truncate text-[11px] font-medium">Q3-report.pdf</p>
                    <p className="text-[10px] text-muted-foreground">128 pages · indexed</p>
                  </div>
                </aside>
                <div className="space-y-4 p-5">
                  <div className="flex justify-end">
                    <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                      What were the three biggest cost drivers this quarter?
                    </p>
                  </div>
                  <div className="max-w-[85%] space-y-3">
                    <p className="text-sm leading-relaxed text-foreground">
                      Three drivers account for most of the increase: cloud infrastructure
                      (+18%), contractor spend (+11%), and logistics (+7%).
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {["p. 24 · Operating costs", "p. 31 · Vendor summary", "p. 47 · Logistics"].map((s) => (
                        <span
                          key={s}
                          className="rounded-md border border-border bg-secondary/50 px-2 py-1 text-[10px] text-muted-foreground"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-4 py-3">
                    <span className="text-xs text-muted-foreground">Ask a follow-up…</span>
                    <span
                      className="grid size-7 place-items-center rounded-lg"
                      style={{ backgroundImage: "var(--gradient-rag)" }}
                    >
                      <ArrowRight className="size-3.5 text-primary-foreground" />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-t border-border/60 py-24">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="max-w-xl text-3xl font-semibold md:text-4xl">
              Retrieval you can actually trust
            </h2>
            <p className="mt-4 max-w-lg text-muted-foreground">
              Everything is built around one rule: an answer is only as good as the passage it came from.
            </p>
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="bg-background p-7 transition-colors hover:bg-card">
                  <f.icon className="size-5 text-accent" />
                  <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Models */}
        <section id="models" className="border-t border-border/60 py-24">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-3xl font-semibold md:text-4xl">Three models. One switch.</h2>
            <p className="mt-4 max-w-lg text-muted-foreground">
              Change your mind mid-conversation — the document stays indexed.
            </p>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {models.map((m, i) => (
                <div
                  key={m.name}
                  className={`rounded-2xl border p-7 transition-transform hover:-translate-y-1 ${
                    i === 1 ? "border-primary/50 bg-card" : "border-border bg-card/50"
                  }`}
                  style={i === 1 ? { boxShadow: "var(--glow-rag)" } : undefined}
                >
                  <p className="text-xs font-medium uppercase tracking-wider text-accent">{m.tag}</p>
                  <h3 className="mt-3 break-all font-mono text-sm font-semibold">{m.name}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{m.desc}</p>
                  <ul className="mt-5 space-y-2">
                    {m.stats.map((s) => (
                      <li key={s} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Check className="size-3.5 text-primary" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-t border-border/60 py-24">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-3xl font-semibold md:text-4xl">From file to answer in three steps</h2>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {steps.map((s, i) => (
                <div key={s.title} className="relative">
                  <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
                  <s.icon className="mt-4 size-6 text-primary" />
                  <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section id="cta" className="border-t border-border/60 py-24">
          <div className="mx-auto max-w-6xl px-6">
            <div
              className="relative overflow-hidden rounded-3xl border border-border bg-card px-8 py-16 text-center"
              style={{ boxShadow: "var(--shadow-rag)" }}
            >
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-25 blur-3xl"
                style={{ backgroundImage: "var(--gradient-rag)" }}
                aria-hidden="true"
              />
              <div className="relative">
                <h2 className="text-3xl font-semibold md:text-4xl">Bring your first document</h2>
                <p className="mx-auto mt-4 max-w-md text-muted-foreground">
                  A contract, a research paper, a 200-page manual. Upload it and ask the question
                  you'd rather not go hunting for.
                </p>
                <Link
                  to="/app"
                  className="mt-8 inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
                  style={{ backgroundImage: "var(--gradient-rag)", boxShadow: "var(--glow-rag)" }}
                >
                  Start chatting
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 text-sm text-muted-foreground md:flex-row">
          <p>RAG Document Chatbot</p>
          <p>Powered by LangChain + LangGraph</p>
        </div>
      </footer>
    </div>
  );
}
