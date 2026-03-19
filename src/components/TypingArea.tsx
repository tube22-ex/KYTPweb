import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { ParseResult } from '../services/api';
import keygraph from '../utils/keygraph';
import { sound, miss_sound } from '../utils/sound';
import { updatePlayerProgress, RoomState, setRoomStartTime, getServerTimeOffset, incrementSharedScore, updateSharedCombo, updateGlobalProgress, updateRoomPlayback, determineHostId } from '../services/sync';
import { PlayerLane } from './PlayerLane';

interface Props {
  mapData: ParseResult;
  roomId: string;
  playerId: string;
  roomState: RoomState | null;
  onBackToMenu: () => void;
  onBlockChange?: (blockIdx: number) => void;
  volume?: number;
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
    <div className={`py-1 px-4 transition-all duration-300 rounded-none border-l-4 ${isActiveLine ? 'bg-rose-50/50 border-rose-400 shadow-sm relative z-10 scale-[1.01]' : 'border-transparent'}`}>
      <div className='text-[20px] font-black leading-tight flex flex-wrap gap-x-4 tracking-tighter text-zinc-600'>
        {line.chunks.map((chunk: any, i: number) => {
          const isChunkActive = isActiveLine && i === currentChunkIdx;
          const isOpponentActiveChunk = isSomeoneElseActive && i === (opponentChunkIdx ?? 0);

          // 修正：自分の場所に関わらず、担当者が打ち終わったチャンクを常にグレーアウトする
          const isChunkFinished = isDone || (i < (isActiveLine ? currentChunkIdx : 0)) || (isSomeoneElseActive && i < (opponentChunkIdx ?? 0));

          let matchedTyping = '';
          if (isOpponentActiveChunk) {
            matchedTyping = (currentTyping && chunk.text.toUpperCase().replace(/ /g, '　').startsWith(currentTyping.toUpperCase())) ? currentTyping : '';
          } else if (isChunkActive && isEngineReady) {
            matchedTyping = keygraph.seq_done() || '';
          }

          const displayText = chunk.text.toUpperCase().replace(/ /g, '　');

          return (
            <span key={i} className="relative" style={{ color: playerColor }}>
              {isChunkActive || isOpponentActiveChunk ? (
                <>
                  <span className="opacity-20 inline-block">{displayText.slice(0, matchedTyping.length)}</span>
                  <span className="opacity-100 drop-shadow-sm">{displayText.slice(matchedTyping.length)}</span>
                </>
              ) : (
                <span className={isChunkFinished ? 'opacity-30' : 'opacity-100'}>{displayText}</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
};

// コンボ倍率の計算ロジック
const getComboMultiplier = (combo: number): number => {
  if (combo >= 50) return 8;
  if (combo >= 30) return 5;
  if (combo >= 20) return 4;
  if (combo >= 10) return 3;
  if (combo >= 5) return 2;
  return 1;
};

export const TypingArea: React.FC<Props> = ({ mapData, roomId, playerId, roomState, onBackToMenu, onBlockChange, volume = 50 }) => {
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

  // 音源の初期化
  useEffect(() => {
    try {
      sound.init();
      miss_sound.init();
    } catch (e) {
      console.warn('Sound init failed:', e);
    }
  }, []);

  useEffect(() => {
    if (playerRef.current && typeof playerRef.current.setVolume === 'function') {
      try { playerRef.current.setVolume(volume); } catch (e) {}
    }
  }, [volume, playerState]);

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
            try { e.target.setVolume(volume); } catch (err) {}
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
    onBlockChange?.(currentBlockIdx);
  }, [currentBlockIdx, onBlockChange]);

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

        // 【コンボルール】ブロックが時間切れになったとき、打ち残しがあればコンボリセット
        // ホストのみが判定してFirebaseに書き込む（重複防止）
        if (isHost) {
          const currentGl = roomStateRef.current?.globalLineIdx ?? 0;
          const currentGc = roomStateRef.current?.globalChunkIdx ?? 0;
          const currentLines = mapData.displaySets[currentBlockIdx].lines;
          // ブロックの最後のラインの最後のチャンクまで打ち終わっていなければリセット
          const lastLine = currentLines[currentLines.length - 1];
          const lastLineFinished = lastLine && (currentGl > lastLine.absLineIdx || (currentGl === lastLine.absLineIdx && currentGc >= lastLine.chunks.length));
          if (!lastLineFinished) {
            updateSharedCombo(roomId, 0, roomStateRef.current?.maxSharedCombo || 0);
            // globalも次のブロックの先頭にリセット
            updateGlobalProgress(roomId, nLines[0]?.absLineIdx ?? currentGl + 1, 0);
          }
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

  // ===【パフォーマンス改善】===
  // handleKeydownが毎回生成・登録しなおされないようにするため、
  // すべての参照をrefで保持して、useEffectの依存配列を空にする
  const isStartedRef = useRef(isStarted);
  const isEngineReadyRef = useRef(isEngineReady);
  const isMeRef = useRef(isMe);
  const currentLineRef = useRef(currentLine);
  const currentChunkIdxRef = useRef(currentChunkIdx);
  const roomStateRef = useRef(roomState);
  const currentLineIdxRef = useRef(currentLineIdx);
  const canSkipRef = useRef(canSkip);
  const nextSetRef = useRef(nextSet);
  const isMineRef = useRef(isMine);
  const currentSetRef = useRef(currentSet);
  const isFinalSetAndFinishedRef = useRef(isFinalSetAndFinished);

  useEffect(() => { isStartedRef.current = isStarted; }, [isStarted]);
  useEffect(() => { isEngineReadyRef.current = isEngineReady; }, [isEngineReady]);
  useEffect(() => { isMeRef.current = isMe; }, [isMe]);
  useEffect(() => { currentLineRef.current = currentLine; }, [currentLine]);
  useEffect(() => { currentChunkIdxRef.current = currentChunkIdx; }, [currentChunkIdx]);
  useEffect(() => { roomStateRef.current = roomState; }, [roomState]);
  useEffect(() => { currentLineIdxRef.current = currentLineIdx; }, [currentLineIdx]);
  useEffect(() => { canSkipRef.current = canSkip; }, [canSkip]);
  useEffect(() => { nextSetRef.current = nextSet; }, [nextSet]);
  useEffect(() => { isMineRef.current = isMine; }, [isMine]);
  useEffect(() => { currentSetRef.current = currentSet; }, [currentSet]);
  useEffect(() => { isFinalSetAndFinishedRef.current = isFinalSetAndFinished; }, [isFinalSetAndFinished]);

  const handleKeydown = useCallback((e: KeyboardEvent) => {
    const _canSkip = canSkipRef.current;
    const _nextSet = nextSetRef.current;
    const _isFinalSetAndFinished = isFinalSetAndFinishedRef.current;
    if (e.code === 'Space' && _canSkip) {
      e.preventDefault();
      if (_nextSet) {
        const skipToSec = (_nextSet.timeMs / 1000) - 3;
        if (playerRef.current?.seekTo) {
          const t = Math.max(0, skipToSec);
          playerRef.current.seekTo(t, true);
          updateRoomPlayback(roomId, t);
        }
      } else if (_isFinalSetAndFinished) {
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
    if (!isStartedRef.current || !isEngineReadyRef.current || !isMeRef.current || e.key.length > 1 || e.altKey || e.ctrlKey || e.metaKey) return;
    const chunk = currentLineRef.current?.chunks?.[currentChunkIdxRef.current];
    if (!chunk) return;
    const rs = roomStateRef.current;
    if (keygraph.next(e.key.toLowerCase())) {
      const isFinished = keygraph.is_finished();

      if (isFinished) {
        setComboAnimKey(k => k + 1);
        // コンボ倍率をスコアに適用
        const comboAfterIncrement = (rs?.sharedCombo || 0) + 1;
        const mult = getComboMultiplier(comboAfterIncrement);
        if (rs?.sharedScore !== undefined) incrementSharedScore(roomId, rs.sharedScore + 10 * mult);

        const currentLine = currentLineRef.current!;
        const currentChunkIdx = currentChunkIdxRef.current;
        const currentLineIdx = currentLineIdxRef.current;
        const currentSet = currentSetRef.current;
        const gl = rs?.globalLineIdx ?? 0;
        const gc = rs?.globalChunkIdx ?? 0;

        // ===【コンボルール】===
        // 正しい順番（globalLineIdx・globalChunkIdx と一致）で打てたかチェック
        const isCorrectOrder = currentLine.absLineIdx === gl && currentChunkIdx === gc;

        if (isCorrectOrder) {
          // 正順: コンボ加算 + globalを進める
          const combo = (rs?.sharedCombo || 0) + 1;
          updateSharedCombo(roomId, combo, Math.max(rs?.maxSharedCombo || 0, combo));
          let nl = currentLine.absLineIdx, nc = currentChunkIdx + 1;
          if (nc >= currentLine.chunks.length) { nl++; nc = 0; }
          updateGlobalProgress(roomId, nl, nc);
        } else {
          // 順番違反: コンボリセット（0にする）
          updateSharedCombo(roomId, 0, rs?.maxSharedCombo || 0);
        }
        let nextLineIdxForFirebase = currentLine.absLineIdx;
        let nextChunkIdxForFirebase = currentChunkIdx + 1;

        let nextChunkToBuild = null;

        if (nextChunkIdxForFirebase < currentLine.chunks.length) {
          setCurrentChunkIdx(nextChunkIdxForFirebase);
          nextChunkToBuild = currentLine.chunks[nextChunkIdxForFirebase];
        } else {
          let nextM = -1;
          if (currentSet?.lines) {
            for (let i = currentLineIdx + 1; i < currentSet.lines.length; i++) {
              if (isMineRef.current(currentSet.lines[i].absLineIdx)) { nextM = i; break; }
            }
          }
          if (nextM !== -1) {
            setCurrentLineIdx(nextM);
            setCurrentChunkIdx(0);
            nextLineIdxForFirebase = currentSet!.lines[nextM].absLineIdx;
            nextChunkIdxForFirebase = 0;
            nextChunkToBuild = currentSet!.lines[nextM].chunks[0];
          } else {
            setCurrentLineIdx(-1);
            nextLineIdxForFirebase = -1;
            nextChunkIdxForFirebase = 0;
          }
        }

        if (roomId && playerId) {
          updatePlayerProgress(roomId, playerId, nextLineIdxForFirebase, nextChunkIdxForFirebase, 0, 0, 0, nextChunkIdxForFirebase, 0, '', '');
        }

        // 次のチャンクを即時ビルドして待機時間をゼロにする
        if (nextChunkToBuild) {
          const key = `${nextLineIdxForFirebase}-${nextChunkIdxForFirebase}`;
          keygraph.reset();
          keygraph.build(nextChunkToBuild.text);
          setIsEngineReady(true);
          preparedRef.current = key;
        } else {
          setIsEngineReady(false);
        }
      }
      // 【最適化】チャンク完了前の中間打鍵はFirebaseに書き込まない
    } else { try { miss_sound.play(); } catch (_) { } }
  }, [roomId, playerId, endTimeMs]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [handleKeydown]);

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
      try { playerRef.current?.stopVideo(); } catch (e) { }
    }
  }, [roomState?.globalLineIdx, mapData.lines, isGameOver, isStarted]);


  if (!mapData || !mapData.displaySets || mapData.displaySets.length === 0 || !currentSet) return <div>Loading...</div>;
  const scoreText = (roomState?.sharedScore || 0).toString().padStart(6, '0');
  const currentCombo = roomState?.sharedCombo || 0;
  const multiplier = getComboMultiplier(currentCombo);

  return (
    <div className='flex flex-col items-center w-full max-w-none mx-auto p-0 h-full overflow-hidden'>
      {/* プレイ画面全体をくくる枠 (角を丸くせず、paddingを0に、上辺のボーダーのみ削る) */}
      <div className="w-full border-4 border-white rounded-none bg-white/5 backdrop-blur-sm p-0 flex flex-col h-full overflow-hidden">

        {/* 1. プレイヤーレーン (背景を透過させて枠に密着) */}
        <div className="w-full bg-white/10 border-b-2 border-white/20 flex-shrink-0" style={{ height: '180px' }}>
          <PlayerLane roomState={roomState} playerId={playerId} />
        </div>

        {!isGameOver && (
          <div className="w-full flex flex-col gap-0">
            {/* 2. 歌詞モニターエリア */}
            <div className="w-full p-2 flex flex-col justify-center relative overflow-hidden bubble-bg bg-white border-y-4 border-rose-200 lyrics-area">
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
                  // u?.color優先。未ロード中はグレーを返し、一瞬別の色が見えるフラッシング防止
                  const pColor = u?.color ?? '#aaaaaa';
                  const iD = u && (u.currentLineIdx === -1 || u.currentLineIdx > line.absLineIdx);
                  const iS = !(pid === playerId) && u && u.currentLineIdx === line.absLineIdx;
                  return (
                    <LineItem key={lIdx} line={line} lineIdx={lIdx} currentLineIdx={currentLineIdx} currentChunkIdx={currentChunkIdx} isEngineReady={isEngineReady && (pid === playerId)} playerColor={pColor} isDone={iD} isSomeoneElseActive={iS} opponentChunkIdx={u?.currentChunkIdx} currentTyping={u?.currentTyping} />
                  );
                })}
                {Array.from({ length: Math.max(0, 4 - currentSet.lines.length) }).map((_, i) => (<div key={'dummy-' + i} className='py-0.5 px-8 h-[40px]' />))}
              </div>
            </div>

            {/* 3. 入力インジケーターバー */}
            <div className="w-full bg-rose-400 flex flex-col relative overflow-hidden border-b-4 border-white/10 target-bar">

              {/* ライン進捗バー (タイマー) */}
              {isStarted && !isGameOver && (() => {
                const myColor = roomState?.players?.[playerId]?.color ?? '#ffffff';
                const line = currentSet.lines[0];
                const nextSet = mapData.displaySets[currentBlockIdx + 1];
                const now = currentTime * 1000;
                const setEnd = nextSet ? nextSet.timeMs : (videoDuration * 1000);
                let start, end;
                if (currentBlockIdx === 0 && now < line.timeMs) {
                  start = 0; end = line.timeMs;
                } else {
                  start = line.timeMs; end = setEnd;
                }
                const progress = Math.max(0, Math.min(100, (now - start) / Math.max(1, end - start) * 100));
                return (
                  <div className="w-full h-4 bg-black/20">
                    <div
                      className="h-full transition-all duration-100"
                      style={{
                        backgroundColor: myColor,
                        boxShadow: `0 0 10px ${myColor}88`,
                        width: `${progress}%`
                      }}
                    />
                  </div>
                );
              })()}

              <div className="flex-1 flex items-center justify-between px-10">
                <div className="flex flex-col items-start leading-none mt-1">
                  <span className="text-[12px] font-black text-rose-100 uppercase italic">Target</span>
                  <span className="text-sm font-black text-white italic">{isMe ? '打って！' : '待機'}</span>
                </div>

                <div className="flex-1 flex items-center justify-start pl-10">
                  {isEngineReady && isMe ? (
                    <div className="flex items-center gap-2">
                      <span className="text-3xl font-black italic tracking-wider text-white drop-shadow-lg">
                        <span className="opacity-30">{(keygraph.key_done() || '').toUpperCase()}</span>
                        <span>{(keygraph.key_candidate() || '').toUpperCase()}</span>
                      </span>
                    </div>
                  ) : (
                    <div className="text-white/40 font-black uppercase tracking-[0.3em] text-[10px] animate-pulse w-full text-center pr-20">
                      {isSomeoneElseActive ? '相手が入力中...' : 'リズムを待っています...'}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end leading-none mt-1">
                  <span className="text-[10px] font-black text-rose-100 uppercase italic text-right tracking-widest">Combo</span>
                  <div key={comboAnimKey} className="flex items-baseline gap-1 combo-pop">
                    <div className="text-4xl font-black italic text-white leading-none">{currentCombo}</div>
                    {multiplier > 1 && (
                      <div
                        key={`mult-${multiplier}`}
                        className="text-sm font-black italic leading-none px-1.5 py-0.5 rounded-full animate-bounce"
                        style={{
                          background: multiplier >= 8 ? 'linear-gradient(135deg, #ff0080, #ff6600)'
                            : multiplier >= 5 ? 'linear-gradient(135deg, #7c3aed, #e11d48)'
                            : multiplier >= 4 ? 'linear-gradient(135deg, #0ea5e9, #7c3aed)'
                            : multiplier >= 3 ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                            : 'linear-gradient(135deg, #10b981, #3b82f6)',
                          color: 'white',
                          boxShadow: '0 0 15px rgba(255,255,255,0.4)',
                          textShadow: '0 0 8px rgba(255,255,255,0.8)',
                        }}
                      >
                        x{multiplier}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 4. ダッシュボードパネル (横に並べつつ、枠に密着) */}
            <div className="w-full flex shrink-0 score-video-area">
              {/* 左パネル: スコア */}
              <div className="flex-[1_1_0%] min-w-0 p-3 flex flex-col items-center justify-center bubble-bg bg-[#fff5f8] border-r-2 border-rose-200 overflow-visible">
                <span className="font-black uppercase tracking-widest mb-0.5 score-label" style={{ color: '#1a1a1a', opacity: 1, textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>合計スコア</span>
                <div className="font-black tracking-tighter shrink-0 score-value" style={{ color: '#1a1a1a', textShadow: '0 2px 4px rgba(0,0,0,0.2)', opacity: 1 }}>{scoreText}</div>
              </div>

              {/* 中央パネル: ビデオ (柔軟なサイズ調整で中央を維持) */}
              <div className="flex-[2] min-w-0 max-w-[540px] aspect-video bg-black relative group border-x-2 border-white/10 flex flex-col items-center justify-center shrink-0">
                <div id='youtube-player' className="w-full h-full" />
              </div>

              {/* 右パネル: 曲情報/メニュー (flex-1にして中央寄せを維持) */}
              <div className="flex-1 p-3 flex flex-col justify-between bubble-bg bg-white overflow-y-auto">
                <div className="flex flex-col">
                  <span className="text-[12px] font-black text-rose-300 uppercase italic">再生中</span>
                  <div className="text-2xl font-black text-zinc-700 truncate mt-0.5 tracking-tighter italic">{mapData.title || 'Unknown Stage'}</div>
                  <div className="text-sm font-bold text-zinc-400 truncate mt-1">{mapData.artist || 'Unknown Artist'}</div>
                </div>

                <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => { try { playerRef.current?.stopVideo(); } catch (e) { } onBackToMenu(); }}
                      className="flex-1 bg-rose-400 text-white font-black rounded-none hover:bg-rose-500 shadow-sm transition-colors menu-button"
                    >
                      MENU
                    </button>
                    <button className="flex-1 bg-white border border-zinc-100 text-zinc-400 font-black rounded-none hover:bg-zinc-50 transition-colors help-button">ヘルプ</button>
                </div>
              </div>
            </div>

            {/* 5. プログレスバー (最下部にフラットに配置) */}
            <div className="w-full bg-zinc-200 overflow-hidden relative footer-area">
              <div
                className="h-full bg-gradient-to-r from-rose-400 to-rose-500 transition-all duration-500 ease-out"
                style={{ width: `${Math.max(0, Math.min(100, (currentTime / (videoDuration || 1)) * 100))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {isGameOver && (
        <div className='flex flex-col items-center justify-center gap-4 py-8 w-full bg-white border-4 border-white shadow-2xl relative overflow-hidden text-center rounded-none bubble-bg h-full'>
          <div className='absolute -top-10 -left-10 w-40 h-40 bg-rose-100 blur-3xl opacity-50' />
          <div className='absolute -bottom-10 -right-10 w-40 h-40 bg-purple-100 blur-3xl opacity-50' />

          <div className='text-8xl font-black text-rose-400 italic tracking-tighter drop-shadow-lg scale-y-110 leading-none'>FINISH!</div>
          <div className='flex flex-col gap-4'>
            <div className='font-black uppercase tracking-tighter' style={{ fontSize: '40px', color: '#1a1a1a', opacity: 1, textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>ステージスコア: <span className='text-rose-500 hover:text-rose-600 transition-colors'>{scoreText}</span></div>
            <div className='font-bold uppercase tracking-[0.5em]' style={{ fontSize: '14px', color: '#666666', opacity: 1 }}>最大コンボ: {roomState?.maxSharedCombo || 0}</div>
          </div>
          <button
            onClick={() => { try { playerRef.current?.stopVideo(); } catch (e) { } onBackToMenu(); }}
            className='bg-rose-500 hover:bg-rose-600 text-white font-black text-xl px-24 py-6 rounded-none shadow-2xl shadow-rose-200 transition-all hover:scale-110 active:scale-95'
          >
            ステージ選択に戻る
          </button>
        </div>
      )}

      {!isGameOver && !isStarted && (
        <div className="fixed inset-0 bg-white/80 flex items-center justify-center z-50 backdrop-blur-xl">
          <button
            onClick={() => setRoomStartTime(roomId)}
            className='px-24 py-10 bg-white border-8 border-rose-300 text-rose-400 font-black text-5xl rounded-[4rem] shadow-[0_30px_60px_rgba(255,133,161,0.3)] hover:scale-110 active:scale-95 transition-all transform tracking-tight'
          >
            START
          </button>
        </div>
      )}
    </div>
  );
};
