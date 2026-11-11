import { Loader2 } from "lucide-react";

/* What each actor really is. The UI never calls a pipeline step an "agent". */
const ACTORS = {
  Orchestrator: { kind: "planner", note: "LLM-routed LangGraph workflow" },
  Researcher: { kind: "agent", note: "tool-calling loop · A2A" },
  Verifier: { kind: "agent", note: "critic loop · A2A" },
  Librarian: { kind: "agent", note: "tool-calling loop · A2A" },
  Guardian: { kind: "guardrail", note: "Prompt Guard + rules" },
  Retriever: { kind: "pipeline", note: "hybrid search, no LLM" },
  Writer: { kind: "llm", note: "single generation call" },
};

const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

export default function Trail({ steps = [], live = false, compact = false }) {
  if (!steps.length && !live) return null;
  return (
    <ol className={`trail ${compact ? "is-compact" : ""}`}>
      {steps.map((s, i) => {
        const a = ACTORS[s.agent] || { kind: "agent", note: "" };
        const tool = s.action.startsWith("tool:");
        return (
          <li key={i} className={`trail-step k-${a.kind} ${s.ok === false ? "is-bad" : ""}`}>
            <span className="trail-dot" />
            <div className="trail-body">
              <div className="trail-head">
                <b>{s.agent}</b>
                <span className={`trail-kind k-${a.kind}`}>{a.kind}</span>
                <span className="trail-action">{tool ? <code>{s.action.slice(5)}</code> : s.action}</span>
                <span className="trail-t">{fmt(s.t_ms)}</span>
              </div>
              {s.detail && <p className="trail-detail">{s.detail}</p>}
              {(s.model || s.ms != null) && (
                <p className="trail-meta">{[s.model, s.ms != null ? `tool ${fmt(s.ms)}` : null].filter(Boolean).join(" · ")}</p>
              )}
            </div>
          </li>
        );
      })}
      {live && (
        <li className="trail-step is-live">
          <span className="trail-dot"><Loader2 size={11} className="spin" /></span>
          <div className="trail-body"><p className="trail-detail">working…</p></div>
        </li>
      )}
    </ol>
  );
}
