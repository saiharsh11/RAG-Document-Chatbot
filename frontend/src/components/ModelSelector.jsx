export default function ModelSelector({ models, selected, onChange }) {
  const selectedModel = models.find((m) => m.id === selected);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider px-0.5">Model</label>
      <div className="relative">
        <select
          value={selected}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-zinc-800/60 border border-zinc-700/50 text-zinc-200 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/50 transition-colors cursor-pointer"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id} className="bg-zinc-800">
              [{m.provider}] {m.id}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-zinc-500">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      {selectedModel && (
        <p className="text-xs text-zinc-600 px-0.5">
          via <span className="text-zinc-500">{selectedModel.provider}</span>
        </p>
      )}
    </div>
  );
}
