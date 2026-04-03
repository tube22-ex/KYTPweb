import React from 'react';

interface EditorToolbarProps {
  onSave: () => void;
  onClose: () => void;
  onShowHistory: () => void;
  showHistory: boolean;
  canSave: boolean;
  onSearchLyrics: () => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  currentTime: number;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  onSave, onClose, onShowHistory, showHistory, canSave, onSearchLyrics,
  isPlaying, onTogglePlay, currentTime
}) => {
  return (
    <div className="flex items-center justify-between px-8 py-4 bg-zinc-900 border-b border-white/5 shadow-2xl flex-shrink-0 z-50">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="w-2 h-8 bg-rose-400 rounded-full shadow-lg shadow-rose-400/20" />
          <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase leading-none">Map Builder</h2>
        </div>
        
        <div className="flex items-center gap-3 bg-white/5 border border-white/10 px-4 py-2 rounded-full">
           <button
             onClick={onTogglePlay}
             className="w-8 h-8 flex items-center justify-center bg-rose-400 text-white rounded-full hover:bg-rose-500 transition-all shadow-md active:scale-95"
           >
             {isPlaying ? (
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 9v6m4-6v6" />
               </svg>
             ) : (
               <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
               </svg>
             )}
           </button>
           <span className="text-lg font-black text-rose-400 tabular-nums min-w-[3ch]">
             {Math.floor(currentTime)}s
           </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={onSearchLyrics}
          className="px-5 py-2.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[11px] font-black hover:bg-indigo-500/20 transition-all uppercase tracking-widest rounded shadow-lg shadow-indigo-500/5 group"
        >
          <span className="group-hover:animate-pulse">筺ｳ Regenerate Settings</span>
        </button>
        
        <button
          onClick={onShowHistory}
          className={`px-5 py-2.5 border text-[11px] font-black transition-all uppercase tracking-widest rounded ${
            showHistory ? 'bg-rose-400 text-white border-rose-400 shadow-rose-400/20 shadow-lg' : 'bg-white/5 text-zinc-400 border-white/10 hover:bg-white/10'
          }`}
        >
          History
        </button>

        <div className="h-8 w-[1px] bg-white/10 mx-2" />

        <button
          onClick={onSave}
          disabled={!canSave}
          className="px-8 py-2.5 bg-rose-400 text-white text-[12px] font-black hover:bg-rose-500 transition-all shadow-xl shadow-rose-400/20 active:scale-95 disabled:opacity-30 disabled:grayscale uppercase tracking-[0.2em] rounded"
        >
          Save Stage
        </button>

        <button
          onClick={onClose}
          className="p-2 text-zinc-500 hover:text-white transition-all bg-white/5 hover:bg-rose-400 rounded-full ml-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};
