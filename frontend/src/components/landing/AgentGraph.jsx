/*
  AgentGraph — the sticky diagram in "How it thinks".
  `active` (0-5) lights the agents involved in that step and sends a packet along the A2A edge.
*/

const NODES = {
  user:   { x: 80,  y: 260, label: "YOU",          sub: "question" },
  guard:  { x: 230, y: 260, label: "GUARDRAILS",   sub: "pii · prompt guard" },
  orch:   { x: 400, y: 260, label: "ORCHESTRATOR", sub: "langgraph · routes" },
  ret:    { x: 400, y: 90,  label: "RESEARCHER",   sub: "agent · mcp tools" },
  lib:    { x: 580, y: 140, label: "LIBRARIAN",    sub: "agent · wiki" },
  ana:    { x: 580, y: 380, label: "MCP TOOLS",    sub: "search · read · wiki" },
  ver:    { x: 400, y: 430, label: "VERIFIER",     sub: "agent · critic" },
};

const EDGES = [
  ["user", "guard"], ["guard", "orch"], ["orch", "ret"], ["orch", "lib"],
  ["lib", "ana"], ["orch", "ver"], ["ver", "ret"],
];

// which nodes + edges are lit per step
const STEPS = [
  { nodes: ["user", "guard"], edges: [0] },
  { nodes: ["guard", "orch"], edges: [1] },
  { nodes: ["orch", "ret"], edges: [2] },
  { nodes: ["orch", "lib", "ana"], edges: [3, 4] },
  { nodes: ["orch", "ver", "ret"], edges: [5, 6] },
  { nodes: ["orch", "user"], edges: [] },
];

const W = 120, H = 46;

function path(a, b) {
  const A = NODES[a], B = NODES[b];
  // Verifier → Retrieval loops around the Orchestrator
  if (a === "ver" && b === "ret") return `M${A.x},${A.y} Q250,260 ${B.x},${B.y}`;
  return `M${A.x},${A.y} L${B.x},${B.y}`;
}

export default function AgentGraph({ active = 0 }) {
  const step = STEPS[active] || STEPS[0];
  return (
    <svg className="mg-graph" viewBox="0 0 680 520" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Diagram: guardrails, the LangGraph Orchestrator, and the Researcher, Librarian and Verifier agents connected over A2A, with tools over MCP">
      <defs>
        <pattern id="mg-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="rgba(239,233,223,0.08)" />
        </pattern>
      </defs>
      <rect width="680" height="520" fill="url(#mg-grid)" />
      <text className="proto" x="24" y="34">A2A · AGENT ↔ AGENT</text>
      <text className="proto" x="24" y="50">MCP · AGENT ↔ TOOLS</text>
      <text className="proto" x="560" y="500">STEP 0{active + 1} / 06</text>

      {EDGES.map(([a, b], i) => {
        const on = step.edges.includes(i);
        return (
          <g key={i}>
            <path id={`mg-e${i}`} d={path(a, b)} className={`edge ${on ? "is-on" : ""}`} strokeDasharray={on ? "0" : "3 5"} />
            {on && (
              <circle r="4" className="packet">
                <animateMotion dur="1.6s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
                  <mpath href={`#mg-e${i}`} />
                </animateMotion>
              </circle>
            )}
          </g>
        );
      })}

      {Object.entries(NODES).map(([id, n]) => {
        const on = step.nodes.includes(id);
        return (
          <g key={id} className={`node ${on ? "is-on" : ""}`} transform={`translate(${n.x - W / 2}, ${n.y - H / 2})`}>
            <rect width={W} height={H} rx="10" />
            <text x={W / 2} y="20" textAnchor="middle">{n.label}</text>
            <text className="sub" x={W / 2} y="34" textAnchor="middle">{n.sub}</text>
          </g>
        );
      })}
    </svg>
  );
}
