import React, { useEffect, useState, useRef, useMemo } from 'react';
import { ParseResult } from '../services/api';
import keygraph from '../utils/keygraph';
import { sound, miss_sound } from '../utils/sound';
import { updatePlayerProgress, RoomState, setRoomStartTime, getServerTimeOffset, PLAYER_COLORS, incrementSharedScore, updateSharedCombo, updateGlobalProgress, updateRoomPlayback, determineHostId } from '../services/sync';
import { PlayerLane } from './PlayerLane';

interface Props {
  mapData: ParseResult;
  roomId: string;
  playerId: string;
  roomState: RoomState | null;
  onBackToMenu: () => void;
}

const LineItem: React.FC<any> = ({ 
  line, 
  lineIdx, 
  currentLineIdx, 
  currentChunkIdx, 
  isEngineReady, 
  playerColor, 
  isDone, 
  isSomeoneElseActive, 
  pidName,
  opponentChunkIdx,
  currentTyping,
  isFuture,
  globalLineIdx,
  isHostLine
}) => {
  const isActiveLine = lineIdx === currentLineIdx;
  const absLineIdx = line.absLineIdx;
  const isGlobalTargetLine = absLineIdx === globalLineIdx;

  return (
    <div className={'py-2 px-6 rounded-xl border border-transparent transition-colors duration-300 ' + (isActiveLine ? 'bg-white/10 border-white/20' : '')}>
      <div className='flex items-center gap-2 mb-0.5 font-premium'>
        <div className='w-1.5 h-1.5 rounded-full' style={{ backgroundColor: playerColor }} />
        <span className='text-[9px] font-black uppercase' style={{ color: playerColor }}>
          {pidName}
        </span>
        {isGlobalTargetLine && (
          <span className='text-[8px] bg-red-500 text-white px-1 rounded animate-pulse'>TARGET</span>
        )}
        {isHostLine && (
          <span className="px-1 py-0.5 bg-amber-500/20 text-amber-400 text-[8px] font-black rounded uppercase tracking-tighter ring-1 ring-amber-500/30 flex-shrink-0">Host</span>
        )}
      </div>
      
      <div className='text-3xl font-black mb-1 leading-snug font-premium flex flex-wrap'>
        {line.chunks.map((chunk: any, i: number) => {
          if (isEngineReady && isActiveLine) {
            const isActiveChunk = i === currentChunkIdx;
            const isChunkDone = i < currentChunkIdx;
            if (isActiveChunk) {
              const done = keygraph.seq_done() || '';
              const rest = keygraph.seq_candidates() || '';
              return (
                <span key={i}>
                  {i > 0 && <span className='opacity-30'>　</span>}
                  <span className='text-white/60'>{done}</span>
                  <span style={{ color: playerColor }} className='font-black'>{rest.slice(0, 1)}</span>
                  <span className='text-white/80'>{rest.slice(1)}</span>
                </span>
              );
            } else if (isChunkDone) {
              return (
                <span key={i}>
                  {i > 0 && <span className='opacity-30'>　</span>}
                  <span className='text-white/50'>{chunk.text}</span>
                </span>
              );
            } else {
              return (
                <span key={i}>
                  {i > 0 && <span className='opacity-30'>　</span>}
                  <span className='text-white/60'>{chunk.text}</span>
                </span>
              );
            }
          }
          if (isSomeoneElseActive) {
            const theirChunkIdx = opponentChunkIdx ?? 0;
            const theirTyping = currentTyping ?? '';
            // 進捗文字列が現在のチャンクの開始と一致しない場合は、古い（または他のチャンクの）データと見なして無視する
            const matchedTyping = (theirTyping && chunk.text.startsWith(theirTyping)) ? theirTyping : '';
            
            const isPastChunk = i < theirChunkIdx;
            const isCurrentChunk = i === theirChunkIdx;

            if (isPastChunk) {
              return <span key={i}>{i > 0 && <span className='opacity-30'>　</span>}<span className='text-white/50'>{chunk.text}</span></span>;
            }
            if (isCurrentChunk) {
              const doneText = matchedTyping;
              const restText = chunk.text.slice(doneText.length);
              return (
                <span key={i}>
                  {i > 0 && <span className='opacity-30'>　</span>}
                  <span className='text-white/60'>{doneText}</span>
                  <span style={{ color: playerColor }} className='font-black'>{restText[0] || ''}</span>
                  <span className='text-white/80'>{restText.slice(1)}</span>
                </span>
              );
            }
            return <span key={i}>{i > 0 && <span className='opacity-30'>　</span>}<span className='text-white/70'>{chunk.text}</span></span>;
          }
          return <span key={i}>{i > 0 && <span className='opacity-30'>　</span>}<span className={isDone ? 'text-white/50' : isFuture ? 'text-white/40' : 'text-white/80'}>{chunk.text}</span></span>;
        })}
      </div>
    </div>
  );
};

