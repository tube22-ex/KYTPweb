import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { MapLoader } from './components/MapLoader';
import { TypingArea } from './components/TypingArea';
import { PlayerLane } from './components/PlayerLane';
import { MapEditor } from './components/MapEditor';
import { ParseResult, fetchMapData } from './services/api';
import { resetRoomGameplayState, setRoomMapId } from './services/sync';

// Hooks
import { useSettings } from './hooks/useSettings';
import { useHistory } from './hooks/useHistory';
import { MultiplayerProvider, useMultiplayer } from './contexts/MultiplayerContext';

// Components
import { Sidebar } from './components/Sidebar';
import { Lobby } from './components/Lobby';
import { AppHeader } from './components/AppHeader';
import { PlayerInfoBar } from './components/PlayerInfoBar';
import { Guide } from './components/Guide';

const BASE_WIDTH = 1280;
const BASE_HEIGHT = 850;

function AppContent() {
  const rootRef = useRef<HTMLDivElement>(null);
  
  // Settings & History (Shared)
  const { 
    volume, setVolume, seVolume, setSeVolume, 
    selectedFont, setSelectedFont, hideVideo, setHideVideo 
  } = useSettings();
  const { history, saveToHistory, showHistory, setShowHistory } = useHistory();

  // Multiplayer Context
  const {
    playerName, isAuthLoaded,
    inRoom, roomId, roomState, isHost,
    toDisplayRoomId
  } = useMultiplayer();

  // Local UI State
  const [mapData, setMapData] = useState<ParseResult | null>(null);
  const [showGuide, setShowGuide] = useState(() => {
    const saved = localStorage.getItem('kytp_show_guide');
    return saved === null ? true : saved === 'true';
  });
  useEffect(() => {
    localStorage.setItem('kytp_show_guide', showGuide.toString());
  }, [showGuide]);

  const [showEditor, setShowEditor] = useState(false);
  const [editorInitialData, setEditorInitialData] = useState<ParseResult | null>(null);
  const [editorInitialId, setEditorInitialId] = useState<string | null>(null);
  const [activeBlockIdx, setActiveBlockIdx] = useState(0);

  // Scaling Logic
  useLayoutEffect(() => {
    // isAuthLoaded が false の間は rootRef.current が null のため、
    // 真になった（＝メイン画面が表示された）タイミングで確実に計算を実行する
    if (!isAuthLoaded) return;

    const updateScale = () => {
      if (!rootRef.current) return;
      // document.documentElement を使うことでスクロールバーの影響を抑えてより正確に計測
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      if (vw === 0 || vh === 0) return; // 画面幅が確定していない場合はスキップ

      const scaleX = vw / BASE_WIDTH;
      const scaleY = vh / BASE_HEIGHT;
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

      console.log("[Scale] Updated:", { vw, vh, scale });
    };

    updateScale();
    
    // ResizeObserver でリサイズをより高精度に監視
    const observer = new ResizeObserver(() => {
      updateScale();
    });
    observer.observe(document.documentElement);
    
    // 画面切り替え直後や CSS/フォントロード待ちのための微調整
    const timers = [
      setTimeout(updateScale, 50),
      setTimeout(updateScale, 200),
      setTimeout(updateScale, 400),
      setTimeout(updateScale, 1000) // 最終的な安定化
    ];
    
    window.addEventListener('resize', updateScale);
    return () => {
      observer.disconnect();
      timers.forEach(t => clearTimeout(t));
      window.removeEventListener('resize', updateScale);
    };
  }, [isAuthLoaded]); // isAuthLoaded の変化（＝メインUIのマウント）を捉える

  // Shortcut for Volume
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setVolume(Math.min(100, volume + 5));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setVolume(Math.max(0, volume - 5));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [volume, setVolume]);

  // Map Loading & Synchronization
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
    if (isHost && roomId) {
      await resetRoomGameplayState(roomId);
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
        }).catch(err => console.error('Failed to sync map:', err));
      }
    } else {
      setMapData(null);
    }
  }, [roomState?.mapId, mapData]);

  if (!isAuthLoaded) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-rose-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-rose-400 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-rose-400 font-black animate-pulse uppercase tracking-widest text-[10px]">Initializing...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="flex flex-col items-stretch bg-gradient-to-br from-[#fff5f7] via-white to-[#f5f3ff] text-zinc-800 selection:bg-rose-200"
      style={{
        fontFamily: selectedFont,
        width: `${BASE_WIDTH}px`,
        height: `${BASE_HEIGHT}px`,
        position: 'absolute',
        top: 0, left: 0, overflow: 'hidden'
      }}
    >
      <AppHeader />

      <div className={`flex flex-row items-start relative z-10 flex-1 layout-root ${!mapData ? 'lobby-screen' : ''}`}
        style={{ margin: 0, padding: 0, width: '100%' }}
      >
        <Sidebar
          showHistory={showHistory} setShowHistory={setShowHistory}
          history={history} onHistoryItemClick={(id) => fetchMapData(id).then(data => handleMapLoad(data, id))}
          selectedFont={selectedFont} setSelectedFont={setSelectedFont}
          volume={volume} setVolume={setVolume}
          seVolume={seVolume} setSeVolume={setSeVolume}
          hideVideo={hideVideo} setHideVideo={setHideVideo}
        />

        <main className="center-column flex-1 min-w-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {!mapData && roomState && (
            <PlayerInfoBar />
          )}

          <div className="flex items-center gap-1.5 mb-3 ml-1 flex-shrink-0 mt-2">
            <div className="w-1.5 h-3 bg-rose-400 rounded-full"></div>
            <h2 className="text-[10px] font-black text-rose-300 uppercase tracking-[0.2em] italic">Player</h2>
          </div>

          <div className="flex-1 pb-4">
            {!inRoom ? (
               <Lobby />
            ) : (
              <div className="w-full flex flex-col h-full">
                {!mapData ? (
                  <div className="w-full h-full flex flex-col min-h-0">
                    <div className="flex-shrink-0 bg-white/60 backdrop-blur-md border-b border-rose-100 flex flex-col items-center shadow-[0_10px_20px_rgba(255,133,161,0.05)]" style={{ padding: 0, marginBottom: '4px' }}>
                      <PlayerLane />
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                      <MapLoader
                        onLoad={handleMapLoad}
                        onEdit={(data, mid) => {
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
                      mapData={mapData!}
                      onBackToMenu={handleBackToMenu}
                      onBlockChange={setActiveBlockIdx}
                      volume={volume}
                      hideVideo={hideVideo}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {!(!mapData && roomState) && (
          <Guide showGuide={showGuide} setShowGuide={setShowGuide} mapData={mapData} activeBlockIdx={activeBlockIdx} />
        )}
      </div>

      {showEditor && (
        <div className="absolute inset-0 z-[100] bg-black/20 backdrop-blur-md flex items-center justify-center p-8">
          <MapEditor
            onClose={() => { setShowEditor(false); setEditorInitialData(null); setEditorInitialId(null); }}
            volume={volume}
            onSaved={async (mid) => {
              if (roomState?.mapId === mid || mid === editorInitialId) {
                const updated = await fetchMapData(mid);
                setMapData(updated);
              }
              setShowEditor(false); setEditorInitialData(null); setEditorInitialId(null);
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

export default function App() {
  return (
    <MultiplayerProvider>
      <AppContent />
    </MultiplayerProvider>
  );
}