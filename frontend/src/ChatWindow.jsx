import { useState, useRef, useEffect } from "react";

function UserAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 text-xs font-bold text-white">
      U
    </div>
  );
}

function BotAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700/50 flex items-center justify-center shrink-0">
      <svg className="w-3.5 h-3.5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
    </div>
  );
}

export default function ChatWindow({ modelId, documentName }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("fast"); // "fast" | "agent"
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || !documentName || loading) return;

    const userMsg = { role: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      const res = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input, model_id: modelId, document_name: documentName, mode }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: res.ok ? data.answer : `Error: ${data.detail}`,
        error: !res.ok,
      }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Failed to reach backend.", error: true }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInput(e) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center select-none">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-600/20 border border-violet-500/20 flex items-center justify-center">
              <svg className="w-7 h-7 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div>
              <p className="text-zinc-300 font-medium text-sm">
                {documentName ? "Ready to answer questions" : "Upload a document to get started"}
              </p>
              <p className="text-zinc-600 text-xs mt-1">
                {documentName ? `Chatting about: ${documentName}` : "Support for PDF files"}
              </p>
            </div>
            {documentName && (
              <div className="flex flex-wrap gap-2 justify-center max-w-sm mt-2">
                {["Summarize this document", "What are the key points?", "List the main topics"].map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); textareaRef.current?.focus(); }}
                    className="text-xs bg-zinc-800/60 hover:bg-zinc-700/60 border border-zinc-700/50 hover:border-zinc-600 text-zinc-400 hover:text-zinc-300 px-3 py-1.5 rounded-lg transition-all"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            {msg.role === "user" ? <UserAvatar /> : <BotAvatar />}
            <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              msg.role === "user"
                ? "bg-violet-600 text-white rounded-tr-sm"
                : msg.error
                ? "bg-red-500/10 border border-red-500/20 text-red-300 rounded-tl-sm"
                : "bg-zinc-800/60 border border-zinc-700/30 text-zinc-200 rounded-tl-sm"
            }`}>
              {msg.text}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <BotAvatar />
            <div className="bg-zinc-800/60 border border-zinc-700/30 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-zinc-800/60">
        <div className={`flex items-end gap-2 bg-zinc-800/40 border rounded-xl px-3 py-2 transition-colors ${
          documentName ? "border-zinc-700/50 focus-within:border-violet-500/40" : "border-zinc-800 opacity-50"
        }`}>
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={documentName ? "Ask anything about your document..." : "Upload a PDF first"}
            disabled={!documentName || loading}
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none max-h-40 py-1"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || !documentName || loading}
            className="w-8 h-8 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-all shrink-0 mb-0.5"
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-0.5">
          <p className="text-xs text-zinc-700">Enter to send · Shift+Enter for new line</p>
          <button
            onClick={() => setMode(m => m === "fast" ? "agent" : "fast")}
            className={`text-xs px-2 py-0.5 rounded-md border transition-colors ${
              mode === "agent"
                ? "border-violet-500/40 text-violet-400 bg-violet-500/10"
                : "border-zinc-700/50 text-zinc-500 hover:text-zinc-400"
            }`}
          >
            {mode === "fast" ? "⚡ Fast" : "🤖 Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
