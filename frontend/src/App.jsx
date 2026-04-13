import { useState, useEffect } from "react";
import ModelSelector from "./components/ModelSelector";
import FileUpload from "./components/FileUpload";
import ChatWindow from "./components/ChatWindow";
import API_URL from "./config";

export default function App() {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [documentName, setDocumentName] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/models`)
      .then((r) => r.json())
      .then((data) => {
        setModels(data.models);
        if (data.models.length > 0) setSelectedModel(data.models[0].id);
      })
      .catch(() => console.error("Backend not reachable"));
  }, []);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col antialiased">
      {/* Top nav */}
      <header className="h-12 border-b border-zinc-800/60 flex items-center px-4 gap-3 shrink-0 backdrop-blur-sm bg-[#09090b]/80 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xs font-bold">
            R
          </div>
          <span className="text-sm font-semibold text-zinc-100 tracking-tight">RAG Chat</span>
        </div>
        <div className="h-4 w-px bg-zinc-700 mx-1" />
        {documentName && (
          <span className="text-xs text-zinc-400 bg-zinc-800/80 border border-zinc-700/50 px-2 py-0.5 rounded-md flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            {documentName}
          </span>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 border-r border-zinc-800/60 flex flex-col shrink-0 bg-zinc-900/30">
          <div className="p-4 flex flex-col gap-5">
            {/* Model selector */}
            <ModelSelector models={models} selected={selectedModel} onChange={setSelectedModel} />

            {/* Divider */}
            <div className="h-px bg-zinc-800/60" />

            {/* File upload */}
            <FileUpload onUploadSuccess={setDocumentName} />

            {/* Active doc */}
            {documentName && (
              <div className="rounded-lg border border-zinc-700/40 bg-zinc-800/30 p-3 flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-md bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-300 truncate">{documentName}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Ready to chat</p>
                </div>
              </div>
            )}
          </div>

          {/* Bottom info */}
          <div className="mt-auto p-4 border-t border-zinc-800/60">
            <p className="text-xs text-zinc-600">Powered by LangChain + LangGraph</p>
          </div>
        </aside>

        {/* Main chat */}
        <main className="flex-1 overflow-hidden flex flex-col">
          <ChatWindow modelId={selectedModel} documentName={documentName} />
        </main>
      </div>
    </div>
  );
}
