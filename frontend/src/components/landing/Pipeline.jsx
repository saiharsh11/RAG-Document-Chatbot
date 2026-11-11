import { useState } from "react";

/*
  One passage, four stages. Each chunk is linked across all four columns:
  hover it anywhere and it lights up everywhere it travels.
*/
const CHUNKS = [
  { id: "c1", text: "Attention weighs every token against every other token in the input.", vec: [0.8, 0.2, 0.6, 0.9, 0.3, 0.5, 0.7, 0.1], score: 0.42 },
  { id: "c2", text: "Retrieval adds an external memory that is searched at inference time.", vec: [0.3, 0.9, 0.4, 0.2, 0.8, 0.6, 0.2, 0.7], score: 0.93 },
  { id: "c3", text: "Both rely on dot-product similarity between learned vectors.", vec: [0.6, 0.7, 0.9, 0.4, 0.5, 0.3, 0.8, 0.6], score: 0.88 },
  { id: "c4", text: "Training data for the model was collected over two years.", vec: [0.1, 0.3, 0.2, 0.7, 0.2, 0.9, 0.1, 0.4], score: 0.12 },
];
const RANKED = [...CHUNKS].sort((a, b) => b.score - a.score);
const CITED = { c2: 1, c3: 2 };

export default function Pipeline() {
  const [on, setOn] = useState(null);
  const bind = (id) => ({
    onPointerEnter: () => setOn(id), onPointerLeave: () => setOn(null),
    className: `pl-chunk ${on === id ? "is-on" : ""} ${on && on !== id ? "is-dim" : ""}`,
  });
  return (
    <div className="pl">
      <div className="pl-col">
        <div className="pl-h"><span>01</span> Read</div>
        <p className="pl-sub">Parsed in memory, split into chunks.</p>
        {CHUNKS.map((c) => <div key={c.id} {...bind(c.id)}><em>¶ {c.id}</em>{c.text}</div>)}
      </div>
      <div className="pl-col">
        <div className="pl-h"><span>02</span> Embed</div>
        <p className="pl-sub">Each chunk becomes a vector.</p>
        {CHUNKS.map((c) => (
          <div key={c.id} {...bind(c.id)}>
            <em>{c.id}</em>
            <span className="pl-vec">{c.vec.map((v, i) => <i key={i} style={{ height: `${10 + v * 26}px` }} />)}</span>
          </div>
        ))}
      </div>
      <div className="pl-col">
        <div className="pl-h"><span>03</span> Rerank</div>
        <p className="pl-sub">Hybrid search, then a reranker orders them.</p>
        {RANKED.map((c, r) => (
          <div key={c.id} {...bind(c.id)}>
            <em>#{r + 1} {c.id}</em>
            <span className="pl-bar"><i style={{ width: `${c.score * 100}%` }} className={c.score > 0.5 ? "is-keep" : ""} /></span>
            <small>{c.score.toFixed(2)}</small>
          </div>
        ))}
      </div>
      <div className="pl-col">
        <div className="pl-h"><span>04</span> Cite</div>
        <p className="pl-sub">Only supported claims make the answer.</p>
        <div className="pl-answer">
          Unlike attention, retrieval queries an{" "}
          <span {...bind("c2")}>external memory at inference time<sup>{CITED.c2}</sup></span>; both{" "}
          <span {...bind("c3")}>score relevance with dot products<sup>{CITED.c3}</sup></span>.
        </div>
        <div className="pl-dropped">c1, c4 were not needed and were left out.</div>
      </div>
    </div>
  );
}
