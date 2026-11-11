/*
  Minimal, safe Markdown renderer (no HTML injection: everything becomes React text nodes).
  Supports headings, paragraphs, bullet/numbered lists, tables, code, bold/italic/inline code,
  citation chips [S1] and wiki links [[Page Title]].
*/

const normalise = (t) =>
  (t || "")
    .replace(/【/g, "[").replace(/】/g, "]")
    .replace(/\[\s*(S\d+)\s*\]/g, "[$1]")
    .replace(/\[\s*(S\d+(?:\s*[,;]\s*S\d+)+)\s*\]/g, (_, ids) => ids.split(/[,;]/).map((x) => `[${x.trim()}]`).join(""));

function inline(text, ctx, keyBase = "") {
  const out = [];
  const re = /(\[\[[^\]]+\]\]|\[S\d+\]|\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("[[")) {
      const title = tok.slice(2, -2);
      out.push(
        <button key={k} type="button" className="md-wikilink" onClick={() => ctx.onWiki?.(title)}>{title}</button>,
      );
    } else if (tok.startsWith("[S")) {
      const sid = tok.slice(1, -1);
      const known = !ctx.citations || ctx.citations.some((c) => c.id === sid);
      out.push(
        <button key={k} type="button" className={`md-cite ${known ? "" : "is-unknown"}`}
          onClick={() => known && ctx.onCite?.(sid)} title={known ? "Open source" : "Source not available"}>
          {sid.slice(1)}
        </button>,
      );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={k}>{inline(tok.slice(2, -2), ctx, k)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    } else {
      out.push(<em key={k}>{inline(tok.slice(1, -1), ctx, k)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*([-*•‑–]|\d+[.)])\s+/;

export default function Markdown({ text, citations, onCite, onWiki }) {
  const ctx = { citations, onCite, onWiki };
  const lines = normalise(text).split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={i}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      const Tag = `h${Math.min(6, h[1].length + 2)}`;
      blocks.push(<Tag key={i}>{inline(h[2], ctx, `h${i}`)}</Tag>);
      i++;
      continue;
    }
    if (line.trim().startsWith("|") && lines[i + 1]?.match(/^\s*\|?\s*:?-{2,}/)) {
      const row = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = row(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) body.push(row(lines[i++]));
      blocks.push(
        <div key={i} className="md-table"><table>
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, ctx, `th${j}`)}</th>)}</tr></thead>
          <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, ctx, `td${ri}${j}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (BULLET.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && BULLET.test(lines[i])) {
        const indent = lines[i].match(/^\s*/)[0].length;
        items.push({ text: lines[i].replace(BULLET, ""), indent });
        i++;
        while (i < lines.length && lines[i].trim() && !BULLET.test(lines[i]) && /^\s{2,}/.test(lines[i])) {
          items[items.length - 1].text += " " + lines[i++].trim();
        }
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={i}>{items.map((it, j) => (
          <li key={j} style={it.indent >= 2 ? { marginLeft: 18 } : undefined}>{inline(it.text, ctx, `li${i}${j}`)}</li>
        ))}</List>,
      );
      continue;
    }
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !BULLET.test(lines[i]) && !lines[i].startsWith("#") && !lines[i].trim().startsWith("|")) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={i}>{inline(para.join(" "), ctx, `p${i}`)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
