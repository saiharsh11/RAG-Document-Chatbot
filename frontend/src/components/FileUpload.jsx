import { useState } from "react";
import API_URL from "../config";

export default function FileUpload({ onUploadSuccess }) {
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState(null); // null | 'success' | 'error'
  const [message, setMessage] = useState("");

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    setStatus(null);
    setMessage("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setStatus("success");
        setMessage(`Indexed ${data.chunks} chunks`);
        onUploadSuccess(file.name);
      } else {
        setStatus("error");
        setMessage(data.detail);
      }
    } catch {
      setStatus("error");
      setMessage("Backend not reachable");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider px-0.5">Document</label>
      <label className={`
        relative cursor-pointer rounded-lg border-2 border-dashed px-4 py-4 text-center transition-all
        ${uploading
          ? "border-violet-500/30 bg-violet-500/5"
          : "border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-800/30"
        }
      `}>
        <input type="file" accept=".pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
        <div className="flex flex-col items-center gap-2">
          {uploading ? (
            <>
              <div className="w-5 h-5 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
              <p className="text-xs text-zinc-400">Processing...</p>
            </>
          ) : (
            <>
              <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700/50 flex items-center justify-center">
                <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-300">Upload PDF</p>
                <p className="text-xs text-zinc-600 mt-0.5">Click to browse</p>
              </div>
            </>
          )}
        </div>
      </label>

      {status && (
        <div className={`flex items-center gap-1.5 px-0.5 ${status === "success" ? "text-emerald-400" : "text-red-400"}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${status === "success" ? "bg-emerald-400" : "bg-red-400"}`} />
          <p className="text-xs">{message}</p>
        </div>
      )}
    </div>
  );
}
