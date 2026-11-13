import { useEffect, useRef } from "react";

/*
  A calm, near-invisible dot grid. A soft orange glow follows the cursor, and every few
  seconds a slow diagonal wave of light passes across. It only redraws while something
  is changing (cursor moving, glow fading, wave passing), so an idle page costs nothing.
*/
export default function DotField({ className = "", gap = 26, base = 0.1, waveEvery = 9000 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, raf = 0, visible = true, timer = 0;
    const m = { x: -999, y: -999, tx: -999, ty: -999, glow: 0, active: false };
    let wave = null;                                // { start } while a wave is crossing

    function resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = r.width; H = r.height;
      canvas.width = Math.max(1, W * dpr); canvas.height = Math.max(1, H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(performance.now());
    }

    function draw(now) {
      ctx.clearRect(0, 0, W, H);
      const off = (gap / 2) | 0;
      const wp = wave ? (now - wave.start) / 4200 : -1;           // 0 → 1 while crossing
      const band = (W + H) * (wp * 1.3 - 0.15);
      for (let y = off; y < H; y += gap) {
        for (let x = off; x < W; x += gap) {
          let a = base, size = 1.2, hot = 0;
          if (m.glow > 0.01) {
            const d = Math.hypot(x - m.x, y - m.y);
            if (d < 170) { hot = (1 - d / 170) ** 2 * m.glow; a += hot * 0.75; size += hot * 1.2; }
          }
          if (wp >= 0) {
            const w = Math.max(0, 1 - Math.abs(x + y - band) / 140);
            a += w * w * 0.16;
          }
          ctx.globalAlpha = Math.min(1, a);
          ctx.fillStyle = hot > 0.25 ? "rgb(255,107,44)" : "rgb(239,233,223)";
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      raf = 0;
      if (!visible || document.hidden) return;
      m.x += (m.tx - m.x) * 0.18; m.y += (m.ty - m.y) * 0.18;
      m.glow += ((m.active ? 1 : 0) - m.glow) * 0.08;
      if (wave && now - wave.start > 4200) wave = null;
      draw(now);
      const settling = Math.abs(m.tx - m.x) > 0.5 || Math.abs(m.ty - m.y) > 0.5 || (m.active ? m.glow < 0.99 : m.glow > 0.01);
      if (settling || wave) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf && !reduced && visible && !document.hidden) raf = requestAnimationFrame(frame); };

    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      m.tx = e.clientX - r.left; m.ty = e.clientY - r.top;
      m.active = m.tx >= 0 && m.ty >= 0 && m.tx <= W && m.ty <= H;
      if (m.glow < 0.01) { m.x = m.tx; m.y = m.ty; }
      kick();
    };
    const onLeave = () => { m.active = false; kick(); };
    const scheduleWave = () => {
      timer = window.setTimeout(() => { if (visible && !document.hidden) { wave = { start: performance.now() }; kick(); } scheduleWave(); }, waveEvery);
    };

    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }); io.observe(canvas);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    if (!reduced) scheduleWave();

    return () => {
      cancelAnimationFrame(raf); clearTimeout(timer); ro.disconnect(); io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [gap, base, waveEvery]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
