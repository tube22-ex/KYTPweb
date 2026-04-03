import React from 'react';
import { RegenHistoryEntry } from '../../hooks/useEditorHistory';

interface HistorySidebarProps {
  history: RegenHistoryEntry[];
  onRestore: (blocks: any[]) => void;
  onClear: () => void;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  history, onRestore, onClear
}) => {
  return (
    <aside className="w-80 flex flex-col bg-zinc-50 border-l border-zinc-200 overflow-hidden animate-in slide-in-from-right-4 duration-300">
      <div className="p-4 border-b border-zinc-200 flex items-center justify-between bg-white">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-rose-400 rounded-full" />
          <h3 className="text-[12px] font-black text-zinc-700 uppercase italic">History</h3>
        </div>
        <button
          onClick={onClear}
          className="text-[10px] font-bold text-zinc-400 hover:text-rose-500 transition-all uppercase"
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 custom-scrollbar">
        {history.length === 0 ? (
          <div className="text-center py-10 opacity-30 text-[10px] font-bold uppercase italic">
            No history yet
          </div>
        ) : (
          history.map((h, i) => (
            <button
              key={i}
              onClick={() => onRestore(h.blocks)}
              className="p-3 bg-white border border-zinc-200 text-left hover:border-rose-400 hover:shadow-md transition-all active:scale-95 group relative"
            >
              <div className="text-[10px] font-black text-rose-300 group-hover:text-rose-400 transition-colors mb-1 uppercase tabular-nums">
                {h.id}
              </div>
              <div className="text-[11px] font-bold text-zinc-500 line-clamp-2">
                Blocks: {h.blocks.length} | Lines: {h.blocks.reduce((sum, b) => sum + b.lines.length, 0)}
              </div>
              <div className="absolute top-0 right-0 h-full w-1 bg-rose-200 scale-y-0 group-hover:scale-y-100 transition-all origin-top" />
            </button>
          ))
        )}
      </div>
    </aside>
  );
};
