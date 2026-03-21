import React, { useState, useRef, useEffect } from 'react';
import { ParseResult, ParsedLine, DisplaySet, splitYomi, toChunks, buildDisplayLines, buildDisplaySets } from '../services/api';
import { saveMapDataToCache } from '../services/sync';

interface MapEditorProps {
  onClose: () => void;
  onSaved?: (mapId: string) => void;
  initialData?: ParseResult | null;
  initialId?: string | null;
}

interface EditableChunk { id: string; text: string; timeMs: number; }
interface EditableLine { id: string; timeMs: number; chunks: EditableChunk[]; }
interface EditableBlock { id: string; timeMs: number; lines: EditableLine[]; }
interface DropTarget { blockId: string; lineId: string; insertBeforeChunkId: string | null; }

// 再生成履歴エントリ
interface RegenHistoryEntry {
  id: string;
  timestamp: number;
  params: { min: number; max: number; lineMaxChars: number; setMaxLines: number };
  blocks: EditableBlock[];
}

// sessionStorage: 生APIレスポンスのキャッシュ
const SESSION_KEY = (mapId: string) => `regen_raw_${mapId}`;
type RawApiLine = { time: string; lyrics: string; word: string };

const getRawCache = (mapId: string): RawApiLine[] | null => {
  try {
    const v = sessionStorage.getItem(SESSION_KEY(mapId));
    return v ? JSON.parse(v) : null;
  } catch { return null; }
};
const setRawCache = (mapId: string, data: RawApiLine[]) => {
  try { sessionStorage.setItem(SESSION_KEY(mapId), JSON.stringify(data)); } catch { }
};

// ============================================
// バリデーション
// ============================================
interface ValidationError {
  severity: 'error' | 'warning';
  location: string; // 例: "SET 3 / LINE 2 / CHUNK 1"
  message: string;
}

const validateParseResult = (data: ParseResult): ValidationError[] => {
  const errors: ValidationError[] = [];

  // 1. absLineIdx がグローバル連番になっているか
  let prevAbsIdx = -1;
  data.displaySets.forEach((set, si) => {
    set.lines.forEach((line, li) => {
      const loc = `SET ${si + 1} / LINE ${li + 1}`;
      // line.absLineIdx が前より大きいか
      if (line.absLineIdx <= prevAbsIdx) {
        errors.push({
          severity: 'error',
          location: loc,
          message: `absLineIdx=${line.absLineIdx} がグローバル連番になっていません（前の値: ${prevAbsIdx}）`,
        });
      }
      prevAbsIdx = line.absLineIdx;

      // 2. line の absLineIdx と chunk の absLineIdx が一致しているか
      line.chunks.forEach((chunk, ci) => {
        const cloc = `${loc} / CHUNK ${ci + 1}`;
        if (chunk.absLineIdx !== line.absLineIdx) {
          errors.push({
            severity: 'error',
            location: cloc,
            message: `chunk.absLineIdx=${chunk.absLineIdx} が line.absLineIdx=${line.absLineIdx} と不一致`,
          });
        }

        // 3. timeMs: 0 チェック（最初のセット最初の行は許容）
        if (chunk.timeMs === 0 && !(si === 0 && li === 0)) {
          errors.push({
            severity: 'warning',
            location: cloc,
            message: `timeMs が 0 です（「${chunk.text}」）`,
          });
        }
      });

      // line.timeMs: 0 チェック
      if (line.timeMs === 0 && !(si === 0 && li === 0)) {
        errors.push({
          severity: 'warning',
          location: loc,
          message: `line.timeMs が 0 です`,
        });
      }
    });
  });

  // 4. lines と displaySets の absLineIdx 整合性
  // displaySets の全 chunk.absLineIdx が lines に存在するか
  const lineAbsIdxSet = new Set(data.lines.filter(l => !l.isEnd).map(l => l.absLineIdx));
  data.displaySets.forEach((set, si) => {
    set.lines.forEach((line, li) => {
      const loc = `SET ${si + 1} / LINE ${li + 1}`;
      if (!lineAbsIdxSet.has(line.absLineIdx)) {
        errors.push({
          severity: 'error',
          location: loc,
          message: `absLineIdx=${line.absLineIdx} が lines 配列に存在しません`,
        });
      }
    });
  });

  return errors;
};

