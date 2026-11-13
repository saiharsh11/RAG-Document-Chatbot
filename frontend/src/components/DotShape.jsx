import { useEffect, useRef } from "react";

/*
  A slowly rotating 3D cloud of dots that morphs between shapes.
    mode="scroll"  the shape follows the page scroll (landing page)
    mode="cycle"   the shape changes on its own every few seconds
    mode="reveal"  morphs once as the canvas scrolls into view (e.g. scatter → logo)
  One canvas, ~1,400 dots, drawn as tiny squares. The loop pauses when the canvas
  is off-screen or the tab is hidden, and draws a single still frame for users who
  prefer reduced motion.
*/

const N = 1400;
const TAU = Math.PI * 2;
const hash = (i) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

const SHAPES = {
  graph(i) {                                       // knowledge graph: concept clusters joined by links
    const C = 7, centre = (c) => [Math.cos(c * 2.3 + 0.4) * (0.45 + hash(c * 7) * 0.4), (hash(c * 13) - 0.5) * 1.3,
      Math.sin(c * 2.3 + 0.4) * (0.45 + hash(c * 7) * 0.4)];
    if (i % 7 === 0) {                             // a dot on a link between two clusters
      const a = Math.floor(hash(i) * C), b = (a + 1 + Math.floor(hash(i + 5) * 3)) % C, t = hash(i + 9);
      const A = centre(a), B = centre(b);
      return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
    }
    const c = i % C, P = centre(c), r = Math.pow(hash(i + 3), 1.6) * 0.26, u = hash(i + 11) * TAU, v = Math.acos(2 * hash(i + 23) - 1);
    return [P[0] + r * Math.sin(v) * Math.cos(u), P[1] + r * Math.cos(v), P[2] + r * Math.sin(v) * Math.sin(u)];
  },
  funnel(i, n) {                                   // retrieval: many passages narrowing to one answer
    const t = i / n, r = 0.05 + 0.85 * Math.pow(1 - t, 1.4), a = i * 2.399963;
    return [Math.cos(a) * r, -0.95 + t * 1.9, Math.sin(a) * r];   // narrows downwards
  },
  pages(i) {                                       // three stacked sheets with lines of "text"
    const s = i % 3, k = Math.floor(i / 3), off = s - 1;
    let x, y;
    if (k % 6 === 0) {                             // sheet outline
      const t = hash(i) * 4.2, w = 1.0, h = 1.36;
      if (t < 1) { x = -w / 2 + t * w; y = h / 2; } else if (t < 2) { x = w / 2; y = h / 2 - (t - 1) * h; }
      else if (t < 3) { x = w / 2 - (t - 2) * w; y = -h / 2; } else { x = -w / 2; y = -h / 2 + Math.min(1, t - 3) * h; }
    } else {                                       // text lines, ragged right edge
      const line = k % 16, len = line % 5 === 4 ? 0.45 : 0.72 + hash(line * 31 + s) * 0.08;
      x = -0.4 + hash(i + 17) * len;
      y = -0.55 + line * 0.068 + (line > 7 ? 0.06 : 0);
    }
    return [x + off * 0.2, y - off * 0.12, off * 0.45];
  },
  helix(i, n) {                                    // double helix with rungs
    const t = i / n, strand = i % 2, a = t * TAU * 3 + strand * Math.PI;
    if (i % 11 === 0) {                            // rung between the strands
      const k = hash(i) * 2 - 1, b = t * TAU * 3;
      return [Math.cos(b) * 0.42 * k, (t * 2 - 1) * 1.05, Math.sin(b) * 0.42 * k];
    }
    const j = (hash(i) - 0.5) * 0.06;
    return [Math.cos(a) * 0.42 + j, (t * 2 - 1) * 1.05, Math.sin(a) * 0.42 + j];
  },
  scatter(i) {                                     // loose specks, before they assemble
    return [(hash(i + 51) - 0.5) * 2.4, (hash(i + 151) - 0.5) * 2.0, (hash(i + 251) - 0.5) * 1.6];
  },
  wave(i) {                                        // rippling plane
    const x = hash(i) * 2 - 1, z = hash(i + 104729) * 2 - 1;
    return [x * 1.1, Math.sin(x * 3.2) * Math.cos(z * 2.6) * 0.22, z * 1.1];
  },
};

