import { useState, useEffect } from 'react';
import { MapLoader } from './components/MapLoader';
import { TypingArea } from './components/TypingArea';
import { PlayerLane } from './components/PlayerLane';
import { ParseResult, fetchMapData } from './services/api';
import { joinRoom, subscribeToRoom, RoomState, setRoomMapId } from './services/sync';

function App() {
  const [mapData, setMapData] = useState<ParseResult | null>(null);

  // ルーム管理ステート
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [playerId] = useState(() => Math.random().toString(36).substring(2, 10));
  const [inRoom, setInRoom] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);

  const handleJoin = async () => {
    console.log('handleJoin clicked');
    if (!roomId.trim() || !playerName.trim()) {
      console.warn('Room ID or Player Name is empty');
      return;
    }
    const colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b']; // 赤, 青, 緑, 黄
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    try {
      console.log('Attempting to join room...');
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
  const handleBackToMenu = () => {
    setMapData(null);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f172a] text-white p-6 overflow-x-hidden selection:bg-blue-500/30">
      {/* 背景の装飾的な光 */}
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full pointer-events-none"></div>

      <header className="flex flex-col items-center mb-12 relative z-10">
        <h1 className="text-6xl font-black mb-2 font-premium bg-clip-text text-transparent bg-gradient-to-br from-white via-white to-blue-400 tracking-tighter">
          歌謡タイピング劇場
        </h1>
        <div className="flex items-center gap-2">
          <div className="h-[1px] w-8 bg-gradient-to-r from-transparent to-blue-500/50"></div>
          <p className="text-xs font-black uppercase tracking-[0.4em] text-blue-500/80 font-premium">Browser Edition</p>
          <div className="h-[1px] w-8 bg-gradient-to-l from-transparent to-blue-500/50"></div>
        </div>
      </header>
      
      {!inRoom ? (
        <div className="glass p-10 rounded-3xl shadow-2xl w-full max-w-md relative z-10 group overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500"></div>
          
          <div className="mb-8">
            <h2 className="text-2xl font-black font-premium mb-1">Welcome Back</h2>
            <p className="text-gray-500 text-sm font-semibold">Enter a room ID and your name to start.</p>
          </div>

          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] uppercase font-black tracking-widest text-blue-400 ml-1">Room Identity</label>
              <input 
                type="text" 
                placeholder="Ex: 1234" 
                value={roomId} 
                onChange={e => setRoomId(e.target.value)} 
                className="px-5 py-4 rounded-xl bg-white/5 border border-white/10 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all font-bold placeholder:text-white/20"
              />
            </div>
            
            <div className="flex flex-col gap-2">
              <label className="text-[10px] uppercase font-black tracking-widest text-blue-400 ml-1">Stage Name</label>
              <input 
                type="text" 
                placeholder="Ex: Player One" 
                value={playerName} 
                onChange={e => setPlayerName(e.target.value)} 
                className="px-5 py-4 rounded-xl bg-white/5 border border-white/10 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all font-bold placeholder:text-white/20"
              />
            </div>

            <button 
              onClick={handleJoin} 
              className="group relative bg-white text-black py-4 rounded-xl font-black text-lg transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl hover:shadow-white/10"
            >
              <span className="relative z-10 flex items-center justify-center gap-2 uppercase tracking-tighter">
                Join the Show
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-5xl flex flex-col items-center relative z-10">
          <div className="glass px-6 py-3 rounded-2xl mb-8 flex items-center gap-4 border-white/5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Room</span>
              <span className="px-3 py-1 bg-white/10 rounded-lg font-black text-sm tabular-nums tracking-tighter">{roomId}</span>
            </div>
            <div className="w-[1px] h-4 bg-white/10"></div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Artist</span>
              <span className="font-black text-sm">{playerName}</span>
            </div>
          </div>

          <PlayerLane roomState={roomState} playerId={playerId} />
          
          {!mapData && (
            <div className="w-full max-w-2xl transform transition-all animate-in fade-in slide-in-from-bottom-4 duration-500">
              <MapLoader onLoad={handleMapLoad} />
            </div>
          )}

          {mapData && (
            <div className="w-full transform transition-all animate-in fade-in zoom-in-95 duration-700">
              <TypingArea 
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
