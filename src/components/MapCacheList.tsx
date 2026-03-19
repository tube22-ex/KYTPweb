import React, { useEffect, useState } from 'react';
import { getAllCachedMaps } from '../services/sync';
import { ParseResult } from '../services/api';

interface MapCacheListProps {
  onSelect: (data: ParseResult, mapId: string) => void;
}

export const MapCacheList: React.FC<MapCacheListProps> = ({ onSelect }) => {
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
    <div className="flex flex-col border-t-4 border-rose-50 animate-in fade-in slide-in-from-bottom-8 duration-1000 cached-section" style={{ marginTop: '4px', paddingTop: 0, gap: '4px' }}>
      <div className="hidden items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="w-3 h-6 bg-rose-500 rounded-full shadow-[0_0_15px_rgba(244,63,94,0.4)]"></div>
          <h4 className="text-2xl font-black text-zinc-800 uppercase tracking-tighter italic" style={{ margin: '0 0 4px 0', padding: 0, lineHeight: 1.2 }}>
            キャッシュされた譜面<span className="text-rose-400">({cachedMaps.length})</span>
          </h4>
        </div>
        <div className="text-xs font-black text-rose-300 uppercase italic tracking-widest">Select a stage to begin</div>
      </div>

      <div className="grid grid-cols-5 max-h-[800px] overflow-y-auto pr-2 custom-scrollbar p-0 chart-grid" style={{ gap: '8px', marginTop: '4px', paddingTop: 0, gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {cachedMaps.map((map) => {
          const thumbnail = map.videoId
            ? `https://img.youtube.com/vi/${map.videoId}/mqdefault.jpg`
            : null;

          return (
            <button
              key={map.id}
              onClick={() => onSelect(map as ParseResult, map.id)}
              className="group flex flex-col bg-white border-4 border-zinc-50 hover:border-rose-300 hover:shadow-2xl hover:shadow-rose-200 transition-all text-left relative overflow-hidden active:scale-[0.98] chart-card"
              style={{ margin: 0 }}
            >
              {/* Large Thumbnail Area */}
              <div className="w-full aspect-video bg-zinc-100 overflow-hidden relative border-b-2 border-zinc-50">
                {thumbnail ? (
                  <img src={thumbnail} alt="" className="w-full h-full object-cover grayscale-[0.2] group-hover:grayscale-0 transition-all duration-700 scale-110 group-hover:scale-100" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xl text-zinc-300 font-black italic">NO PREVIEW</div>
                )}
                {/* ID Tag */}
                <div className="absolute top-4 left-4 bg-rose-500 text-white px-3 py-1 text-xs font-black italic shadow-lg z-10">
                  # {map.id}
                </div>
                {/* Play Overlay */}
                <div className="absolute inset-0 bg-rose-600/0 group-hover:bg-rose-600/40 transition-all duration-500 flex items-center justify-center backdrop-blur-0 group-hover:backdrop-blur-[2px]">
                  <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-2xl scale-0 group-hover:scale-100 transition-transform duration-500">
                    <span className="text-rose-500 translate-x-1">▶</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col p-2 min-w-0">
                <div className="text-[14px] font-black text-zinc-800 group-hover:text-rose-600 transition-colors line-clamp-2 uppercase italic tracking-tighter leading-[1.1] mb-1">
                  {map.title || 'Untitled Stage'}
                </div>
                <div className="text-sm font-bold text-zinc-400 line-clamp-1 truncate border-l-4 border-rose-200 pl-3 py-1 bg-rose-50/30">
                  {map.artist || 'Unknown Artist'}
                </div>
              </div>

              {/* Animation Border */}
              <div className="absolute bottom-0 left-0 w-0 h-1 bg-rose-500 group-hover:w-full transition-all duration-700"></div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