/* The app's own logo, traced from its SVG (viewBox 26×30): a page outline, three text
   lines, and the orange corner stroke (those dots are drawn in the accent colour). */
const MARK = [
  [[1, 1], [19, 1]], [[19, 1], [19, 25]], [[19, 25], [1, 25]], [[1, 25], [1, 1]],
  [[5, 7], [15, 7]], [[5, 11], [15, 11]], [[5, 15], [11, 15]],
  [[22, 9], [22, 25], 1], [[22, 25], [21.1, 27.1], 1], [[21.1, 27.1], [19, 28], 1], [[19, 28], [7, 28], 1],
];
const MARK_LEN = MARK.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
const MARK_TOTAL = MARK_LEN.reduce((x, y) => x + y, 0);
SHAPES.mark = (i) => {
  let d = hash(i + 401) * MARK_TOTAL, k = 0;
  while (d > MARK_LEN[k] && k < MARK.length - 1) d -= MARK_LEN[k++];
  const [a, b, acc] = MARK[k], t = d / MARK_LEN[k];
  const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
  const w = (hash(i + 77) - 0.5) * 0.5;            // a little thickness so it reads in 3D
  return [(x - 11.5) / 13 + w * 0.02, (y - 14.5) / 13 + w * 0.02, w * 0.12, acc ? 1 : 0];   // canvas y points down, like SVG
};

function build(name) {
  const out = new Float32Array(N * 3), acc = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const p = SHAPES[name](i, N);
    out.set(p.slice(0, 3), i * 3);
    acc[i] = p[3] ? 1 : 0;
  }
  return { pts: out, acc, hasAcc: acc.some((v) => v === 1) };
}

