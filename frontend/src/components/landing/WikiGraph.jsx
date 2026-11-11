import { useEffect, useRef } from "react";
import { ACCENT, PAPER } from "./canvasKit.js";

/*
  A static knowledge-graph render (the session wiki's graph view).
  Drawn once per resize; redrawn only on hover to highlight a node's neighbourhood.
  No animation loop, so it costs nothing while idle.
*/
const HUBS = [
  "Self-attention", "Dense retrieval", "Reranking", "Positional encoding",
  "Embeddings", "Hallucination", "Chunking", "Evaluation",
];

function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

export default function WikiGraph({ className = "", onFocus }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    let nodes = [], edges = [], adj = [], W = 0, H = 0, hover = -1;

    function build() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = r.width; H = r.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rand = rng(7);
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.3;
      nodes = []; edges = [];
      HUBS.forEach((name, h) => {
        const a = (h / HUBS.length) * Math.PI * 2 + 0.3;
        const hx = cx + Math.cos(a) * R * (0.7 + rand() * 0.5);
        const hy = cy + Math.sin(a) * R * (0.6 + rand() * 0.4);
        const hubId = nodes.length;
        nodes.push({ x: hx, y: hy, r: 5.5, hub: true, name, contra: h === 5 });
        const n = 18 + Math.floor(rand() * 14);
        for (let k = 0; k < n; k++) {
          const ang = rand() * Math.PI * 2, d = 14 + Math.pow(rand(), 0.6) * R * 0.55;
          nodes.push({ x: hx + Math.cos(ang) * d, y: hy + Math.sin(ang) * d * 0.85, r: 1.4 + rand() * 1.6 });
          edges.push([hubId, nodes.length - 1]);
          if (rand() < 0.25 && nodes.length > 3) edges.push([nodes.length - 1, nodes.length - 2 - Math.floor(rand() * 3)]);
        }
      });
      // cross-links between concept hubs (the wiki's [[links]])
      const hubIds = nodes.map((n, i) => (n.hub ? i : -1)).filter((i) => i >= 0);
      [[0, 3], [0, 4], [1, 2], [1, 4], [1, 6], [2, 7], [5, 7], [5, 1], [6, 4], [3, 4]].forEach(([a, b]) => edges.push([hubIds[a], hubIds[b], true]));
      adj = nodes.map(() => new Set());
      edges.forEach(([a, b]) => { adj[a].add(b); adj[b].add(a); });
      draw();
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const focus = hover >= 0 ? adj[hover] : null;
      for (const [a, b, cross] of edges) {
        const on = focus && (a === hover || b === hover);
        ctx.strokeStyle = on ? `rgba(${ACCENT},.7)` : cross ? `rgba(${PAPER},.22)` : `rgba(${PAPER},${focus ? 0.04 : 0.09})`;
        ctx.lineWidth = cross || on ? 1 : 0.6;
        ctx.beginPath(); ctx.moveTo(nodes[a].x, nodes[a].y); ctx.lineTo(nodes[b].x, nodes[b].y); ctx.stroke();
      }
      nodes.forEach((n, i) => {
        const on = i === hover || (focus && focus.has(i));
        const col = on || n.contra ? ACCENT : PAPER;
        ctx.fillStyle = `rgba(${col},${on ? 1 : focus ? 0.25 : n.hub ? 0.95 : 0.55})`;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + (on && n.hub ? 1.5 : 0), 0, 6.283); ctx.fill();
        if (n.hub) {
          ctx.font = '11px "Geist Mono", monospace';
          ctx.fillStyle = `rgba(${PAPER},${on ? 1 : focus ? 0.3 : 0.7})`;
          ctx.fillText(n.name, n.x + 9, n.y + 4);
        }
      });
    }

    function onMove(e) {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = -1, bd = 18 * 18;
      nodes.forEach((n, i) => { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd) { bd = d; best = i; } });
      // snap leaf hover to its hub so the highlight reads as a "page"
      if (best >= 0 && !nodes[best].hub) best = [...adj[best]].find((j) => nodes[j].hub) ?? best;
      if (best !== hover) { hover = best; draw(); onFocus?.(best >= 0 ? nodes[best].name : null); }
    }
    function onLeave() { if (hover !== -1) { hover = -1; draw(); onFocus?.(null); } }

    build();
    const ro = new ResizeObserver(build); ro.observe(canvas);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    document.fonts?.ready.then(build);
    return () => { ro.disconnect(); canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerleave", onLeave); };
  }, [onFocus]);
  return <canvas ref={ref} className={className} aria-label="Knowledge graph of the session wiki" role="img" />;
}
