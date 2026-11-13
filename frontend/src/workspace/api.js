import API_URL from "../config";

/** Parse a server-sent-events response body, calling onEvent({type, ...data}) per event. */
async function readSSE(res, onEvent, signal) {
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try { detail = (await res.json()).detail || detail; } catch { /* not JSON */ }
    throw new Error(detail);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    if (signal?.aborted) { reader.cancel(); break; }
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("");
      if (data) onEvent(JSON.parse(data));
    }
  }
}

async function json(path, opts = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try { detail = (await res.json()).detail || detail; } catch { /* not JSON */ }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.headers.get("content-type")?.includes("json") ? res.json() : res.text();
}

export const api = {
  createSession: () => json("/sessions", { method: "POST" }),
  getSession: (sid) => json(`/sessions/${sid}`),
  endSession: (sid) => json(`/sessions/${sid}`, { method: "DELETE" }),
  extendSession: (sid) => json(`/sessions/${sid}/extend`, { method: "POST" }),
  models: () => json("/models"),
  agents: () => json("/agents"),

  upload: async (sid, files, onEvent) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    const res = await fetch(`${API_URL}/sessions/${sid}/documents`, { method: "POST", body: fd });
    return readSSE(res, onEvent);
  },
  deleteDoc: (sid, docId) => json(`/sessions/${sid}/documents/${docId}`, { method: "DELETE" }),

  chat: async (sid, body, onEvent, signal) => {
    const res = await fetch(`${API_URL}/sessions/${sid}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
    });
    return readSSE(res, onEvent, signal);
  },

  buildWiki: async (sid, onEvent) => {
    const res = await fetch(`${API_URL}/sessions/${sid}/wiki/build`, { method: "POST" });
    return readSSE(res, onEvent);
  },
  wiki: (sid) => json(`/sessions/${sid}/wiki`),
  wikiPage: (sid, slug) => json(`/sessions/${sid}/wiki/${encodeURIComponent(slug)}`),
  saveToWiki: (sid, page) => json(`/sessions/${sid}/wiki/save`, { method: "POST", body: JSON.stringify(page) }),

  studio: async (sid, body, onEvent) => {
    const res = await fetch(`${API_URL}/sessions/${sid}/studio`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return readSSE(res, onEvent);
  },
  studioItems: (sid) => json(`/sessions/${sid}/studio`),
  speak: async (sid, text) => {
    const res = await fetch(`${API_URL}/sessions/${sid}/speak`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("speech unavailable");
    return res.blob();
  },
  transcribe: async (sid, blob) => {
    const fd = new FormData();
    fd.append("audio", blob, "question.webm");
    const res = await fetch(`${API_URL}/sessions/${sid}/transcribe`, { method: "POST", body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Transcription failed");
    return res.json();
  },
};