// localStorage: 再生成履歴
const LS_HISTORY_KEY = (mapId: string) => `regen_history_${mapId}`;
const MAX_HISTORY = 20;

const loadHistory = (mapId: string): RegenHistoryEntry[] => {
  try {
    const v = localStorage.getItem(LS_HISTORY_KEY(mapId));
    return v ? JSON.parse(v) : [];
  } catch { return []; }
};
const saveHistory = (mapId: string, entries: RegenHistoryEntry[]) => {
  try { localStorage.setItem(LS_HISTORY_KEY(mapId), JSON.stringify(entries.slice(0, MAX_HISTORY))); } catch { }
};

let _cnt = 0;
const uid = () => `${++_cnt}-${Math.random().toString(36).slice(2, 5)}`;

const toEditable = (data: ParseResult): EditableBlock[] =>
  (data.displaySets || []).map(set => ({
    id: uid(), timeMs: set.timeMs,
    lines: set.lines.map(line => ({
      id: uid(), timeMs: line.timeMs,
      chunks: line.chunks.map(c => ({ id: uid(), text: c.text, timeMs: c.timeMs })),
    })),
  }));

const buildResult = (blocks: EditableBlock[], title: string, artist: string, videoId: string): ParseResult => {
  let globalLineCounter = 0;
  const displaySets: DisplaySet[] = blocks.map(b => ({
    timeMs: b.timeMs,
    lines: b.lines.map((l) => {
      const absIdx = globalLineCounter++;
      return {
        timeMs: l.timeMs, absLineIdx: absIdx,
        chunks: l.chunks.map((c, ci) => ({ text: c.text, timeMs: c.timeMs, isLineHead: ci === 0, absLineIdx: absIdx })),
      };
    }),
  }));
  const lines: ParsedLine[] = displaySets.flatMap(s =>
    s.lines.map((l) => ({
      timeMs: l.timeMs,
      lyrics: l.chunks.map(c => c.text).join(''),
      rawWord: l.chunks.map(c => c.text).join(''),
      words: l.chunks.map(c => c.text),
      isEnd: false, absLineIdx: l.absLineIdx,
    }))
  );
  if (lines.length > 0) lines.push({ timeMs: lines[lines.length - 1].timeMs + 3000, lyrics: 'end', rawWord: '', words: [], isEnd: true, absLineIdx: lines.length });
  return { lines, displaySets, title, artist, videoId };
};

