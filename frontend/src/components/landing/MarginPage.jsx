import { useEffect, useLayoutEffect, useRef, useState } from "react";

/*
  The hero visual: a document page with a live margin.
  Hover a line and it gets highlighted and annotated in the margin, the way a
  retriever "reads" a page. With no pointer, it annotates itself line by line.
  Plain DOM + CSS transitions — no animation loop.
*/
const LINES = [
  { t: "§ 3.2  Retrieval and grounding", head: true },
  { t: "Language models answer fluently," },
  { t: "but fluency is not evidence. A", note: ["Retrieval", "score 0.91", "chunk 14"] },
  { t: "grounded system first finds the" },
  { t: "passages that bear on a question," },
  { t: "then writes only what they support.", note: ["Verifier", "supported", "3 of 3 claims"] },
  { t: "" },
  { t: "Keyword search catches exact terms;", note: ["Hybrid", "BM25 + dense", "k = 20 → 4"] },
  { t: "vectors catch meaning. Reranked" },
  { t: "together, they find what a careful" },
  { t: "reader would." },
  { t: "" },
  { t: "When two sources disagree, that", note: ["Librarian", "contradiction", "wiki/hallucination"] },
  { t: "disagreement is shown as an answer." },
  { t: "Nothing read here is kept.", note: ["Guardian", "zero retention", "wiped on exit"] },
];
const NOTED = LINES.map((l, i) => (l.note ? i : -1)).filter((i) => i >= 0);

export default function MarginPage() {
  const [hover, setHover] = useState(-1);
  const [auto, setAuto] = useState(0);

  useEffect(() => {
    if (hover !== -1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setAuto((a) => (a + 1) % NOTED.length), 2600);
    return () => clearInterval(id);
  }, [hover]);

  const active = hover !== -1 ? hover : NOTED[auto];
  const noteFor = (i) => LINES[i].note || ["Read", "no match", `line ${i + 1}`];
  const lineRefs = useRef([]);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const el = lineRefs.current[active];
    if (el) setTop(el.offsetTop);
  }, [active]);
  const [who, what, detail] = noteFor(active);

  return (
    <div className="mp" onPointerLeave={() => setHover(-1)}>
      <div className="mp-page">
        <div className="mp-meta"><span>rag-survey.pdf</span><span>p. 7</span></div>
        {LINES.map((l, i) => (
          <div key={i} ref={(el) => (lineRefs.current[i] = el)} className={`mp-line ${l.head ? "is-head" : ""} ${active === i ? "is-on" : ""} ${l.note ? "has-note" : ""}`}
            onPointerEnter={() => l.t && setHover(i)}>
            <span className="mp-ln">{l.t ? String(i + 1).padStart(2, "0") : ""}</span>
            <span className="mp-text">{l.t || " "}</span>
          </div>
        ))}
      </div>
      <div className="mp-margin" aria-live="polite">
        <div className="mp-note" key={active} style={{ transform: `translateY(${top}px)` }}>
          <b>{who}</b><span>{what}</span><small>{detail}</small>
        </div>
      </div>
    </div>
  );
}
