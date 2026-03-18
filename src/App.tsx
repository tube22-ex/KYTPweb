import { useState, useEffect } from 'react';
import { MapLoader } from './components/MapLoader';
import { TypingArea } from './components/TypingArea';
import { PlayerLane } from './components/PlayerLane';
import { ParseResult, fetchMapData } from './services/api';
import { joinRoom, subscribeToRoom, RoomState, setRoomMapId, PLAYER_COLORS, getRoomState, resetRoom, determineHostId, deleteRoomIfEmpty, subscribeToAllRooms, leaveRoom as cleanupPlayer, updatePlayerHeartbeat } from './services/sync';

interface PlayedHistoryItem {
  id: string;
  title: string;
  thumbnail: string;
  timestamp: number;
}

function App() {
  const [mapData, setMapData] = useState<ParseResult | null>(null);

  // ルーム管理ステート
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [playerId] = useState(() => {
    const saved = localStorage.getItem('kytp_player_id');
    if (saved) return saved;
    const newId = Math.random().toString(36).substring(2, 10);
    localStorage.setItem('kytp_player_id', newId);
    return newId;
  });
  const [inRoom, setInRoom] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [allRooms, setAllRooms] = useState<Record<string, RoomState> | null>(null);

  // 履歴管理
  const [history, setHistory] = useState<PlayedHistoryItem[]>(() => {
    const saved = localStorage.getItem('kytp_history');
    return saved ? JSON.parse(saved) : [];
  });

  const saveToHistory = (data: ParseResult, mid: string) => {
    if (!data.videoId) return;
    const thumbnail = `https://img.youtube.com/vi/${data.videoId}/mqdefault.jpg`;
    const newItem: PlayedHistoryItem = {
      id: mid,
      title: data.title || 'Unknown Stage',
      thumbnail,
      timestamp: Date.now()
    };
    const newHistory = [newItem, ...history.filter(h => h.id !== mid)].slice(0, 5);
    setHistory(newHistory);
    localStorage.setItem('kytp_history', JSON.stringify(newHistory));
  };

  const handleJoin = async () => {
    console.log('handleJoin clicked');
    if (!roomId.trim() || !playerName.trim()) {
      console.warn('Room ID or Player Name is empty');
      return;
    }
    try {
      console.log('Attempting to join room...');
      // 部屋が存在するがプレイヤーが0人の場合はクリーンアップする
      await deleteRoomIfEmpty(roomId);

      const currentState = await getRoomState(roomId);
      const existingCount = Object.keys(currentState?.players ?? {}).length;
      const color = PLAYER_COLORS[existingCount % PLAYER_COLORS.length];

      await joinRoom(roomId, playerId, playerName, color);
      console.log('In room state being set to true');
      setInRoom(true);

      subscribeToRoom(roomId, (state) => {
        console.log('Room state updated:', state);
        setRoomState(state);
      });
    } catch (err) {
      console.error('Failed to join room:', err);
      alert('入室に失敗しました。Firebaseの設定や通信状況を確認してください。');
    }
  };

  // ルームの曲が変更されたら自動でフェッチする
  useEffect(() => {
    if (roomState?.mapId) {
      if (!mapData || typeof mapData === 'object') {
        fetchMapData(roomState.mapId).then(data => {
          setMapData(data);
          saveToHistory(data, roomState.mapId!);
        }).catch(err => {
          console.error('Failed to sync map:', err);
        });
      }
    } else {
      setMapData(null);
    }
  }, [roomState?.mapId]);

  const handleMapLoad = async (data: ParseResult, inputMapId: string) => {
    setMapData(data);
    saveToHistory(data, inputMapId);
    if (inRoom) {
      await setRoomMapId(roomId, inputMapId);
    }
  };

  const handleBackToMenu = async () => {
    const isHost = determineHostId(roomState?.players) === playerId;
    if (isHost && roomId) {
      await resetRoom(roomId);
    }
    setMapData(null);
  };

  useEffect(() => {
    if (!inRoom) {
      const unsub = subscribeToAllRooms((rooms) => {
        setAllRooms(rooms);
        if (rooms) {
          const now = Date.now();
          Object.keys(rooms).forEach(rid => {
            const r = rooms[rid];
            const players = r.players || {};
            const pIds = Object.keys(players);
            if (pIds.length === 0) {
              deleteRoomIfEmpty(rid);
              return;
            }
            pIds.forEach(pid => {
              const p = players[pid];
              const last = p.lastSeen || 0;
              if (now - last > 60000) {
                cleanupPlayer(rid, pid);
              }
            });
          });
        }
      });
      return unsub;
    }
  }, [inRoom]);

  useEffect(() => {
    if (inRoom && roomId && playerId) {
      const interval = setInterval(() => {
        updatePlayerHeartbeat(roomId, playerId);
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [inRoom, roomId, playerId]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-[#fff5f7] via-white to-[#f5f3ff] text-zinc-800 p-6 overflow-x-hidden selection:bg-rose-200">

      <header className="flex flex-col items-center mb-10 relative z-10">
        <h1 className="text-6xl font-black mb-1 font-premium bg-clip-text text-transparent bg-gradient-to-br from-rose-400 via-rose-500 to-purple-500 tracking-tighter drop-shadow-sm">
          通うタイピング
        </h1>
        <div className="flex items-center gap-2">
          <div className="h-[2px] w-10 bg-gradient-to-r from-transparent to-rose-300"></div>
          <p className="text-[10px] font-black uppercase tracking-[0.5em] text-rose-400 font-premium">Browser Edition</p>
          <div className="h-[2px] w-10 bg-gradient-to-l from-transparent to-rose-300"></div>
        </div>
      </header>

      {!inRoom ? (
        <div className="bg-white border-4 border-white shadow-[0_20px_50px_rgba(255,133,161,0.1)] p-10 rounded-none w-full max-w-md relative z-10 overflow-hidden bubble-bg">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-rose-400 to-purple-400"></div>

          <div className="mb-8 text-center">
            <h1 className="text-4xl font-black font-premium text-zinc-700 italic uppercase tracking-tighter mb-2">部屋選択</h1>
            <p className="text-xs text-rose-300 font-black uppercase tracking-[0.2em] mb-8">部屋名を入力して入室</p>
          </div>

          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-black tracking-widest text-rose-400 ml-0.5 italic">ルーム設定</label>
              <input
                type="text"
                placeholder="ルームID (例: a)"
                value={roomId}
                onChange={e => setRoomId(e.target.value)}
                className="px-5 py-4 rounded-none bg-zinc-50 border-2 border-zinc-100 focus:outline-none focus:border-rose-300 focus:bg-white transition-all font-black text-zinc-700 placeholder:text-zinc-300 shadow-inner"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-black tracking-widest text-rose-400 ml-0.5 italic">あなたの名前</label>
              <input
                type="text"
                placeholder="プレイヤー名"
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                className="px-5 py-4 rounded-none bg-zinc-50 border-2 border-zinc-100 focus:outline-none focus:border-rose-300 focus:bg-white transition-all font-black text-zinc-700 placeholder:text-zinc-300 shadow-inner"
              />
            </div>

            <button
              onClick={handleJoin}
              className="w-full py-5 bg-rose-400 hover:bg-rose-500 text-white font-black rounded-none shadow-xl transition-all active:scale-[0.98] group font-premium mt-2"
            >
              入室
            </button>
          </div>

          {Object.keys(allRooms || {}).length > 0 && (
            <div className="mt-12 pt-8 border-t-2 border-zinc-50">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></div>
                <h3 className="text-sm font-black text-rose-300 uppercase tracking-widest italic">部屋一覧</h3>
              </div>
              <div className="grid grid-cols-1 gap-3 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                {Object.keys(allRooms || {}).map(rid => {
                  const r = allRooms![rid];
                  const pCount = Object.keys(r.players || {}).length;
                  if (pCount === 0) return null;
                  return (
                    <button
                      key={rid}
                      onClick={() => { setRoomId(rid); }}
                      className="group flex items-center justify-between p-4 bg-zinc-50 border-2 border-zinc-100 hover:border-rose-200 transition-all text-left active:scale-[0.98]"
                    >
                      <div className="flex flex-col">
                        <span className="text-xs font-black text-zinc-400 italic mb-0.5">部屋名</span>
                        <span className="font-black text-zinc-700 tracking-tighter"># {rid}</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-black text-rose-300 uppercase italic mb-0.5">プレイヤー</span>
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                          <span className="font-black text-sm text-zinc-600 tabular-nums">{pCount}P</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="w-full max-w-[1240px] flex gap-8 items-start relative z-10 mx-auto">
          {/* 左サイドバー: プレイ履歴 */}
          {mapData && (
            <aside className="w-48 flex-shrink-0 animate-in fade-in slide-in-from-left-4 duration-700 hidden lg:block sticky top-8">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1.5 h-4 bg-rose-400 rounded-full"></div>
                <h2 className="text-[10px] font-black text-rose-300 uppercase tracking-[0.2em] italic">History</h2>
              </div>
              <div className="flex flex-col gap-4">
                {history.map((item) => (
                  <div key={item.id} 
                    onClick={() => {
                      fetchMapData(item.id).then(data => handleMapLoad(data, item.id));
                    }}
                    className="group relative bg-white border-2 border-white shadow-sm hover:shadow-md transition-all p-1 cursor-pointer active:scale-95"
                  >
                    <img src={item.thumbnail} alt="" className="w-full aspect-video object-cover grayscale-[0.3] group-hover:grayscale-0 transition-all" />
                    <div className="p-2">
                      <div className="text-[9px] font-black text-rose-300 mb-0.5 tabular-nums">#{item.id}</div>
                      <div className="text-[10px] font-bold text-zinc-600 truncate leading-tight">{item.title}</div>
                    </div>
                  </div>
                ))}
                {history.length === 0 && (
                  <div className="text-[9px] font-bold text-zinc-300 uppercase tracking-widest text-center py-10 border-2 border-dashed border-zinc-100 italic">
                    No History
                  </div>
                )}
              </div>
            </aside>
          )}

          <div className="flex-1 flex flex-col items-center">
            <div className="bg-white border-2 border-white shadow-md px-6 py-2.5 rounded-none mb-8 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black text-rose-300 uppercase tracking-widest italic">Room</span>
                <span className="px-3 py-1 bg-rose-50 rounded-none font-black text-sm tabular-nums text-rose-400 tracking-tighter"># {roomId}</span>
              </div>
              <div className="w-[1px] h-4 bg-zinc-100"></div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black text-purple-300 uppercase tracking-widest italic">Player</span>
                <span className="font-black text-sm text-zinc-600 uppercase italic">{playerName}</span>
              </div>
            </div>

            {!mapData && <PlayerLane roomState={roomState} playerId={playerId} />}

            {!mapData && (
              <div className="w-full max-w-2xl transform transition-all animate-in fade-in slide-in-from-bottom-4 duration-500">
                <MapLoader onLoad={handleMapLoad} />
              </div>
            )}

            {mapData && (
              <div className="w-full transform transition-all animate-in fade-in zoom-in-95 duration-700">
                <TypingArea
                  key={roomState?.mapId || 'none'}
                  mapData={mapData}
                  roomId={roomId}
                  playerId={playerId}
                  roomState={roomState}
                  onBackToMenu={handleBackToMenu}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <footer className="mt-12 opacity-30 text-[10px] font-black uppercase tracking-[0.5em] pointer-events-none relative z-10">
        歌謡タイピング
      </footer>
    </div>
  );
}

export default App;
