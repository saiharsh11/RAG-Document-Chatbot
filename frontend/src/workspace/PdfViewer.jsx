import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/*
  Renders the user's own copy of the PDF, kept in the browser (it is never fetched back
  from the server), and highlights the text that matches the cited passage.
*/

const docCache = new WeakMap();
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function loadDoc(file) {
  if (!docCache.has(file)) docCache.set(file, pdfjs.getDocument({ data: await file.arrayBuffer() }).promise);
  return docCache.get(file);
}

export default function PdfViewer({ file, page: startPage, snippet, title, onClose }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [page, setPage] = useState(startPage || 1);
  const [pages, setPages] = useState(0);
  const [marks, setMarks] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let task;
    (async () => {
      try {
        const doc = await loadDoc(file);
        if (cancelled) return;
        setPages(doc.numPages);
        const p = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
        const width = wrapRef.current?.clientWidth || 560;
        const base = p.getViewport({ scale: 1 });
        const viewport = p.getViewport({ scale: width / base.width });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        task = p.render({ canvasContext: ctx, viewport });
        await task.promise;
        if (cancelled) return;

        // Highlight text items that belong to the cited passage.
        const target = norm(snippet || "");
        const content = await p.getTextContent();
        const rects = [];
        if (target) {
          for (const item of content.items) {
            const t = norm(item.str || "");
            if (t.length < 4 || !target.includes(t)) continue;
            const tx = pdfjs.Util.transform(viewport.transform, item.transform);
            const h = Math.hypot(tx[2], tx[3]);
            rects.push({ x: tx[4], y: tx[5] - h, w: item.width * viewport.scale, h: h * 1.15 });
          }
        }
        setMarks(rects);
        setError("");
      } catch (e) {
        if (!cancelled && e?.name !== "RenderingCancelledException") setError("Couldn't render this page.");
      }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [file, page, snippet]);

  return (
    <div className="pdfv">
      <div className="pdfv-bar">
        <span className="pdfv-title">{title}</span>
        <div className="pdfv-nav">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={15} /></button>
          <span>p. {page}{pages ? ` / ${pages}` : ""}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(pages || p, p + 1))} disabled={pages && page >= pages} aria-label="Next page"><ChevronRight size={15} /></button>
          <button type="button" onClick={onClose} aria-label="Close viewer"><X size={15} /></button>
        </div>
      </div>
      <div className="pdfv-page" ref={wrapRef}>
        <canvas ref={canvasRef} />
        {page === startPage && marks.map((r, i) => (
          <span key={i} className="pdfv-mark" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
        ))}
        {error && <p className="pdfv-error">{error}</p>}
      </div>
      <p className="pdfv-note">Rendered from your local copy. The file is never sent back from the server.</p>
    </div>
  );
}
