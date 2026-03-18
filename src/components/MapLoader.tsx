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
    if (!mapId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMapData(mapId);
      console.log('Fetched Map Data:', data);
      onLoad(data, mapId);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'データ取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass p-8 rounded-3xl shadow-2xl w-full flex flex-col gap-6 relative overflow-hidden group">
      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-3xl rounded-full -mr-16 -mt-16 group-hover:bg-blue-500/20 transition-all duration-700"></div>
      
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-black font-premium text-white">Select Your Stage</h3>
        <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">Enter Map ID to begin fetching lyrics</p>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Stage ID (e.g. 1)"
            value={mapId}
            onChange={(e) => setMapId(e.target.value)}
            className="w-full px-5 py-4 rounded-xl bg-white/5 border border-white/10 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all font-bold placeholder:text-white/20 text-white"
          />
        </div>
        <button
          onClick={handleLoad}
          disabled={loading}
          className="px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl shadow-lg transition-all hover:scale-[1.05] active:scale-[0.95] disabled:opacity-50 disabled:scale-100 flex items-center gap-2 group/btn font-premium"
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