export const MapEditor: React.FC<MapEditorProps> = ({ onClose, onSaved, initialData, initialId }) => {
  const [title, setTitle] = useState(initialData?.title || '');
  const [artist, setArtist] = useState(initialData?.artist || '');
  const [videoId, setVideoId] = useState(initialData?.videoId || '');
  const [localMapId, setLocalMapId] = useState(() => initialId || `local-${Math.random().toString(36).slice(2, 8)}`);
  const [blocks, setBlocks] = useState<EditableBlock[]>(() => initialData ? toEditable(initialData) : []);

  const [editingChunkId, setEditingChunkId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingBlockTimeId, setEditingBlockTimeId] = useState<string | null>(null);
  const [editingLineTimeId, setEditingLineTimeId] = useState<string | null>(null);
  const [editingTimeValue, setEditingTimeValue] = useState('');

  // ドラッグ状態
  const dragRef = useRef<{ chunk: EditableChunk; fromLineId: string } | null>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const [isDragging, setIsDragging] = useState(false); // ★ 再レンダリング用
  const [activeDropTarget, setActiveDropTarget] = useState<DropTarget | null>(null);

  // 再生成パラメーター
  const [regenMin, setRegenMin] = useState(3);
  const [regenMax, setRegenMax] = useState(14);
  const [regenLineMaxChars, setRegenLineMaxChars] = useState(14);
  const [regenSetMaxLines, setRegenSetMaxLines] = useState(4);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // 再生成履歴
  const [regenHistory, setRegenHistory] = useState<RegenHistoryEntry[]>(() => loadHistory(localMapId));
  const [showHistory, setShowHistory] = useState(false);

  const handleRegenerate = async () => {
    if (!videoId) {
      alert('Video IDがありません。');
      return;
    }
    setIsRegenerating(true);
    try {
      // 1. sessionStorageキャッシュ確認 → なければAPI取得
      let rawData = getRawCache(localMapId);
      if (!rawData) {
        const response = await fetch(`https://ytyping.net/api/maps/${localMapId}/json`);
        if (!response.ok) throw new Error('API取得失敗');
        rawData = await response.json() as RawApiLine[];
        setRawCache(localMapId, rawData);
      }

      // 2. splitYomiでパース（パラメーター適用）
      const parsedLines: ParsedLine[] = await Promise.all(
        rawData.map(async (line, index) => ({
          timeMs: parseFloat(line.time) * 1000,
          lyrics: line.lyrics,
          words: await splitYomi(line.lyrics, line.word, regenMin, regenMax),
          rawWord: line.word,
          isEnd: (index === rawData!.length - 1 && line.lyrics === 'end' && (!line.word || line.word.trim() === '')),
          absLineIdx: index,
        }))
      );

      // 3. buildDisplayLines → buildDisplaySets
      const filteredLines = parsedLines.filter(l => !l.isEnd);
      const chunks = toChunks(filteredLines);
      const displayLines = buildDisplayLines(chunks, regenLineMaxChars);
      const newDisplaySets = buildDisplaySets(displayLines, regenSetMaxLines);

      // 4. timeMsをセット先頭に統一
      for (const set of newDisplaySets) {
        const setTimeMs = set.lines[0]?.chunks[0]?.timeMs ?? 0;
        set.timeMs = setTimeMs;
        for (const line of set.lines) {
          line.timeMs = setTimeMs;
          for (const chunk of line.chunks) chunk.timeMs = setTimeMs;
        }
      }

      // 5. blocks更新
      const newBlocks = toEditable({ lines: parsedLines, displaySets: newDisplaySets });
      setBlocks(newBlocks);

      // 6. 履歴に追加（先頭に挿入）
      const entry: RegenHistoryEntry = {
        id: uid(),
        timestamp: Date.now(),
        params: { min: regenMin, max: regenMax, lineMaxChars: regenLineMaxChars, setMaxLines: regenSetMaxLines },
        blocks: newBlocks,
      };
      const updated = [entry, ...regenHistory].slice(0, MAX_HISTORY);
      setRegenHistory(updated);
      saveHistory(localMapId, updated);
    } catch (e) {
      console.error(e);
      alert('再生成に失敗しました。');
    } finally {
      setIsRegenerating(false);
    }
  };

  // 履歴から復元
  const restoreFromHistory = (entry: RegenHistoryEntry) => {
    setBlocks(entry.blocks);
    setRegenMin(entry.params.min);
    setRegenMax(entry.params.max);
    setRegenLineMaxChars(entry.params.lineMaxChars);
    setRegenSetMaxLines(entry.params.setMaxLines);
    setShowHistory(false);
  };

  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [showValidation, setShowValidation] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef<any>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingChunkId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingChunkId]);

  useEffect(() => {
    if (!videoId) return;
    const init = () => {
      if (playerRef.current) try { playerRef.current.destroy(); } catch (e) { }
      if (!(window as any).YT?.Player) return;
      playerRef.current = new (window as any).YT.Player('editor-player', {
        height: '100%', width: '100%', videoId,
        playerVars: { autoplay: 0, modestbranding: 1, rel: 0, origin: window.location.origin },
        events: {
          onReady: (e: any) => { playerRef.current = e.target; },
          onStateChange: (e: any) => { setIsPlaying(e.data === 1); }
        }
      });
    };
    if (!(window as any).YT) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
      (window as any).onYouTubeIframeAPIReady = init;
    } else init();
    const iv = setInterval(() => {
      if (playerRef.current?.getCurrentTime) {
        setCurrentTime(playerRef.current.getCurrentTime());
        setIsPlaying(playerRef.current.getPlayerState?.() === 1);
      }
    }, 100);
    return () => clearInterval(iv);
  }, [videoId]);

  const commitEdit = () => {
    if (!editingChunkId) return;
    const id = editingChunkId, txt = editingText;
    setBlocks(p => p.map(b => ({ ...b, lines: b.lines.map(l => ({ ...l, chunks: l.chunks.map(c => c.id === id ? { ...c, text: txt } : c) })) })));
    setEditingChunkId(null);
  };

  const delChunk = (bid: string, lid: string, cid: string) =>
    setBlocks(p => p.map(b => b.id !== bid ? b : {
      ...b, lines: b.lines.map(l => l.id !== lid ? l : {
        ...l, chunks: l.chunks.filter(c => c.id !== cid)
      }).filter(l => l.chunks.length > 0)
    }));

  const addChunk = (bid: string, lid: string) =>
    setBlocks(p => p.map(b => b.id !== bid ? b : {
      ...b, lines: b.lines.map(l => l.id !== lid ? l : {
        ...l, chunks: [...l.chunks, { id: uid(), text: 'テキスト', timeMs: l.timeMs }]
      })
    }));

  const addLine = (bid: string) => {
    const t = Math.floor(currentTime * 1000);
    setBlocks(p => p.map(b => b.id !== bid ? b : {
      ...b, lines: [...b.lines, { id: uid(), timeMs: t, chunks: [{ id: uid(), text: 'テキスト', timeMs: t }] }]
    }));
  };

  const commitBlockTime = (bid: string) => {
    const v = parseInt(editingTimeValue);
    if (!isNaN(v)) setBlocks(p => p.map(b => b.id === bid ? { ...b, timeMs: v } : b));
    setEditingBlockTimeId(null);
  };

  const commitLineTime = (bid: string, lid: string) => {
    const v = parseInt(editingTimeValue);
    if (!isNaN(v)) setBlocks(p => p.map(b => b.id !== bid ? b : {
      ...b, lines: b.lines.map(l => l.id !== lid ? l : {
        ...l, timeMs: v, chunks: l.chunks.map(c => ({ ...c, timeMs: v }))
      })
    }));
    setEditingLineTimeId(null);
  };

  // ドロップ実行
  const executeDrop = () => {
    const drag = dragRef.current;
    const drop = dropRef.current;
    if (!drag || !drop) return;

    const { chunk, fromLineId } = drag;
    const { blockId: toBid, lineId: toLid, insertBeforeChunkId } = drop;

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
        const tl = b.lines.find(l => l.id === toLid);
        if (!tl) return { ...b, lines: [...b.lines, { id: toLid, timeMs: mc.timeMs, chunks: [{ ...mc }] }] };
        return {
          ...b, lines: b.lines.map(l => {
            if (l.id !== toLid) return l;
            const nc = { ...mc, timeMs: l.timeMs };
            if (insertBeforeChunkId === null) return { ...l, chunks: [...l.chunks, nc] };
            const idx = l.chunks.findIndex(c => c.id === insertBeforeChunkId);
            if (idx === -1) return { ...l, chunks: [...l.chunks, nc] };
            const arr = [...l.chunks];
            arr.splice(idx, 0, nc);
            return { ...l, chunks: arr };
          })
        };
      });

      return next;
    });

    dragRef.current = null;
    dropRef.current = null;
    setIsDragging(false);
    setActiveDropTarget(null);
  };

  const handleValidate = () => {
    const result = buildResult(blocks, title, artist, videoId);
    const errs = validateParseResult(result);
    setValidationErrors(errs);
    setShowValidation(true);
  };

  const handleSave = async () => {
    // 保存前にバリデーション
    const result = buildResult(blocks, title, artist, videoId);
    const errs = validateParseResult(result);
    setValidationErrors(errs);
    if (errs.some(e => e.severity === 'error')) {
      setShowValidation(true);
      alert(`⚠️ エラーが ${errs.filter(e => e.severity === 'error').length} 件あります。確認してください。`);
      return;
    }
    setIsSaving(true);
    try {
      await saveMapDataToCache(localMapId, result);
      alert(`保存しました！ ID: ${localMapId}`);
      onSaved?.(localMapId);
    } catch { alert('保存に失敗しました'); }
    finally { setIsSaving(false); }
  };

  // ★ DropZoneをインライン関数で描画。isDraggingがtrueのときだけ表示
  const renderDropZone = (blockId: string, lineId: string, insertBeforeChunkId: string | null) => {
    if (!isDragging) return null; // ★ stateで判定
    const isActive =
      activeDropTarget?.blockId === blockId &&
      activeDropTarget?.lineId === lineId &&
      activeDropTarget?.insertBeforeChunkId === insertBeforeChunkId;
    return (
      <div
        onDragEnter={e => e.preventDefault()}
        onDragOver={e => {
          e.preventDefault();
          e.stopPropagation();
          const t = { blockId, lineId, insertBeforeChunkId };
          dropRef.current = t;
          setActiveDropTarget(t);
        }}
        onDragLeave={() => {
          dropRef.current = null;
          setActiveDropTarget(null);
        }}
        onDrop={e => {
          e.preventDefault();
          e.stopPropagation();
          executeDrop();
        }}
        style={{
          width: isActive ? '20px' : '8px',
          minHeight: '32px',
          background: isActive ? '#fb7185' : '#3f3f46',
          borderRadius: '3px',
          flexShrink: 0,
          transition: 'width 0.1s, background 0.1s',
          cursor: 'copy',
        }}
      />
    );
  };

  return (
    <div className="bg-white/95 backdrop-blur-md w-full h-full flex flex-col p-4 animate-in fade-in duration-300 shadow-2xl overflow-hidden border-4 border-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 border-b-2 border-rose-100 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-3 h-7 bg-rose-400 rounded-full" />
          <h2 className="text-2xl font-black text-zinc-700 italic uppercase tracking-tighter">Map Builder</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleValidate} disabled={blocks.length === 0}
            className="px-4 py-2 bg-zinc-600 hover:bg-zinc-500 text-white font-black text-xs uppercase shadow active:scale-95 disabled:opacity-50 transition-all">
            CHECK
          </button>
          <button onClick={handleSave} disabled={isSaving || blocks.length === 0}
            className="px-6 py-2 bg-rose-400 hover:bg-rose-500 text-white font-black text-xs uppercase shadow-lg active:scale-95 disabled:opacity-50 transition-all">
            {isSaving ? '保存中...' : 'SAVE STAGE'}
          </button>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center bg-zinc-100 rounded-full hover:bg-rose-100 text-zinc-400 hover:text-rose-500 font-black">×</button>
        </div>
      </div>

      {/* バリデーション結果パネル */}
      {showValidation && (
        <div className="flex-shrink-0 border-b-2 border-zinc-200 bg-zinc-900 px-4 py-2 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
              CHECK RESULT —
              {validationErrors.length === 0
                ? <span className="text-green-400"> ✓ 問題なし</span>
                : <>
                  <span className="text-rose-400"> {validationErrors.filter(e => e.severity === 'error').length} errors</span>
                  {validationErrors.filter(e => e.severity === 'warning').length > 0 &&
                    <span className="text-yellow-400"> / {validationErrors.filter(e => e.severity === 'warning').length} warnings</span>}
                </>
              }
            </span>
            <button onClick={() => setShowValidation(false)} className="text-zinc-500 hover:text-zinc-300 text-xs font-black">✕</button>
          </div>
          {validationErrors.length === 0 ? (
            <div className="text-[11px] text-green-400 font-mono">保存できます！</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {validationErrors.map((err, i) => (
                <div key={i} className="flex items-start gap-2 text-[10px] font-mono">
                  <span className={`flex-shrink-0 font-black ${err.severity === 'error' ? 'text-rose-400' : 'text-yellow-400'}`}>
                    {err.severity === 'error' ? '✕ ERR' : '⚠ WARN'}
                  </span>
                  <span className="text-zinc-400 flex-shrink-0">[{err.location}]</span>
                  <span className="text-zinc-200">{err.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Left */}
        <div className="w-[300px] flex-shrink-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-1">
          <div className="bg-zinc-50 border border-zinc-100 p-3 flex flex-col gap-2 text-[11px]">
            {([['Title', title, setTitle], ['Artist', artist, setArtist], ['Video ID', videoId, setVideoId], ['Save ID', localMapId, setLocalMapId]] as [string, string, any][]).map(([lbl, val, set]) => (
              <div key={lbl} className="flex items-center gap-2">
                <span className="font-black text-rose-300 uppercase italic w-16 flex-shrink-0">{lbl}:</span>
                <input value={val} onChange={e => set(e.target.value)} className="flex-1 bg-white border border-zinc-200 px-2 py-1 font-bold focus:border-rose-300 outline-none text-zinc-700" />
              </div>
            ))}
          </div>

          <div className="bg-black overflow-hidden relative" style={{ width: '100%', height: '180px' }}>
            <div id="editor-player" style={{ width: '100%', height: '100%' }} />
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-3 py-1 flex items-center justify-between">
              <span className="text-[11px] font-mono text-white tabular-nums">{Math.floor(currentTime)}s / {Math.floor(currentTime * 1000)}ms</span>
              <button
                onClick={() => {
                  if (!playerRef.current) return;
                  try {
                    isPlaying ? playerRef.current.pauseVideo() : playerRef.current.playVideo();
                  } catch (_) { }
                }}
                className="text-white text-[16px] w-7 h-7 flex items-center justify-center hover:text-rose-300 transition-colors"
              >
                {isPlaying ? '⏸' : '▶'}
              </button>
            </div>
          </div>

          <div className="bg-zinc-50 border border-zinc-100 p-3 text-[10px] text-zinc-400 leading-loose">
            <div className="font-black text-zinc-500 mb-1 uppercase">操作方法</div>
            <div>• ⠿ を掴んでドラッグ → 移動</div>
            <div>• テキストをクリック → 編集</div>
            <div>• × → 削除</div>
            <div>• 時間をクリック → 編集</div>
            <div>• + → 追加</div>
          </div>

          {/* 再生成パネル */}
          <div className="bg-zinc-800 border border-zinc-700 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between mb-1">
              <div className="font-black text-zinc-300 text-[10px] uppercase tracking-widest">⟳ 再生成</div>
              {regenHistory.length > 0 && (
                <button
                  onClick={() => setShowHistory(v => !v)}
                  className="text-[9px] font-black uppercase text-zinc-400 hover:text-rose-300 transition-colors"
                >
                  {showHistory ? '▲ 閉じる' : `▼ 履歴 (${regenHistory.length})`}
                </button>
              )}
            </div>

            {/* 履歴リスト */}
            {showHistory && (
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto mb-1">
                {regenHistory.map((entry, i) => (
                  <button
                    key={entry.id}
                    onClick={() => restoreFromHistory(entry)}
                    className="text-left bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 hover:border-rose-500 px-2 py-1.5 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black text-zinc-400 uppercase">#{regenHistory.length - i}</span>
                      <span className="text-[9px] font-mono text-zinc-500">
                        {new Date(entry.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-[9px] font-mono text-green-400 mt-0.5">
                      MIN:{entry.params.min} MAX:{entry.params.max} line:{entry.params.lineMaxChars} set:{entry.params.setMaxLines}
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
                <input
                  type="range" min={min} max={max} value={val}
                  onChange={e => set(Number(e.target.value))}
                  className="w-full accent-rose-400 cursor-pointer"
                />
              </div>
            ))}
            <button
              onClick={handleRegenerate}
              disabled={isRegenerating || !videoId}
              className="mt-1 px-3 py-1.5 bg-rose-500 hover:bg-rose-400 disabled:opacity-40 text-white font-black text-[11px] uppercase tracking-widest transition-colors active:scale-95"
            >
              {isRegenerating ? '生成中...' : 'REGENERATE'}
            </button>
            {!videoId && <div className="text-[9px] text-zinc-500">Video IDを入力してください</div>}
          </div>
        </div>

        {/* Right: Visual Editor */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
          <div className="flex flex-col gap-3">
            {blocks.map((block, bi) => (
              <div key={block.id} className="border border-zinc-200 overflow-hidden">
                {/* Block Header */}
                <div
                  className="bg-zinc-800 px-3 py-1.5 flex items-center justify-between group cursor-pointer hover:bg-zinc-700 transition-colors"
                  onClick={() => {
                    if (playerRef.current?.seekTo) {
                      playerRef.current.seekTo(block.timeMs / 1000, true);
                      try { playerRef.current.playVideo(); } catch (_) { }
                    }
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-zinc-300 uppercase italic">BLOCK {bi + 1}</span>
                    <span className="text-[10px] text-zinc-500 group-hover:text-green-400 transition-colors">▶</span>
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
                  <button
                    onClick={e => { e.stopPropagation(); addLine(block.id); }}
                    className="text-[10px] font-black text-zinc-400 hover:text-green-400 px-2 py-0.5 border border-zinc-600 hover:border-green-600 transition-colors">
                    + 行追加 ({Math.floor(currentTime * 1000)}ms)
                  </button>
                </div>

                {/* Lines */}
                <div className="bg-zinc-900 p-2 flex flex-col gap-1">
                  {block.lines.map((line) => (
                    <div key={line.id} className="flex items-center gap-1.5 p-1.5 bg-zinc-800" style={{ minHeight: '40px' }}>
                      {/* 行の時間 */}
                      {editingLineTimeId === line.id ? (
                        <input type="number" value={editingTimeValue}
                          onChange={e => setEditingTimeValue(e.target.value)}
                          onBlur={() => commitLineTime(block.id, line.id)} autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') commitLineTime(block.id, line.id); if (e.key === 'Escape') setEditingLineTimeId(null); }}
                          className="bg-zinc-700 text-rose-400 font-mono text-[10px] px-1.5 py-0.5 w-20 outline-none border border-rose-500 flex-shrink-0" />
                      ) : (
                        <span className="text-[10px] font-mono text-rose-400 cursor-pointer hover:text-rose-300 tabular-nums flex-shrink-0"
                          style={{ minWidth: '76px' }}
                          onClick={() => { setEditingLineTimeId(line.id); setEditingTimeValue(String(line.timeMs)); }}>
                          [{line.timeMs}]
                        </span>
                      )}

                      {/* チャンク + DropZone */}
                      <div className="flex flex-wrap items-center flex-1" style={{ gap: '3px' }}>
                        {/* 先頭 DropZone */}
                        {renderDropZone(block.id, line.id, line.chunks[0]?.id ?? null)}

                        {line.chunks.map((chunk, ci) => (
                          <React.Fragment key={chunk.id}>
                            <div
                              draggable={editingChunkId !== chunk.id}
                              onDragStart={e => {
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', chunk.id);
                                dragRef.current = { chunk, fromLineId: line.id };
                                setIsDragging(true); // ★ 再レンダリングを起こしてDropZoneを表示
                              }}
                              onDragEnd={() => {
                                dragRef.current = null;
                                dropRef.current = null;
                                setIsDragging(false); // ★
                                setActiveDropTarget(null);
                              }}
                              className="group"
                              style={{
                                display: 'flex', alignItems: 'stretch',
                                border: '1px solid #52525b',
                                background: '#3f3f46',
                                transition: 'opacity 0.1s',
                              }}
                            >
                              {/* ハンドル */}
                              <div style={{ width: '14px', background: '#52525b', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px', padding: '0 4px', borderRight: '1px solid #3f3f46', flexShrink: 0, cursor: 'grab' }}>
                                <div style={{ width: '6px', height: '1.5px', background: '#a1a1aa', borderRadius: '1px' }} />
                                <div style={{ width: '6px', height: '1.5px', background: '#a1a1aa', borderRadius: '1px' }} />
                                <div style={{ width: '6px', height: '1.5px', background: '#a1a1aa', borderRadius: '1px' }} />
                              </div>

                              {editingChunkId === chunk.id ? (
                                <input ref={editInputRef} value={editingText}
                                  onChange={e => setEditingText(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') commitEdit();
                                    if (e.key === 'Escape') setEditingChunkId(null);
                                    if (e.key === 'Backspace' && editingText === '') { delChunk(block.id, line.id, chunk.id); setEditingChunkId(null); }
                                  }}
                                  className="bg-zinc-600 text-white font-mono text-[13px] px-2 py-1 outline-none border-none"
                                  style={{ minWidth: `${Math.max((editingText.length + 1) * 13, 48)}px` }} />
                              ) : (
                                <span className="text-[13px] font-bold text-green-300 px-2 py-1 select-none"
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => { setEditingChunkId(chunk.id); setEditingText(chunk.text); }}>
                                  {chunk.text}
                                </span>
                              )}

                              <button
                                onClick={e => { e.stopPropagation(); delChunk(block.id, line.id, chunk.id); }}
                                style={{ color: '#52525b', fontSize: '13px', padding: '0 6px', background: 'none', border: 'none', cursor: 'pointer', alignSelf: 'stretch', display: 'flex', alignItems: 'center', opacity: 0, transition: 'opacity 0.15s' }}
                                className="group-hover:!opacity-100 hover:!text-rose-400">
                                ×
                              </button>
                            </div>

                            {/* チャンク後ろの DropZone */}
                            {renderDropZone(block.id, line.id, line.chunks[ci + 1]?.id ?? null)}
                          </React.Fragment>
                        ))}

                        <button onClick={() => addChunk(block.id, line.id)}
                          style={{ fontSize: '11px', fontWeight: 900, color: '#52525b', padding: '2px 6px', border: '1px dashed #3f3f46', background: 'none', cursor: 'pointer' }}
                          className="hover:!text-green-400 hover:!border-green-700 transition-colors">
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};