export default function DotShape({ mode = "cycle", order, className = "", place = "center", strength = 1, dust = 0 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const names = order || ["pages", "graph", "funnel", "helix", "mark"];
    const shapes = names.map(build);
    const seed = Array.from({ length: N }, (_, i) => hash(i + 31));
    const accent = seed.map((h) => h < 0.07);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Ambient "dust": a few slow-drifting dots across the whole canvas so the background is never empty.
    const motes = Array.from({ length: dust }, (_, i) => ({
      x: hash(i + 900), y: hash(i + 1900), vx: (hash(i + 2900) - 0.5) * 0.00006, vy: -0.00002 - hash(i + 3900) * 0.00005,
      a: 0.08 + hash(i + 4900) * 0.22, tw: hash(i + 5900) * TAU, acc: hash(i + 6900) < 0.12,
    }));

    let W = 0, H = 0, dpr = 1, raf = 0, visible = true, last = 0;
    let morph = 0;                                  // continuous shape index
    const start = performance.now();
    const mouse = { x: 0, y: 0, px: -9999, py: -9999, tx: 0, ty: 0 };

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = r.width; H = r.height;
      canvas.width = Math.max(1, W * dpr); canvas.height = Math.max(1, H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduced) draw(performance.now());
    }

    function target(now) {
      if (mode === "reveal") {
        const r = canvas.getBoundingClientRect(), vh = window.innerHeight;
        const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.75)));
        return p * (shapes.length - 1);
      }
      if (mode === "scroll") {
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        return Math.min(1, window.scrollY / max) * (shapes.length - 1);
      }
      const hold = 7000, move = 2600, cyc = hold + move;
      const t = (now - start) / cyc;
      const k = Math.floor(t), f = (t - k) * cyc;
      return k + (f < hold ? 0 : (f - hold) / move);
    }

    function draw(now) {
      const tgt = target(now);
      morph = mode === "cycle" ? tgt : morph + (tgt - morph) * 0.06;
      const L = shapes.length;
      if (mode === "reveal") morph = Math.min(morph, L - 1.0001);   // hold on the last shape, don't wrap
      const base = Math.floor(morph), frac = morph - base;
      const SA = shapes[((base % L) + L) % L], SB = shapes[(((base + 1) % L) + L) % L];
      const A = SA.pts, B = SB.pts;

      mouse.x += (mouse.tx - mouse.x) * 0.05; mouse.y += (mouse.ty - mouse.y) * 0.05;
      const time = reduced ? 0 : (now - start) / 1000;
      const ry = time * 0.12 + mouse.x * 0.5, rx = -0.32 + mouse.y * 0.25;
      const cy_ = Math.cos(ry), sy_ = Math.sin(ry), cx_ = Math.cos(rx), sx_ = Math.sin(rx);

      const narrow = W < 900;
      const right = place === "right" && !narrow, hero = place === "hero" && !narrow;
      const cx = right ? W * 0.8 : hero ? W * 0.64 : W * 0.5;
      const cy = H * (right ? 0.44 : 0.52);
      const R = Math.min(W, H) * (right ? 0.3 : hero ? 0.4 : narrow ? 0.34 : 0.4);

      ctx.clearRect(0, 0, W, H);
      const dt = reduced ? 0 : 16;
      for (const m of motes) {
        m.x = (m.x + m.vx * dt + 1) % 1; m.y = (m.y + m.vy * dt + 1) % 1;
        ctx.globalAlpha = m.a * (0.6 + 0.4 * Math.sin(time * 0.8 + m.tw)) * strength;
        ctx.fillStyle = m.acc ? "rgb(255,107,44)" : "rgb(239,233,223)";
        ctx.fillRect(m.x * W, m.y * H, 1.6, 1.6);
      }
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass === 0 ? "rgb(239,233,223)" : "rgb(255,107,44)";
        for (let i = 0; i < N; i++) {
          // staggered morph: each dot moves at a slightly different moment
          const t = Math.min(1, Math.max(0, frac * 1.5 - seed[i] * 0.5));
          const e = t * t * (3 - 2 * t);
          const o = i * 3;
          let x = A[o] + (B[o] - A[o]) * e, y = A[o + 1] + (B[o + 1] - A[o + 1]) * e, z = A[o + 2] + (B[o + 2] - A[o + 2]) * e;
          y += Math.sin(time * 0.9 + seed[i] * TAU) * 0.012;          // gentle breathing
          const x1 = x * cy_ + z * sy_, z1 = -x * sy_ + z * cy_;
          const y2 = y * cx_ - z1 * sx_, z2 = y * sx_ + z1 * cx_;
          const s = 2.6 / (2.6 + z2);
          const px = cx + x1 * R * s, py = cy + y2 * R * s;
          const d2 = (px - mouse.px) ** 2 + (py - mouse.py) ** 2;
          const near = d2 < 110 * 110;
          const S = e < 0.5 ? SA : SB;              // the shape this dot is closer to
          const isAccent = S.acc[i] === 1 || (accent[i] && !S.hasAcc) || near;
          if ((pass === 1) !== isAccent) continue;
          const depth = (1 - z2) / 2;                                   // 0 far … 1 near
          ctx.globalAlpha = Math.min(1, (0.12 + depth * 0.5 + (near ? 0.35 : 0)) * strength);
          const size = 0.9 + depth * 1.5;
          ctx.fillRect(px, py, size, size);
        }
      }
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      raf = 0;
      if (!visible || document.hidden) return;
      if (now - last > 15) { draw(now); last = now; }
      raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf && !reduced && visible && !document.hidden) raf = requestAnimationFrame(frame); };

    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.px = e.clientX - r.left; mouse.py = e.clientY - r.top;
      mouse.tx = (e.clientX / window.innerWidth - 0.5); mouse.ty = (e.clientY / window.innerHeight - 0.5);
    };
    const onLeave = () => { mouse.px = mouse.py = -9999; };

    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); }); io.observe(canvas);
    const onVis = () => kick();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    if (reduced) draw(performance.now()); else kick();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [mode, order, place, strength, dust]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
