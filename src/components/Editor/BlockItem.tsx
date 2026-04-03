import React from 'react';

interface Chunk {
  id: string;
  text: string;
  timeMs: number;
  absLineIdx: number;
  isLineHead: boolean;
}

interface Block {
  id: string;
  timeMs: number;
  lines: { chunks: Chunk[] }[];
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
  onAddLine: (idx: number) => void;
}

export const BlockItem: React.FC<BlockItemProps> = ({
  block, blockIdx, currentTime,
  isDraggingChunk, setIsDraggingChunk, onExecuteDrop,
  onDeleteBlock, onEditChunk, onTimeChange, onAddLine
}) => {
  const isActive = currentTime * 1000 >= block.timeMs;

  return (
    <div className={`p-4 border-l-4 transition-all bg-white shadow-sm border-zinc-200 ${isActive ? 'ring-2 ring-rose-400 ring-inset' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-black text-zinc-300 italic">BLOCK {String(blockIdx + 1).padStart(2, '0')}</span>
          <input
            type="number"
            value={Math.round(block.timeMs)}
            onChange={(e) => onTimeChange(blockIdx, Number(e.target.value))}
            className="w-20 bg-zinc-50 border border-zinc-200 p-1 text-[11px] font-bold text-rose-500 focus:outline-none focus:border-rose-400 text-center rounded-sm"
          />
          <span className="text-[10px] font-bold text-zinc-300 tabular-nums">ms</span>
        </div>
        <button
          onClick={() => onDeleteBlock(blockIdx)}
          className="p-1 hover:bg-rose-50 text-zinc-300 hover:text-rose-500 transition-all rounded"
          title="ブロックを削除"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {block.lines.map((line, lIdx) => (
          <div key={lIdx} className="flex flex-wrap items-center gap-2 p-2 bg-zinc-50/50 rounded border border-dashed border-zinc-100 min-h-[40px]">
            {line.chunks.map((chunk) => (
              <div
                key={chunk.id}
                draggable
                onDragStart={() => setIsDraggingChunk(chunk.id)}
                onDragEnd={() => setIsDraggingChunk(null)}
                className={`group relative flex items-center gap-2 px-2 py-1 bg-white border border-rose-100 shadow-sm cursor-move active:scale-95 transition-all ${isDraggingChunk === chunk.id ? 'opacity-30' : ''}`}
              >
                <input
                  type="text"
                  value={chunk.text}
                  onChange={(e) => onEditChunk(chunk.id, e.target.value)}
                  className="bg-transparent border-none p-0 text-[12px] font-bold text-zinc-600 focus:outline-none w-[auto] min-w-[20px]"
                  style={{ width: `${chunk.text.length + 1}ch` }}
                />
                <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-1.5 h-0.5 bg-rose-200 rounded-full" />
                  <div className="w-1.5 h-0.5 bg-rose-200 rounded-full" />
                  <div className="w-1.5 h-0.5 bg-rose-200 rounded-full" />
                </div>
              </div>
            ))}

            {isDraggingChunk && (
               <button
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onExecuteDrop(blockIdx, lIdx, line.chunks.length)}
                  className="h-8 px-2 border-2 border-dashed border-rose-200 text-rose-300 text-[10px] font-bold hover:bg-rose-50 transition-all"
               >
                 + Drop Here
               </button>
            )}
          </div>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onAddLine(blockIdx)}
            className="px-2 py-1 bg-white border border-rose-100 text-rose-400 text-[10px] font-bold hover:bg-rose-50 transition-all flex items-center gap-1 shadow-sm"
          >
            <span className="text-sm leading-none">+</span> 行追加
          </button>
          
          {isDraggingChunk && (
            <button
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onExecuteDrop(blockIdx, block.lines.length, 0)}
              className="px-2 py-1 bg-rose-50 border border-dashed border-rose-200 text-rose-400 text-[10px] font-bold hover:bg-rose-100 transition-all flex items-center gap-1 shadow-sm"
            >
               + 新しい行としてドロップ
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
