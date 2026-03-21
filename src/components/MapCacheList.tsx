import React, { useEffect, useState } from 'react';
import { getAllCachedMaps } from '../services/sync';
import { ParseResult } from '../services/api';

interface MapCacheListProps {
  onSelect: (data: ParseResult, mapId: string) => void;
  onRequest?: (data: ParseResult, mapId: string) => void;
  onEdit?: (data: ParseResult, mapId: string) => void;
}

export const MapCacheList: React.FC<MapCacheListProps> = ({ onSelect, onRequest, onEdit }) => {
  const [cachedMaps, setCachedMaps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCache = async () => {
      console.log('MapCacheList: fetching cache...');
      try {
        const maps = await getAllCachedMaps();
        console.log('MapCacheList: fetched maps:', maps?.length);
        if (Array.isArray(maps)) {
          setCachedMaps(maps);
        } else {
          console.error('Fetched maps is not an array:', maps);
          setError('取得したデータが配列ではありません。');
        }
      } catch (err: any) {
        console.error('Failed to fetch cached maps:', err);
        setError(err.message || 'キャッシュの取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };
    fetchCache();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2 border-2 border-dotted border-rose-200">
        <div className="w-8 h-8 border-4 border-rose-100 border-t-rose-500 rounded-full animate-spin"></div>
        <span className="text-xs font-black text-rose-500 uppercase animate-pulse">読み込み中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-100 border-2 border-red-500 p-4 text-center my-4">
        <div className="text-sm font-black text-red-600 uppercase mb-1">エラー発生</div>
        <div className="text-xs text-red-500 italic">{error}</div>
      </div>
    );
  }

  if (!cachedMaps || cachedMaps.length === 0) {
    return (
      <div className="bg-amber-50 border-2 border-dashed border-amber-200 p-8 text-center my-4">
        <div className="text-sm font-black text-amber-500 uppercase tracking-widest italic mb-1">
          キャッシュが見つかりません
        </div>
        <div className="text-[10px] text-amber-400">
          まだ一度も譜面が読み込まれていないか、DBが空です。<br />
          上の入力欄から読み込むと、ここに自動的に追加されます。
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col border-t-4 border-rose-50 animate-in fade-in slide-in-from-bottom-8 duration-1000 cached-section">
      <div className="hidden items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="w-3 h-6 bg-rose-500 rounded-full shadow-[0_0_15px_rgba(244,63,94,0.4)]"></div>
          <h4 className="text-2xl font-black text-zinc-800 uppercase tracking-tighter italic" style={{ margin: '0 0 4px 0', padding: 0, lineHeight: 1.2 }}>
            キャッシュされた譜面<span className="text-rose-400">({cachedMaps.length})</span>
          </h4>
        </div>
        <div className="text-xs font-black text-rose-300 uppercase italic tracking-widest">Select a stage to begin</div>
      </div>

      <div className="chart-grid custom-scrollbar vibrant-scrollbar">
        {cachedMaps.map((map) => {
          const thumbnail = map.videoId
            ? `https://img.youtube.com/vi/${map.videoId}/mqdefault.jpg`
            : null;

          return (
            // ★ buttonからdivに変更（内部にbuttonがあるため）
            <div
              key={map.id}
              onClick={() => onSelect(map as ParseResult, map.id)}
              className="chart-card group relative aspect-video overflow-hidden rounded-md shadow-sm hover:shadow-md transition-all border-none cursor-pointer"
            >
              {/* Full Image background */}
              {thumbnail ? (
                <img src={thumbnail} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-zinc-200 flex items-center justify-center text-[8px] text-zinc-400 font-black italic">NO IMAGE</div>
              )}

              {/* Top Band: ID & Title */}
              <div className="absolute top-0 left-0 right-0 bg-white/80 py-1 px-2 flex items-start gap-1.5 border-b border-rose-100/10 pointer-events-none h-[38px]">
                <span className="text-rose-500 text-[10px] font-black italic whitespace-nowrap shrink-0 mt-0.5">
                  #{map.id}
                </span>
                <span className="text-[11px] font-black text-zinc-900 line-clamp-2 text-left leading-tight flex-1">
                  {map.title}
                </span>
              </div>

              {/* Bottom Band: Artist */}
              <div className="absolute bottom-0 left-0 right-0 bg-white/80 py-0.5 px-2 border-t border-rose-100/5 pointer-events-none h-[28px] flex items-center">
                <div className="text-[10px] font-black text-zinc-900 line-clamp-2 text-left leading-none flex-1">
                  {map.artist || 'Unknown'}
                </div>
              </div>

              {/* Quick Request Button (ゲストのみ) */}
              {onRequest && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequest(map as ParseResult, map.id);
                  }}
                  className="absolute bottom-1 right-1 w-6 h-6 bg-rose-400 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-rose-500 hover:scale-110 active:scale-90 transition-all z-20 group/reqbtn"
                  title="ワンクリックでリクエスト"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 rotate-45" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              )}

              {/* Edit Button (ホストのみ) */}
              {onEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(map as ParseResult, map.id);
                  }}
                  className="absolute top-1 right-1 w-6 h-6 bg-white/95 text-rose-400 rounded-full flex items-center justify-center shadow-md hover:bg-rose-50 hover:scale-110 active:scale-95 transition-all z-20 border border-rose-50"
                  title="この譜面を編集する"
                >
                  <span className="text-[12px]">✎</span>
                </button>
              )}

              {/* Hover Effect Overlay */}
              <div className="absolute inset-0 bg-rose-500/0 group-hover:bg-rose-500/10 transition-colors pointer-events-none" />
            </div>
          );
        })}
      </div>
    </div>
  );
};