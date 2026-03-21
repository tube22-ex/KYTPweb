import React, { useState } from 'react';
import { fetchMapData, ParseResult } from '../services/api';
import { MapCacheList } from './MapCacheList';
import { requestMap, clearRequests, removeRequest, RoomState } from '../services/sync';
interface MapLoaderProps {
  onLoad: (data: ParseResult, mapId: string) => void;
  isHost: boolean;
  roomId?: string;
  playerName?: string;
  roomState?: RoomState | null;
  onEdit?: (data: ParseResult, mapId: string) => void;
}

export const MapLoader: React.FC<MapLoaderProps> = ({ onLoad, isHost, roomId, playerName, roomState, onEdit }) => {
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
      if (isHost && roomId) {
        await clearRequests(roomId);
      }
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
      if (isHost && roomId) {
        await clearRequests(roomId);
      }
      onLoad(data, targetId);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'データ取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const [requestSuccess, setRequestSuccess] = useState(false);

  const handleRequest = async () => {
    if (!roomId || !playerName || !mapId.trim()) return;
    let targetId = mapId.trim();
    const match = targetId.match(/\/type\/(\d+)$/);
    if (match) targetId = match[1];
    
    setLoading(true);
    try {
      let title: string | undefined = previewData?.title;
      let videoId: string | undefined = previewData?.videoId;
      if ((!title || !videoId) || targetId !== lastFetchedId) {
        const data = await fetchMapData(targetId);
        title = data.title;
        videoId = data.videoId;
      }
      await requestMap(roomId, targetId, playerName, title, videoId);
      setMapId('');
      setPreviewData(null);
      
      // フィードバック表示
      setRequestSuccess(true);
      setTimeout(() => setRequestSuccess(false), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickRequest = async (data: ParseResult, mid: string) => {
    if (!roomId || !playerName) return;
    setLoading(true);
    try {
      await requestMap(roomId, mid, playerName, data.title, data.videoId);
      setRequestSuccess(true);
      setTimeout(() => setRequestSuccess(false), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (!isHost) {
    return (
      <div className="bg-white border-4 border-white shadow-[0_10px_30px_rgba(255,133,161,0.05)] rounded-none w-full h-full flex flex-col relative overflow-hidden bubble-bg input-section p-0">
        <div className="flex flex-col gap-1 mb-2">
          <h3 className="text-xs font-black text-rose-400 uppercase tracking-widest italic">譜面をリクエストする</h3>
          <p className="text-[10px] text-zinc-400 font-bold">ホストにプレイしたい譜面を提案できます</p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex gap-1 flex-wrap">
            <input
              type="text"
              placeholder="YTYPINGの譜面ID または URL"
              value={mapId}
              onChange={(e) => setMapId(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={(e) => e.key === 'Enter' && handleRequest()}
              className="flex-1 rounded-none bg-zinc-50 border-2 border-zinc-100 focus:outline-none focus:border-rose-300 focus:bg-white transition-all font-black px-3 py-1 text-xs min-w-[120px]"
            />
            <button
              onClick={handleRequest}
              disabled={loading || !mapId.trim() || requestSuccess}
              className={`px-4 font-black text-[10px] uppercase shadow-md transition-all ${
                requestSuccess ? 'bg-green-500 text-white' : 'bg-rose-400 hover:bg-rose-500 text-white'
              } disabled:bg-zinc-200`}
              style={{ flexShrink: 0 }}
            >
              {loading ? '...' : requestSuccess ? 'OK!' : 'リクエスト'}
            </button>

            {/* ゲスト画面にもリクエストチップを表示 */}
            {roomState?.requests && Object.keys(roomState.requests).length > 0 && (
              <div className="flex flex-wrap items-center gap-1 px-1 border-l border-rose-100 ml-1">
                {Object.entries(roomState.requests).sort((a,b) => b[1].timestamp - a[1].timestamp).map(([reqId, req]) => (
                  <div key={reqId} className="flex items-center bg-white border border-rose-100 h-9 p-0 rounded-sm shadow-sm group/req animate-in slide-in-from-right-2 duration-300 overflow-hidden">
                    {req.videoId && (
                      <img
                        src={`https://img.youtube.com/vi/${req.videoId}/mqdefault.jpg`}
                        className="h-full aspect-video object-cover border-r border-rose-100"
                        alt=""
                      />
                    )}
                    <button
                      onClick={() => {
                        setMapId(req.mapId);
                        fetchPreview(req.mapId);
                      }}
                      className="h-full flex flex-col justify-center text-left min-w-0 px-2 hover:opacity-80 transition-opacity"
                      title={`${req.playerName}: ${req.title || req.mapId}`}
                    >
                      <div className="text-[7px] font-black text-rose-300 uppercase italic leading-none mb-0.5 whitespace-nowrap">by {req.playerName}</div>
                      <div className="text-[10px] font-black text-zinc-700 truncate max-w-[100px] leading-tight">
                        {req.title || req.mapId}
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {previewData && (
            <div className="bg-rose-50/50 flex gap-2 border border-rose-100 animate-in fade-in duration-300 overflow-hidden">
              {previewData.videoId && (
                <img
                  src={`https://img.youtube.com/vi/${previewData.videoId}/mqdefault.jpg`}
                  className="w-20 aspect-video object-cover border-r border-rose-100"
                  alt=""
                />
              )}
              <div className="flex flex-col justify-center min-w-0 pr-2">
                <div className="text-[8px] font-black text-rose-400 uppercase italic leading-none mb-0.5">Preview</div>
                <div className="text-[10px] font-black text-zinc-700 truncate leading-tight">{previewData.title}</div>
                <div className="text-[9px] text-zinc-400 font-bold truncate leading-tight">{previewData.artist}</div>
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto mt-2 border-t border-rose-100 pt-2">
          <MapCacheList 
            onSelect={(data, mid) => {
              handleQuickRequest(data, mid);
            }} 
            onRequest={handleQuickRequest}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border-4 border-white shadow-[0_10px_30px_rgba(255,133,161,0.05)] rounded-none w-full h-full flex flex-col relative overflow-hidden bubble-bg input-section">
      <div className="flex flex-col gap-1">
        <div className="flex input-row flex-1 flex-wrap" style={{ gap: '4px' }}>
          <div className="flex-1 relative min-w-[200px]">
            <input
              type="text"
              placeholder="YTYPINGの譜面ID または 譜面URL"
              value={mapId}
              onChange={(e) => setMapId(e.target.value)}
              onBlur={handleBlur}
              className="w-full rounded-none bg-zinc-50 border-2 border-zinc-100 focus:outline-none focus:border-rose-300 focus:bg-white transition-all font-black placeholder:text-zinc-300 text-zinc-700 shadow-inner"
              style={{ height: '32px', padding: '0 8px', fontSize: '12px' }}
            />
          </div>
          <button
            onClick={handleLoad}
            disabled={loading}
            className="px-4 bg-rose-400 hover:bg-rose-500 text-white font-black rounded-none shadow-lg transition-all active:scale-[0.95] disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2 group/btn font-premium"
            style={{ height: '32px', fontSize: '11px', flexShrink: 0 }}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <>
                読み込む
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 group-hover/btn:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </>
            )}
          </button>

          {/* コンパクトなリクエストチップ */}
          {roomState?.requests && Object.keys(roomState.requests).length > 0 && (
            <div className="flex flex-wrap items-center gap-1 px-1 border-l border-rose-100 ml-1">
              {Object.entries(roomState.requests).sort((a,b) => b[1].timestamp - a[1].timestamp).map(([reqId, req]) => (
                <div key={reqId} className="flex items-center bg-white border border-rose-100 h-9 p-0 rounded-sm shadow-sm group/req animate-in slide-in-from-right-2 duration-300 overflow-hidden">
                  {req.videoId && (
                    <img
                      src={`https://img.youtube.com/vi/${req.videoId}/mqdefault.jpg`}
                      className="h-full aspect-video object-cover border-r border-rose-100"
                      alt=""
                    />
                  )}
                  <button
                    onClick={() => {
                      setMapId(req.mapId);
                      fetchPreview(req.mapId);
                    }}
                    className="h-full flex flex-col justify-center text-left min-w-0 px-2 hover:opacity-80 transition-opacity"
                    title={`${req.playerName}: ${req.title || req.mapId}`}
                  >
                    <div className="text-[7px] font-black text-rose-300 uppercase italic leading-none mb-0.5 whitespace-nowrap">by {req.playerName}</div>
                    <div className="text-[10px] font-black text-zinc-700 uppercase italic tracking-tighter truncate max-w-[120px] leading-tight">
                      {req.title || req.mapId}
                    </div>
                  </button>
                  {isHost && (
                    <button
                      onClick={() => roomId && removeRequest(roomId, reqId)}
                      className="ml-1 w-4 h-4 flex items-center justify-center text-rose-200 hover:text-rose-500 hover:bg-white rounded-full transition-all"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {previewData && (
          <div className="bg-rose-50/30 border-2 border-rose-100 flex gap-3 animate-in fade-in slide-in-from-top-2 duration-500 overflow-hidden">
            {previewData.videoId && (
              <img
                src={`https://img.youtube.com/vi/${previewData.videoId}/mqdefault.jpg`}
                className="w-32 aspect-video object-cover border-r-2 border-rose-100 shadow-sm"
                alt=""
              />
            )}
            <div className="flex flex-col justify-center min-w-0 py-1 pr-4">
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

      <MapCacheList 
        onSelect={(data, mid) => {
          if (isHost) {
            onLoad(data, mid);
          } else {
            setMapId(mid);
            setPreviewData(data);
            setLastFetchedId(mid);
          }
        }} 
        onRequest={isHost ? undefined : handleQuickRequest}
        onEdit={onEdit}
      />
    </div>
  );
};
