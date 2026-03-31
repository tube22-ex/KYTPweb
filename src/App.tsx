import { useState, useEffect, useRef } from 'react';
import { MapLoader } from './components/MapLoader';
import { TypingArea } from './components/TypingArea';
import { PlayerLane } from './components/PlayerLane';
import { MapEditor } from './components/MapEditor';
import { ParseResult, fetchMapData } from './services/api';
import {
  joinRoom,
  subscribeToRoom,
  RoomState,
  setRoomMapId,
  SlotId,
  getRoomState,
  resetRoom,
  determineHostId,
  deleteRoomIfEmpty,
  subscribeToAllRooms,
  leaveRoom as cleanupPlayer,
  updatePlayerHeartbeat,
  releaseSlot,
} from './services/sync';

interface PlayedHistoryItem {
  id: string;
  title: string;
  thumbnail: string;
  timestamp: number;
}

const BASE_WIDTH = 1280;
const BASE_HEIGHT = 850;

// ★ ユーザー入力のルームIDにプレフィックスを付けてFirebase用IDに変換
const toFirebaseRoomId = (rawId: string) => `room-${rawId}`;
// ★ 表示用に room- を除去
const toDisplayRoomId = (firebaseId: string) => firebaseId.replace(/^room-/, '');

export default function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mapData, setMapData] = useState<ParseResult | null>(null);

  // ルーム管理ステート
  // roomInputはユーザーが入力する表示用ID、roomIdはFirebase内部用ID（room-プレフィックス付き）
  const [roomInput, setRoomInput] = useState('');
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem('kytp_player_name') || 'User_' + Math.random().toString(36).substring(2, 6);
  }); const [playerId] = useState(() => {
    const saved = localStorage.getItem('kytp_player_id');
    if (saved) return saved;
    const newId = Math.random().toString(36).substring(2, 10);
    localStorage.setItem('kytp_player_id', newId);
    return newId;
  });
  const [inRoom, setInRoom] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [allRooms, setAllRooms] = useState<Record<string, RoomState> | null>(null);

  const [mySlotId, setMySlotId] = useState<SlotId | null>(null);

  // 表示トグル
  const [showHistory, setShowHistory] = useState(() => {
    return localStorage.getItem('kytp_show_history') === 'true';
  });
  const [showGuide, setShowGuide] = useState(() => {
    const saved = localStorage.getItem('kytp_show_guide');
    return saved === null ? true : saved === 'true';
  });
  const [editorInitialId, setEditorInitialId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editorInitialData, setEditorInitialData] = useState<ParseResult | null>(null);

  // 現在の再生/タイピングブロック
  const [activeBlockIdx, setActiveBlockIdx] = useState(0);
  const guideRef = useRef<HTMLDivElement>(null);
  const hasPrefilledRef = useRef(false);

  useEffect(() => {
    if (guideRef.current && showGuide) {
      const activeBlock = guideRef.current.querySelector('.guide-block-active');
      if (activeBlock) {
        guideRef.current.scrollTo({
          top: (activeBlock as HTMLElement).offsetTop,
          behavior: 'smooth'
        });
      }
    }
  }, [activeBlockIdx, showGuide]);

  // フォント設定
  const [selectedFont, setSelectedFont] = useState(() => {
    return localStorage.getItem('kytp_font') || "'Noto Sans Mono', monospace";
  });

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

  // 音量管理
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('kytp_volume');
    return saved ? Number(saved) : 50;
  });

  // SE音量管理
  const [seVolume, setSeVolume] = useState(() => {
    const saved = localStorage.getItem('kytp_se_volume');
    return saved ? Number(saved) : 60;
  });

  const [hideVideo, setHideVideo] = useState(() => {
    return localStorage.getItem('kytp_hide_video') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('kytp_volume', volume.toString());
  }, [volume]);

  useEffect(() => {
    localStorage.setItem('kytp_se_volume', seVolume.toString());
    (window as any).typeVolume = seVolume / 100;
    (window as any).clearVolume = seVolume / 100;
    (window as any).missVolume = seVolume / 100;
  }, [seVolume]);


  useEffect(() => {
    localStorage.setItem('kytp_player_name', playerName);
  }, [playerName]);

  useEffect(() => {
    localStorage.setItem('kytp_hide_video', hideVideo.toString());
  }, [hideVideo]);

  useEffect(() => {
    localStorage.setItem('kytp_font', selectedFont);
  }, [selectedFont]);

  useEffect(() => {
    localStorage.setItem('kytp_show_history', showHistory.toString());
  }, [showHistory]);

  useEffect(() => {
    localStorage.setItem('kytp_show_guide', showGuide.toString());
  }, [showGuide]);



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

  const handleJoin = async (rawId: string = roomInput) => {
    const trimmed = rawId.trim();
    if (!trimmed || !playerName.trim()) return;
    const idToJoin = toFirebaseRoomId(trimmed);

    try {
      await deleteRoomIfEmpty(idToJoin);
      const currentState = await getRoomState(idToJoin);
      if (currentState?.status === 'playing') {
        alert('プレイ中の部屋には入室できません。');
        return;
      }

      const { slotId } = await joinRoom(idToJoin, playerId, playerName);
      setMySlotId(slotId);
      setRoomId(idToJoin);
      setInRoom(true);
      subscribeToRoom(idToJoin, (state) => {
        setRoomState(state);
      });
    } catch (err: any) {
      console.error('Failed to join room:', err);
      if (err.message === 'ROOM_FULL') {
        alert('この部屋は満員です（最大8名）。');
      } else {
        alert('入室に失敗しました。');
      }
    }
  };

  const handleMapLoad = async (data: ParseResult, inputMapId: string) => {
    setMapData(data);
    saveToHistory(data, inputMapId);
    if (inRoom) {
      await setRoomMapId(roomId, inputMapId);
    }
    setShowEditor(false);
    setEditorInitialData(null);
    setEditorInitialId(null);
  };

  const isLeavingRef = useRef(false);

  const handleBackToMenu = async () => {
    isLeavingRef.current = true;
    const isHost = determineHostId(roomState?.players) === playerId;
    if (isHost && roomId) {
      await resetRoom(roomId);
    }
    setMapData(null);
    setTimeout(() => { isLeavingRef.current = false; }, 1000);
  };

  useEffect(() => {
    if (roomState?.mapId) {
      if (!mapData && !isLeavingRef.current) {
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
    if (!inRoom) {
      hasPrefilledRef.current = false;
      const unsub = subscribeToAllRooms((rooms) => {
        setAllRooms(rooms);

        // ★ 部屋が一つもない場合、入力欄に「部屋」と事前入力しておく
        if (!hasPrefilledRef.current) {
          if (!rooms || Object.keys(rooms).length === 0) {
            setRoomInput(prev => prev === '' ? '部屋' : prev);
          }
          hasPrefilledRef.current = true;
        }

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
              if (now - (p.lastSeen || 0) > 180000) {
                const ghostSlotId = (p as any).slotId as SlotId | undefined;
                cleanupPlayer(rid, pid, ghostSlotId ?? null);
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

  useEffect(() => {
    if (inRoom && roomState && playerId && roomState.players && !roomState.players[playerId]) {
      setInRoom(false);
      setRoomId('');
      setMapData(null);
      setMySlotId(null);
      alert('長時間操作がなかったため、自動的に退室しました。');
    }
  }, [inRoom, roomState, playerId]);


  // ページを閉じたときにFirestoreスロットを確実に解放する
  useEffect(() => {
    if (!inRoom || !roomId || !playerId || !mySlotId) return;

    const handleUnload = () => {
      releaseSlot(roomId, mySlotId);
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [inRoom, roomId, playerId, mySlotId]);


  const isHost = determineHostId(roomState?.players) === playerId;

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
      className="flex flex-col items-stretch bg-gradient-to-br from-[#fff5f7] via-white to-[#f5f3ff] text-zinc-800 selection:bg-rose-200"
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

      <div className={`flex flex-row items-start relative z-10 flex-1 layout-root ${!mapData ? 'lobby-screen' : ''}`}
        style={{ margin: 0, padding: 0, width: '100%' }}
      >
        <div className={`left-column relative h-full flex flex-row items-start ${showHistory ? 'has-history' : ''}`} style={{ flexShrink: 0 }}>
          <aside className={`relative flex flex-col h-full transition-all duration-200 ease-out overflow-hidden ${showHistory ? 'open' : ''}`}
            style={{ flexShrink: 0, width: showHistory ? '196px' : '0px' }}>
            <div className="w-[196px] flex flex-col h-full pr-1">
              <div className="flex items-center justify-between mb-3 ml-1 flex-shrink-0 pt-3">
                <div className="flex items-center gap-1.5">
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
                        <label className="text-[9px] font-black text-rose-300 uppercase italic tracking-tighter">BGM Volume</label>
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
                    <div className="flex flex-col gap-1.5 mt-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[9px] font-black text-rose-300 uppercase italic tracking-tighter">SE Volume</label>
                        <span className="text-[10px] font-black text-zinc-400 tabular-nums">{seVolume}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={seVolume}
                        onChange={(e) => setSeVolume(Number(e.target.value))}
                        className="w-full h-1.5 bg-rose-100 rounded-lg appearance-none cursor-pointer accent-purple-400"
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <label className="text-[9px] font-black text-rose-300 uppercase italic">Hide Video</label>
                      <input type="checkbox" checked={hideVideo} onChange={e => setHideVideo(e.target.checked)} className="accent-rose-400" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          <div className="history-toggle-container">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="history-toggle-btn"
              title="履歴の表示切替"
            >
              <span className="text-[10px] tabular-nums">{showHistory ? '◀' : '▶'}</span>
            </button>
            {/* サイドバーの下部にボタンを追加したい場合はここ */}
          </div>
        </div>

        {/* 中央カラム */}
        <main className="center-column flex-1 min-w-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {!mapData && roomState && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#fff0f5] border-b-2 border-rose-400 flex-shrink-0 animate-in fade-in slide-in-from-top-1 duration-300">
              <div className="flex items-center gap-2 pr-3 border-r border-rose-100">
                <div
                  className="w-3.5 h-3.5 rounded-full shadow-sm border border-white"
                  style={{ background: roomState.players[playerId]?.color || '#ccc' }}
                />
                <span className="text-[14px] font-black text-zinc-700 italic tracking-tighter uppercase">{playerName}</span>
                <span className="text-[9px] font-black text-rose-300 bg-white px-1 rounded-sm border border-rose-50 shadow-sm leading-none py-0.5">YOU</span>
                {isHost && (
                  <span className="text-[9px] font-black text-amber-400 bg-white px-1 rounded-sm border border-amber-100 shadow-sm leading-none py-0.5">★ HOST</span>
                )}
              </div>
              <div className="flex items-center gap-4 pl-1">
                {Object.values(roomState.players).filter(p => p.id !== playerId).map(p => (
                  <div key={p.id} className="flex items-center gap-1.5 opacity-80 hover:opacity-100 transition-opacity">
                    <div className="w-2.5 h-2.5 rounded-full border border-white shadow-[0_0_4px_rgba(0,0,0,0.1)]" style={{ background: p.color }} />
                    <span className="text-[12px] font-bold text-zinc-500 italic tracking-tight">{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5 mb-3 ml-1 flex-shrink-0 mt-2">
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
                    value={roomInput}
                    onChange={e => setRoomInput(e.target.value)}
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
                              onClick={() => setRoomInput(toDisplayRoomId(rid))}
                              onDoubleClick={() => !isPlaying && handleJoin(toDisplayRoomId(rid))}
                              className="group flex items-center justify-between p-3 bg-white border border-zinc-100 hover:border-rose-200 hover:bg-rose-50/30 transition-all text-left"
                            >
                              <div className="flex flex-col">
                                <span className="text-xs font-black text-zinc-600 group-hover:text-rose-500"># {toDisplayRoomId(rid)}</span>
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
                      <MapLoader
                        onLoad={handleMapLoad}
                        isHost={isHost}
                        roomId={roomId}
                        playerName={playerName}
                        roomState={roomState}
                        onEdit={(data: ParseResult, mid: string) => {
                          console.log("displaySets[0].lines[0].chunks[0].absLineIdx:",
                            data.displaySets?.[0]?.lines?.[0]?.chunks?.[0]?.absLineIdx);
                          console.log("lines[0]:", data.lines?.[0]);
                          setEditorInitialData(data);
                          setEditorInitialId(mid);
                          setShowEditor(true);
                        }}

                      />
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full transform transition-all animate-in fade-in zoom-in-95 duration-1000 relative">
                    <div className="absolute top-2 left-2 z-50 bg-white/80 backdrop-blur-sm px-3 py-1 flex items-center gap-2 border border-zinc-100 shadow-sm pointer-events-none">
                      <span className="font-black text-[10px] text-rose-400 tabular-nums"># {toDisplayRoomId(roomId)}</span>
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
                      hideVideo={hideVideo}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {/* 右カラム: 歌詞リスト (290px) */}
        {!(!mapData && roomState) && (
          <div className={`right-column guide-column relative h-full flex flex-row items-start ${showGuide ? 'has-guide' : ''}`} style={{ flexShrink: 0 }}>
            <button
              onClick={() => setShowGuide(!showGuide)}
              className="guide-toggle flex h-12 w-6 bg-white border border-rose-100 border-r-0 items-center justify-center text-rose-300 hover:bg-rose-50 hover:text-rose-500 transition-all z-30 shadow-sm mt-4 rounded-l-md"
              title={showGuide ? "ガイドを閉じる" : "ガイドを開く"}
            >
              <span className="text-[10px] tabular-nums">{showGuide ? '▶' : '◀'}</span>
            </button>
            <aside className={`relative flex flex-col h-full transition-all duration-200 ease-out overflow-hidden ${showGuide ? 'open' : ''}`}
              style={{
                width: showGuide ? '290px' : '0px',
                minWidth: showGuide ? '290px' : '0px',
                maxWidth: showGuide ? '290px' : '0px',
                flexShrink: 0,
                alignSelf: 'stretch',
                overflow: 'hidden',
                borderLeft: showGuide ? '2px solid #fee' : 'none',
              }}>
              <div className="guide-blocks custom-scrollbar h-full overflow-y-auto" ref={guideRef} style={{ width: '290px' }}>
                <div className="flex items-center gap-1.5 mb-3 ml-1 flex-shrink-0">
                  <div className="w-1.5 h-3 bg-purple-400 rounded-full"></div>
                  <h2 className="text-[10px] font-black text-purple-300 uppercase tracking-[0.2em] italic">Guide</h2>
                </div>
                <div className="flex flex-col gap-2">
                  {mapData?.displaySets.map((set, idx) => (
                    <button
                      key={idx}
                      className={`group relative p-3 border-l-4 transition-all text-left ${activeBlockIdx === idx
                        ? 'bg-rose-50 border-rose-400 shadow-md translate-x-1 guide-block-active'
                        : 'bg-white border-zinc-100 hover:bg-zinc-50 hover:border-zinc-300'
                        }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[10px] font-black italic ${activeBlockIdx === idx ? 'text-rose-400' : 'text-zinc-300'}`}>BLOCK {String(idx + 1).padStart(2, '0')}</span>
                        <span className="text-[9px] font-bold text-zinc-300 tabular-nums">
                          {Math.floor(set.timeMs / 1000 / 60)}:{String(Math.floor((set.timeMs / 1000) % 60)).padStart(2, '0')}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1.5 mt-2">
                        {set.lines.slice(0, 4).map((line: any, lIdx: number) => (
                          <div
                            key={lIdx}
                            className={`text-[11px] font-bold leading-tight pb-1 ${activeBlockIdx === idx ? 'text-rose-900' : 'text-zinc-500'
                              } ${lIdx < Math.min(set.lines.length, 4) - 1 ? 'border-b border-zinc-100/50' : ''}`}
                          >
                            {line.chunks.map((c: any) => c.text).join('　') || '...'}
                          </div>
                        ))}
                        {set.lines.length > 4 && (
                          <div className="text-[9px] font-bold text-zinc-300 italic">... and {set.lines.length - 4} more</div>
                        )}
                      </div>
                      {activeBlockIdx === idx && (
                        <div className="absolute top-0 right-1 h-full w-1 bg-rose-400 rounded-full"></div>
                      )}
                    </button>
                  ))}

                  {mapData && (
                    <div style={{ minHeight: `${850}px`, flexShrink: 0 }} />
                  )}

                </div>
              </div>
            </aside>
          </div>
        )}
      </div>

      {showEditor && (
        <div className="absolute inset-0 z-[100] bg-black/20 backdrop-blur-md flex items-center justify-center p-8">
          <MapEditor
            onClose={() => {
              setShowEditor(false);
              setEditorInitialData(null);
              setEditorInitialId(null);
            }}
            volume={volume}
            onSaved={async (mid) => {
              if (roomState?.mapId === mid || mid === editorInitialId) {
                const updated = await fetchMapData(mid);
                setMapData(updated);
              }
              setShowEditor(false);
              setEditorInitialData(null);
              setEditorInitialId(null);
            }}
            initialData={editorInitialData}
            initialId={editorInitialId}
          />
        </div>
      )}

      <footer className="py-2 opacity-10 text-[8px] font-black uppercase tracking-[0.5em] pointer-events-none relative z-10 w-full text-center flex-shrink-0">
        通うタイピング
      </footer>
    </div>
  );
}