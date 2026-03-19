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

      <div className="chart-grid custom-scrollbar">
        {cachedMaps.map((map) => {
          const thumbnail = map.videoId
            ? `https://img.youtube.com/vi/${map.videoId}/mqdefault.jpg`
            : null;

          return (
            <button
              key={map.id}
              onClick={() => onSelect(map as ParseResult, map.id)}
              className="chart-card"
            >
              {/* Square Thumbnail Area */}
              <div className="w-full aspect-square bg-zinc-100 overflow-hidden relative">
                {thumbnail ? (
                  <img src={thumbnail} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-300 font-black italic">NO IMAGE</div>
                )}
                {/* ID Tag */}
                <div className="absolute top-1 left-1 bg-rose-500 text-white px-1.5 py-0.5 text-[8px] font-black italic shadow-sm z-10">
                  # {map.id}
                </div>
              </div>

              <div className="flex flex-col min-w-0">
                <div className="title">
                  {map.title || 'Untitled Stage'}
                </div>
                <div className="artist">
                  {map.artist || 'Unknown Artist'}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
