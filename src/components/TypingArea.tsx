
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { ParseResult } from '../services/api';
import keygraph from '../utils/keygraph';
import { sound, miss_sound } from '../utils/sound';
import { updatePlayerProgress, RoomState, setRoomStartTime, getServerTimeOffset, PLAYER_COLORS, incrementSharedScore } from '../services/sync';

interface Props {
  mapData: ParseResult;
  roomId: string;
  playerId: string;
  roomState: RoomState | null;
}

// ============================
// LineItem: 1行の表示
// ============================
const LineItem: React.FC<any> = ({ line, lineIdx, currentLineIdx, currentChunkIdx, isEngineReady, playerColor, isDone, isSomeoneElseActive, pidName }) => {
  const isActiveLine = lineIdx === currentLineIdx;

  return (
    <div className={'py-2 px-6 rounded-xl border border-transparent transition-colors duration-300 ' + (isActiveLine ? 'bg-white/10 border-white/20' : '')}>
      <div className='flex items-center gap-2 mb-0.5 font-premium'>
        <div className='w-1.5 h-1.5 rounded-full' style={{ backgroundColor: playerColor }} />
        <span className='text-[9px] font-black uppercase' style={{ color: playerColor }}>
          {pidName}
        </span>
      </div>
      
      <div className='text-3xl font-black mb-1 leading-snug font-premium flex flex-wrap'>
        {line.chunks.map((chunk: any, i: number) => {
          const isActiveChunk = isEngineReady && isActiveLine && i === currentChunkIdx;
          const isChunkDone = lineIdx < currentLineIdx || (isActiveLine && i < currentChunkIdx);

          let content;
          if (isActiveChunk) {
            const done = keygraph.seq_done() || '';
            const rest = keygraph.seq_candidates() || '';
            content = (
              <>
                <span className='text-white/30'>{done}</span>
                <span style={{ color: playerColor }}>{rest.slice(0, 1)}</span>
                <span className='text-white/40'>{rest.slice(1)}</span>
              </>
            );
          } else if (isChunkDone || isDone) {
            content = <span className='text-white/30'>{chunk.text}</span>;
          } else if (isSomeoneElseActive) {
            content = <span style={{ color: playerColor }} className='animate-pulse font-black'>{chunk.text}</span>;
          } else {
            content = <span className='text-white/60'>{chunk.text}</span>;
          }

          return (
            <span key={i}>
              {i > 0 && <span className='opacity-30'>　</span>}
              {content}
            </span>
          );
        })}
      </div>

    </div>
  );
};

