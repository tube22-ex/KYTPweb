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
  opponentChunkIdx,
  currentTyping,
}) => {
  const isActiveLine = lineIdx === currentLineIdx;

  return (
    <div className={`py-2 px-10 transition-all duration-300 rounded-none ${isActiveLine ? 'bg-white shadow-[0_4px_30px_rgba(255,133,161,0.2)] relative z-10 scale-[1.01]' : ''}`}>
      <div className='text-4xl font-black leading-tight flex flex-wrap gap-x-4 tracking-tighter'>
        {line.chunks.map((chunk: any, i: number) => {
          const isChunkActive = isActiveLine && i === currentChunkIdx;
          const isOpponentActiveChunk = isSomeoneElseActive && i === (opponentChunkIdx ?? 0);
          
          // 修正：自分の場所に関わらず、担当者が打ち終わったチャンクを常にグレーアウトする
          const isChunkFinished = isDone || (i < (isActiveLine ? currentChunkIdx : 0)) || (isSomeoneElseActive && i < (opponentChunkIdx ?? 0));
          
          let matchedTyping = '';
          if (isOpponentActiveChunk) {
            matchedTyping = (currentTyping && chunk.text.startsWith(currentTyping)) ? currentTyping : '';
          } else if (isChunkActive && isEngineReady) {
             matchedTyping = keygraph.seq_done() || '';
          }

          return (
            <span key={i} className="relative transition-opacity duration-300" style={{ color: playerColor }}>
              {isChunkActive || isOpponentActiveChunk ? (
                <>
                  <span className="opacity-20 inline-block">{matchedTyping}</span>
                  <span className="opacity-100 drop-shadow-sm">{chunk.text.slice(matchedTyping.length)}</span>
                </>
              ) : (
                <span className={isChunkFinished ? 'opacity-30' : 'opacity-100'}>{chunk.text}</span>
              )}
            </span>
          );
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
  const [videoDuration, setVideoDuration] = useState(0);
  const [playerState, setPlayerState] = useState<number>(-1); // YT.PlayerState

  const playerRef = useRef<any>(null);
  const instanceIdRef = useRef<number>(0);
  const preparedRef = useRef<string>(""); // "absLineIdx-chunkIdx"

  const isStarted = roomState?.startTime != null;

  const playerIds = useMemo(() => {
    if (!roomState || !roomState.players) return [playerId];
    return Object.keys(roomState.players).sort();
  }, [roomState?.players, playerId]);

  const isHost = determineHostId(roomState?.players) === playerId;

  const getAssignedPlayerId = useMemo(() => {
    return (absLineIdx: number, pids: string[]) => {
      const n = pids.length;
      if (n === 0) return "";
      return pids[absLineIdx % n];
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
            setVideoDuration(e.target.getDuration());
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
  const activeLinePlayerId = currentLine ? getAssignedPlayerId(currentLine.absLineIdx, playerIds) : "";
  const isSomeoneElseActive = activeLinePlayerId !== "" && activeLinePlayerId !== playerId;

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

  const handleKeydown = (e: KeyboardEvent) => {
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
        if (roomId && playerId) {
          updatePlayerProgress(roomId, playerId, nextLineIdxForFirebase, nextChunkIdxForFirebase, 0, 0, 0, nextChunkIdxForFirebase, 0, '', '');
        }
        setIsEngineReady(false);
      } else {
        if (roomId && playerId && currentLine) {
          updatePlayerProgress(roomId, playerId, currentLine.absLineIdx, currentChunkIdx, 0, 0, 0, currentChunkIdx, keygraph.seq_done()?.length || 0, keygraph.seq_done() || '', chunk.text);
        }
      }
    } else { try { miss_sound.play(); } catch (_) { } }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [isStarted, isEngineReady, isMe, currentLine, currentChunkIdx, roomState, roomId, currentBlockIdx, currentLineIdx, canSkip, nextSet, isMine]);

  useEffect(() => {
    if (!isStarted || isGameOver || !roomState || !currentSet || currentLineIdx === -1) return;
    const gl = roomState.globalLineIdx ?? 0;
    const myA = currentLine?.absLineIdx ?? -1;
    if (gl > myA || (currentLineIdx === 0 && !isMe)) {
      const idx = currentSet.lines.findIndex(l => l.absLineIdx >= gl && isMine(l.absLineIdx));
      if (idx !== -1) {
        if (idx > currentLineIdx || (currentLineIdx === 0 && !isMe)) {
          setCurrentLineIdx(idx); 
          setCurrentChunkIdx(0);
        }
      } else if (currentSet.lines.length > 0 && gl > currentSet.lines[currentSet.lines.length - 1].absLineIdx) {
        setCurrentLineIdx(-1);
      }
    }
  }, [roomState?.globalLineIdx, currentSet, isStarted, isGameOver, isMine, isMe, currentLineIdx, currentLine]);

  useEffect(() => {
    if (!mapData.displaySets || !isStarted || isGameOver || !mapData.lines) return;
    const playableLines = mapData.lines.filter(l => !l.isEnd);
    const lastPlayableIdx = playableLines[playableLines.length - 1]?.absLineIdx ?? -1;
    const gl = roomState?.globalLineIdx ?? 0;
    if (gl > lastPlayableIdx && lastPlayableIdx !== -1) {
      setIsGameOver(true);
      try { playerRef.current?.stopVideo(); } catch (e) {}
    }
  }, [roomState?.globalLineIdx, mapData.lines, isGameOver, isStarted]);

  if (!mapData || !mapData.displaySets || mapData.displaySets.length === 0 || !currentSet) return <div>Loading...</div>;
  const scoreText = (roomState?.sharedScore || 0).toString().padStart(6, '0');

  return (
    <div className='flex flex-col items-center w-full max-w-5xl mx-auto pb-12 px-2'>
      {/* プレイ画面全体をくくる枠 (角を丸くせず、paddingを0に) */}
      <div className="w-full border-4 border-white rounded-none bg-white/5 backdrop-blur-sm p-0 flex flex-col gap-0 shadow-2xl overflow-hidden">
        
        {/* 1. プレイヤーレーン (背景を透過させて枠に密着) */}
        <div className="w-full bg-white/10 border-b-2 border-white/20">
          <PlayerLane roomState={roomState} playerId={playerId} />
        </div>

        {!isGameOver && (
          <div className="w-full flex flex-col gap-0">
            {/* 2. 歌詞モニターエリア */}
            <div className="w-full p-10 min-h-[240px] flex flex-col justify-center relative overflow-hidden bubble-bg bg-white border-y-4 border-rose-200">
               {canSkip && (
                 <div className="absolute top-3 right-5 animate-bounce z-20">
                   <div className="px-3 py-1 bg-rose-400 text-white text-[10px] font-black rounded-full shadow-md flex items-center gap-2">
                     <span>SPACE to Skip</span>
                     <span className="text-sm">➜</span>
                   </div>
                 </div>
               )}

               <div 
                 className="flex flex-col w-full gap-1.5 transition-opacity duration-700"
                 style={{ opacity: (currentBlockIdx === 0 && currentTime * 1000 < currentSet.timeMs) ? 0 : 1 }}
               >
                {currentSet.lines.map((line: any, lIdx: number) => {
                  const pid = getAssignedPlayerId(line.absLineIdx, playerIds);
                  const u = roomState?.players?.[pid];
                  const pColor = u?.color || PLAYER_COLORS[playerIds.indexOf(pid) % PLAYER_COLORS.length];
                  const iD = u && (u.currentLineIdx === -1 || u.currentLineIdx > line.absLineIdx);
                  const iS = !(pid === playerId) && u && u.currentLineIdx === line.absLineIdx;
                  return (
                    <LineItem key={lIdx} line={line} lineIdx={lIdx} currentLineIdx={currentLineIdx} currentChunkIdx={currentChunkIdx} isEngineReady={isEngineReady && (pid === playerId)} playerColor={pColor} isDone={iD} isSomeoneElseActive={iS} opponentChunkIdx={u?.currentChunkIdx} currentTyping={u?.currentTyping} />
                  );
                })}
                {Array.from({ length: Math.max(0, 4 - currentSet.lines.length) }).map((_, i) => ( <div key={'dummy-' + i} className='py-0.5 px-8 h-[40px]' /> ))}
              </div>
            </div>

            {/* 3. 入力インジケーターバー */}
            <div className="w-full bg-rose-400 flex flex-col relative overflow-hidden border-b-4 border-white/10">
              
              {/* ライン進捗バー (タイマー) */}
              {isStarted && !isGameOver && (
                <div className="w-full h-4 bg-rose-900/20">
                  <div 
                    className="h-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)] transition-all duration-100"
                    style={{ 
                      width: `${(() => {
                        const line = currentSet.lines[0];
                        const nextSet = mapData.displaySets[currentBlockIdx + 1];
                        const now = currentTime * 1000;
                        const setEnd = nextSet ? nextSet.timeMs : (videoDuration * 1000);
                        
                        let start, end;
                        if (currentBlockIdx === 0 && now < line.timeMs) {
                          start = 0;
                          end = line.timeMs;
                        } else {
                          start = line.timeMs;
                          end = setEnd;
                        }
                        
                        const progress = (now - start) / (Math.max(1, end - start));
                        return Math.max(0, Math.min(100, progress * 100));
                      })()}%` 
                    }}
                  />
                </div>
              )}

              <div className="h-24 flex items-center justify-between px-10">
                <div className="flex flex-col items-start leading-none mt-1">
                  <span className="text-[10px] font-black text-rose-100 uppercase italic">Target</span>
                  <span className="text-xs font-black text-white italic">{isMe ? 'TYPE!' : 'WAIT'}</span>
                </div>

                <div className="flex-1 flex items-center justify-start pl-10">
                  {isEngineReady && isMe ? (
                    <div className="flex items-center gap-2">
                      <span className="text-6xl font-black italic tracking-wider text-white drop-shadow-lg">
                        <span className="opacity-30">{(keygraph.key_done() || '').toUpperCase()}</span>
                        <span>{(keygraph.key_candidate() || '').toUpperCase()}</span>
                      </span>
                    </div>
                  ) : (
                    <div className="text-white/40 font-black uppercase tracking-[0.3em] text-[10px] animate-pulse w-full text-center pr-20">
                      {isSomeoneElseActive ? 'Opponent Activity...' : 'Waiting for Rhythm...'}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end leading-none mt-1">
                  <span className="text-[10px] font-black text-rose-100 uppercase italic text-right">Combo</span>
                  <div key={comboAnimKey} className="text-4xl font-black italic text-white combo-pop leading-none">{roomState?.sharedCombo || 0}</div>
                </div>
              </div>
            </div>

            {/* 4. ダッシュボードパネル (横に並べつつ、枠に密着) */}
            <div className="w-full flex">
              {/* 左パネル: スコア */}
              <div className="flex-1 p-6 flex flex-col items-center justify-center bubble-bg bg-white border-r-2 border-white/10">
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">Total Score</span>
                <div className="text-4xl font-black text-zinc-700 tracking-tighter">{scoreText}</div>
              </div>

              {/* 中央パネル: ビデオ */}
              <div className="w-[360px] aspect-video bg-black relative group border-r-2 border-white/10">
                 <div id='youtube-player' className="w-full h-full" />
              </div>

              {/* 右パネル: 曲情報/メニュー */}
              <div className="flex-1 p-6 flex flex-col justify-between bubble-bg bg-white">
                 <div className="flex flex-col">
                   <span className="text-[10px] font-black text-rose-300 uppercase italic">Playing</span>
                   <div className="text-base font-black text-zinc-700 truncate mt-0.5">{mapData.title || 'Unknown Stage'}</div>
                   <div className="text-[10px] font-bold text-zinc-400 truncate">{mapData.artist || 'Unknown Artist'}</div>
                 </div>
                 
                 <div className="flex gap-2 mt-4">
                    <button 
                      onClick={() => { try { playerRef.current?.stopVideo(); } catch (e) {} onBackToMenu(); }}
                      className="flex-1 py-1.5 bg-rose-400 text-white text-[10px] font-black rounded-none hover:bg-rose-500 shadow-sm transition-colors"
                    >
                      MENU
                    </button>
                    <button className="flex-1 py-1.5 bg-white border border-zinc-100 text-[10px] text-zinc-400 font-black rounded-none hover:bg-zinc-50 transition-colors">HELP</button>
                 </div>
              </div>
            </div>

            {/* 5. プログレスバー (最下部にフラットに配置) */}
            <div className="w-full h-2 bg-zinc-200 overflow-hidden relative">
               <div 
                 className="h-full bg-gradient-to-r from-rose-400 to-rose-500 transition-all duration-500 ease-out"
                 style={{ width: `${Math.max(0, Math.min(100, (currentTime / (videoDuration || 1)) * 100))}%` }}
               />
            </div>
          </div>
        )}
      </div>

      {isGameOver && (
        <div className='flex flex-col items-center gap-12 py-24 w-full bg-white border-4 border-white shadow-2xl relative overflow-hidden text-center rounded-none bubble-bg mt-12'>
          <div className='absolute -top-10 -left-10 w-40 h-40 bg-rose-100 blur-3xl opacity-50' />
          <div className='absolute -bottom-10 -right-10 w-40 h-40 bg-purple-100 blur-3xl opacity-50' />
          
          <div className='text-8xl font-black text-rose-400 italic tracking-tighter drop-shadow-lg scale-y-110 leading-none'>FINISH!</div>
          <div className='flex flex-col gap-4'>
            <div className='text-5xl font-black text-zinc-700 uppercase tracking-tighter'>STAGE SCORE: <span className='text-rose-400'>{scoreText}</span></div>
            <div className='text-xl font-bold text-zinc-300 uppercase tracking-[0.5em]'>Grand Combo: {roomState?.maxSharedCombo || 0}</div>
          </div>
          <button 
            onClick={() => { try { playerRef.current?.stopVideo(); } catch (e) {} onBackToMenu(); }} 
            className='bg-rose-500 hover:bg-rose-600 text-white font-black text-xl px-24 py-6 rounded-none shadow-2xl shadow-rose-200 transition-all hover:scale-110 active:scale-95'
          >
            RETURN TO STAGE SELECTION ♥
          </button>
        </div>
      )}

      {!isGameOver && !isStarted && (
        <div className="fixed inset-0 bg-white/80 flex items-center justify-center z-50 backdrop-blur-xl">
           <button 
             onClick={() => setRoomStartTime(roomId)} 
             className='px-24 py-10 bg-white border-8 border-rose-300 text-rose-400 font-black text-5xl rounded-[4rem] shadow-[0_30px_60px_rgba(255,133,161,0.3)] hover:scale-110 active:scale-95 transition-all transform tracking-tight'
           >
             GO! ♥
           </button>
        </div>
      )}
    </div>
  );
};
