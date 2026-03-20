import React, { useState, useRef, useEffect } from 'react';
import { 
  ParseResult, 
  ParsedLine, 
  splitYomi, 
  toChunks, 
  buildDisplayLines, 
  buildDisplaySets 
} from '../services/api';
import { saveMapDataToCache } from '../services/sync';

interface MapEditorProps {
  onClose: () => void;
  onSaved?: (mapId: string) => void;
}

export const MapEditor: React.FC<MapEditorProps> = ({ onClose, onSaved }) => {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [videoId, setVideoId] = useState('');
  const [rawText, setRawText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [previewData, setPreviewData] = useState<ParseResult | null>(null);
  const [localMapId, setLocalMapId] = useState(() => `local-${Math.random().toString(36).substring(2, 8)}`);

  const playerRef = useRef<any>(null);
  const [currentTime, setCurrentTime] = useState(0);

  // YouTube Player initialization (Simplified for editor)
  useEffect(() => {
    if (!videoId) return;
    const init = () => {
      if (playerRef.current) try { playerRef.current.destroy(); } catch (e) { }
      if (!(window as any).YT || !(window as any).YT.Player) return;
      playerRef.current = new (window as any).YT.Player('editor-player', {
        height: '225', width: '400', videoId,
        playerVars: { autoplay: 0, modestbranding: 1 },
        events: {
          onReady: (e: any) => { playerRef.current = e.target; },
        }
      });
    };
    if (!(window as any).YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      (window as any).onYouTubeIframeAPIReady = init;
    } else init();
    
    const interval = setInterval(() => {
      if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
        setCurrentTime(playerRef.current.getCurrentTime());
      }
    }, 100);
    return () => clearInterval(interval);
  }, [videoId]);

  const handleParse = async () => {
    setIsParsing(true);
    try {
      const lines: ParsedLine[] = [];
      const rawLines = rawText.split('\n').filter(l => l.trim());
      
      for (let i = 0; i < rawLines.length; i++) {
        const lineStr = rawLines[i].trim();
        // Format: [TIME_MS] LYRICS / WORD
        // Example: [1200] ハローワールド / はろーわーるど
        const match = lineStr.match(/^\[(\d+)\]\s*(.*?)\s*\/\s*(.*)$/);
        if (match) {
          const timeMs = parseInt(match[1]);
          const lyrics = match[2];
          const word = match[3];
          lines.push({
            timeMs,
            lyrics,
            rawWord: word,
            words: await splitYomi(lyrics, word),
            isEnd: false,
            absLineIdx: i
          });
        }
      }

      // Add "end" line if not present
      if (lines.length > 0) {
        const lastTime = lines[lines.length - 1].timeMs + 3000;
        lines.push({
          timeMs: lastTime,
          lyrics: 'end',
          rawWord: '',
          words: [],
          isEnd: true,
          absLineIdx: lines.length
        });
      }

      const chunks = toChunks(lines.filter(l => !l.isEnd));
      const dLines = buildDisplayLines(chunks);
      const dSets = buildDisplaySets(dLines);

      // Time alignment
      for (const set of dSets) {
        const setTimeMs = set.lines[0]?.chunks[0]?.timeMs ?? 0;
        set.timeMs = setTimeMs;
        for (const line of set.lines) {
          line.timeMs = setTimeMs;
          for (const chunk of line.chunks) chunk.timeMs = setTimeMs;
        }
      }

      const result: ParseResult = {
        lines,
        displaySets: dSets,
        title,
        artist,
        videoId
      };
      setPreviewData(result);
    } catch (err) {
      console.error(err);
      alert('パースに失敗しました');
    } finally {
      setIsParsing(false);
    }
  };

  const handleSave = async () => {
    if (!previewData) return;
    try {
      await saveMapDataToCache(localMapId, previewData);
      alert(`保存しました！ ID: ${localMapId}`);
      onSaved?.(localMapId);
    } catch (err) {
      alert('保存に失敗しました');
    }
  };

  const handleRecordTime = () => {
    const timeMs = Math.floor(currentTime * 1000);
    setRawText(prev => {
      const lines = prev.split('\n');
      const lastLine = lines[lines.length - 1];
      if (lastLine && lastLine.trim() && !lastLine.startsWith('[')) {
         // もし最後がテキストだけなら時間を先頭に補完する
         lines[lines.length - 1] = `[${timeMs}] ` + lastLine.trim();
         return lines.join('\n');
      }
      return prev + (prev.endsWith('\n') || prev === '' ? '' : '\n') + `[${timeMs}] Lyric / yomi`;
    });
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        if (e.key === 'Enter' && e.shiftKey) {
          e.preventDefault();
          handleRecordTime();
        }
        return;
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [currentTime]);

  return (
    <div className="bg-white/95 backdrop-blur-md w-full h-full flex flex-col p-6 animate-in fade-in duration-300 shadow-2xl overflow-hidden border-4 border-white">
      <div className="flex items-center justify-between mb-6 border-b-2 border-rose-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-4 h-8 bg-rose-400 rounded-full shadow-lg"></div>
          <h2 className="text-3xl font-black text-zinc-700 italic uppercase tracking-tighter">Map Builder</h2>
        </div>
        <button onClick={onClose} className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-full hover:bg-rose-100 text-zinc-400 hover:text-rose-500 transition-all font-black">×</button>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden">
        {/* Left: Settings & Raw Input */}
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black text-rose-300 uppercase italic">Title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className="bg-zinc-50 border-2 border-zinc-100 p-2 text-xs font-bold focus:border-rose-300 outline-none" placeholder="楽曲タイトル" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black text-rose-300 uppercase italic">Artist</label>
              <input value={artist} onChange={e => setArtist(e.target.value)} className="bg-zinc-50 border-2 border-zinc-100 p-2 text-xs font-bold focus:border-rose-300 outline-none" placeholder="アーティスト名" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black text-rose-300 uppercase italic">YouTube Video ID</label>
            <input value={videoId} onChange={e => setVideoId(e.target.value)} className="bg-zinc-50 border-2 border-zinc-100 p-2 text-xs font-bold focus:border-rose-300 outline-none" placeholder="例: dQw4w9WgXcQ" />
          </div>

          <div className="flex-1 flex flex-col gap-1 min-h-[300px]">
            <div className="flex justify-between items-end">
              <label className="text-[10px] font-black text-rose-300 uppercase italic">Raw Line Data</label>
              <p className="text-[9px] text-zinc-400 font-bold">Format: [TimeMS] Lyrics / Yomi</p>
            </div>
            <textarea 
              value={rawText} 
              onChange={e => setRawText(e.target.value)}
              className="flex-1 bg-zinc-900 text-green-400 p-4 font-mono text-[11px] leading-relaxed border-2 border-zinc-800 focus:border-rose-500 outline-none shadow-inner"
              spellCheck={false}
              placeholder="[0] ハロー / はろー&#10;[3000] ワールド / わーるど"
            />
          </div>
        </div>

        {/* Right: Player & Preview */}
        <div className="w-[400px] flex flex-col gap-4">
          <div className="bg-black rounded-none overflow-hidden aspect-video shadow-xl relative group">
            <div id="editor-player" className="w-full h-full" />
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm p-2 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="text-[10px] font-mono text-white tabular-nums">{Math.floor(currentTime)}s</span>
              <button 
                onClick={handleRecordTime}
                className="bg-rose-500 hover:bg-rose-400 text-white text-[9px] font-black px-3 py-1 rounded-sm shadow-lg active:scale-95 transition-all"
              >
                RECORD TIME (SPACE)
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <button 
              onClick={handleParse} 
              disabled={isParsing || !rawText}
              className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-900 text-white font-black text-xs uppercase italic tracking-widest shadow-lg active:scale-95 disabled:opacity-50"
            >
              {isParsing ? 'Parsing...' : 'Parse & Preview'}
            </button>
            <button 
              onClick={handleSave} 
              disabled={!previewData}
              className="flex-1 py-3 bg-rose-400 hover:bg-rose-500 text-white font-black text-xs uppercase italic tracking-widest shadow-lg active:scale-95 disabled:opacity-50"
            >
              SAVE STAGE
            </button>
          </div>

          <div className="flex-1 bg-zinc-50 border-2 border-zinc-100 overflow-y-auto custom-scrollbar p-3">
             <label className="text-[10px] font-black text-zinc-300 uppercase italic mb-2 block">Parsed Structure Preview</label>
             {previewData ? (
               <div className="flex flex-col gap-3">
                 {previewData.displaySets.map((set, sid) => (
                   <div key={sid} className="border-l-2 border-rose-200 pl-3">
                     <span className="text-[9px] font-bold text-rose-300 tabular-nums">BLOCK {sid+1} ({set.timeMs}ms)</span>
                     {set.lines.map((l, lid) => (
                       <div key={lid} className="text-[11px] font-bold text-zinc-600">
                         {l.chunks.map(c => c.text).join(' ')}
                       </div>
                     ))}
                   </div>
                 ))}
               </div>
             ) : (
               <div className="flex items-center justify-center h-full text-zinc-300 text-[10px] font-bold italic">No preview data</div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
};