export const TypingArea: React.FC<Props> = ({ mapData, roomId, playerId, roomState, onBackToMenu }) => {
  const [currentBlockIdx, setCurrentBlockIdx] = useState(0);
  const [currentLineIdx, setCurrentLineIdx] = useState(0);
  const [currentChunkIdx, setCurrentChunkIdx] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const [comboAnimKey, setComboAnimKey] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerState, setPlayerState] = useState<number>(-1); // YT.PlayerState

  const playerRef = useRef<any>(null);
  const instanceIdRef = useRef<number>(0);
  const preparedRef = useRef<string>(""); // "absLineIdx-chunkIdx"

  const isStarted = roomState?.startTime != null;

  const playerIds = useMemo(() => {
    if (!roomState || !roomState.players) return [playerId];
    return Object.keys(roomState.players).sort();
  }, [roomState?.players, playerId]);

  const myPos = playerIds.indexOf(playerId);
  const isHost = determineHostId(roomState?.players) === playerId;

  const getAssignedPlayerId = useMemo(() => {
    return (absLineIdx: number, pids: string[]) => {
      const n = pids.length;
      if (n === 0) return "";
      const bIdx = Math.floor(absLineIdx / 4);
      const lInB = absLineIdx % 4;
      const createRand = (seed: number) => {
        let s = seed;
        return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
      };
      const shuffle = (arr: number[], seed: number) => {
        const res = [...arr];
        const rand = createRand(seed);
        for (let i = res.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [res[i], res[j]] = [res[j], res[i]];
        }
        return res;
      };
      const o1 = shuffle(Array.from({ length: n }, (_, i) => i), bIdx + 12345);
      const o2 = shuffle(Array.from({ length: n }, (_, i) => i), bIdx + 67890);
      const c = [...o1, ...o2];
      return pids[c[lInB] % n];
    };
  }, []);

  const endTimeMs = useMemo(() => {
    const endLine = mapData.lines.find(l => l.isEnd);
    if (endLine) return endLine.timeMs;
    const lastLine = mapData.lines[mapData.lines.length - 1];
    return lastLine ? lastLine.timeMs + 3000 : undefined;
  }, [mapData.lines]);

  const isMine = React.useCallback((absLineIdx: number): boolean => getAssignedPlayerId(absLineIdx, playerIds) === playerId, [playerIds, playerId, getAssignedPlayerId]);

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
            if (start) getServerTimeOffset().then(off => {
              const sec = (Date.now() + off - start) / 1000;
              if (sec > 0) e.target.seekTo(sec, true);
              if (!isGameOver) e.target.playVideo();
            });
          },
          onStateChange: (e: any) => {
            setPlayerState(e.data);
            if (e.data === 0) { // YT.PlayerState.ENDED
              setIsGameOver(true);
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

  useEffect(() => {
    const start = roomState?.startTime;
    if (start && !isGameOver) {
      const p = playerRef.current;
      if (p && typeof p.playVideo === 'function') {
        const s = p.getPlayerState();
        if (s !== 1 && s !== 3) getServerTimeOffset().then(off => {
          const sec = (Date.now() + off - start) / 1000;
          if (sec > 0) { p.seekTo(sec, true); p.playVideo(); } else p.playVideo();
        });
      }
    } else {
      try { playerRef.current?.stopVideo(); } catch (e) { }
      if (!isGameOver) { 
        setCurrentBlockIdx(0); 
        setCurrentLineIdx(0); 
        setCurrentChunkIdx(0); 
        preparedRef.current = "";
      }
    }
  }, [roomState?.startTime, isGameOver]);

  const currentSet = mapData.displaySets?.[currentBlockIdx];
  const currentLine = useMemo(() => currentSet?.lines?.[currentLineIdx], [currentSet, currentLineIdx]);
  const isMe = currentLine ? isMine(currentLine.absLineIdx) : false;

  useEffect(() => {
    const int = setInterval(() => {
      const p = playerRef.current;
      if (!isStarted || isGameOver || !p || typeof p.getCurrentTime !== 'function') return;
      const ms = p.getCurrentTime() * 1000;
      setCurrentTime(p.getCurrentTime());
      if (endTimeMs && ms >= endTimeMs) { setIsGameOver(true); p.stopVideo(); return; }
      
      const ns = mapData.displaySets?.[currentBlockIdx + 1];
      if (ns && ms >= ns.timeMs) {
        const nextBlockIdx = currentBlockIdx + 1;
        setCurrentBlockIdx(nextBlockIdx);
        setCurrentChunkIdx(0);
        setIsEngineReady(false);
        preparedRef.current = "";
        
        // 次のセットでの開始行を初期化し、Firebaseにも同期して「前のセットの完了状態(-1)」が誤爆しないようにする
        const nLines = mapData.displaySets[nextBlockIdx].lines;
        const firstM = nLines.findIndex(l => isMine(l.absLineIdx));
        const newLocalLineIdx = firstM !== -1 ? firstM : 0;
        setCurrentLineIdx(newLocalLineIdx);

        if (roomId && playerId) {
          const absStart = firstM !== -1 ? nLines[firstM].absLineIdx : -1;
          updatePlayerProgress(roomId, playerId, absStart, 0, 0, 0, 0, 0, 0, '', '');
        }
      }
    }, 50);
    return () => clearInterval(int);
  }, [currentBlockIdx, mapData.displaySets, isStarted, endTimeMs, isGameOver, isMine]);

  useEffect(() => {
    if (!isHost || !isStarted || isGameOver) return;
    const interval = setInterval(() => {
      const p = playerRef.current;
      if (p && typeof p.getCurrentTime === 'function' && p.getPlayerState() === 1) updateRoomPlayback(roomId, p.getCurrentTime());
    }, 2000);
    return () => clearInterval(interval);
  }, [isHost, isStarted, isGameOver, roomId]);

  useEffect(() => {
    if (isHost || !isStarted || isGameOver || !roomState?.playbackTime) return;
    const p = playerRef.current;
    if (p && typeof p.getCurrentTime === 'function' && typeof p.seekTo === 'function') {
      const diff = Math.abs(roomState.playbackTime - p.getCurrentTime());
      if (diff > 1.2) p.seekTo(roomState.playbackTime, true);
    }
  }, [isHost, isStarted, isGameOver, roomState?.playbackTime]);

  const allFinished = useMemo(() => {
    if (!currentSet || !roomState?.players) return false;
    return currentSet.lines.every(line => {
      const pid = getAssignedPlayerId(line.absLineIdx, playerIds);
      const u = roomState.players[pid];
      return u && (u.currentLineIdx === -1 || u.currentLineIdx > line.absLineIdx);
    });
  }, [currentSet, roomState?.players, playerIds, getAssignedPlayerId]);

  const nextSet = useMemo(() => {
    if (!mapData.displaySets || mapData.displaySets.length === 0) return undefined;
    if (currentTime * 1000 < (mapData.displaySets[0].timeMs - 500)) return mapData.displaySets[0];
    return mapData.displaySets?.[currentBlockIdx + 1];
  }, [currentBlockIdx, mapData.displaySets, currentTime]);

  const isNearNextSet = nextSet && (currentTime * 1000 > nextSet.timeMs - 3000);
  const isInitialGap = (currentBlockIdx === 0 && (currentTime * 1000 < (currentSet?.timeMs ?? 0) - 3000));
  const isFinalSetAndFinished = (currentBlockIdx + 1 === mapData.displaySets.length) && allFinished && !isGameOver;
  // 動画が再生中(1)または一時停止(2)の場合のみスキップを許可する
  const isVideoActive = playerState === 1 || playerState === 2;
  const canSkip = isHost && isVideoActive && (allFinished || isInitialGap) && (nextSet || isFinalSetAndFinished) && !isGameOver && !isNearNextSet;

  useEffect(() => {
    if (!isStarted || isEngineReady || isGameOver || !currentSet || !currentLine || !isMe) return;
    const int = setInterval(() => {
      const p = playerRef.current;
      if (!p || typeof p.getCurrentTime !== 'function') return;
      const ms = p.getCurrentTime() * 1000;
      const targetTime = (currentLineIdx === 0) ? currentLine.timeMs : currentSet.timeMs;
      if (ms >= targetTime) {
        const key = `${currentLine.absLineIdx}-${currentChunkIdx}`;
        if (preparedRef.current !== key) {
          const chunk = currentLine.chunks?.[currentChunkIdx];
          if (chunk) { 
            keygraph.reset(); 
            keygraph.build(chunk.text); 
            setIsEngineReady(true);
            preparedRef.current = key;
          }
        }
      }
    }, 50);
    return () => clearInterval(int);
  }, [isStarted, isEngineReady, isGameOver, currentSet, currentLine, currentLineIdx, currentChunkIdx, isMe]);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.code === 'Space' && canSkip) {
        e.preventDefault();
        if (nextSet) {
          const skipToSec = (nextSet.timeMs / 1000) - 3;
          if (playerRef.current?.seekTo) {
            const t = Math.max(0, skipToSec);
            playerRef.current.seekTo(t, true);
            updateRoomPlayback(roomId, t);
          }
        } else if (isFinalSetAndFinished) {
          // 最終セットが終わっている場合はリザルト（または動画末尾）へ
          if (endTimeMs) {
            const t = endTimeMs / 1000;
            playerRef.current?.seekTo(t, true);
            updateRoomPlayback(roomId, t);
          } else {
            setIsGameOver(true);
          }
        }
        return;
      }
      if (!isStarted || !isEngineReady || !isMe || e.key.length > 1 || e.altKey || e.ctrlKey || e.metaKey) return;
      const chunk = currentLine?.chunks?.[currentChunkIdx];
      if (!chunk) return;
      if (keygraph.next(e.key.toLowerCase())) {
        try { sound.currentTime = 0; sound.play(); } catch (_) { }
        setComboAnimKey(k => k + 1);
        if (roomState?.sharedScore !== undefined) incrementSharedScore(roomId, roomState.sharedScore + 10);
        
        const isFinished = keygraph.is_finished();
        
        if (isFinished) {
          const gl = roomState?.globalLineIdx ?? 0;
          const gc = roomState?.globalChunkIdx ?? 0;
          if (currentLine.absLineIdx === gl && currentChunkIdx === gc) {
            const combo = (roomState?.sharedCombo || 0) + 1;
            updateSharedCombo(roomId, combo, Math.max(roomState?.maxSharedCombo || 0, combo));
            let nl = gl, nc = gc + 1;
            if (nc >= currentLine.chunks.length) { nl++; nc = 0; }
            updateGlobalProgress(roomId, nl, nc);
          }
          let nextLineIdxForFirebase = currentLine.absLineIdx;
          let nextChunkIdxForFirebase = currentChunkIdx + 1;

          if (nextChunkIdxForFirebase < currentLine.chunks.length) {
            setCurrentChunkIdx(nextChunkIdxForFirebase);
          } else {
            let nextM = -1;
            if (currentSet?.lines) {
              for (let i = currentLineIdx + 1; i < currentSet.lines.length; i++) {
                if (isMine(currentSet.lines[i].absLineIdx)) { nextM = i; break; }
              }
            }
            if (nextM !== -1) {
              setCurrentLineIdx(nextM);
              setCurrentChunkIdx(0);
              nextLineIdxForFirebase = currentSet.lines[nextM].absLineIdx;
              nextChunkIdxForFirebase = 0;
            } else {
              setCurrentLineIdx(-1);
              nextLineIdxForFirebase = -1;
              nextChunkIdxForFirebase = 0;
            }
          }
          // 次の状態をFirebaseに送る (進捗・タイピング内容は確実にクリア)
          if (roomId && playerId) {
            updatePlayerProgress(
              roomId, 
              playerId, 
              nextLineIdxForFirebase, 
              nextChunkIdxForFirebase, 
              0, 0, 0, 
              nextChunkIdxForFirebase, 
              0, 
              '', // currentTypingを確実にクリア
              ''  // currentWordを確実にクリア
            );
          }
          setIsEngineReady(false);
        } else {
          // まだチャンクが終わっていない場合のみ、現在のチャンクの進捗を更新
          if (roomId && playerId && currentLine) {
            updatePlayerProgress(
              roomId, 
              playerId, 
              currentLine.absLineIdx, 
              currentChunkIdx, 
              0, 0, 0, 
              currentChunkIdx, 
              keygraph.seq_done()?.length || 0, 
              keygraph.seq_done() || '', 
              chunk.text
            );
          }
        }
      } else { try { miss_sound.play(); } catch (_) { } }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [isStarted, isEngineReady, isMe, currentLine, currentChunkIdx, roomState, roomId, currentBlockIdx, currentLineIdx, canSkip, nextSet, isMine]);

  useEffect(() => {
    if (!isStarted || isGameOver || !roomState || !currentSet || currentLineIdx === -1) return;
    const gl = roomState.globalLineIdx ?? 0;
    const myA = currentLine?.absLineIdx ?? -1;
    if (gl > myA || (currentLineIdx === 0 && !isMe)) {
      const idx = currentSet.lines.findIndex(l => l.absLineIdx >= gl && isMine(l.absLineIdx));
      if (idx !== -1) {
        // 現在の行より先にある場合、もしくは初期状態で自分の番を待っている場合にのみ追いつかせる(戻りは禁止)
        if (idx > currentLineIdx || (currentLineIdx === 0 && !isMe)) {
          setCurrentLineIdx(idx); 
          setCurrentChunkIdx(0);
        }
      } else if (currentSet.lines.length > 0 && gl > currentSet.lines[currentSet.lines.length - 1].absLineIdx) {
        // 全員先のセットに進んでいる場合のみ -1 にする
        setCurrentLineIdx(-1);
      }
    }
  }, [roomState?.globalLineIdx, currentSet, isStarted, isGameOver, isMine, isMe, currentLineIdx, currentLine]);

  useEffect(() => {
    if (!mapData.displaySets || !isStarted || isGameOver || !mapData.lines) return;
    // プレイ可能な最後の絶対行番号（isEndではない行の最大値）
    const playableLines = mapData.lines.filter(l => !l.isEnd);
    const lastPlayableIdx = playableLines[playableLines.length - 1]?.absLineIdx ?? -1;
    const gl = roomState?.globalLineIdx ?? 0;
    
    // 全ての歌詞行が入力し終わった（＝グローバル行番号が最後の行を超えた）場合
    if (gl > lastPlayableIdx && lastPlayableIdx !== -1) {
      setIsGameOver(true);
      try { playerRef.current?.stopVideo(); } catch (e) {}
    }
  }, [roomState?.globalLineIdx, mapData.lines, isGameOver, isStarted]);

  if (!mapData || !mapData.displaySets || mapData.displaySets.length === 0 || !currentSet) return <div>Loading...</div>;
  const scoreText = (roomState?.sharedScore || 0).toLocaleString();
  const myColor = roomState?.players?.[playerId]?.color || PLAYER_COLORS[myPos % 4];

  return (
    <div className='flex flex-col items-center mt-2 w-full max-w-4xl glass p-8 rounded-3xl relative overflow-hidden font-premium mx-auto'>
      <div className='absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500' />
      <div className={'mb-6 rounded-2xl overflow-hidden bg-black flex items-center justify-center ring-4 ring-white/5 ' + (isGameOver ? 'hidden' : 'flex')} style={{ width: '426px', height: '240px' }}><div id='youtube-player' /></div>
      {isStarted && !isGameOver && (
        <div className="w-full h-2 bg-white/5 rounded-full mb-6 overflow-hidden relative ring-1 ring-white/5">
          <div 
            className="h-full bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400 transition-all duration-300 ease-linear shadow-[0_0_15px_rgba(37,99,235,0.4)]" 
            style={{ width: `${Math.min(100, (currentTime * 1000 / (endTimeMs || 1)) * 100)}%` }} 
          />
        </div>
      )}
      {!isGameOver && <div className="w-full mb-6"><PlayerLane roomState={roomState} playerId={playerId} /></div>}
      {isGameOver ? (
        <div className='flex flex-col items-center gap-4 py-8 animate-in fade-in zoom-in duration-1000 w-full'>
          <div className='text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-amber-600 italic tracking-tighter'>RESULT</div>
          <div className='text-3xl font-black text-white'>SCORE: <span className='text-yellow-400'>{scoreText}</span></div>
          <div className='text-xl font-bold text-white/60'>MAX SHARED COMBO: {roomState?.maxSharedCombo || 0}</div>
          <button onClick={() => { try { playerRef.current?.stopVideo(); } catch (e) {} onBackToMenu(); }} className='mt-6 px-8 py-3 bg-white/10 hover:bg-white/20 text-white font-black rounded-2xl text-sm transition-colors'>BACK TO LOBBY</button>
        </div>
      ) : (
        <>
          {(nextSet || isFinalSetAndFinished) && (
            <div className="w-full flex flex-col items-center mb-6">
              <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden relative mb-3 ring-1 ring-white/10">
                <div 
                  className="h-full bg-gradient-to-r from-rose-600 via-orange-500 to-amber-400 transition-all duration-100 ease-linear shadow-[0_0_20px_rgba(244,63,94,0.3)]" 
                  style={{ width: `${isFinalSetAndFinished ? 100 : Math.max(0, Math.min(100, currentBlockIdx === 0 && currentTime * 1000 < currentSet.timeMs ? (currentTime * 1000 / currentSet.timeMs) * 100 : ((currentTime * 1000 - currentSet.timeMs) / (nextSet!.timeMs - currentSet.timeMs)) * 100))}%` }} 
                />
              </div>
              {canSkip ? ( 
                <div className="text-xs font-black text-amber-400 animate-bounce tracking-[0.3em] uppercase bg-amber-400/10 px-6 py-2 rounded-2xl ring-2 ring-amber-400/40 shadow-[0_0_15px_rgba(251,191,36,0.2)]">
                  ⚡ Press [Space] to Skip to {nextSet ? 'Next Set' : 'Result'} ⚡
                </div>
              ) : ( 
                <div className="text-[10px] font-black text-rose-500/80 tracking-[0.5em] uppercase animate-pulse">
                  {nextSet ? `Next Set in ${Math.max(0, ((nextSet.timeMs - currentTime * 1000) / 1000)).toFixed(1)}s` : 'Waiting for Video End...'}
                </div> 
              )}
            </div>
          )}
          <div className='w-full px-2 mb-2 font-mono font-bold text-4xl tracking-widest min-h-[3rem]'>
            {isEngineReady && ( <><span className='text-white/30'>{(keygraph.key_done() || '').toUpperCase()}</span><span style={{ color: myColor }}>{(keygraph.key_candidate() || '').toUpperCase()}</span></> )}
          </div>
          <div className='flex justify-between items-center w-full mb-4 px-2 font-black italic text-white'>
            <div key={comboAnimKey} className='text-3xl transition-transform' style={{ animation: comboAnimKey > 0 ? 'comboScale 0.3s ease-out' : 'none' }}>{(roomState?.sharedCombo || 0) + ' COMBO'}</div>
            <div className='text-5xl'>{scoreText}</div>
          </div>
        </>
      )}
      {!isGameOver && currentSet && (
        <div className='flex flex-col w-full' style={{ minHeight: '16rem' }}>
          {currentSet.lines.map((line: any, lIdx: number) => {
            const pid = getAssignedPlayerId(line.absLineIdx, playerIds);
            const u = roomState?.players?.[pid];
            const isMeLine = pid === playerId;
            const pColor = u?.color || PLAYER_COLORS[playerIds.indexOf(pid) % PLAYER_COLORS.length];
            const iD = u && (u.currentLineIdx === -1 || u.currentLineIdx > line.absLineIdx);
            const iS = !isMeLine && u && u.currentLineIdx === line.absLineIdx;
            const iF = u && u.currentLineIdx !== -1 && u.currentLineIdx < line.absLineIdx;
            const isHostLine = pid === determineHostId(roomState?.players);
            return (
              <LineItem key={lIdx} line={line} lineIdx={lIdx} currentLineIdx={currentLineIdx} currentChunkIdx={currentChunkIdx} isEngineReady={isEngineReady && isMeLine} playerColor={pColor} isDone={iD} isSomeoneElseActive={iS} isFuture={iF} pidName={(u?.name || '---') + (isMeLine ? ' (YOU)' : '')} opponentChunkIdx={u?.currentChunkIdx} currentTyping={u?.currentTyping} globalLineIdx={roomState?.globalLineIdx} isHostLine={isHostLine} />
            );
          })}
          {Array.from({ length: Math.max(0, 4 - currentSet.lines.length) }).map((_, i) => ( <div key={'dummy-' + i} className='py-2 px-6 rounded-xl' style={{ minHeight: '4rem' }} /> ))}
        </div>
      )}
      <div className={'mt-8 text-center ' + (isGameOver ? 'hidden' : 'block')}>
        {!isStarted ? ( <button onClick={() => setRoomStartTime(roomId)} className='px-10 py-4 bg-gradient-to-br from-green-500 to-emerald-700 text-white font-black text-xl rounded-2xl shadow-xl hover:scale-105 active:scale-95 transition-transform tracking-widest uppercase'>▶ START</button>
        ) : ( <div className='flex items-center gap-4 px-6 py-2 glass rounded-full border-white/5 font-premium'><span className='text-[10px] text-gray-500 font-black uppercase'>Sync Active</span><div className='w-2 h-2 rounded-full bg-green-500 animate-pulse' /></div> )}
      </div>
      <style>{` @keyframes comboScale { 0% { transform: scale(1.4); color: #fbbf24; } 60% { transform: scale(1.1); } 100% { transform: scale(1); color: inherit; } } `}</style>
    </div>
  );
};
