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
    <div className="flex items-center justify-between p-4 bg-white border-b border-rose-100 shadow-sm flex-shrink-0">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-black text-zinc-700 italic tracking-tighter uppercase">Map Editor</h2>
        <div className="h-6 w-[1px] bg-zinc-100" />
        <div className="flex items-center gap-2">
           <button
             onClick={onTogglePlay}
             className="w-10 h-10 flex items-center justify-center bg-rose-400 text-white rounded-full hover:bg-rose-500 transition-all shadow-md active:scale-95"
           >
             {isPlaying ? (
               <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 9v6m4-6v6" />
               </svg>
             ) : (
               <svg className="w-5 h-5 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
               </svg>
             )}
           </button>
           <span className="text-lg font-black text-rose-400 tabular-nums w-20">
             {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, '0')}
           </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onSearchLyrics}
          className="px-4 py-2 bg-purple-50 text-purple-500 text-[11px] font-black hover:bg-purple-100 transition-all uppercase tracking-tighter"
        >
          Open with lyrics
        </button>
        <button
          onClick={onShowHistory}
          className={`px-4 py-2 text-[11px] font-black transition-all uppercase tracking-tighter ${
            showHistory ? 'bg-rose-400 text-white shadow-md' : 'bg-rose-50 text-rose-400 hover:bg-rose-100'
          }`}
        >
          History
        </button>
        <div className="h-6 w-[1px] bg-zinc-100" />
        <button
          onClick={onSave}
          disabled={!canSave}
          className="px-6 py-2 bg-rose-400 text-white text-[12px] font-black hover:bg-rose-500 transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:grayscale uppercase tracking-widest"
        >
          Save Changes
        </button>
        <button
          onClick={onClose}
          className="p-2 text-zinc-300 hover:text-zinc-500 transition-all"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};
