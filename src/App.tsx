import React, { useState, useEffect, useCallback, useRef } from 'react';
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

const BASE_WIDTH = 1280;
const BASE_HEIGHT = 720;

export default function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mapData, setMapData] = useState<ParseResult | null>(null);

  // ルーム管理ステート
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState(() => 'User_' + Math.random().toString(36).substring(2, 6));
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
  const [showHistory, setShowHistory] = useState(false);
  const [showLyrics, setShowLyrics] = useState(true);

  // 現在の再生/タイピングブロック (TypingArea から同期)
  const [activeBlockIdx, setActiveBlockIdx] = useState(0);

  // フォント設定
  const [selectedFont, setSelectedFont] = useState("'M PLUS Rounded 1c', sans-serif");
  
  // 画面スケーリング処理
  useEffect(() => {
    const updateScale = () => {
      if (!rootRef.current) return;
      
      const scaleX = window.innerWidth / BASE_WIDTH;
      const scaleY = window.innerHeight / BASE_HEIGHT;
      const scale = Math.min(scaleX, scaleY);
      
      rootRef.current.style.transform = `scale(${scale})`;
      rootRef.current.style.transformOrigin = 'top left';
      rootRef.current.style.width = `${BASE_WIDTH}px`;
      rootRef.current.style.height = `${BASE_HEIGHT}px`;
      
      // ボディサイズを調整してスクロールバーを防止しつつ中央寄せ
      document.body.style.width = `${BASE_WIDTH * scale}px`;
      document.body.style.height = `${BASE_HEIGHT * scale}px`;
      document.body.style.margin = '0 auto';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'relative';
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // 音量管理 (localStorage保存、Keyboard操作)
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('kytp_volume');
    return saved ? Number(saved) : 50;
  });

  useEffect(() => {
    localStorage.setItem('kytp_volume', volume.toString());
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

  const handleJoin = async (targetRoomId: string = roomId) => {
    const idToJoin = targetRoomId.trim() || roomId.trim();
    if (!idToJoin || !playerName.trim()) return;
    try {
      await deleteRoomIfEmpty(idToJoin);
      const currentState = await getRoomState(idToJoin);
      if (currentState?.status === 'playing') {
        alert('プレイ中の部屋には入室できません。');
        return;
      }
      const existingCount = Object.keys(currentState?.players ?? {}).length;
      const color = PLAYER_COLORS[existingCount % PLAYER_COLORS.length];
      await joinRoom(idToJoin, playerId, playerName, color);
      setRoomId(idToJoin);
      setInRoom(true);
      subscribeToRoom(idToJoin, (state) => {
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

  return (
    <div
      ref={rootRef}
      className="flex flex-col items-center bg-gradient-to-br from-[#fff5f7] via-white to-[#f5f3ff] text-zinc-800 selection:bg-rose-200"
      style={{ 
        fontFamily: selectedFont,
        width: `${BASE_WIDTH}px`,
        height: `${BASE_HEIGHT}px`,
        position: 'absolute',
        top: 0,
        left: 0,
        overflow: 'hidden'
      }}
    >
      <header className="flex flex-col items-center relative z-10 w-full text-center flex-shrink-0" style={{ height: '70px', paddingTop: '10px' }}>
        <h1 className="text-3xl font-black mb-0 font-premium bg-clip-text text-transparent bg-gradient-to-br from-rose-400 via-rose-500 to-purple-500 tracking-tighter drop-shadow-sm leading-none">
          通うタイピング
        </h1>
        <div className="flex items-center justify-center gap-1.5 mt-1">
          <div className="h-[1px] w-6 bg-rose-200"></div>
          <p className="text-[7px] font-black uppercase tracking-[0.5em] text-rose-400 font-premium">Browser Edition</p>
          <div className="h-[1px] w-6 bg-rose-200"></div>
        </div>
      </header>

      <div className="flex flex-row items-start relative z-10 flex-1 w-full layout-root"
        style={{ margin: 0, padding: 0 }}
      >
        {/* 左カラム: プレイ履歴 (130px) */}
        <div className="left-column relative h-full flex flex-row items-start" style={{ flexShrink: 0, width: showHistory ? '130px' : '30px' }}>
          <aside className={`relative flex flex-col h-full transition-all duration-200 ease-out overflow-hidden ${showHistory ? 'open' : ''}`}
            style={{ width: showHistory ? '130px' : '0px', minWidth: showHistory ? '130px' : '0px', flexShrink: 0 }}>
            <div className="w-[130px] flex flex-col h-full pr-1">
              <div className="flex items-center justify-between mb-3 ml-1 flex-shrink-0">
                <div className="flex items-center gap-1.5 ">
                  <div className="w-1.5 h-3 bg-rose-400 rounded-full"></div>
                  <h2 className="text-[10px] font-black text-rose-300 uppercase tracking-[0.2em] italic">History</h2>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 pr-1 overflow-y-auto custom-scrollbar flex-1 pb-4">
                {history.map(item => <HistoryCard key={item.id} item={item} />)}
                <div className="mt-8 pr-1">
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
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex h-12 w-6 bg-white border border-rose-100 items-center justify-center text-rose-300 hover:bg-rose-50 hover:text-rose-500 transition-all z-20 shadow-sm mt-4 rounded-r-md"
          >
            <span className="text-[10px] tabular-nums">{showHistory ? '◀' : '▶'}</span>
          </button>
        </div>

        {/* 中央カラム: プレイヤー (860px) */}
        <main className="center-column animate-in fade-in slide-in-from-bottom-4 duration-500 shrink-0">
          <div className="flex items-center gap-1.5 mb-3 ml-1 flex-shrink-0">
            <div className="w-1.5 h-3 bg-rose-400 rounded-full"></div>
            <h2 className="text-[10px] font-black text-rose-300 uppercase tracking-[0.2em] italic">Player</h2>
          </div>
          <div className="flex-1 pb-4">
            {!inRoom ? (
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
                    onClick={() => handleJoin()}
                    className="w-full py-4 bg-rose-400 hover:bg-rose-500 text-white font-black shadow-lg transition-all active:scale-95 text-sm uppercase font-premium"
                  >
                    入室
                  </button>
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
                              onClick={() => setRoomId(rid)}
                              onDoubleClick={() => !isPlaying && handleJoin(rid)}
                              className="group flex items-center justify-between p-3 bg-white border border-zinc-100 hover:border-rose-200 hover:bg-rose-50/30 transition-all text-left"
                            >
                              <div className="flex flex-col">
                                <span className="text-xs font-black text-zinc-600 group-hover:text-rose-500"># {rid}</span>
                                <span className="text-[9px] font-bold text-zinc-400">
                                  {isPlaying ? '🎮 プレイ中' : '⏳ 待機中'}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
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
              <div className="w-full flex flex-col h-full">
                {!mapData ? (
                  <div className="w-full h-full flex flex-col min-h-0">
                    <div className="flex-shrink-0 bg-white/60 backdrop-blur-md border-b border-rose-100 flex justify-center shadow-[0_10px_20px_rgba(255,133,161,0.05)]" style={{ padding: 0, marginBottom: '4px' }}>
                      <PlayerLane roomState={roomState} playerId={playerId} />
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                      <MapLoader onLoad={handleMapLoad} />
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full transform transition-all animate-in fade-in zoom-in-95 duration-1000 relative">
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

        {/* 右カラム: 歌詞リスト (290px) */}
        <aside className="right-column guide-column relative flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-500 overflow-hidden"
          style={{ width: '290px', minWidth: '290px', maxWidth: '290px' }}>
          {showLyrics && (
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between mb-3 ml-1 flex-shrink-0">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-3 rounded-full" style={{ backgroundColor: '#e91e8c' }}></div>
                  <h2 className="text-[10px] font-black uppercase tracking-[0.4em] italic" style={{ color: '#e91e8c', opacity: 1 }}>Guide</h2>
                </div>
                <button
                  onClick={() => setShowLyrics(false)}
                  className="w-5 h-5 flex items-center justify-center text-purple-200 hover:text-purple-400 hover:bg-purple-50 transition-all rounded-full"
                >
                  <span className="text-[10px]">▶</span>
                </button>
              </div>
              <div
                ref={lyricsScrollRef}
                className="flex-1 border border-zinc-100 shadow-sm overflow-y-auto custom-scrollbar p-3"
                style={{ backgroundColor: '#fff5f8' }}
              >
                {mapData?.displaySets.map((set, setIdx) => {
                  const isActive = setIdx === activeBlockIdx;
                  return (
                    <div
                      key={setIdx}
                      data-set-idx={setIdx}
                      className={`break-inside-avoid mb-4 border-l-4 p-4 transition-all rounded-r-md scroll-mt-4 ${isActive ? 'border-rose-400 bg-rose-100 shadow-xl ring-1 ring-rose-200 scale-[1.02] z-10' : 'border-zinc-50 bg-white/50'}`}
                    >
                      <div className="uppercase tracking-widest italic mb-2 transition-colors" style={{ fontSize: '14px', color: '#e91e8c', fontWeight: 700, opacity: 1 }}>Block {setIdx + 1}</div>
                      <div className="flex flex-col gap-2">
                        {set.lines.map((line, lIdx) => {
                          const hiragana = line.chunks.map((c: any) => c.text).join('');
                          return (
                            <div key={lIdx} className="leading-tight transition-all break-all font-bold opacity-100"
                              style={{ color: isActive ? '#1a1a1a' : '#666666', fontSize: isActive ? '16px' : '14px', wordBreak: 'break-all' }}>
                              {hiragana}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {!showLyrics && (
            <button
              onClick={() => setShowLyrics(true)}
              className="flex h-12 w-6 bg-white border border-rose-100 items-center justify-center text-rose-300 hover:bg-rose-50 hover:text-rose-500 transition-all z-20 shadow-sm mt-4 rounded-l-md self-end"
            >
              <span className="text-[10px] tabular-nums">◀</span>
            </button>
          )}
        </aside>
      </div>

      <footer className="py-2 opacity-10 text-[8px] font-black uppercase tracking-[0.5em] pointer-events-none relative z-10 w-full text-center flex-shrink-0">
        通うタイピング
      </footer>
    </div>
  );
}