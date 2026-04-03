import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ParseResult, ParsedLine, DisplaySet, splitYomi, toChunks, buildDisplayLines, buildDisplaySets } from '../services/api';
import { saveMapDataToCache } from '../services/sync';
import { getGlobalRebuildRules, saveGlobalRebuildRules } from '../services/globalConfig';

// ============================================================
// 蝙句ｮ夂ｾｩ
// ============================================================
interface MapEditorProps {
  onClose: () => void;
  onSaved?: (mapId: string) => void;
  initialData?: ParseResult | null;
  initialId?: string | null;
  volume?: number;
}

interface EditableChunk { id: string; text: string; timeMs: number; isLineHead?: boolean; }
interface EditableLine { id: string; timeMs: number; chunks: EditableChunk[]; }
interface EditableBlock { id: string; timeMs: number; lines: EditableLine[]; }
interface DropTarget { blockId: string; lineId: string; insertBeforeChunkId: string | null; isBetweenLines?: boolean; insertBeforeLineIdx?: number; }

interface RegenHistoryEntry {
  id: string;
  timestamp: number;
  params: { min: number; max: number; lineMaxChars: number; setMaxLines: number; protectedWords?: string; separatedWords?: string };
  blocks: EditableBlock[];
}

interface ValidationError {
  severity: 'error' | 'warning';
  location: string;
  message: string;
}

// ============================================================
// 繝ｦ繝ｼ繝・ぅ繝ｪ繝・ぅ
// ============================================================
let _cnt = 0;
const uid = () => `${++_cnt}-${Math.random().toString(36).slice(2, 5)}`;

// 繝悶Ο繝・け髢薙・謖ｿ蜈･繝懊ち繝ｳ蜈ｼ繝峨Ο繝・・繧ｾ繝ｼ繝ｳ
const InsertBlockButton: React.FC<{
  onClick: () => void;
  currentTimeMs: number;
  isDropTarget: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}> = ({ onClick, currentTimeMs, isDropTarget, onDragOver, onDragLeave, onDrop }) => (
  <div
    className="flex items-center gap-2 px-2 py-1 group transition-colors"
    style={{ background: isDropTarget ? '#d1fae5' : 'transparent' }}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
  >
    <div className={`flex-1 h-px transition-colors ${isDropTarget ? 'bg-green-400' : 'bg-zinc-200 group-hover:bg-green-400'}`} />
    {isDropTarget ? (
      <span className="text-[9px] font-black text-green-600 px-2 py-0.5 border border-green-400 bg-green-50 whitespace-nowrap">
        縺薙％縺ｫ繝峨Ο繝・・
      </span>
    ) : (
      <button
        onClick={onClick}
        className="text-[9px] font-black text-zinc-400 hover:text-green-400 hover:bg-zinc-100 px-2 py-0.5 border border-dashed border-zinc-300 hover:border-green-400 transition-colors whitespace-nowrap"
      >
        + BLOCK ({currentTimeMs}ms)
      </button>
    )}
    <div className={`flex-1 h-px transition-colors ${isDropTarget ? 'bg-green-400' : 'bg-zinc-200 group-hover:bg-green-400'}`} />
  </div>
);

