import React, { useState } from 'react';
import { fetchMapData, ParseResult } from '../services/api';

interface MapLoaderProps {
  onLoad: (data: ParseResult, mapId: string) => void;
}

export const MapLoader: React.FC<MapLoaderProps> = ({ onLoad }) => {
  const [mapId, setMapId] = useState<string>('1');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

   const handleLoad = async () => {
    let targetId = mapId.trim();
    // ytyping URL (https://ytyping.net/type/1) から ID を抽出
    const match = targetId.match(/\/type\/(\d+)$/);
    if (match) {
      targetId = match[1];
      setMapId(targetId); // 入力欄もクリーンアップ
    }

    if (!targetId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMapData(targetId);
      console.log('Fetched Map Data:', data);
      onLoad(data, targetId);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'データ取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border-4 border-white shadow-[0_10px_30px_rgba(255,133,161,0.05)] p-8 rounded-none w-full flex flex-col gap-6 relative overflow-hidden group bubble-bg">
      
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-black font-premium text-zinc-700 italic uppercase tracking-tighter">Select Your Stage</h3>
        <p className="text-[10px] text-rose-300 font-black uppercase tracking-widest italic">Enter Map ID to begin fetching lyrics</p>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Stage ID (e.g. 1)"
            value={mapId}
            onChange={(e) => setMapId(e.target.value)}
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
              LOAD 
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover/btn:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
};