// ============================
// TypingArea メイン
// ============================
export const TypingArea: React.FC<Props> = ({ mapData, roomId, playerId, roomState }) => {
  const [currentBlockIdx, setCurrentBlockIdx] = useState(0);
  const [currentLineIdx, setCurrentLineIdx] = useState(0);
  const [currentChunkIdx, setCurrentChunkIdx] = useState(0);
  const [combo, setCombo] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const [maxCombo, setMaxCombo] = useState(0);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const [comboAnimKey, setComboAnimKey] = useState(0);
  // keygraph の進捗変化をレンダリングに反映するためのカウンター
  const [kgTick, setKgTick] = useState(0);

  const playerRef = useRef<any>(null);
  const instanceIdRef = useRef<number>(0);
  const lastLogTime = useRef(0);

  // ゲーム開始フラグ
  const isStarted = roomState?.startTime != null;

  const playerIds = useMemo(() => {
    if (!roomState || !roomState.players) return [playerId];
    return Object.keys(roomState.players).sort();
  }, [roomState, playerId]);
  const numPlayers = playerIds.length || 1;
  const myPos = playerIds.indexOf(playerId);

  const endTimeMs = useMemo(() => {
    return mapData.lines.find(l => l.isEnd)?.timeMs;
  }, [mapData.lines]);

  // =====================
  // YouTube Player 初期化
  // =====================
  useEffect(() => {
    if (!mapData.videoId) return;
    const curId = Date.now();
    instanceIdRef.current = curId;
    const init = () => {
      if (playerRef.current) try { playerRef.current.destroy(); } catch (e) { }
      if (!(window as any).YT || !(window as any).YT.Player) return;
      playerRef.current = new (window as any).YT.Player('youtube-player', {
        height: '240', width: '426', videoId: mapData.videoId,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, origin: window.location.origin, enablejsapi: 1 },
        events: {
          onReady: (e: any) => {
            if (instanceIdRef.current !== curId) { e.target.destroy(); return; }
            playerRef.current = e.target;
            const start = roomState?.startTime;
            if (start) {
              getServerTimeOffset().then(off => {
                const sec = (Date.now() + off - start) / 1000;
                if (sec > 0) e.target.seekTo(sec, true);
                e.target.playVideo();
              });
            }
          }
        }
      });
    };
    if (!(window as any).YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      (window as any).onYouTubeIframeAPIReady = init;
    } else init();
    return () => { if (playerRef.current) try { playerRef.current.destroy(); } catch (e) { } };
  }, [mapData.videoId, roomId]);

  // =====================
  // startTime 変化 → 再生制御
  // =====================
  useEffect(() => {
    const start = roomState?.startTime;
    if (start) {
      const p = playerRef.current;
      if (p && typeof p.playVideo === 'function') {
        const s = p.getPlayerState();
        if (s !== 1 && s !== 3) getServerTimeOffset().then(off => {
          const sec = (Date.now() + off - start) / 1000;
          if (sec > 0) { p.seekTo(sec, true); p.playVideo(); }
          else p.playVideo();
        });
      }
    } else {
      try { if (playerRef.current?.stopVideo) playerRef.current.stopVideo(); } catch (e) { }
      setCurrentBlockIdx(0); setCurrentLineIdx(0); setCurrentChunkIdx(0); setCombo(0);
    }
  }, [roomState?.startTime]);

  const isMe = (currentBlockIdx % numPlayers === myPos);

  // =====================
  // ブロック進行タイマー (displaySetsベース)
  // =====================
  useEffect(() => {
    const int = setInterval(() => {
      const p = playerRef.current;
      if (!p || typeof p.getCurrentTime !== 'function') return;
      if (isStarted) {
        const s = p.getPlayerState();
        const now = Date.now();
        if (s === 5 || s === 2 || s === -1) {
          if (now - lastLogTime.current > 3000) { p.playVideo(); lastLogTime.current = now; }
        }
        if (s === 1) {
          const ms = p.getCurrentTime() * 1000;

          // ゲーム終了判定
          if (endTimeMs && ms >= endTimeMs) {
            setIsGameOver(true);
            try { p.stopVideo(); } catch (e) { }
            return;
          }

          const nextSet = mapData.displaySets?.[currentBlockIdx + 1];
          if (nextSet && ms >= nextSet.timeMs) {
            setCurrentBlockIdx(v => v + 1);
            setCurrentLineIdx(0);
            setCurrentChunkIdx(0);
            setIsEngineReady(false);
          }
        }
      }
    }, 50);
    return () => clearInterval(int);
  }, [currentBlockIdx, mapData.displaySets, isStarted]);

  // =====================
  // 時間が来たらチャンクをエンジンにロード (アクティブ化)
  // =====================
  useEffect(() => {
    const int = setInterval(() => {
      if (!isStarted || isEngineReady || !isMe) return;
      
      const p = playerRef.current;
      if (!p || typeof p.getCurrentTime !== 'function') return;
      const ms = p.getCurrentTime() * 1000;
      
      const currentSet = mapData.displaySets?.[currentBlockIdx];
      const currentLine = currentSet?.lines[currentLineIdx];
      const currentChunk = currentLine?.chunks[currentChunkIdx];
      
      if (currentChunk && ms >= currentChunk.timeMs - 200) {
        keygraph.reset();
        keygraph.build(currentChunk.text);
        setIsEngineReady(true);
      }
    }, 50);
    return () => clearInterval(int);
  }, [currentBlockIdx, currentLineIdx, currentChunkIdx, isStarted, isEngineReady, mapData.displaySets]);

  // =====================
  // キーボードイベント
  // =====================
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (!isStarted || !isEngineReady || !isMe || e.key.length > 1 || e.altKey || e.ctrlKey || e.metaKey) return;
      if (keygraph.next(e.key.toLowerCase())) {
        try { sound.play(); } catch (_) { }
        setCombo(prev => {
          const n = prev + 1;
          if (n > maxCombo) setMaxCombo(n);
          setComboAnimKey(k => k + 1);
          return n;
        });
        if (roomState?.sharedScore !== undefined) incrementSharedScore(roomId, roomState.sharedScore + 10);
        // keygraph の状態変化をレンダリングに伝える
        setKgTick(t => t + 1);
        // チャンクが終了したら次へ
        if (keygraph.is_finished()) {
          const currentSet = mapData.displaySets[currentBlockIdx];
          const currentLine = currentSet.lines[currentLineIdx];

          if (currentChunkIdx + 1 < currentLine.chunks.length) {
            // 同じ行の次のチャンクへ
            setCurrentChunkIdx(prev => prev + 1);
          } else if (currentLineIdx + 1 < currentSet.lines.length) {
            // 次の行へ
            setCurrentLineIdx(prev => prev + 1);
            setCurrentChunkIdx(0);
          } else {
            // 次のセットへ
            setCurrentBlockIdx(prev => prev + 1);
            setCurrentLineIdx(0);
            setCurrentChunkIdx(0);
          }
          setIsEngineReady(false);
        }
      } else {
        try { miss_sound.play(); } catch (_) { }
        setCombo(0);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [isStarted, isEngineReady, maxCombo, roomState?.sharedScore, roomId, currentBlockIdx, currentLineIdx, currentChunkIdx, mapData.displaySets, numPlayers, myPos]);

  // =====================
  // 進捗同期 (ブロック番号 + 行番号をシリアル化して送信)
  // =====================
  useEffect(() => {
    if (roomId && playerId) {
      const act = currentBlockIdx * 4 + currentLineIdx;
      updatePlayerProgress(roomId, playerId, act, currentChunkIdx, combo, maxCombo, 0);
    }
  }, [currentBlockIdx, currentLineIdx, currentChunkIdx, kgTick, combo, maxCombo, roomId, playerId]);

  if (!mapData || !mapData.displaySets || mapData.displaySets.length === 0) return <div>Loading...</div>;
  const scoreText = (roomState?.sharedScore || 0).toLocaleString();
  const currentSet = mapData.displaySets[currentBlockIdx];
  if (!currentSet) return <div>Ending...</div>;

  // 自分のプレイヤーカラー
  const myColor = roomState?.players?.[playerId]?.color || PLAYER_COLORS[myPos % 4];

  return (
    <div className='flex flex-col items-center mt-2 w-full max-w-4xl glass p-8 rounded-3xl relative overflow-hidden font-premium'>
      <div className='absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500' />

      {/* YouTube プレイヤー */}
      <div className='mb-6 rounded-2xl overflow-hidden bg-black flex items-center justify-center ring-4 ring-white/5' style={{ width: '426px', height: '240px' }}>
        <div id='youtube-player' key={mapData.videoId} />
      </div>

      {/* ローマ字ガイド（COMBO行の上） */}
      <div className='w-full px-2 mb-2 font-mono font-bold text-4xl tracking-widest min-h-[3rem]'>
        {isEngineReady && (
          <>
            <span className='text-white/30'>
              {(keygraph.key_done() || '').toUpperCase()}
            </span>
            <span style={{ color: myColor }}>
              {(keygraph.key_candidate() || '').toUpperCase()}
            </span>
          </>
        )}
      </div>

      {/* COMBO & スコア */}
      <div className='flex justify-between items-center w-full mb-4 px-2 font-black italic text-white'>
        <div
          key={comboAnimKey}
          className='text-3xl transition-transform'
          style={{ animation: comboAnimKey > 0 ? 'comboScale 0.3s ease-out' : 'none' }}
        >
          {combo + ' COMBO'}
        </div>
        <div className='text-5xl'>{scoreText}</div>
      </div>

      {/* 歌詞エリア / リザルト画面 */}
      <div className='flex flex-col w-full space-y-1'>
        {isGameOver ? (
          <div className='flex flex-col items-center gap-4 py-12 animate-in fade-in zoom-in duration-1000'>
            <div className='text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-amber-600 italic tracking-tighter'>RESULT</div>
            <div className='text-3xl font-black text-white'>SCORE: <span className='text-yellow-400'>{scoreText}</span></div>
            <div className='text-xl font-bold text-white/60'>MAX COMBO: {maxCombo}</div>
            
            <button 
              onClick={() => window.location.reload()}
              className='mt-6 px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-full text-sm transition-colors'
            >
              BACK TO LOBBY
            </button>
          </div>
        ) : (
          currentSet.lines.map((line: any, lIdx: number) => {
            const actSetIdx = currentBlockIdx;
            const pid = playerIds[actSetIdx % numPlayers];
            const u = roomState?.players?.[pid];
            const isCurrentPlayerMe = (actSetIdx % numPlayers === myPos);
            const playerColor = u?.color || PLAYER_COLORS[actSetIdx % 4];
            
            const absLineIdx = actSetIdx * 4 + lIdx;
            const isDone = u && u.currentLineIdx > absLineIdx;
            const isSomeoneElseActive = !isCurrentPlayerMe && u && u.currentLineIdx === absLineIdx;
            const pidName = (u?.name || '---') + (pid === playerId ? ' (YOU)' : '');

            return (
              <LineItem
                key={lIdx}
                line={line}
                lineIdx={lIdx}
                currentLineIdx={currentLineIdx}
                currentChunkIdx={currentChunkIdx}
                isEngineReady={isEngineReady && isCurrentPlayerMe}
                playerColor={playerColor}
                isDone={isDone}
                isSomeoneElseActive={isSomeoneElseActive}
                pidName={pidName}
              />
            );
          })
        )}
      </div>

      {/* START / SYNC ACTIVE ボタン */}
      <div className='mt-8 text-center'>
        {!isStarted ? (
          <button
            onClick={() => setRoomStartTime(roomId)}
            className='px-10 py-4 bg-gradient-to-br from-green-500 to-emerald-700 text-white font-black text-xl rounded-2xl shadow-xl hover:scale-105 active:scale-95 transition-transform tracking-widest uppercase'
          >
            ▶ START
          </button>
        ) : (
          <div className='flex items-center gap-4 px-6 py-2 glass rounded-full border-white/5 font-premium'>
            <span className='text-[10px] text-gray-500 font-black uppercase'>Sync Active</span>
            <div className='w-2 h-2 rounded-full bg-green-500 animate-pulse' />
          </div>
        )}
      </div>

      {/* コンボアニメーション用 keyframe */}
      <style>{`
        @keyframes comboScale {
          0%   { transform: scale(1.4); color: #fbbf24; }
          60%  { transform: scale(1.1); }
          100% { transform: scale(1);   color: inherit; }
        }
      `}</style>
    </div>
  );
};
