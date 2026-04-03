import { useState } from 'react';
import { ParseResult } from '../services/api';
import { saveMapDataToCache as saveMapData } from '../services/sync';
import { useEditorHistory } from '../hooks/useEditorHistory';
import { useYTPlayer } from '../hooks/useYTPlayer';

// Sub-components
import { EditorToolbar } from './Editor/EditorToolbar';
import { BlockItem } from './Editor/BlockItem';
import { HistorySidebar } from './Editor/HistorySidebar';

interface MapEditorProps {
  onClose: () => void;
  volume: number;
  onSaved: (mapId: string) => void;
  initialData: ParseResult | null;
  initialId: string | null;
}

const uid = () => Math.random().toString(36).substring(2, 10);

export const MapEditor: React.FC<MapEditorProps> = ({
  onClose, volume, onSaved, initialData, initialId
}) => {
  const [blocks, setBlocks] = useState<any[]>(() => {
    if (initialData?.displaySets) {
       return JSON.parse(JSON.stringify(initialData.displaySets));
    }
    return [];
  });

  const { history, addHistory, clearHistory } = useEditorHistory(initialId);
  const { currentTime, isPlaying, togglePlay } = useYTPlayer(initialData?.videoId, volume);
  
  const [showHistory, setShowHistory] = useState(false);
  const [isDraggingChunk, setIsDraggingChunk] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // --- Handlers ---
  const handleSave = async () => {
    if (!initialId || !initialData) return;
    setIsSaving(true);
    try {
      // データの正規化 (absLineIdx等の振り直し)
      const normalized = JSON.parse(JSON.stringify(blocks));
      let currentAbsIdx = 0;
      normalized.forEach((b: any) => {
        b.lines.forEach((l: any) => {
          l.absLineIdx = currentAbsIdx++;
          l.chunks.forEach((c: any) => {
            c.absLineIdx = l.absLineIdx;
          });
        });
      });

      await saveMapData(initialId, normalized);
      onSaved(initialId);
    } catch (err) {
      console.error('Save failed:', err);
      alert('保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteBlock = (idx: number) => {
    addHistory(blocks);
    setBlocks(prev => prev.filter((_, i) => i !== idx));
  };

  const handleEditChunk = (id: string, text: string) => {
    setBlocks(prev => prev.map(b => ({
      ...b, lines: b.lines.map((l: any) => ({
        ...l, chunks: l.chunks.map((c: any) => c.id === id ? { ...c, text } : c)
      }))
    })));
  };

  const handleTimeChange = (idx: number, newTime: number) => {
    setBlocks(prev => prev.map((b, i) => i === idx ? { ...b, timeMs: newTime } : b));
  };

  const handleAddLine = (idx: number) => {
    addHistory(blocks);
    setBlocks(prev => prev.map((b, i) => {
      if (i !== idx) return b;
      return {
        ...b, lines: [...b.lines, { chunks: [{ id: uid(), text: 'New Line', timeMs: b.timeMs, isLineHead: true }] }]
      };
    }));
  };

  const handleExecuteDrop = (targetBlockIdx: number, targetLineIdx: number, targetChunkIdx: number) => {
    if (!isDraggingChunk) return;
    addHistory(blocks);
    
    // 現在の場所から削除
    let draggedChunkData: any = null;
    let nextBlocks = blocks.map(b => ({
      ...b, lines: b.lines.map((l: any) => {
        const idx = l.chunks.findIndex((c: any) => c.id === isDraggingChunk);
        if (idx !== -1) {
          draggedChunkData = { ...l.chunks[idx] };
          return { ...l, chunks: l.chunks.filter((c: any) => c.id !== isDraggingChunk) };
        }
        return l;
      }).filter((l: any) => l.chunks.length > 0)
    })).filter(b => b.lines.length > 0);

    if (!draggedChunkData) return;

    // 新しい場所に挿入
    const targetBlock = nextBlocks[targetBlockIdx];
    if (!targetBlock) return;

    if (targetLineIdx >= targetBlock.lines.length) {
      // 新しい行として追加
      targetBlock.lines.push({ chunks: [draggedChunkData] });
    } else {
      // 既存の行に挿入
      targetBlock.lines[targetLineIdx].chunks.splice(targetChunkIdx, 0, draggedChunkData);
    }

    setBlocks(nextBlocks);
    setIsDraggingChunk(null);
  };

  return (
    <div className="flex flex-col w-full h-full bg-rose-50/30 shadow-2xl overflow-hidden border border-white animate-in zoom-in-95 duration-500">
      <EditorToolbar 
        onSave={handleSave} onClose={onClose} onShowHistory={() => setShowHistory(!showHistory)} 
        showHistory={showHistory} canSave={!isSaving && !!initialId}
        onSearchLyrics={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(initialData?.title || '')}+歌詞`, '_blank')}
        isPlaying={isPlaying} onTogglePlay={togglePlay} currentTime={currentTime}
      />

      <div className="flex flex-1 min-h-0 relative">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-shrink-0 bg-black flex items-center justify-center p-2">
            <div id="editor-youtube-player" className="shadow-lg border-4 border-zinc-800" />
          </div>

          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4 custom-scrollbar">
            {blocks.map((b, bi) => (
              <BlockItem 
                key={b.id || bi} block={b} blockIdx={bi} currentTime={currentTime}
                isDraggingChunk={isDraggingChunk} setIsDraggingChunk={setIsDraggingChunk}
                onExecuteDrop={handleExecuteDrop} onDeleteBlock={handleDeleteBlock}
                onEditChunk={handleEditChunk} onTimeChange={handleTimeChange} onAddLine={handleAddLine}
              />
            ))}
          </div>
        </div>

        {showHistory && (
          <HistorySidebar 
            history={history} onRestore={(histBlocks) => { addHistory(blocks); setBlocks(histBlocks); }} 
            onClear={clearHistory} 
          />
        )}
      </div>
    </div>
  );
};