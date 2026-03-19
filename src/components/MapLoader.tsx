import React, { useState } from 'react';
import { fetchMapData, ParseResult } from '../services/api';
import { MapCacheList } from './MapCacheList';

interface MapLoaderProps {
  onLoad: (data: ParseResult, mapId: string) => void;
}

export const MapLoader: React.FC<MapLoaderProps> = ({ onLoad }) => {
  const [mapId, setMapId] = useState<string>('1');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<ParseResult | null>(null);
  const [lastFetchedId, setLastFetchedId] = useState<string | null>(null);

  const fetchPreview = async (targetId: string) => {
    if (!targetId || targetId === lastFetchedId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMapData(targetId);
      setPreviewData(data);
      setLastFetchedId(targetId);
    } catch (err: any) {
      console.error(err);
      setError('プレビューの取得に失敗しました');
      setPreviewData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleBlur = () => {
    let targetId = mapId.trim();
    const match = targetId.match(/\/type\/(\d+)$/);
    if (match) {
      targetId = match[1];
      setMapId(targetId);
    }
    if (targetId) {
      fetchPreview(targetId);
    }
  };

  const handleLoad = async () => {
    if (previewData && mapId.trim() === lastFetchedId) {
      onLoad(previewData, lastFetchedId);
      return;
    }

    let targetId = mapId.trim();
    const match = targetId.match(/\/type\/(\d+)$/);
    if (match) {
      targetId = match[1];
      setMapId(targetId);
    }

    if (!targetId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMapData(targetId);
      onLoad(data, targetId);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'データ取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border-4 border-white shadow-[0_10px_30px_rgba(255,133,161,0.05)] p-8 rounded-none w-full h-full flex flex-col gap-6 relative overflow-hidden bubble-bg">

      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-black font-premium text-zinc-700 italic uppercase tracking-tighter">譜面ID・URL</h3>
        <p className="text-[10px] text-rose-300 font-black uppercase tracking-widest italic">譜面IDを入力してフォーカスを外すとプレビューが表示されます</p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="ステージID (例: 1)"
              value={mapId}
              onChange={(e) => setMapId(e.target.value)}
              onBlur={handleBlur}
              className="w-full px-5 py-4 rounded-none bg-zinc-50 border-2 border-zinc-100 focus:outline-none focus:border-rose-300 focus:bg-white transition-all font-black placeholder:text-zinc-300 text-zinc-700 shadow-inner"
            />
          </div>
          <button
            onClick={handleLoad}
            disabled={loading}
            className="px-8 py-4 bg-rose-400 hover:bg-rose-500 text-white font-black rounded-none shadow-lg transition-all active:scale-[0.95] disabled:opacity-50 disabled:scale-100 flex items-center gap-2 group/btn font-premium"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <>
                読み込む
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover/btn:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </>
            )}
          </button>
        </div>

        {/* プレビュー表示エリア */}
        {previewData && (
          <div className="bg-rose-50/30 border-2 border-rose-100 p-4 flex gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
            {previewData.videoId && (
              <img
                src={`https://img.youtube.com/vi/${previewData.videoId}/mqdefault.jpg`}
                className="w-32 aspect-video object-cover border-2 border-white shadow-sm"
                alt=""
              />
            )}
            <div className="flex flex-col justify-center min-w-0">
              <div className="text-[10px] font-black text-rose-400 uppercase italic mb-0.5">Preview Stage</div>
              <div className="text-base font-black text-zinc-800 uppercase italic tracking-tighter truncate leading-tight">
                {previewData.title || 'Untitled'}
              </div>
              <div className="text-[11px] font-bold text-zinc-500 truncate">
                {previewData.artist || 'Unknown Artist'}
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-none text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      <MapCacheList onSelect={onLoad} />
    </div>
  );
};