// ============================================================
// 繝輔Ο繝ｼ繝・ぅ繝ｳ繧ｰ蜈・ョ繝ｼ繧ｿ繧ｦ繧｣繝ｳ繝峨え
// ============================================================
const RawDataWindow: React.FC<{
  rawLines: RawApiLine[];
  scrollRef: React.RefObject<HTMLDivElement>;
  onClose: () => void;
}> = ({ rawLines, scrollRef, onClose }) => {
  const [pos, setPos] = useState({ x: 40, y: 80 });
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, wx: 0, wy: 0 });

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, wx: pos.x, wy: pos.y };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({
        x: dragStart.current.wx + e.clientX - dragStart.current.mx,
        y: dragStart.current.wy + e.clientY - dragStart.current.my,
      });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // end陦後ｒ髯､縺・  const filtered = rawLines.filter(l => !(l.lyrics === 'end' && !l.word?.trim()));

  return createPortal(
    <div
      style={{
        position: 'fixed', left: pos.x, top: pos.y,
        width: 460, maxHeight: '65vh',
        zIndex: 9999,
        display: 'flex', flexDirection: 'column',
        background: '#18181b', border: '1px solid #52525b',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}
    >
      {/* 繧ｿ繧､繝医Ν繝舌・・医ラ繝ｩ繝・げ蜿ｯ閭ｽ・・*/}
      <div
        onMouseDown={onMouseDown}
        style={{ cursor: 'grab', userSelect: 'none' }}
        className="flex items-center justify-between px-3 py-2 bg-zinc-800 border-b border-zinc-700 flex-shrink-0"
      >
        <span className="text-[10px] font-black text-zinc-300 uppercase tracking-widest">
          蜈・ョ繝ｼ繧ｿ 窶・{filtered.length} 陦・        </span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 font-black text-sm leading-none">笨・/button>
      </div>
      {/* 陦後Μ繧ｹ繝・*/}
      <div ref={scrollRef} className="overflow-y-auto flex-1 p-2 flex flex-col gap-1">
        {filtered.map((line, i) => (
          <div
            key={i}
            data-line-idx={i}
            className="flex items-start gap-3 px-2 py-1.5 hover:bg-zinc-800 rounded transition-colors"
          >
            <span className="font-mono text-[12px] text-green-400 tabular-nums flex-shrink-0 w-24 pt-0.5">
              {Math.round(parseFloat(line.time) * 1000)}ms
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] text-zinc-200 leading-tight font-bold">
                {line.word || <span className="text-zinc-600 italic text-[12px]">・育ｩｺ陦鯉ｼ・/span>}
              </span>
              {line.lyrics && (
                <span className="text-[11px] text-zinc-500 leading-tight">{line.lyrics}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
};
type RawApiLine = { time: string; lyrics: string; word: string };
const SESSION_KEY = (id: string) => `regen_raw_${id}`;
const getRawCache = (id: string): RawApiLine[] | null => { try { const v = sessionStorage.getItem(SESSION_KEY(id)); return v ? JSON.parse(v) : null; } catch { return null; } };
const setRawCache = (id: string, d: RawApiLine[]) => { try { sessionStorage.setItem(SESSION_KEY(id), JSON.stringify(d)); } catch { } };

// localStorage: 蜀咲函謌仙ｱ･豁ｴ
const LS_KEY = (id: string) => `regen_history_${id}`;
const MAX_HIST = 20;
const loadHistory = (id: string): RegenHistoryEntry[] => { try { const v = localStorage.getItem(LS_KEY(id)); return v ? JSON.parse(v) : []; } catch { return []; } };
const saveHistory = (id: string, entries: RegenHistoryEntry[]) => { try { localStorage.setItem(LS_KEY(id), JSON.stringify(entries.slice(0, MAX_HIST))); } catch { } };

// ============================================================
// 繝・・繧ｿ螟画鋤
// ============================================================
const toEditable = (data: ParseResult): EditableBlock[] =>
  (data.displaySets || []).map(set => ({
    id: uid(), timeMs: set.timeMs,
    lines: set.lines.map(line => ({
      id: uid(), timeMs: line.timeMs,
      chunks: line.chunks.map(c => ({ id: uid(), text: c.text, timeMs: c.timeMs, isLineHead: c.isLineHead })),
    })),
  }));

const buildResult = (blocks: EditableBlock[], title: string, artist: string, videoId: string, endTimeMs: number): ParseResult => {
  let g = 0;
  const displaySets: DisplaySet[] = blocks.map(b => ({
    timeMs: b.timeMs,
    lines: b.lines.map(l => {
      const absIdx = g++;
      return {
        timeMs: b.timeMs,
        absLineIdx: absIdx,
        chunks: l.chunks.map((c) => ({
          text: c.text,
          timeMs: c.timeMs, // 繝悶Ο繝・け蜈ｨ菴薙・譎る俣縺ｧ縺ｯ縺ｪ縺上∝腰隱槭′謖√▽譛ｬ譚･縺ｮ譎る俣繧剃ｿ晄戟縺吶ｋ
          isLineHead: c.isLineHead || false,
          absLineIdx: absIdx
        })),
      };
    }),
  }));
  const lines: ParsedLine[] = displaySets.flatMap(s =>
    s.lines.map(l => ({
      timeMs: l.timeMs,
      lyrics: l.chunks.map(c => c.text).join(''),
      rawWord: l.chunks.map(c => c.text).join(''),
      words: l.chunks.map(c => c.text),
      isEnd: false, absLineIdx: l.absLineIdx,
    }))
  );
  if (lines.length > 0) lines.push({ timeMs: endTimeMs, lyrics: 'end', rawWord: '', words: [], isEnd: true, absLineIdx: lines.length });
  return { lines, displaySets, title, artist, videoId };
};

// ============================================================
// 繝舌Μ繝・・繧ｷ繝ｧ繝ｳ
// ============================================================
const validateParseResult = (data: ParseResult): ValidationError[] => {
  const errors: ValidationError[] = [];
  let prev = -1;
  data.displaySets.forEach((set, si) => {
    set.lines.forEach((line, li) => {
      const loc = `SET ${si + 1} / LINE ${li + 1}`;
      if (line.absLineIdx <= prev)
        errors.push({ severity: 'error', location: loc, message: `absLineIdx=${line.absLineIdx} 縺後げ繝ｭ繝ｼ繝舌Ν騾｣逡ｪ縺ｫ縺ｪ縺｣縺ｦ縺・∪縺帙ｓ・亥燕縺ｮ蛟､: ${prev}・荏 });
      prev = line.absLineIdx;
      line.chunks.forEach((chunk, ci) => {
        const cloc = `${loc} / CHUNK ${ci + 1}`;
        if (chunk.absLineIdx !== line.absLineIdx)
          errors.push({ severity: 'error', location: cloc, message: `chunk.absLineIdx=${chunk.absLineIdx} 縺・line.absLineIdx=${line.absLineIdx} 縺ｨ荳堺ｸ閾ｴ` });
        if (chunk.timeMs === 0 && !(si === 0 && li === 0))
          errors.push({ severity: 'warning', location: cloc, message: `timeMs 縺・0 縺ｧ縺呻ｼ医・{chunk.text}縲搾ｼ荏 });
      });
      if (line.timeMs === 0 && !(si === 0 && li === 0))
        errors.push({ severity: 'warning', location: loc, message: `line.timeMs 縺・0 縺ｧ縺兪 });
    });
  });
  const idxSet = new Set(data.lines.filter(l => !l.isEnd).map(l => l.absLineIdx));
  data.displaySets.forEach((set, si) => {
    set.lines.forEach((line, li) => {
      if (!idxSet.has(line.absLineIdx))
        errors.push({ severity: 'error', location: `SET ${si + 1} / LINE ${li + 1}`, message: `absLineIdx=${line.absLineIdx} 縺・lines 驟榊・縺ｫ蟄伜惠縺励∪縺帙ｓ` });
    });
  });
  return errors;
};

// ============================================================
// 繧ｳ繝ｳ繝昴・繝阪Φ繝・// ============================================================
export const MapEditor: React.FC<MapEditorProps> = ({ onClose, onSaved, initialData, initialId, volume = 50 }) => {
  const [title, setTitle] = useState(initialData?.title || '');
  const [artist, setArtist] = useState(initialData?.artist || '');
  const [videoId, setVideoId] = useState(initialData?.videoId || '');
  const [localMapId, setLocalMapId] = useState(() => initialId || `local-${Math.random().toString(36).slice(2, 8)}`);
  const [blocks, setBlocks] = useState<EditableBlock[]>(() => initialData ? toEditable(initialData) : []);
  const [endTimeMs, setEndTimeMs] = useState<number>(() => {
    const endLine = initialData?.lines?.find(l => l.isEnd);
    return endLine ? endLine.timeMs : 0;
  });

  // 邱ｨ髮・憾諷・  const [editingChunkId, setEditingChunkId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingBlockTimeId, setEditingBlockTimeId] = useState<string | null>(null);
  const [editingLineTimeId, setEditingLineTimeId] = useState<string | null>(null);
  const [editingTimeValue, setEditingTimeValue] = useState('');

  // 繝峨Λ繝・げ
  const dragRef = useRef<{ chunk: EditableChunk; fromLineId: string } | null>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeDropTarget, setActiveDropTarget] = useState<DropTarget | null>(null);

  // 蜀咲函謌・  const [regenHistory, setRegenHistory] = useState<RegenHistoryEntry[]>(() => loadHistory(localMapId));
  const [showHistory, setShowHistory] = useState(false);

  const lastParams = regenHistory[0]?.params;
  const [regenMin, setRegenMin] = useState(lastParams?.min ?? 3);
  const [regenMax, setRegenMax] = useState(lastParams?.max ?? 14);
  const [regenLineMaxChars, setRegenLineMaxChars] = useState(lastParams?.lineMaxChars ?? 14);
  const [regenSetMaxLines, setRegenSetMaxLines] = useState(lastParams?.setMaxLines ?? 4);
  const [regenProtectedInput, setRegenProtectedInput] = useState(lastParams?.protectedWords ?? '');
  const [regenSeparatedInput, setRegenSeparatedInput] = useState(lastParams?.separatedWords ?? '');
  const [isRegenerating, setIsRegenerating] = useState(false);

  // 蜈ｱ譛芽ｨｭ螳・(Firestore)
  const [globalProtectedInput, setGlobalProtectedInput] = useState('');
  const [globalSeparatedInput, setGlobalSeparatedInput] = useState('');
  const [useGlobalRules, setUseGlobalRules] = useState(true);

  // 菫晏ｭ倥・繝舌Μ繝・・繧ｷ繝ｧ繝ｳ
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [showValidation, setShowValidation] = useState(false);

  // 蜍慕判繝励Ξ繧､繝､繝ｼ
  const playerRef = useRef<any>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  // ---- 邱ｨ髮・nput閾ｪ蜍輔ヵ繧ｩ繝ｼ繧ｫ繧ｹ ----
  useEffect(() => {
    if (editingChunkId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingChunkId]);

  // ---- 蜈ｱ譛芽ｨｭ螳壹・蜿門ｾ・----
  useEffect(() => {
    getGlobalRebuildRules().then(rules => {
      if (rules) {
        setGlobalProtectedInput(rules.protectedWords || '');
        setGlobalSeparatedInput(rules.separatedWords || '');
      }
    });
  }, []);

  // ---- YouTube Player 蛻晄悄蛹・----
  // playerDivRef 縺檎｢ｺ螳溘↓蟄伜惠縺励※縺九ｉ蛻晄悄蛹悶☆繧九◆繧・useCallback + useEffect 縺ｧ邂｡逅・  const initPlayer = useCallback(() => {
    if (!playerDivRef.current) return;
    if (!(window as any).YT?.Player) return;
    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch (_) { }
      playerRef.current = null;
    }
    playerRef.current = new (window as any).YT.Player(playerDivRef.current, {
      videoId,
      playerVars: { autoplay: 0, modestbranding: 1, rel: 0, origin: window.location.origin },
      events: {
        onReady: (e: any) => { playerRef.current = e.target; try { e.target.setVolume(volume); } catch (_) { } },
        onStateChange: (e: any) => { setIsPlaying(e.data === 1); },
      },
    });
  }, [videoId, volume]);

  // volume螟画峩譎ゅ↓繝励Ξ繧､繝､繝ｼ縺ｫ蜿肴丐
  useEffect(() => {
    try { if (playerRef.current?.setVolume) playerRef.current.setVolume(volume); } catch (_) { }
  }, [volume]);

  useEffect(() => {
    if (!videoId) return;

    // YT API 縺後☆縺ｧ縺ｫ隱ｭ縺ｿ霎ｼ縺ｾ繧後※縺・ｌ縺ｰ蜊ｳ蛻晄悄蛹・    if ((window as any).YT?.Player) {
      initPlayer();
    } else {
      // 隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ or 譛ｪ繝ｭ繝ｼ繝・      const prev = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        initPlayer();
        if (prev) prev();
      };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(s);
      }
    }

    const iv = setInterval(() => {
      try {
        if (playerRef.current?.getCurrentTime) {
          setCurrentTime(playerRef.current.getCurrentTime());
          setIsPlaying(playerRef.current.getPlayerState() === 1);
        }
      } catch (_) { }
    }, 100);

    return () => {
      clearInterval(iv);
      try { playerRef.current?.destroy(); } catch (_) { }
      playerRef.current = null;
    };
  }, [videoId, initPlayer]);

  // ---- 繝√Ε繝ｳ繧ｯ邱ｨ髮・----
  const commitEdit = () => {
    if (!editingChunkId) return;
    const id = editingChunkId;
    const txt = editingText.trim();
    if (txt === '') { setEditingChunkId(null); return; }

    // 繧ｹ繝壹・繧ｹ・亥・隗偵・蜊願ｧ抵ｼ峨〒蛻・牡
    const parts = txt.split(/[\s縲]+/).filter(p => p.length > 0);
    
    setBlocks(prev => prev.map(b => ({
      ...b, lines: b.lines.map(l => {
        const idx = l.chunks.findIndex(c => c.id === id);
        if (idx === -1) return l;
        
        const original = l.chunks[idx];
        const newChunks = parts.map((p, pidx) => ({
          id: pidx === 0 ? id : uid(), // 譛蛻昴・荳縺､莉･螟悶・譁ｰ縺励＞ID繧堤匱陦・          text: p,
          timeMs: original.timeMs,
          isLineHead: pidx === 0 ? original.isLineHead : false // 蜈磯ｭ繝輔Λ繧ｰ縺ｯ譛蛻昴・荳縺､縺縺醍ｶ呎価
        }));

        const nextChunks = [...l.chunks];
        nextChunks.splice(idx, 1, ...newChunks);
        return { ...l, chunks: nextChunks };
      })
    })));
    setEditingChunkId(null);
  };

  const delChunk = (bid: string, lid: string, cid: string) =>
    setBlocks(p => p.map(b => b.id !== bid ? b : {
      ...b, lines: b.lines.map(l => l.id !== lid ? l : { ...l, chunks: l.chunks.filter(c => c.id !== cid) }).filter(l => l.chunks.length > 0)
    }));

  const addChunk = (bid: string, lid: string) =>
    setBlocks(p => p.map(b => b.id !== bid ? b : {
      ...b, lines: b.lines.map(l => l.id !== lid ? l : { ...l, chunks: [...l.chunks, { id: uid(), text: '繝・く繧ｹ繝・, timeMs: l.timeMs }] })
    }));

  const mergeChunkBackward = (bid: string, lid: string, cid: string) => {
    setBlocks(prevBlocks => prevBlocks.map(block => {
      if (block.id !== bid) return block;

      const newLines: EditableLine[] = [];
      for (let i = 0; i < block.lines.length; i++) {
        const line = block.lines[i];
        if (line.id !== lid) {
          newLines.push(line);
          continue;
        }

        const cidx = line.chunks.findIndex(c => c.id === cid);
        if (cidx > 0) {
          // 蜷御ｸ陦悟・縺ｧ邨仙粋
          const prevC = line.chunks[cidx - 1];
          const currC = line.chunks[cidx];
          const mergedChunk = { ...prevC, text: prevC.text + currC.text };
          const updatedChunks = [...line.chunks];
          updatedChunks.splice(cidx - 1, 2, mergedChunk);
          newLines.push({ ...line, chunks: updatedChunks });
        } else if (i > 0) {
          // 蜑阪・陦後・譛ｫ蟆ｾ縺ｨ邨仙粋
          const lastLine = newLines[newLines.length - 1];
          const lastC = lastLine.chunks[lastLine.chunks.length - 1];
          const currC = line.chunks[0];
          const mergedChunk = { ...lastC, text: lastC.text + currC.text };
          
          const updatedLastLineChunks = [...lastLine.chunks];
          updatedLastLineChunks.splice(updatedLastLineChunks.length - 1, 1, mergedChunk);
          newLines[newLines.length - 1] = { ...lastLine, chunks: updatedLastLineChunks };

          const remainingChunks = line.chunks.slice(1);
          if (remainingChunks.length > 0) {
            newLines.push({ ...line, chunks: remainingChunks });
          }
        } else {
          newLines.push(line);
        }
      }
      return { ...block, lines: newLines };
    }));
  };

  const mergeChunkForward = (bid: string, lid: string, cid: string) => {
    setBlocks(prevBlocks => prevBlocks.map(block => {
      if (block.id !== bid) return block;

      const targetLidx = block.lines.findIndex(l => l.id === lid);
      if (targetLidx === -1) return block;
      const line = block.lines[targetLidx];
      const cidx = line.chunks.findIndex(c => c.id === cid);
      if (cidx === -1) return block;

      const newLines = [...block.lines];
      if (cidx < line.chunks.length - 1) {
        // 蜷御ｸ陦悟・
        const currC = line.chunks[cidx];
        const nextC = line.chunks[cidx + 1];
        const mergedChunk = { ...currC, text: currC.text + nextC.text };
        const updatedChunks = [...line.chunks];
        updatedChunks.splice(cidx, 2, mergedChunk);
        newLines[targetLidx] = { ...line, chunks: updatedChunks };
      } else if (targetLidx < block.lines.length - 1) {
        // 谺｡縺ｮ陦後・鬆ｭ縺ｨ邨仙粋
        const nextLine = block.lines[targetLidx + 1];
        const currC = line.chunks[cidx];
        const nextC = nextLine.chunks[0];
        const mergedChunk = { ...currC, text: currC.text + nextC.text };

        const updatedNextLineChunks = [...nextLine.chunks];
        updatedNextLineChunks.splice(0, 1, mergedChunk);
        newLines[targetLidx + 1] = { ...nextLine, chunks: updatedNextLineChunks };

        const currentRemaining = line.chunks.slice(0, -1);
        if (currentRemaining.length > 0) {
          newLines[targetLidx] = { ...line, chunks: currentRemaining };
        } else {
          newLines.splice(targetLidx, 1);
        }
      } else {
        // 繝悶Ο繝・け蜀・・譛蠕後・陦後√°縺､譛蠕後・蜊倩ｪ槭・蝣ｴ蜷・-> 譁ｰ縺励＞陦後ｒ蠅励ｄ縺励※遘ｻ蜍・        const currC = line.chunks[cidx];
        const currentRemaining = line.chunks.slice(0, -1);
        const newLine: EditableLine = { id: uid(), timeMs: line.timeMs, chunks: [{ ...currC, id: uid() }] };

        if (currentRemaining.length > 0) {
          // 蜈・・陦後・谿九ｊ縲∵眠縺励￥陦後ｒ霑ｽ蜉
          newLines[targetLidx] = { ...line, chunks: currentRemaining };
          newLines.push(newLine);
        } else {
          // 蜈・・陦後↓1隱槭＠縺九↑縺九▲縺溷ｴ蜷医・縲√◎縺ｮ陦後＃縺ｨ縺昴・縺ｾ縺ｾ縺縺栗D縺縺大､峨∴繧具ｼ亥ｮ溯ｳｪ菴輔ｂ縺励↑縺・・縺ｨ霑代＞縺悟ｮ溯｣・ｸ翫・騾壹☆・・          newLines[targetLidx] = newLine;
        }
      }
      return { ...block, lines: newLines };
    }));
  };

  const addLine = (bid: string) => {
    const block = blocks.find(b => b.id === bid);
    const t = block ? block.timeMs : Math.floor(currentTime * 1000);
    setBlocks(p => p.map(b => b.id !== bid ? b : {
      ...b, lines: [...b.lines, { id: uid(), timeMs: t, chunks: [{ id: uid(), text: '繝・く繧ｹ繝・, timeMs: t }] }]
    }));
  };

  const splitBlock = (bid: string, lid: string) => {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === bid);
      if (idx === -1) return prev;
      const b = prev[idx];
      const lidx = b.lines.findIndex(l => l.id === lid);
      if (lidx === -1) return prev;

      // 迴ｾ蝨ｨ縺ｮ陦・(lid) 縺九ｉ谺｡縺ｮ髱偵＞蜊倩ｪ槭′蟋九∪繧玖｡後・逶ｴ蜑阪∪縺ｧ繧・1 縺､縺ｮ繝悶Ο繝・け縺ｫ縺吶ｋ
      let nextBlueLidx = b.lines.length;
      for (let i = lidx + 1; i < b.lines.length; i++) {
        if (b.lines[i].chunks.length > 0 && b.lines[i].chunks[0].isLineHead) {
          nextBlueLidx = i;
          break;
        }
      }

      const resultBlocks: EditableBlock[] = [];

      // 1. 謖・ｮ壻ｽ咲ｽｮ繧医ｊ蜑阪・陦・      if (lidx > 0) {
        const linesA = b.lines.slice(0, lidx);
        const timeA = linesA[0].chunks[0]?.timeMs ?? b.timeMs;
        resultBlocks.push({
          id: uid(),
          timeMs: timeA,
          lines: linesA.map(l => ({
            ...l, id: uid(), timeMs: timeA,
            chunks: l.chunks.map(c => ({ ...c, id: uid(), timeMs: timeA }))
          }))
        });
      }

      // 2. 謖・ｮ壻ｽ咲ｽｮ縺九ｉ谺｡縺ｮ髱偵＞蜊倩ｪ槭・謇句燕縺ｾ縺ｧ
      const linesB = b.lines.slice(lidx, nextBlueLidx);
      const timeB = linesB[0].chunks[0]?.timeMs ?? b.timeMs;
      resultBlocks.push({
        id: uid(),
        timeMs: timeB,
        lines: linesB.map(l => ({
          ...l, id: uid(), timeMs: timeB,
          chunks: l.chunks.map(c => ({ ...c, id: uid(), timeMs: timeB }))
        }))
      });

      // 3. 谺｡縺ｮ髱偵＞蜊倩ｪ樔ｻ･髯・      if (nextBlueLidx < b.lines.length) {
        const linesC = b.lines.slice(nextBlueLidx);
        const timeC = linesC[0].chunks[0]?.timeMs ?? b.timeMs;
        resultBlocks.push({
          id: uid(),
          timeMs: timeC,
          lines: linesC.map(l => ({
            ...l, id: uid(), timeMs: timeC,
            chunks: l.chunks.map(c => ({ ...c, id: uid(), timeMs: timeC }))
          }))
        });
      }

      const res = [...prev];
      res.splice(idx, 1, ...resultBlocks);
      return res;
    });
  };

  const delBlock = (bid: string) => {
    if (!window.confirm('縺薙・繝悶Ο繝・け繧貞炎髯､縺励∪縺吶°・・)) return;
    setBlocks(p => p.filter(b => b.id !== bid));
  };

  const commitBlockTime = (bid: string) => {
    const v = parseInt(editingTimeValue);
    if (!isNaN(v)) setBlocks(p => p.map(b => b.id === bid ? { ...b, timeMs: v } : b));
    setEditingBlockTimeId(null);
  };

  const commitLineTime = (bid: string, lid: string) => {
    const v = parseInt(editingTimeValue);
    if (!isNaN(v)) setBlocks(p => p.map(b => b.id !== bid ? b : {
      ...b, lines: b.lines.map(l => l.id !== lid ? l : { ...l, timeMs: v, chunks: l.chunks.map(c => ({ ...c, timeMs: v })) })
    }));
    setEditingLineTimeId(null);
  };

  // ---- 繝峨Ο繝・・ ----
  const executeDrop = () => {
    const drag = dragRef.current;
    const drop = dropRef.current;
    if (!drag || !drop) return;
    const { chunk, fromLineId } = drag;
    const { blockId: toBid, lineId: toLid, insertBeforeChunkId, isBetweenLines, insertBeforeLineIdx } = drop;
    setBlocks(prev => {
      let moved: EditableChunk | null = null;
      let next = prev.map(b => ({
        ...b, lines: b.lines.map(l => {
          if (l.id !== fromLineId) return l;
          const idx = l.chunks.findIndex(c => c.id === chunk.id);
          if (idx === -1) return l;
          moved = { ...l.chunks[idx] };
          return { ...l, chunks: l.chunks.filter(c => c.id !== chunk.id) };
        }).filter(l => l.chunks.length > 0)
      }));
      if (!moved) return prev;
      const mc = moved as EditableChunk;
      next = next.map(b => {
        if (b.id !== toBid) return b;

        if (isBetweenLines && insertBeforeLineIdx !== undefined) {
          const newLine: EditableLine = { id: uid(), timeMs: mc.timeMs, chunks: [{ ...mc }] };
          const newLines = [...b.lines];
          newLines.splice(insertBeforeLineIdx, 0, newLine);
          return { ...b, lines: newLines };
        }

        const tl = b.lines.find(l => l.id === toLid);
        if (!tl) return { ...b, lines: [...b.lines, { id: toLid, timeMs: mc.timeMs, chunks: [{ ...mc }] }] };
        return {
          ...b, lines: b.lines.map(l => {
            if (l.id !== toLid) return l;
            const nc = { ...mc, timeMs: l.timeMs };
            if (insertBeforeChunkId === null) return { ...l, chunks: [...l.chunks, nc] };
            const idx = l.chunks.findIndex(c => c.id === insertBeforeChunkId);
            if (idx === -1) return { ...l, chunks: [...l.chunks, nc] };
            const arr = [...l.chunks]; arr.splice(idx, 0, nc);
            return { ...l, chunks: arr };
          })
        };
      });
      return next;
    });
    dragRef.current = null; dropRef.current = null;
    setIsDragging(false); setActiveDropTarget(null);
  };

  // ---- 蜀咲函謌・----
  const handleRegenerate = async () => {
    if (!videoId) { alert('Video ID縺後≠繧翫∪縺帙ｓ縲・); return; }
    setIsRegenerating(true);
    try {
      // 繧ｭ繝｣繝・す繝･繧堤┌隕悶＠縺ｦ譛譁ｰ縺ｮ繝・・繧ｿ繧貞叙蠕・      const res = await fetch(`https://ytyping.net/api/maps/${localMapId}/json`);
      if (!res.ok) throw new Error('蜈・ョ繝ｼ繧ｿ繧貞叙蠕励〒縺阪∪縺帙ｓ縺ｧ縺励◆');
      const rawData = await res.json() as RawApiLine[];
      setRawCache(localMapId, rawData);
      
      const localPw = regenProtectedInput.split(/[,・後―s\n]+/).filter(s => s.trim().length > 0);
      const globalPw = useGlobalRules ? globalProtectedInput.split(/[,・後―s\n]+/).filter(s => s.trim().length > 0) : [];
      const pwList = [...new Set([...localPw, ...globalPw])];

      const localSw = regenSeparatedInput.split(/[,・後―s\n]+/).filter(s => s.trim().length > 0);
      const globalSw = useGlobalRules ? globalSeparatedInput.split(/[,・後―s\n]+/).filter(s => s.trim().length > 0) : [];
      const swList = [...new Set([...localSw, ...globalSw])];

      const parsedLines: ParsedLine[] = await Promise.all(
        rawData.map(async (line, index) => {
          const tms = parseFloat(line.time) * 1000;
          return {
            timeMs: tms,
            lyrics: line.lyrics,
            words: await splitYomi(line.lyrics, line.word, regenMin, regenMax, pwList, swList),
            rawWord: line.word,
            isEnd: index === rawData!.length - 1 && line.lyrics === 'end' && (!line.word || line.word.trim() === ''),
            absLineIdx: index,
          };
        })
      );

      const filteredLines = parsedLines.filter(l => !l.isEnd);
      const chunks = toChunks(filteredLines);
      const displayLines = buildDisplayLines(chunks, regenLineMaxChars);
      const newSets = buildDisplaySets(displayLines, regenSetMaxLines);

      for (const set of newSets) {
        // 繧ｻ繝・ヨ・・LOCK・芽・菴薙・譎る俣縺ｯ縺昴・1陦檎岼縺ｮ譎る俣縺ｫ縺吶ｋ
        const setTimeMs = set.lines[0]?.chunks[0]?.timeMs ?? 0;
        set.timeMs = setTimeMs;
        for (const line of set.lines) {
          // 蜷・｡瑚・霄ｫ縺ｮ譎る俣繧偵√◎縺ｮ陦後・蜈磯ｭ蜊倩ｪ槭・譛ｬ譚･縺ｮ譎る俣縺ｫ縲悟句挨縺ｫ縲榊粋繧上○繧・          const lineHeadTime = line.chunks[0]?.timeMs ?? setTimeMs;
          line.timeMs = lineHeadTime;
          // 蜷・メ繝｣繧ｦ繝ｳ繧ｯ縺ｮ timeMs 繧ゅ∝・縺ｮ繧ｿ繧､繝溘Φ繧ｰ繧剃ｿ晄戟縺吶ｋ
          for (const c of line.chunks) {
            if (c.timeMs === 0) c.timeMs = lineHeadTime;
          }
        }
      }
      const newBlocks = toEditable({ lines: parsedLines, displaySets: newSets });
      setBlocks(newBlocks);
      const entry: RegenHistoryEntry = {
        id: uid(), timestamp: Date.now(),
        params: { min: regenMin, max: regenMax, lineMaxChars: regenLineMaxChars, setMaxLines: regenSetMaxLines, protectedWords: regenProtectedInput, separatedWords: regenSeparatedInput },
        blocks: newBlocks,
      };
      const updated = [entry, ...regenHistory].slice(0, MAX_HIST);
      setRegenHistory(updated);
      saveHistory(localMapId, updated);
    } catch (e) { console.error(e); alert('蜀咲函謌舌↓螟ｱ謨励＠縺ｾ縺励◆縲・); }
    finally {
      setIsRegenerating(false);
    }
  };

  const handleSaveGlobalRules = async () => {
    if (!window.confirm('迴ｾ蝨ｨ縺ｮ蜈ｱ譛芽ｨｭ螳壹ｒFirestore縺ｫ菫晏ｭ倥＠縺ｾ縺吶°・滂ｼ亥・隴憺擇縺ｧ蜈ｱ譛峨＆繧後∪縺呻ｼ・)) return;
    try {
      await saveGlobalRebuildRules({
        protectedWords: globalProtectedInput,
        separatedWords: globalSeparatedInput
      });
      alert('蜈ｱ譛芽ｨｭ螳壹ｒ菫晏ｭ倥＠縺ｾ縺励◆');
    } catch (e) {
      alert('蜈ｱ譛芽ｨｭ螳壹・菫晏ｭ倥↓螟ｱ謨励＠縺ｾ縺励◆');
    }
  };

  const restoreFromHistory = (entry: RegenHistoryEntry) => {
    setBlocks(entry.blocks);
    setRegenMin(entry.params.min); setRegenMax(entry.params.max);
    setRegenLineMaxChars(entry.params.lineMaxChars); setRegenSetMaxLines(entry.params.setMaxLines);
    setRegenProtectedInput(entry.params.protectedWords || '');
    setRegenSeparatedInput(entry.params.separatedWords || '');
    setShowHistory(false);
  };

  // ---- 繝舌Μ繝・・繧ｷ繝ｧ繝ｳ繝ｻ菫晏ｭ・----
  const handleValidate = () => {
    const errs = validateParseResult(buildResult(blocks, title, artist, videoId, endTimeMs));
    setValidationErrors(errs); setShowValidation(true);
  };

  const handleSave = async () => {
    const result = buildResult(blocks, title, artist, videoId, endTimeMs);
    const errs = validateParseResult(result);
    setValidationErrors(errs);
    if (errs.some(e => e.severity === 'error')) {
      setShowValidation(true);
      alert(`笞・・繧ｨ繝ｩ繝ｼ縺・${errs.filter(e => e.severity === 'error').length} 莉ｶ縺ゅｊ縺ｾ縺吶ら｢ｺ隱阪＠縺ｦ縺上□縺輔＞縲Ａ);
      return;
    }
    setIsSaving(true);
    try {
      await saveMapDataToCache(localMapId, result);
      alert(`菫晏ｭ倥＠縺ｾ縺励◆・・ID: ${localMapId}`);
      onSaved?.(localMapId);
    } catch { alert('菫晏ｭ倥↓螟ｱ謨励＠縺ｾ縺励◆'); }
    finally { setIsSaving(false); }
  };

  // ---- DropZone ----
  const renderDropZone = (blockId: string, lineId: string, insertBeforeChunkId: string | null) => {
    if (!isDragging) return null;
    const isActive =
      activeDropTarget?.blockId === blockId &&
      activeDropTarget?.lineId === lineId &&
      activeDropTarget?.insertBeforeChunkId === insertBeforeChunkId;
    return (
      <div
        onDragEnter={e => e.preventDefault()}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); const t = { blockId, lineId, insertBeforeChunkId }; dropRef.current = t; setActiveDropTarget(t); }}
        onDragLeave={() => { dropRef.current = null; setActiveDropTarget(null); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); executeDrop(); }}
        style={{
          width: isActive ? '20px' : '8px', minHeight: '32px',
          background: isActive ? '#fb7185' : '#3f3f46',
          borderRadius: '3px', flexShrink: 0,
          transition: 'width 0.1s, background 0.1s', cursor: 'copy',
        }}
      />
    );
  };

  const renderLineDropZone = (blockId: string, insertBeforeLineIdx: number) => {
    const isActive = isDragging &&
      activeDropTarget?.blockId === blockId &&
      activeDropTarget?.isBetweenLines &&
      activeDropTarget?.insertBeforeLineIdx === insertBeforeLineIdx;

    return (
      <div
        onDragEnter={e => e.preventDefault()}
        onDragOver={e => { 
          if (!isDragging) return;
          e.preventDefault(); e.stopPropagation(); 
          const t: DropTarget = { blockId, lineId: '', insertBeforeChunkId: null, isBetweenLines: true, insertBeforeLineIdx }; 
          dropRef.current = t; setActiveDropTarget(t); 
        }}
        onDragLeave={() => { dropRef.current = null; setActiveDropTarget(null); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); executeDrop(); }}
        className="transition-all duration-150 relative"
        style={{
          height: isActive ? '18px' : '4px',
          margin: isActive ? '2px 0' : '0',
          background: isActive ? '#fb7185' : 'transparent',
          borderRadius: '2px', 
          cursor: isDragging ? 'copy' : 'default', 
          zIndex: 10,
          pointerEvents: isDragging ? 'auto' : 'none'
        }}
      >
        {isActive && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] font-black text-rose-100 uppercase pointer-events-none tracking-widest">+ NEW LINE</span>
          </div>
        )}
      </div>
    );
  };

  // 蜈・ョ繝ｼ繧ｿ繝昴ャ繝励い繝・・
  const [rawPopupLines, setRawPopupLines] = useState<RawApiLine[] | null>(null);
  const rawScrollRef = useRef<HTMLDivElement>(null);

  const openRawPopup = async () => {
    // sessionStorage繧ｭ繝｣繝・す繝･繧貞━蜈・    let raw = getRawCache(localMapId);
    if (!raw) {
      // 縺ｪ縺代ｌ縺ｰAPI縺九ｉ蜿門ｾ励＠縺ｦ繧ｭ繝｣繝・す繝･
      try {
        const res = await fetch(`https://ytyping.net/api/maps/${localMapId}/json`);
        if (res.ok) { raw = await res.json(); setRawCache(localMapId, raw!); }
      } catch (_) { }
    }
    if (raw) setRawPopupLines(raw);
    else alert('蜈・ョ繝ｼ繧ｿ縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆縲ょ・縺ｫREGENERATE繧貞ｮ溯｡後＠縺ｦ縺上□縺輔＞縲・);
  };

  const scrollToNearestLine = (blockTimeMs: number) => {
    if (!rawPopupLines || !rawScrollRef.current) return;
    const lines = rawPopupLines.filter(l => !(l.lyrics === 'end' && !l.word?.trim()));
    let nearestIdx = 0, minDiff = Infinity;
    lines.forEach((line, i) => {
      const diff = Math.abs(parseFloat(line.time) * 1000 - blockTimeMs);
      if (diff < minDiff) { minDiff = diff; nearestIdx = i; }
    });
    const el = rawScrollRef.current.querySelector(`[data-line-idx="${nearestIdx}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // 繝悶Ο繝・け繝峨Λ繝・げ
  const blockDragRef = useRef<{ blockId: string; blockIdx: number } | null>(null);
  const [blockDropIdx, setBlockDropIdx] = useState<number | null>(null);

  // 譁ｰ繝悶Ο繝・け霑ｽ蜉繝｢繝ｼ繝繝ｫ
  const [addBlockModal, setAddBlockModal] = useState<{ insertAfterIdx: number } | null>(null);
  const [addBlockTimeValue, setAddBlockTimeValue] = useState('');

  // ---- 繝悶Ο繝・け繝峨Λ繝・げ ----
  const handleBlockDragStart = (e: React.DragEvent, blockId: string, blockIdx: number) => {
    blockDragRef.current = { blockId, blockIdx };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('block', blockId);
  };

  const handleBlockDrop = (insertAfterIdx: number) => {
    const drag = blockDragRef.current;
    if (!drag) return;
    setBlocks(p => {
      const from = p.findIndex(b => b.id === drag.blockId);
      if (from === -1) return p;
      const next = [...p];
      const [removed] = next.splice(from, 1);
      // from蜑企勁蠕後・insertAfterIdx繧定ｪｿ謨ｴ
      const adjustedIdx = insertAfterIdx >= from ? insertAfterIdx - 1 : insertAfterIdx;
      next.splice(adjustedIdx + 1, 0, removed);
      return next;
    });
    blockDragRef.current = null;
    setBlockDropIdx(null);
  };

  // ---- 譁ｰ繝悶Ο繝・け霑ｽ蜉・医Δ繝ｼ繝繝ｫ邨檎罰・・----
  const openAddBlockModal = (insertAfterIdx: number) => {
    setAddBlockModal({ insertAfterIdx });
    setAddBlockTimeValue(String(Math.floor(currentTime * 1000)));
  };

  const confirmAddBlock = () => {
    if (!addBlockModal) return;
    const t = parseInt(addBlockTimeValue);
    if (isNaN(t)) { alert('豁｣縺励＞繝溘Μ遘偵ｒ蜈･蜉帙＠縺ｦ縺上□縺輔＞'); return; }
    const newBlock: EditableBlock = {
      id: uid(), timeMs: t,
      lines: [{ id: uid(), timeMs: t, chunks: [{ id: uid(), text: '繝・く繧ｹ繝・, timeMs: t }] }],
    };
    setBlocks(p => {
      const next = [...p];
      next.splice(addBlockModal.insertAfterIdx + 1, 0, newBlock);
      return next;
    });
    setAddBlockModal(null);
  };
  const seekTo = (ms: number) => {
    try {
      if (!playerRef.current) return;
      playerRef.current.seekTo(ms / 1000, true);
      // 蜀咲函荳ｭ縺ｮ縺ｨ縺阪□縺大・逕溘ｒ邯咏ｶ壹∝●豁｢荳ｭ縺ｯ繧ｷ繝ｼ繧ｯ縺ｮ縺ｿ
      if (isPlaying) playerRef.current.playVideo();
    } catch (_) { }
  };

  const togglePlay = () => {
    try {
      if (!playerRef.current) return;
      isPlaying ? playerRef.current.pauseVideo() : playerRef.current.playVideo();
    } catch (_) { }
  };

  // 竊・竊・繧ｭ繝ｼ縺ｧ1遘偵せ繧ｭ繝・・・・nput/textarea縺ｫ繝輔か繝ｼ繧ｫ繧ｹ荳ｭ縺ｯ辟｡蜉ｹ・・  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (!playerRef.current?.getCurrentTime) return;
        const current = playerRef.current.getCurrentTime();
        const next = e.key === 'ArrowRight' ? current + 1 : Math.max(0, current - 1);
        playerRef.current.seekTo(next, true);
        if (isPlaying) playerRef.current.playVideo();
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [isPlaying]);

  // ============================================================
  // 繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ
  // ============================================================
  return (
    <div className="bg-white/95 backdrop-blur-md w-full h-full flex flex-col p-4 animate-in fade-in duration-300 shadow-2xl overflow-hidden border-4 border-white">

      {/* 繝倥ャ繝繝ｼ */}
      <div className="flex items-center justify-between mb-3 border-b-2 border-rose-100 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-3 h-7 bg-rose-400 rounded-full" />
          <h2 className="text-2xl font-black text-zinc-700 italic uppercase tracking-tighter">Map Builder</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openRawPopup}
            className="px-4 py-2 bg-zinc-500 hover:bg-zinc-400 text-white font-black text-xs uppercase shadow active:scale-95 transition-all">
            蜈・ョ繝ｼ繧ｿ
          </button>
          <button onClick={handleValidate} disabled={blocks.length === 0}
            className="px-4 py-2 bg-zinc-600 hover:bg-zinc-500 text-white font-black text-xs uppercase shadow active:scale-95 disabled:opacity-50 transition-all">
            CHECK
          </button>
          <button onClick={handleSave} disabled={isSaving || blocks.length === 0}
            className="px-6 py-2 bg-rose-400 hover:bg-rose-500 text-white font-black text-xs uppercase shadow-lg active:scale-95 disabled:opacity-50 transition-all">
            {isSaving ? '菫晏ｭ倅ｸｭ...' : 'SAVE STAGE'}
          </button>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center bg-zinc-100 rounded-full hover:bg-rose-100 text-zinc-400 hover:text-rose-500 font-black">ﾃ・/button>
        </div>
      </div>

      {/* 繝舌Μ繝・・繧ｷ繝ｧ繝ｳ邨先棡 */}
      {showValidation && (
        <div className="flex-shrink-0 border-b-2 border-zinc-200 bg-zinc-900 px-4 py-2 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
              CHECK RESULT 窶・              {validationErrors.length === 0
                ? <span className="text-green-400"> 笨・蝠城｡後↑縺・/span>
                : <>
                  <span className="text-rose-400"> {validationErrors.filter(e => e.severity === 'error').length} errors</span>
                  {validationErrors.filter(e => e.severity === 'warning').length > 0 &&
                    <span className="text-yellow-400"> / {validationErrors.filter(e => e.severity === 'warning').length} warnings</span>}
                </>
              }
            </span>
            <button onClick={() => setShowValidation(false)} className="text-zinc-500 hover:text-zinc-300 text-xs font-black">笨・/button>
          </div>
          {validationErrors.length === 0
            ? <div className="text-[11px] text-green-400 font-mono">菫晏ｭ倥〒縺阪∪縺呻ｼ・/div>
            : <div className="flex flex-col gap-0.5">
              {validationErrors.map((err, i) => (
                <div key={i} className="flex items-start gap-2 text-[10px] font-mono">
                  <span className={`flex-shrink-0 font-black ${err.severity === 'error' ? 'text-rose-400' : 'text-yellow-400'}`}>
                    {err.severity === 'error' ? '笨・ERR' : '笞 WARN'}
                  </span>
                  <span className="text-zinc-400 flex-shrink-0">[{err.location}]</span>
                  <span className="text-zinc-200">{err.message}</span>
                </div>
              ))}
            </div>
          }
        </div>
      )}

      <div className="flex-1 flex gap-4 overflow-hidden">

        {/* 蟾ｦ繝代ロ繝ｫ */}
        <div className="w-[300px] flex-shrink-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">

          {/* 繝｡繧ｿ諠・ｱ */}
          <div className="bg-zinc-50 border border-zinc-100 p-3 flex flex-col gap-2 text-[11px]">
            {([['Title', title, setTitle], ['Artist', artist, setArtist], ['Video ID', videoId, setVideoId], ['Save ID', localMapId, setLocalMapId]] as [string, string, (v: string) => void][]).map(([lbl, val, set]) => (
              <div key={lbl} className="flex items-center gap-2">
                <span className="font-black text-rose-300 uppercase italic w-16 flex-shrink-0">{lbl}:</span>
                <input value={val} onChange={e => set(e.target.value)} className="flex-1 bg-white border border-zinc-200 px-2 py-1 font-bold focus:border-rose-300 outline-none text-zinc-700" />
              </div>
            ))}
            {/* END timeMs */}
            <div className="flex items-center gap-2">
              <span className="font-black text-rose-300 uppercase italic w-16 flex-shrink-0">End:</span>
              <input
                type="number"
                value={endTimeMs}
                onChange={e => setEndTimeMs(Number(e.target.value))}
                className="flex-1 bg-white border border-zinc-200 px-2 py-1 font-bold focus:border-rose-300 outline-none text-zinc-700 font-mono"
              />
              <span className="text-zinc-400 text-[10px] flex-shrink-0">ms</span>
              <button
                onClick={() => setEndTimeMs(Math.floor(currentTime * 1000))}
                className="text-[9px] font-black text-rose-300 hover:text-rose-500 flex-shrink-0 whitespace-nowrap"
                title="迴ｾ蝨ｨ譎る俣繧偵そ繝・ヨ"
              >迴ｾ蝨ｨ</button>
            </div>
          </div>

          {/* 蜍慕判繝励Ξ繧､繝､繝ｼ・磯浹螢ｰ蜀咲函逕ｨ繝ｻ髱櫁｡ｨ遉ｺ・・*/}
          <div style={{ width: 0, height: 0, overflow: 'hidden', position: 'absolute' }}>
            <div ref={playerDivRef} style={{ width: '1px', height: '1px' }} />
          </div>

          {/* 蜀咲函繧ｳ繝ｳ繝医Ο繝ｼ繝ｫ */}
          <div className="bg-zinc-800 border border-zinc-700 px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-mono text-zinc-300 tabular-nums">
              {Math.floor(currentTime)}s / {Math.floor(currentTime * 1000)}ms
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={togglePlay}
                disabled={!videoId}
                className="text-zinc-200 hover:text-green-400 text-[16px] w-8 h-8 flex items-center justify-center transition-colors disabled:opacity-30"
                title={isPlaying ? '荳譎ょ●豁｢' : '蜀咲函'}
              >
                {isPlaying ? '竢ｸ' : '笆ｶ'}
              </button>
              <button
                onClick={() => { try { playerRef.current?.stopVideo(); setCurrentTime(0); } catch (_) { } }}
                disabled={!videoId}
                className="text-zinc-200 hover:text-rose-400 text-[14px] w-8 h-8 flex items-center justify-center transition-colors disabled:opacity-30"
                title="蛛懈ｭ｢"
              >
                竢ｹ
              </button>
            </div>
          </div>

          {/* 謫堺ｽ懈婿豕・*/}
          <div className="bg-zinc-50 border border-zinc-100 p-3 text-[10px] text-zinc-400 leading-loose">
            <div className="font-black text-zinc-500 mb-1 uppercase">謫堺ｽ懈婿豕・/div>
            <div>窶｢ 笄ｿ 繧呈雫繧薙〒繝峨Λ繝・げ 竊・遘ｻ蜍・/div>
            <div>窶｢ 繝・く繧ｹ繝医ｒ繧ｯ繝ｪ繝・け 竊・邱ｨ髮・/div>
            <div>窶｢ ﾃ・竊・蜑企勁</div>
            <div>窶｢ 譎る俣繧偵け繝ｪ繝・け 竊・邱ｨ髮・/div>
            <div>窶｢ 繝悶Ο繝・け繝倥ャ繝繝ｼ 竊・縺昴・譎る俣縺九ｉ蜀咲函</div>
            <div>窶｢ + 竊・霑ｽ蜉</div>
          </div>

          {/* 蜀咲函謌舌ヱ繝阪Ν */}
          <div className="bg-zinc-800 border border-zinc-700 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between mb-1">
              <div className="font-black text-zinc-300 text-[10px] uppercase tracking-widest">筺ｳ 蜀咲函謌・/div>
              {regenHistory.length > 0 && (
                <button onClick={() => setShowHistory(v => !v)} className="text-[9px] font-black uppercase text-zinc-400 hover:text-rose-300 transition-colors">
                  {showHistory ? '笆ｲ 髢峨§繧・ : `笆ｼ 螻･豁ｴ (${regenHistory.length})`}
                </button>
              )}
            </div>
            {showHistory && (
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto mb-1">
                {regenHistory.map((entry, i) => (
                  <button key={entry.id} onClick={() => restoreFromHistory(entry)}
                    className="text-left bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 hover:border-rose-500 px-2 py-1.5 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black text-zinc-400 uppercase">#{regenHistory.length - i}</span>
                      <span className="text-[9px] font-mono text-zinc-500">
                        {new Date(entry.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-[9px] font-mono text-green-400 mt-0.5">
                      MIN:{entry.params.min} MAX:{entry.params.max} line:{entry.params.lineMaxChars} set:{entry.params.setMaxLines}
                      {entry.params.protectedWords && <div className="text-rose-300 truncate">PROT:{entry.params.protectedWords}</div>}
                      {entry.params.separatedWords && <div className="text-blue-300 truncate">SEP:{entry.params.separatedWords}</div>}
                    </div>
                    <div className="text-[9px] text-zinc-500">{entry.blocks.length} blocks</div>
                  </button>
                ))}
              </div>
            )}
            {([
              ['MIN', regenMin, setRegenMin, 1, 10],
              ['MAX', regenMax, setRegenMax, 5, 30],
              ['lineMaxChars', regenLineMaxChars, setRegenLineMaxChars, 5, 30],
              ['setMaxLines', regenSetMaxLines, setRegenSetMaxLines, 1, 8],
            ] as [string, number, (v: number) => void, number, number][]).map(([lbl, val, set, min, max]) => (
              <div key={lbl} className="flex flex-col gap-0.5">
                <div className="flex justify-between items-center">
                  <span className="font-black text-rose-300 uppercase italic text-[10px]">{lbl}</span>
                  <span className="font-mono text-green-400 text-[11px] tabular-nums">{val}</span>
                </div>
                <input type="range" min={min} max={max} value={val} onChange={e => set(Number(e.target.value))} className="w-full accent-rose-400 cursor-pointer" />
              </div>
            ))}

            {/* 蜈ｱ譛芽ｨｭ螳壹そ繧ｯ繧ｷ繝ｧ繝ｳ */}
            <div className="mt-4 pt-3 border-t border-zinc-700">
              <label className="flex items-center gap-2 mb-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={useGlobalRules}
                  onChange={e => setUseGlobalRules(e.target.checked)}
                  className="w-3 h-3 accent-blue-500"
                />
                <span className="text-[10px] font-black text-zinc-400 group-hover:text-zinc-200 uppercase tracking-tighter">蜈ｨ隴憺擇蜈ｱ譛芽ｨｭ螳壹ｒ驕ｩ逕ｨ縺吶ｋ</span>
              </label>
              
              <div className="flex flex-col gap-1 mb-2">
                <div className="flex items-center justify-between">
                  <span className="font-black text-zinc-500 uppercase italic text-[9px]">蜈ｱ譛会ｼ壼・髮｢遖∵ｭ｢</span>
                </div>
                <textarea
                  value={globalProtectedInput}
                  onChange={e => setGlobalProtectedInput(e.target.value)}
                  className="bg-zinc-800 text-zinc-300 font-bold text-[10px] px-2 py-1 outline-none border border-zinc-700 focus:border-zinc-500 min-h-[32px] resize-none custom-scrollbar"
                  placeholder="蜈ｨ隴憺擇縺ｧ蜈ｱ譛峨＆繧後ｋ蜊倩ｪ・
                />
              </div>
              <div className="flex flex-col gap-1 mb-3">
                <div className="flex items-center justify-between">
                  <span className="font-black text-zinc-500 uppercase italic text-[9px]">蜈ｱ譛会ｼ夂ｵ仙粋遖∵ｭ｢</span>
                  <button 
                    onClick={handleSaveGlobalRules}
                    className="text-[9px] font-black bg-zinc-700 hover:bg-zinc-600 text-zinc-300 px-2 py-0.5 rounded transition-colors"
                  >
                    Firestore縺ｫ菫晏ｭ・                  </button>
                </div>
                <textarea
                  value={globalSeparatedInput}
                  onChange={e => setGlobalSeparatedInput(e.target.value)}
                  className="bg-zinc-800 text-zinc-300 font-bold text-[10px] px-2 py-1 outline-none border border-zinc-700 focus:border-zinc-500 min-h-[32px] resize-none custom-scrollbar"
                  placeholder="蜈ｨ隴憺擇縺ｧ蜈ｱ譛峨＆繧後ｋ蜊倩ｪ・
                />
              </div>
            </div>

            <div className="flex flex-col gap-1 my-2">
              <span className="font-black text-rose-300 uppercase italic text-[10px]">蛻・屬遖∵ｭ｢繝ｯ繝ｼ繝会ｼ育ｹ九￡縺溘∪縺ｾ・・/span>
              <textarea
                value={regenProtectedInput}
                onChange={e => setRegenProtectedInput(e.target.value)}
                className="bg-zinc-700 text-zinc-100 font-bold text-[11px] px-2 py-1.5 outline-none border border-zinc-600 focus:border-rose-400 min-h-[44px] resize-none custom-scrollbar"
                placeholder="萓・ 繧ｰ繝ｩ繝薙ユ繧｣, 螟ｪ髯ｽ"
              />
            </div>
            <div className="flex flex-col gap-1 mb-2">
              <span className="font-black text-blue-300 uppercase italic text-[10px]">邨仙粋遖∵ｭ｢繝ｯ繝ｼ繝会ｼ亥ｿ・★蛻・￠繧具ｼ・/span>
              <textarea
                value={regenSeparatedInput}
                onChange={e => setRegenSeparatedInput(e.target.value)}
                className="bg-zinc-700 text-zinc-100 font-bold text-[11px] px-2 py-1.5 outline-none border border-zinc-600 focus:border-blue-400 min-h-[44px] resize-none custom-scrollbar"
                placeholder="萓・ 繧後ｂ繧・ 繝√Ι繧ｳ"
              />
            </div>
            <button onClick={handleRegenerate} disabled={isRegenerating || !videoId}
              className="mt-1 px-3 py-1.5 bg-rose-500 hover:bg-rose-400 disabled:opacity-40 text-white font-black text-[11px] uppercase tracking-widest transition-colors active:scale-95">
              {isRegenerating ? '逕滓・荳ｭ...' : 'REGENERATE'}
            </button>
            {!videoId && <div className="text-[9px] text-zinc-500">Video ID繧貞・蜉帙＠縺ｦ縺上□縺輔＞</div>}
          </div>
        </div>

        {/* 蜿ｳ繝代ロ繝ｫ・壹ン繧ｸ繝･繧｢繝ｫ繧ｨ繝・ぅ繧ｿ繝ｼ */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
          <div className="flex flex-col gap-0">

            {/* 蜈磯ｭ縺ｸ縺ｮ謖ｿ蜈･繧ｾ繝ｼ繝ｳ */}
            <InsertBlockButton
              onClick={() => openAddBlockModal(-1)}
              currentTimeMs={Math.floor(currentTime * 1000)}
              isDropTarget={blockDropIdx === -1}
              onDragOver={e => { e.preventDefault(); setBlockDropIdx(-1); }}
              onDragLeave={() => setBlockDropIdx(null)}
              onDrop={e => { e.preventDefault(); handleBlockDrop(-1); }}
            />

            {blocks.map((block, bi) => (
              <div key={block.id} className="flex flex-col gap-0">
                <div
                  className="border border-zinc-200 overflow-hidden"
                  style={{ opacity: blockDragRef.current?.blockId === block.id ? 0.4 : 1, transition: 'opacity 0.15s' }}
                >

                  {/* 繝悶Ο繝・け繝倥ャ繝繝ｼ 窶・繝峨Λ繝・げ蜿ｯ閭ｽ & 繧ｯ繝ｪ繝・け縺ｧ繧ｷ繝ｼ繧ｯ */}
                  <div
                    draggable
                    onDragStart={e => handleBlockDragStart(e, block.id, bi)}
                    onDragEnd={() => { blockDragRef.current = null; setBlockDropIdx(null); }}
                    className="bg-zinc-800 px-3 py-1.5 flex items-center justify-between group cursor-grab hover:bg-zinc-700 transition-colors active:cursor-grabbing"
                    onClick={() => seekTo(block.timeMs)}
                  >
                    <div className="flex items-center gap-2">
                      {/* 繝峨Λ繝・げ繝上Φ繝峨Ν */}
                      <div className="flex flex-col gap-0.5 flex-shrink-0 mr-1 opacity-40 group-hover:opacity-80">
                        <div style={{ width: '12px', height: '1.5px', background: '#a1a1aa', borderRadius: '1px' }} />
                        <div style={{ width: '12px', height: '1.5px', background: '#a1a1aa', borderRadius: '1px' }} />
                        <div style={{ width: '12px', height: '1.5px', background: '#a1a1aa', borderRadius: '1px' }} />
                      </div>
                      <span className="text-[10px] font-black text-zinc-300 uppercase italic">BLOCK {bi + 1}</span>
                      <span className="text-[10px] text-zinc-600 group-hover:text-green-400 transition-colors">笆ｶ</span>
                      {editingBlockTimeId === block.id ? (
                        <input type="number" value={editingTimeValue}
                          onClick={e => e.stopPropagation()}
                          onChange={e => setEditingTimeValue(e.target.value)}
                          onBlur={() => commitBlockTime(block.id)} autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') commitBlockTime(block.id); if (e.key === 'Escape') setEditingBlockTimeId(null); }}
                          className="bg-zinc-700 text-green-400 font-mono text-[11px] px-2 py-0.5 w-24 outline-none border border-zinc-500" />
                      ) : (
                        <span className="text-[10px] font-mono text-green-400 cursor-pointer hover:text-green-300"
                          onClick={e => { e.stopPropagation(); setEditingBlockTimeId(block.id); setEditingTimeValue(String(block.timeMs)); }}>
                          {block.timeMs}ms
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={e => { e.stopPropagation(); delBlock(block.id); }}
                        className="text-[10px] font-black text-zinc-500 hover:text-rose-400 px-2 py-0.5 border border-zinc-600 hover:border-rose-400 transition-colors bg-zinc-800/50"
                title="繝悶Ο繝・け繧貞炎髯､">
                        笨・蜑企勁
                      </button>
                      <button onClick={e => { e.stopPropagation(); addLine(block.id); }}
                        className="text-[10px] font-black text-zinc-400 hover:text-green-400 px-2 py-0.5 border border-zinc-600 hover:border-green-600 transition-colors">
                        + 陦瑚ｿｽ蜉 ({block.timeMs}ms)
                      </button>
                    </div>
                  </div>

                  {/* 陦・*/}
                  <div
                    className="bg-zinc-900 p-2 flex flex-col gap-0"
                    onClick={() => scrollToNearestLine(block.timeMs)}
                  >
                    {renderLineDropZone(block.id, 0)}
                    {block.lines.map((line, li) => (
                      <React.Fragment key={line.id}>
                        <div className="flex items-center gap-1.5 p-1.5 bg-zinc-800" style={{ minHeight: '40px' }}>
                        {/* 陦後・譎る俣 */}
                        {editingLineTimeId === line.id ? (
                          <input type="number" value={editingTimeValue}
                            onChange={e => setEditingTimeValue(e.target.value)}
                            onBlur={() => commitLineTime(block.id, line.id)} autoFocus
                            onKeyDown={e => { if (e.key === 'Enter') commitLineTime(block.id, line.id); if (e.key === 'Escape') setEditingLineTimeId(null); }}
                            className="bg-zinc-700 text-rose-400 font-mono text-[10px] px-1.5 py-0.5 w-20 outline-none border border-rose-500 flex-shrink-0" />
                        ) : (
                          <div className="flex items-center gap-1 flex-shrink-0" style={{ minWidth: '100px' }}>
                            <span className="text-[10px] font-mono text-rose-400 cursor-pointer hover:text-rose-300 tabular-nums"
                              onClick={() => { setEditingLineTimeId(line.id); setEditingTimeValue(String(line.timeMs)); }}>
                              [{line.timeMs}]
                            </span>
                            {line.chunks.length > 0 && line.chunks[0].isLineHead && (
                              (() => {
                                const blueCount = block.lines.filter(fl => fl.chunks.length > 0 && fl.chunks[0].isLineHead).length;
                                return blueCount > 1 ? (
                                  <button
                                    onClick={() => splitBlock(block.id, line.id)}
                                    className="text-[8px] font-bold bg-indigo-600/50 hover:bg-indigo-500 text-indigo-100 px-1 py-0.5 rounded border border-indigo-400/50 transition-colors"
                                    title="縺薙・BLOCK繧呈ｭ瑚ｩ槭ヵ繝ｬ繝ｼ繧ｺ(髱貞腰隱・縺斐→縺ｫ荳諡ｬ蛻・牡縺吶ｋ"
                                  >笳ｨ 蛻・牡</button>
                                ) : null;
                              })()
                            )}
                          </div>
                        )}

                        {/* 繝√Ε繝ｳ繧ｯ + DropZone */}
                        <div className="flex flex-wrap items-center flex-1" style={{ gap: '3px' }}>
                          {renderDropZone(block.id, line.id, line.chunks[0]?.id ?? null)}
                          {line.chunks.map((chunk, ci) => (
                            <React.Fragment key={chunk.id}>
                              <div
                                draggable={editingChunkId !== chunk.id}
                                onDragStart={e => {
                                  e.dataTransfer.effectAllowed = 'move';
                                  e.dataTransfer.setData('text/plain', chunk.id);
                                  dragRef.current = { chunk, fromLineId: line.id };
                                  setIsDragging(true);
                                }}
                                onDragEnd={() => {
                                  dragRef.current = null;
                                  dropRef.current = null;
                                  setIsDragging(false);
                                  setActiveDropTarget(null);
                                }}
                                className={`group flex items-stretch border transition-opacity duration-100 ${chunk.isLineHead ? 'bg-indigo-700/60 border-indigo-400' : 'bg-zinc-700 border-zinc-500'}`}
                                style={{ opacity: dragRef.current?.chunk.id === chunk.id ? 0.3 : 1 }}
                              >
                                {/* 蜑阪↓邨仙粋繝懊ち繝ｳ逕ｨ縺ｮ蝗ｺ螳壼ｹ・せ繝壹・繧ｹ */}
                                <div className="w-4 flex flex-shrink-0 items-stretch">
                                  {(ci > 0 || li > 0) && (
                                    <button
                                      onClick={() => mergeChunkBackward(block.id, line.id, chunk.id)}
                                      className="opacity-40 group-hover:opacity-100 group-hover:bg-indigo-600/50 w-full bg-zinc-600/30 hover:bg-indigo-500 text-[9px] text-white transition-opacity border-r border-zinc-600 flex items-center justify-center font-bold"
                                      title="蜑阪・蜊倩ｪ槭→邨仙粋"
                                    >笳</button>
                                  )}
                                </div>

                                {/* 荳画悽邱壹ワ繝ｳ繝峨Ν */}
                                <div
                                  className="flex flex-col items-center justify-center gap-0.5 px-0.5 bg-zinc-600/30 cursor-grab active:cursor-grabbing hover:bg-zinc-600/50 transition-colors"
                                  title="繝峨Λ繝・げ縺励※遘ｻ蜍・
                                >
                                  <div className="w-2 h-[1px] bg-zinc-400 rounded-full pointer-events-none" />
                                  <div className="w-2 h-[1px] bg-zinc-400 rounded-full pointer-events-none" />
                                  <div className="w-2 h-[1px] bg-zinc-400 rounded-full pointer-events-none" />
                                </div>
                                {editingChunkId === chunk.id ? (
                                  <input
                                    ref={editInputRef}
                                    value={editingText}
                                    onChange={e => setEditingText(e.target.value)}
                                    onBlur={commitEdit}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') commitEdit();
                                      if (e.key === 'Escape') setEditingChunkId(null);
                                      if (e.key === 'Backspace' && editingText === '') {
                                        delChunk(block.id, line.id, chunk.id);
                                        setEditingChunkId(null);
                                      }
                                    }}
                                    className="bg-zinc-600 text-white font-mono text-[13px] px-2 py-1 outline-none border-none"
                                    style={{ minWidth: `${Math.max((editingText.length + 1) * 11, 48)}px` }}
                                  />
                                ) : (
                                  <span
                                    className="text-[13px] font-bold text-green-300 px-2 py-1 select-none cursor-pointer"
                                    draggable="false"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingChunkId(chunk.id);
                                      setEditingText(chunk.text);
                                    }}
                                  >
                                    {chunk.text}
                                  </span>
                                )}
                                {/* 蠕後ｍ縺ｫ邨仙粋繝懊ち繝ｳ逕ｨ縺ｮ蝗ｺ螳壼ｹ・せ繝壹・繧ｹ */}
                                <div className="w-4 flex flex-shrink-0 items-stretch">
                                  <button
                                    onClick={() => mergeChunkForward(block.id, line.id, chunk.id)}
                                    className="opacity-40 group-hover:opacity-100 group-hover:bg-indigo-600/50 w-full bg-zinc-600/30 hover:bg-indigo-500 text-[9px] text-white transition-opacity border-l border-zinc-600 flex items-center justify-center font-bold"
                                    title={ci < line.chunks.length - 1 || li < block.lines.length - 1 ? "蠕後ｍ縺ｮ蜊倩ｪ槭→邨仙粋" : "譁ｰ縺励＞陦後↓遘ｻ蜍・}
                                  >笆ｶ</button>
                                </div>
                                <button
                                  onClick={e => { e.stopPropagation(); delChunk(block.id, line.id, chunk.id); }}
                                  style={{ color: '#52525b', fontSize: '13px', padding: '0 6px', background: 'none', border: 'none', cursor: 'pointer', alignSelf: 'stretch', display: 'flex', alignItems: 'center', opacity: 0, transition: 'opacity 0.15s' }}
                                  className="group-hover:!opacity-100 hover:!text-rose-400">ﾃ・/button>
                              </div>
                              {renderDropZone(block.id, line.id, line.chunks[ci + 1]?.id ?? null)}
                            </React.Fragment>
                          ))}
                          <button onClick={() => addChunk(block.id, line.id)}
                            style={{ fontSize: '11px', fontWeight: 900, color: '#52525b', padding: '2px 6px', border: '1px dashed #3f3f46', background: 'none', cursor: 'pointer' }}
                            className="hover:!text-green-400 hover:!border-green-700 transition-colors">+</button>
                        </div>
                      </div>
                      {renderLineDropZone(block.id, li + 1)}
                    </React.Fragment>
                  ))}
                </div>

                </div>

                {/* 縺薙・繝悶Ο繝・け縺ｮ荳九∈縺ｮ謖ｿ蜈･繧ｾ繝ｼ繝ｳ */}
                <InsertBlockButton
                  onClick={() => openAddBlockModal(bi)}
                  currentTimeMs={Math.floor(currentTime * 1000)}
                  isDropTarget={blockDropIdx === bi}
                  onDragOver={e => { e.preventDefault(); setBlockDropIdx(bi); }}
                  onDragLeave={() => setBlockDropIdx(null)}
                  onDrop={e => { e.preventDefault(); handleBlockDrop(bi); }}
                />
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* 蜈・ョ繝ｼ繧ｿ 繝輔Ο繝ｼ繝・ぅ繝ｳ繧ｰ繧ｦ繧｣繝ｳ繝峨え */}
      {rawPopupLines && (
        <RawDataWindow
          rawLines={rawPopupLines}
          scrollRef={rawScrollRef}
          onClose={() => setRawPopupLines(null)}
        />
      )}

      {/* 譁ｰ繝悶Ο繝・け霑ｽ蜉繝｢繝ｼ繝繝ｫ */}
      {addBlockModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setAddBlockModal(null)}
        >
          <div
            className="bg-white border-2 border-rose-200 p-5 flex flex-col gap-3 shadow-2xl w-64"
            onClick={e => e.stopPropagation()}
          >
            <div className="font-black text-zinc-700 uppercase text-sm">譁ｰ縺励＞繝悶Ο繝・け</div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black text-rose-300 uppercase">TimeMs</label>
              <input
                type="number"
                value={addBlockTimeValue}
                onChange={e => setAddBlockTimeValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmAddBlock(); if (e.key === 'Escape') setAddBlockModal(null); }}
                className="border border-zinc-200 px-3 py-1.5 font-mono text-sm outline-none focus:border-rose-300 text-zinc-700"
                autoFocus
              />
              <div className="text-[9px] text-zinc-400">
                迴ｾ蝨ｨ: {Math.floor(currentTime * 1000)}ms
                <button
                  onClick={() => setAddBlockTimeValue(String(Math.floor(currentTime * 1000)))}
                  className="ml-2 text-rose-400 hover:text-rose-600 font-black"
                >迴ｾ蝨ｨ譎る俣繧剃ｽｿ縺・/button>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={confirmAddBlock}
                className="flex-1 py-1.5 bg-rose-400 hover:bg-rose-500 text-white font-black text-xs uppercase transition-colors">
                霑ｽ蜉
              </button>
              <button onClick={() => setAddBlockModal(null)}
                className="flex-1 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-500 font-black text-xs uppercase transition-colors">
                繧ｭ繝｣繝ｳ繧ｻ繝ｫ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
