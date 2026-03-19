import { useState, useEffect, useRef } from 'react';
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

  // 表示トグル
  const [showHistory, setShowHistory] = useState(true);
  const [showLyrics, setShowLyrics] = useState(true);

  // 現在の再生/タイピングブロック (TypingArea から同期)
  const [activeBlockIdx, setActiveBlockIdx] = useState(0);

  // フォント設定
  const [selectedFont, setSelectedFont] = useState("'M PLUS Rounded 1c', sans-serif");
  
  // 画面幅に応じてサイドバーを自動で閉じる (1000px以下で一旦閉じる)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1000) {
        setShowHistory(false);
        setShowLyrics(false);
      }
    };
    handleResize(); // 初期実行
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 音量管理 (localStorage保存、Keyboard操作)
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('kytp_volume');
    return saved ? Number(saved) : 50;
  });

  useEffect(() => {
    localStorage.setItem('kytp_volume', volume.toString());
    // sound.jsでグローバル変数として参照されているため、windowオブジェクトにセット
    (window as any).typeVolume = volume / 100;
    (window as any).clearVolume = volume / 100;
    (window as any).missVolume = volume / 100;
  }, [volume]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setVolume(prev => Math.min(100, prev + 5));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setVolume(prev => Math.max(0, prev - 5));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 日本語のセグメンテーション（ふりがな付与）
  const [history, setHistory] = useState<PlayedHistoryItem[]>(() => {
    const saved = localStorage.getItem('kytp_history');
    return saved ? JSON.parse(saved) : [];
  });

  const lyricsScrollRef = useRef<HTMLDivElement>(null);

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
    if (!roomId.trim() || !playerName.trim()) return;
    try {
      await deleteRoomIfEmpty(roomId);
      const currentState = await getRoomState(roomId);
      const existingCount = Object.keys(currentState?.players ?? {}).length;
      const color = PLAYER_COLORS[existingCount % PLAYER_COLORS.length];
      await joinRoom(roomId, playerId, playerName, color);
      setInRoom(true);
      subscribeToRoom(roomId, (state) => {
        setRoomState(state);
      });
    } catch (err) {
      console.error('Failed to join room:', err);
      alert('入室に失敗しました。');
    }
  };

  useEffect(() => {
    if (roomState?.mapId) {
      if (!mapData) {
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
  }, [roomState?.mapId, mapData]);

  // 歌詞の自動スクロール (ブロック単位)
  useEffect(() => {
    if (mapData && lyricsScrollRef.current) {
      const activeBlock = lyricsScrollRef.current.querySelector(`[data-set-idx="${activeBlockIdx}"]`);
      if (activeBlock) {
        activeBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [activeBlockIdx, mapData]);

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
            const pIds = Object.keys(r.players || {});
            if (pIds.length === 0) {
              deleteRoomIfEmpty(rid);
              return;
            }
            pIds.forEach(pid => {
              const p = r.players[pid];
              if (now - (p.lastSeen || 0) > 60000) {
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

  // 履歴アイテムコンポーネント (よりコンパクト)
  const HistoryCard = ({ item }: { item: PlayedHistoryItem }) => (
    <button
      onClick={() => fetchMapData(item.id).then(data => handleMapLoad(data, item.id))}
      className="group flex gap-2 bg-white border border-rose-50 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all p-2 text-left active:scale-95 w-full overflow-hidden"
    >
      <div className="w-12 aspect-video flex-shrink-0 overflow-hidden bg-zinc-50 rounded-sm">
        <img src={item.thumbnail} alt="" className="w-full h-full object-cover grayscale-[0.2] group-hover:grayscale-0 transition-all scale-110 group-hover:scale-100" />
      </div>
      <div className="flex flex-col justify-center min-w-0 flex-1">
        <div className="text-[10px] font-black text-rose-300 mb-0 tabular-nums uppercase italic"># {item.id}</div>
        <div className="text-[12px] font-black text-zinc-500 truncate leading-tight group-hover:text-rose-400 transition-colors uppercase italic tracking-tighter">{item.title}</div>
      </div>
    </button>
  );

  // グリッド列の動的設定
  const gridLayoutClass = `grid-cols-1 ${showHistory && showLyrics ? 'xl:grid-cols-[200px_1fr_500px]' :
    showHistory ? 'xl:grid-cols-[200px_1fr]' :
      showLyrics ? 'xl:grid-cols-[1fr_500px]' :
        'grid-cols-1'
    }`;

  return (
    <div
      className="flex flex-col items-center h-screen bg-gradient-to-br from-[#fff5f7] via-white to-[#f5f3ff] text-zinc-800 p-2 lg:p-4 overflow-hidden selection:bg-rose-200"
      style={{ fontFamily: selectedFont }}
    >

      <header className="flex flex-col items-center mb-6 relative z-10 w-full text-center flex-shrink-0">
        <h1 className="text-4xl font-black mb-1 font-premium bg-clip-text text-transparent bg-gradient-to-br from-rose-400 via-rose-500 to-purple-500 tracking-tighter drop-shadow-sm">
          通うタイピング
        </h1>
        <div className="flex items-center justify-center gap-1.5">
          <div className="h-[1px] w-6 bg-rose-200"></div>
          <p className="text-[8px] font-black uppercase tracking-[0.5em] text-rose-400 font-premium">Browser Edition</p>
          <div className="h-[1px] w-6 bg-rose-200"></div>
        </div>
      </header>

      {/* 高さ固定のコンテナ: h-[calc(100vh-180px)] 程度に設定し、
          各カラムの内部をスクロールさせることで下端を揃える 
      */}
      <div className={`w-full grid ${gridLayoutClass} gap-4 relative z-10 px-0 flex-1 min-h-0 overflow-hidden`}
        style={{ alignItems: 'stretch' }}
      >

        {/* 左カラム: プレイ履歴 */}
        {showHistory ? (
          <aside className="relative flex flex-col h-full animate-in fade-in slide-in-from-left-4 duration-500 min-h-0">
            <div className="flex items-center justify-between mb-3 ml-1 flex-shrink-0">
              <div className="flex items-center gap-1.5 ">
                <div className="w-1.5 h-3 bg-rose-400 rounded-full"></div>
                <h2 className="text-[10px] font-black text-rose-300 uppercase tracking-[0.2em] italic">History</h2>
              </div>
              <button
                onClick={() => setShowHistory(false)}
                className="w-5 h-5 flex items-center justify-center text-rose-200 hover:text-rose-400 hover:bg-rose-50 transition-all rounded-full"
              >
                <span className="text-[10px]">◀</span>
              </button>
            </div>
            <div className="flex flex-col gap-1.5 pr-1 overflow-y-auto custom-scrollbar flex-1 pb-4">
              {history.map(item => <HistoryCard key={item.id} item={item} />)}

              <div className="mt-8 pr-1 animate-in fade-in slide-in-from-left-2 duration-700">
                <div className="flex items-center gap-1.5 mb-3 ml-1">
                  <div className="w-1 h-3 bg-rose-400 rounded-full"></div>
                  <h2 className="text-[8px] font-black text-rose-300 uppercase tracking-[0.2em] italic">Settings</h2>
                </div>
                <div className="bg-white border border-rose-50 shadow-sm p-3 flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-black text-rose-300 uppercase italic tracking-tighter">Font Style</label>
                    <select
                      value={selectedFont}
                      onChange={(e) => setSelectedFont(e.target.value)}
                      className="w-full bg-zinc-50 border border-zinc-100 p-1.5 text-[10px] font-bold text-zinc-600 focus:outline-none focus:border-rose-200 appearance-none cursor-pointer"
                    >
                      <option value="'M PLUS Rounded 1c', sans-serif">Rounded (Default)</option>
                      <option value="'Zen Maru Gothic', sans-serif">Kawaii (Round)</option>
                      <option value="'Noto Sans JP', sans-serif">Modern (Gothic)</option>
                      <option value="'Shippori Mincho', serif">Elegant (Mincho)</option>
                      <option value="'Potta One', cursive">Pop (Bold)</option>
                      <option value="'Noto Sans Mono', monospace">Monospace (JP)</option>
                      <option value="'Orbitron', sans-serif">Digital (Futuristic)</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5 mt-2">
                    <div className="flex justify-between items-center">
                      <label className="text-[9px] font-black text-rose-300 uppercase italic tracking-tighter">Volume</label>
                      <span className="text-[10px] font-black text-zinc-400 tabular-nums">{volume}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      value={volume}
                      onChange={(e) => setVolume(Number(e.target.value))}
                      className="w-full h-1.5 bg-rose-100 rounded-lg appearance-none cursor-pointer accent-rose-400"
                    />
                    <p className="text-[7px] text-zinc-300 font-bold uppercase">Tip: Use Arrow Up/Down keys</p>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        ) : (
          <button
            onClick={() => setShowHistory(true)}
            className="flex h-20 self-start w-6 bg-white/50 backdrop-blur-sm border-r border-y border-rose-100 items-center justify-center text-rose-300 hover:bg-rose-50 hover:text-rose-500 transition-all z-20 shadow-sm mt-8"
          >
            <span className="text-xs transform scale-y-150 rotate-180">◀</span>
          </button>
        )}

        {/* 中央カラム: プレイヤー (プレイヤーラベルごとスクロール) */}
        <main className="flex-1 flex flex-col min-w-0 h-full animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-y-auto custom-scrollbar pr-2">
          {/* ヘッダーラベル */}
          <div className="flex items-center gap-1.5 mb-3 ml-1 flex-shrink-0">
            <div className="w-1.5 h-3 bg-rose-400 rounded-full"></div>
            <h2 className="text-[10px] font-black text-rose-300 uppercase tracking-[0.2em] italic">Player</h2>
          </div>

          {/* コンテンツエリア */}
          <div className="flex-1 pb-4">
            {!inRoom ? (
              /* 入室画面 */
              <div className="bg-white border-4 border-white shadow-xl p-8 rounded-none w-full max-w-md mx-auto relative z-10 overflow-hidden bubble-bg animate-in zoom-in-95 duration-500">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-rose-400 to-purple-400"></div>
                <div className="mb-6 text-center">
                  <h1 className="text-3xl font-black font-premium text-zinc-700 italic uppercase tracking-tighter mb-1">部屋選択</h1>
                  <p className="text-[10px] text-rose-300 font-black uppercase tracking-[0.2em]">部屋名を入力して入室</p>
                </div>
                <div className="flex flex-col gap-4">
                  <input
                    type="text"
                    placeholder="ルームID"
                    value={roomId}
                    onChange={e => setRoomId(e.target.value)}
                    className="px-4 py-3 rounded-none bg-zinc-50 border-2 border-zinc-100 focus:outline-none focus:border-rose-300 focus:bg-white transition-all font-black text-zinc-700 shadow-inner text-sm"
                  />
                  <input
                    type="text"
                    placeholder="プレイヤー名"
                    value={playerName}
                    onChange={e => setPlayerName(e.target.value)}
                    className="px-4 py-3 rounded-none bg-zinc-50 border-2 border-zinc-100 focus:outline-none focus:border-rose-300 focus:bg-white transition-all font-black text-zinc-700 shadow-inner text-sm"
                  />
                  <button
                    onClick={handleJoin}
                    className="w-full py-4 bg-rose-400 hover:bg-rose-500 text-white font-black shadow-lg transition-all active:scale-95 text-sm uppercase font-premium"
                  >
                    入室
                  </button>

                  {/* 稼働中のルーム一覧 */}
                  <div className="mt-8 pt-6 border-t border-zinc-100">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-1 h-3 bg-purple-400 rounded-full"></div>
                      <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest italic">稼働中の部屋</h3>
                    </div>
                    
                    {!allRooms || Object.keys(allRooms).length === 0 ? (
                      <div className="text-[10px] text-zinc-300 italic text-center py-4 bg-zinc-50 border border-dashed border-zinc-200">
                        現在稼働中の部屋はありません
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                        {Object.entries(allRooms).map(([rid, state]) => {
                          const pCount = Object.keys(state.players || {}).length;
                          const isPlaying = state.status === 'playing';
                          return (
                            <button
                              key={rid}
                              onClick={() => {
                                setRoomId(rid);
                                // 名前が入力済みなら即座にジョインを試みることも可能だが、
                                // 確認のためにIDを入れるだけに留める
                              }}
                              className="group flex items-center justify-between p-3 bg-white border border-zinc-100 hover:border-rose-200 hover:bg-rose-50/30 transition-all text-left"
                            >
                              <div className="flex flex-col">
                                <span className="text-xs font-black text-zinc-600 group-hover:text-rose-500"># {rid}</span>
                                <span className="text-[9px] font-bold text-zinc-400">
                                  {isPlaying ? '🎮 プレイ中' : '⏳ 待機中'}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex -space-x-1">
                                  {Array.from({ length: Math.min(3, pCount) }).map((_, i) => (
                                    <div key={i} className="w-4 h-4 rounded-full border-2 border-white bg-rose-200"></div>
                                  ))}
                                </div>
                                <span className="text-[10px] font-black text-rose-300">{pCount} 名</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* ルーム内画面 */
              <div className="w-full flex flex-col h-full">
                {!mapData ? (
                  /* マップ選択待ち状態 */
                  <div className="w-full h-full flex flex-col min-h-0">
                    <div className="flex-shrink-0 py-4 bg-white/60 backdrop-blur-md border-b border-rose-100 flex justify-center shadow-[0_10px_20px_rgba(255,133,161,0.05)] mb-4">
                      <PlayerLane roomState={roomState} playerId={playerId} />
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                      <MapLoader onLoad={handleMapLoad} />
                    </div>
                  </div>
                ) : (
                  /* プレイ（タイピング）状態 */
                  <div className="w-full h-full transform transition-all animate-in fade-in zoom-in-95 duration-1000 relative">
                    {/* プレイヤー情報バッジ */}
                    <div className="absolute top-2 left-2 z-50 bg-white/80 backdrop-blur-sm px-3 py-1 flex items-center gap-2 border border-zinc-100 shadow-sm pointer-events-none">
                      <span className="font-black text-[10px] text-rose-400 tabular-nums"># {roomId}</span>
                      <div className="w-[1px] h-2 bg-zinc-200"></div>
                      <span className="font-black text-[10px] text-zinc-500 uppercase italic">{playerName}</span>
                    </div>

                    <TypingArea
                      key={roomState?.mapId || 'none'}
                      mapData={mapData}
                      roomId={roomId}
                      playerId={playerId}
                      roomState={roomState}
                      onBackToMenu={handleBackToMenu}
                      onBlockChange={(idx) => setActiveBlockIdx(idx)}
                      volume={volume}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {/* 右カラム: 歌詞リスト */}
        {showLyrics ? (
          <aside className="relative flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-500 overflow-hidden">
            <div className="flex items-center justify-between mb-3 ml-1 flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-3 bg-purple-400 rounded-full"></div>
                <h2 className="text-[10px] font-black text-purple-300 uppercase tracking-[0.4em] italic">Guide</h2>
              </div>
              <button
                onClick={() => setShowLyrics(false)}
                className="w-5 h-5 flex items-center justify-center text-purple-200 hover:text-purple-400 hover:bg-purple-50 transition-all rounded-full"
              >
                <span className="text-[10px]">▶</span>
              </button>
            </div>
            {/* Guideのコンテンツエリアを flex-1 + overflow-y-auto にして高さを揃える */}
            <div
              ref={lyricsScrollRef}
              className="flex-1 bg-white border border-zinc-100 shadow-sm overflow-y-auto custom-scrollbar p-3"
            >
              {mapData?.displaySets.map((set, setIdx) => {
                const isActive = setIdx === activeBlockIdx;
                return (
                  <div
                    key={setIdx}
                    data-set-idx={setIdx}
                    className={`break-inside-avoid mb-4 border-l-4 p-4 transition-all rounded-r-md scroll-mt-4 ${isActive ? 'border-rose-400 bg-rose-100 shadow-xl ring-1 ring-rose-200 scale-[1.02] z-10' : 'border-zinc-50 bg-zinc-50/5'}`}
                  >
                    <div className={`text-[10px] font-black uppercase tracking-widest italic mb-2 transition-colors ${isActive ? 'text-rose-500 opacity-100' : 'text-rose-300 opacity-60'}`}>Block {setIdx + 1}</div>
                    <div className="flex flex-col gap-2">
                      {set.lines.map((line, lIdx) => {
                        const hiragana = line.chunks.map((c: any) => c.text).join('');
                        return (
                          <div
                            key={lIdx}
                            className={`font-black leading-tight transition-all ${isActive ? 'text-zinc-900 text-[20px] drop-shadow-sm' : 'text-zinc-400 text-[13px]'}`}
                          >
                            {hiragana}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        ) : (
          <button
            onClick={() => setShowLyrics(true)}
            className="flex h-20 self-start w-6 bg-white/50 backdrop-blur-sm border-l border-y border-purple-100 items-center justify-center text-purple-300 hover:bg-purple-50 hover:text-purple-500 transition-all z-20 shadow-sm mt-8"
          >
            <span className="text-xs transform scale-y-150">▶</span>
          </button>
        )}

      </div>

      <footer className="py-2 opacity-10 text-[8px] font-black uppercase tracking-[0.5em] pointer-events-none relative z-10 w-full text-center flex-shrink-0">
        歌謡タイピング
      </footer>
    </div>
  );
}

export default App;