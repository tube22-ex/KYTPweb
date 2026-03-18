import { useState, useEffect } from 'react';
import { MapLoader } from './components/MapLoader';
import { TypingArea } from './components/TypingArea';
import { PlayerLane } from './components/PlayerLane';
import { ParseResult, fetchMapData } from './services/api';
import { joinRoom, subscribeToRoom, RoomState, setRoomMapId, PLAYER_COLORS, getRoomState, resetRoom, determineHostId, deleteRoomIfEmpty, subscribeToAllRooms, leaveRoom as cleanupPlayer, updatePlayerHeartbeat } from './services/sync';

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
      if (!mapData || typeof mapData === 'object') { // 厳密な比較は省略し再フェッチ
        fetchMapData(roomState.mapId).then(data => {
          setMapData(data);
        }).catch(err => {
          console.error('Failed to sync map:', err);
        });
      }
    } else {
      setMapData(null); // 曲がリセットされた時
    }
  }, [roomState?.mapId]);

  const handleMapLoad = async (data: ParseResult, inputMapId: string) => {
    setMapData(data);
    if (inRoom) {
      // 自分が曲をロードしたらFirebaseのRoom状態も更新する
      await setRoomMapId(roomId, inputMapId);
    }
  };

  // リザルト画面から曲選択に戻る
  const handleBackToMenu = async () => {
    // 自身がホストなら部屋をリセット（idle状態に戻す）
    const isHost = determineHostId(roomState?.players) === playerId;
    if (isHost && roomId) {
      await resetRoom(roomId);
    }

    setMapData(null);
    // Note: leaveRoomは呼び出さず、inRoom/roomIdも維持することでロビー（選曲画面）に戻る
  };

  // 全ルーム購読とクリーンアップ
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
            
            // 0人の部屋を削除
            if (pIds.length === 0) {
              deleteRoomIfEmpty(rid);
              return;
            }

            // 幽霊プレイヤー（30秒以上無反応）を削除
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

  const activeRoomsCount = allRooms ? Object.keys(allRooms).filter(rid => {
    const players = allRooms[rid].players;
    return players && Object.keys(players).length > 0;
  }).length : 0;

  // ハートビート (15秒ごとに生存確認を更新)
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

          <div className="mb-8">
            <h2 className="text-2xl font-black font-premium mb-1 text-zinc-700">Welcome Back</h2>
            <p className="text-zinc-400 text-sm font-bold">Please log in to your stage.</p>
          </div>

          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-black tracking-widest text-rose-400 ml-0.5 italic">Room Identity</label>
              <input
                type="text"
                placeholder="Ex: 1234"
                value={roomId}
                onChange={e => setRoomId(e.target.value)}
                className="px-5 py-4 rounded-none bg-zinc-50 border-2 border-zinc-100 focus:outline-none focus:border-rose-300 focus:bg-white transition-all font-black text-zinc-700 placeholder:text-zinc-300 shadow-inner"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase font-black tracking-widest text-rose-400 ml-0.5 italic">Stage Name</label>
              <input
                type="text"
                placeholder="Ex: Player One"
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                className="px-5 py-4 rounded-none bg-zinc-50 border-2 border-zinc-100 focus:outline-none focus:border-rose-300 focus:bg-white transition-all font-black text-zinc-700 placeholder:text-zinc-300 shadow-inner"
              />
            </div>

            <button
              onClick={handleJoin}
              className="group relative bg-rose-400 text-white py-4 rounded-none font-black text-lg transition-all hover:bg-rose-500 active:scale-[0.98] shadow-lg shadow-rose-200 mt-2"
            >
              <span className="relative z-10 flex items-center justify-center gap-2 uppercase tracking-tighter">
                Enter the Show
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </span>
            </button>
          </div>

          {activeRoomsCount > 0 && (
            <div className="mt-10">
              <h3 className="text-[10px] uppercase font-black tracking-[0.3em] text-rose-300 mb-4 text-center">Live Stages</h3>
              <div className="grid grid-cols-1 gap-3 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                {Object.entries(allRooms || {})
                  .filter(([_, state]) => state.players && Object.keys(state.players).length > 0)
                  .map(([rid, state]) => {
                    const pCount = Object.keys(state.players || {}).length;
                    return (
                      <button
                        key={rid}
                        onClick={() => { setRoomId(rid); }}
                        className="group flex items-center justify-between p-4 bg-zinc-50 border-2 border-zinc-100 hover:border-rose-200 transition-all text-left active:scale-[0.98]"
                      >
                        <div className="flex flex-col">
                          <span className="text-xs font-black text-zinc-400 italic mb-0.5">Stage ID</span>
                          <span className="font-black text-zinc-700 tracking-tighter"># {rid}</span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] font-black text-rose-300 uppercase italic mb-0.5">Audience</span>
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
        <div className="w-full max-w-5xl flex flex-col items-center relative z-10 mx-auto">
          <div className="bg-white border-2 border-white shadow-md px-6 py-2.5 rounded-none mb-8 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black text-rose-300 uppercase tracking-widest italic">Room</span>
              <span className="px-3 py-1 bg-rose-50 rounded-none font-black text-sm tabular-nums text-rose-400 tracking-tighter"># {roomId}</span>
            </div>
            <div className="w-[1px] h-4 bg-zinc-100"></div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black text-purple-300 uppercase tracking-widest italic">Artist</span>
              <span className="font-black text-sm text-zinc-600 uppercase italic">{playerName}</span>
            </div>
          </div>

          {/* 楽曲選択・ロード前のみアバターを表示（プレイ中はTypingArea内で表示） */}
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
      )}

      <footer className="mt-12 opacity-30 text-[10px] font-black uppercase tracking-[0.5em] pointer-events-none relative z-10">
        &copy; 2026 Kayo Typing Theater Project
      </footer>
    </div>
  );
}

export default App;
