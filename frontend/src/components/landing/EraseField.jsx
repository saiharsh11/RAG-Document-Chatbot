import { useEffect, useRef } from "react";

/*
  "The forgetting page": faint body text your cursor erases, which slowly
  grows back. Text is rasterised once; each frame is two drawImage calls.
  The loop idles when nothing is erased and the pointer is away.
*/
const TEXT =
  "The quarterly report notes a rise in retrieval quality after reranking was introduced. Section four compares two chunking strategies and finds that smaller passages with overlap answer narrow questions better. The appendix lists every question in the evaluation set together with the passages that support each answer. Contradictions between the survey and the lecture notes are recorded on their own page. None of this is stored. ";

export default function EraseField({ className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const text = document.createElement("canvas"), tctx = text.getContext("2d");
    const mask = document.createElement("canvas"), mctx = mask.getContext("2d");
    let W = 0, H = 0, dpr = 1, raf = 0, dirty = 0, visible = true;
    const m = { x: 0, y: 0, active: false };

    function build() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = r.width; H = r.height;
      for (const c of [canvas, text, mask]) { c.width = W * dpr; c.height = H * dpr; }
      for (const c of [ctx, tctx, mctx]) c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const size = W < 700 ? 15 : 19, lh = size * 1.75;
      tctx.font = `300 ${size}px "Fraunces", Georgia, serif`;
      tctx.fillStyle = "rgba(239,233,223,0.055)";
      tctx.textBaseline = "top";
      const words = TEXT.repeat(12).split(" ");
      let x = 24, y = 24;
      for (const w of words) {
        const ww = tctx.measureText(w + " ").width;
        if (x + ww > W - 24) { x = 24; y += lh; if (y > H) break; }
        tctx.fillText(w, x, y); x += ww;
      }
      draw();
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(text, 0, 0, W, H);
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(mask, 0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
    }
    function frame() {
      raf = 0;
      if (!visible) return;
      if (m.active) {
        const g = mctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 70);
        g.addColorStop(0, "rgba(0,0,0,0.5)"); g.addColorStop(1, "rgba(0,0,0,0)");
        mctx.fillStyle = g; mctx.beginPath(); mctx.arc(m.x, m.y, 70, 0, 6.283); mctx.fill();
        dirty = 140;
      }
      // memory slowly returns: fade the erase mask
      mctx.globalCompositeOperation = "destination-out";
      mctx.fillStyle = "rgba(0,0,0,0.025)"; mctx.fillRect(0, 0, W, H);
      mctx.globalCompositeOperation = "source-over";
      draw();
      if (m.active || --dirty > 0) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      m.x = e.clientX - r.left; m.y = e.clientY - r.top;
      m.active = m.x >= 0 && m.y >= 0 && m.x <= W && m.y <= H;
      if (m.active) kick();
    };
    build();
    const ro = new ResizeObserver(build); ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(canvas);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.fonts?.ready.then(build);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); window.removeEventListener("pointermove", onMove); };
  }, []);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
