import React from 'react';

interface Chunk {
  id: string;
  text: string;
  timeMs: number;
  isLineHead?: boolean;
}

interface Line {
  id: string;
  timeMs: number;
  chunks: Chunk[];
}

interface Block {
  id: string;
  timeMs: number;
  lines: Line[];
}

interface BlockItemProps {
  block: Block;
  blockIdx: number;
  currentTime: number;
  isDraggingChunk: string | null;
  setIsDraggingChunk: (id: string | null) => void;
  onExecuteDrop: (targetBlockIdx: number, targetLineIdx: number, targetChunkIdx: number) => void;
  onDeleteBlock: (idx: number) => void;
  onEditChunk: (id: string, text: string) => void;
  onTimeChange: (idx: number, newTime: number) => void;
  onLineTimeChange: (bIdx: number, lIdx: number, newTime: number) => void;
  onAddLine: (idx: number) => void;
  onSplitBlock: (bIdx: number, lIdx: number) => void;
  onMergeForward: (bIdx: number, lIdx: number, cIdx: number) => void;
  onMergeBackward: (bIdx: number, lIdx: number, cIdx: number) => void;
}

export const BlockItem: React.FC<BlockItemProps> = ({
  block, blockIdx, currentTime,
  isDraggingChunk, setIsDraggingChunk, onExecuteDrop,
  onDeleteBlock, onEditChunk, onTimeChange, onLineTimeChange, onAddLine,
  onSplitBlock, onMergeForward, onMergeBackward
}) => {
  const isActive = currentTime * 1000 >= block.timeMs && (blockIdx === 0 || currentTime * 1000 < (block.timeMs + 5000)); // Simple highlight

  return (
    <div className={`p-5 rounded-lg border-2 transition-all bg-white shadow-xl ${isActive ? 'border-rose-400 ring-4 ring-rose-100' : 'border-zinc-200 shadow-sm'}`}>
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-100">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
             <span className="text-[10px] font-black text-rose-300 uppercase italic tracking-widest leading-none mb-1">
               BLOCK {String(blockIdx + 1).padStart(2, '0')}
             </span>
             <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={Math.round(block.timeMs)}
                  onChange={(e) => onTimeChange(blockIdx, Number(e.target.value))}
                  className="w-24 bg-zinc-50 border-2 border-zinc-100 p-1.5 text-sm font-black text-rose-500 focus:outline-none focus:border-rose-400 text-center rounded-md font-mono"
                />
                <span className="text-[10px] font-black text-zinc-300 uppercase">ms</span>
             </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
           <button
            onClick={() => onAddLine(blockIdx)}
            className="px-3 py-1.5 bg-rose-50 text-rose-500 text-[10px] font-black hover:bg-rose-100 transition-all rounded uppercase tracking-tighter"
          >
            + Add Line
          </button>
          <button
            onClick={() => onDeleteBlock(blockIdx)}
            className="p-2 hover:bg-rose-50 text-zinc-300 hover:text-rose-500 transition-all rounded-full"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {block.lines.map((line, lIdx) => (
          <div key={line.id} className="relative group/line">
            {/* Split Zone */}
            {lIdx > 0 && (
              <div 
                className="absolute -top-2 left-0 right-0 h-1 hover:h-4 bg-transparent hover:bg-rose-100 transition-all cursor-pointer z-10 flex items-center justify-center group/split"
                onClick={() => onSplitBlock(blockIdx, lIdx)}
              >
                <span className="opacity-0 group-hover/split:opacity-100 text-[8px] font-black text-rose-400 uppercase tracking-widest bg-white px-2 py-0.5 border border-rose-200 shadow-sm">
                  Split Block Here
                </span>
              </div>
            )}

            <div className="flex items-center gap-3 mb-1">
               <input
                 type="number"
                 value={Math.round(line.timeMs)}
                 onChange={(e) => onLineTimeChange(blockIdx, lIdx, Number(e.target.value))}
                 className="w-16 bg-zinc-50 border border-zinc-200 py-0.5 px-1 text-[10px] font-bold text-zinc-400 focus:outline-none focus:border-rose-300 text-center rounded font-mono"
               />
               <div className="flex-1 h-px bg-zinc-100" />
            </div>

            <div className="flex flex-wrap items-center gap-2 p-3 bg-zinc-50/50 rounded-lg border border-zinc-100 min-h-[50px] transition-colors hover:bg-zinc-100/50">
              {line.chunks.map((chunk, cIdx) => (
                <div
                  key={chunk.id}
                  draggable
                  onDragStart={() => setIsDraggingChunk(chunk.id)}
                  onDragEnd={() => setIsDraggingChunk(null)}
                  className={`group relative flex items-center gap-2 px-3 py-1.5 bg-white border shadow-sm cursor-move active:scale-95 transition-all outline-none focus-within:ring-2 focus-within:ring-rose-200 ${
                    chunk.isLineHead ? 'border-indigo-400 ring-2 ring-indigo-50 ring-inset' : 'border-rose-100'
                  } ${isDraggingChunk === chunk.id ? 'opacity-20 scale-90' : ''}`}
                >
                  {/* Merge Backward */}
                  {(cIdx > 0 || lIdx > 0) && (
                    <button 
                      onClick={() => onMergeBackward(blockIdx, lIdx, cIdx)}
                      className="absolute -left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 bg-rose-400 text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px] shadow z-20 hover:scale-125 transition-all"
                      title="左の単語と結合"
                    >
                      &lt;
                    </button>
                  )}

                  <input
                    type="text"
                    value={chunk.text}
                    onChange={(e) => onEditChunk(chunk.id, e.target.value)}
                    className={`bg-transparent border-none p-0 text-[13px] font-black focus:outline-none w-[auto] min-w-[20px] ${
                      chunk.isLineHead ? 'text-indigo-600' : 'text-rose-600'
                    }`}
                    style={{ width: `${chunk.text.length + 1.5}ch` }}
                  />

                  {/* Merge Forward */}
                  {(cIdx < line.chunks.length - 1 || lIdx < block.lines.length - 1) && (
                    <button 
                      onClick={() => onMergeForward(blockIdx, lIdx, cIdx)}
                      className="absolute -right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 bg-rose-400 text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px] shadow z-20 hover:scale-125 transition-all"
                      title="右の単語と結合"
                    >
                      &gt;
                    </button>
                  )}
                </div>
              ))}

              {isDraggingChunk && (
                 <button
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onExecuteDrop(blockIdx, lIdx, line.chunks.length)}
                    className="h-10 px-4 border-2 border-dashed border-rose-300 text-rose-400 text-[11px] font-black hover:bg-rose-100 hover:border-rose-400 transition-all rounded flex items-center justify-center bg-white/50"
                 >
                   + DROP HERE
                 </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
