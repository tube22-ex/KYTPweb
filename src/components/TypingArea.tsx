import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { ParseResult } from '../services/api';
import keygraph from '../utils/keygraph';
import { sound, miss_sound, clear_sound } from '../utils/sound';
import { updatePlayerProgress, updatePlayerSpeedSamples, RoomState, setRoomStartTime, getServerTimeOffset, incrementSharedScore, updateSharedCombo, updateGlobalProgress, updateRoomPlayback, determineHostId } from '../services/sync';
import { PlayerLane } from './PlayerLane';

interface Props {
  mapData: ParseResult;
  roomId: string;
  playerId: string;
  roomState: RoomState | null;
  onBackToMenu: () => void;
  onBlockChange: (idx: number) => void;
  onLineChange?: (lineIdx: number) => void;
  volume: number;
}

const getComboMultiplier = (combo: number): number => {
  if (combo >= 50) return 8;
  if (combo >= 30) return 5;
  if (combo >= 20) return 4;
  if (combo >= 10) return 3;
  if (combo >= 5) return 2;
  return 1;
};

type JudgeResult = 'PERFECT' | 'GOOD' | 'OK' | 'BAD';

// 残り時間の割合で判定（1セット内の行ごと）
// ratio = remainMs / intervalMs
// > 5/6 → PERFECT, > 3/6 → GOOD, > 1/6 → OK, else → BAD
const calcJudge = (remainMs: number, intervalMs: number): JudgeResult => {
  if (intervalMs <= 0) return 'BAD';
  const ratio = remainMs / intervalMs;
  if (ratio > 5 / 6) return 'PERFECT';
  if (ratio > 3 / 6) return 'GOOD';
  if (ratio > 1 / 6) return 'OK';
  return 'BAD';
};

const JUDGE_STYLE: Record<JudgeResult, { color: string; shadow: string; stroke: string }> = {
  PERFECT: { color: '#FFE500', stroke: '#FF6600', shadow: '0 0 8px #FFE500, 0 0 20px #FF8C00, 0 0 40px #FF4400, 2px 2px 0 #AA4400, -1px -1px 0 #AA4400' },
  GOOD: { color: '#00FF88', stroke: '#007744', shadow: '0 0 8px #00FF88, 0 0 20px #00CC66, 0 0 40px #009944, 2px 2px 0 #004422, -1px -1px 0 #004422' },
  OK: { color: '#44CCFF', stroke: '#0055AA', shadow: '0 0 8px #44CCFF, 0 0 20px #0088CC, 2px 2px 0 #003366, -1px -1px 0 #003366' },
  BAD: { color: '#FF4444', stroke: '#880000', shadow: '0 0 8px #FF4444, 0 0 16px #CC0000, 2px 2px 0 #550000, -1px -1px 0 #550000' },
};

export const TypingArea: React.FC<Props> = ({ mapData, roomId, playerId, roomState, onBackToMenu, onBlockChange, onLineChange, volume }) => {
  const [currentBlockIdx, setCurrentBlockIdx] = useState(0);
  const [currentLineIdx, setCurrentLineIdx] = useState(0);
  const [currentChunkIdx, setCurrentChunkIdx] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const [comboAnimKey, setComboAnimKey] = useState(0);
  const [inputCount, setInputCount] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [playerState, setPlayerState] = useState<number>(-1);

  // 判定演出 — どのチャンクの上に表示するか "absLineIdx-chunkIdx" で特定
  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null);
  const [judgeChunkKey, setJudgeChunkKey] = useState<string | null>(null);
  const judgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 速度計測
  const measureStartTimeRef = useRef<number | null>(null);
  const setTotalCharsRef = useRef<number>(0);
  const typedCharsInSetRef = useRef<number>(0); // セット内で実際に打ち終えたチャンクの累計文字数
  const speedSamplesRef = useRef<number[]>([]);

  const playerRef = useRef<any>(null);
  const instanceIdRef = useRef<number>(0);
  const preparedRef = useRef<string>("");

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
    if (endLine) return endLine.timeMs + 10000; // 10秒バッファ
    const lastLine = mapData.lines[mapData.lines.length - 1];
    return lastLine ? lastLine.timeMs + 13000 : undefined;
  }, [mapData.lines]);

  const isMine = React.useCallback((absLineIdx: number): boolean =>
    getAssignedPlayerId(absLineIdx, playerIds) === playerId,
    [playerIds, playerId, getAssignedPlayerId]);

  useEffect(() => {
    try {
      sound.init();
      miss_sound.init();
      clear_sound.init();
    } catch (e) {
      console.warn('Sound init failed:', e);
    }
  }, []);

  useEffect(() => {
    if (playerRef.current && typeof playerRef.current.setVolume === 'function') {
      try { playerRef.current.setVolume(volume); } catch (e) { }
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
            try { e.target.setVolume(volume); } catch (err) { }
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
            if (e.data === 0) setIsGameOver(true);
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
        setCurrentBlockIdx(0); setCurrentLineIdx(0); setCurrentChunkIdx(0);
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
    onBlockChange(currentBlockIdx);
    onLineChange?.(currentLine?.absLineIdx ?? 0);
  }, [currentBlockIdx, currentLine, onBlockChange, onLineChange]);

  // セット切り替え時に速度計測をリセット&開始
  useEffect(() => {
    if (!isStarted || isGameOver || !currentSet) return;
    const myTotalChars = currentSet.lines
      .filter(l => isMine(l.absLineIdx))
      .flatMap(l => l.chunks)
      .reduce((sum, c) => sum + c.text.length, 0);
    setTotalCharsRef.current = myTotalChars;
    measureStartTimeRef.current = Date.now();
    typedCharsInSetRef.current = 0;
  }, [currentBlockIdx, isStarted, isGameOver]);

  useEffect(() => {
    const int = setInterval(() => {
      const p = playerRef.current;
      if (!isStarted || isGameOver || !p || typeof p.getCurrentTime !== 'function') return;
      const ms = p.getCurrentTime() * 1000;
      setCurrentTime(p.getCurrentTime());
      if (endTimeMs && ms >= endTimeMs && currentBlockIdx >= mapData.displaySets.length - 1) { setIsGameOver(true); p.stopVideo(); return; }

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

        if (isHost) {
          const currentGl = roomStateRef.current?.globalLineIdx ?? 0;
          const currentGc = roomStateRef.current?.globalChunkIdx ?? 0;
          const currentLines = mapData.displaySets[currentBlockIdx].lines;
          const lastLine = currentLines[currentLines.length - 1];
          const lastLineFinished = lastLine && (currentGl > lastLine.absLineIdx || (currentGl === lastLine.absLineIdx && currentGc >= lastLine.chunks.length));
          if (!lastLineFinished) {
            updateSharedCombo(roomId, 0, roomStateRef.current?.maxSharedCombo || 0);
            updateGlobalProgress(roomId, nLines[0]?.absLineIdx ?? currentGl + 1, 0);
          }
        }
      }
    }, 50);
    return () => clearInterval(int);
  }, [currentBlockIdx, mapData.displaySets, isStarted, endTimeMs, isGameOver, isMine, isHost, roomId, playerId, playerIds]);

  useEffect(() => {
    if (!isHost || !isStarted || isGameOver) return;
    const interval = setInterval(() => {
      const p = playerRef.current;
      if (p && typeof p.getCurrentTime === 'function' && p.getPlayerState() === 1)
        updateRoomPlayback(roomId, p.getCurrentTime());
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

  const isStartedRef = useRef(isStarted);
  const isEngineReadyRef = useRef(isEngineReady);
  const isMeRef = useRef(isMe);
  const currentLineRef = useRef(currentLine);
  const currentChunkIdxRef = useRef(currentChunkIdx);
  const roomStateRef = useRef(roomState);
  const currentLineIdxRef = useRef(currentLineIdx);
  const canSkipRef = useRef(canSkip);
  const nextSetRef = useRef(nextSet);
  const currentSetRef = useRef(currentSet);
  const isFinalSetAndFinishedRef = useRef(isFinalSetAndFinished);
  const currentBlockIdxRef = useRef(currentBlockIdx);

  useEffect(() => { isStartedRef.current = isStarted; }, [isStarted]);
  useEffect(() => { isEngineReadyRef.current = isEngineReady; }, [isEngineReady]);
  useEffect(() => { isMeRef.current = isMe; }, [isMe]);
  useEffect(() => { currentLineRef.current = currentLine; }, [currentLine]);
  useEffect(() => { currentChunkIdxRef.current = currentChunkIdx; }, [currentChunkIdx]);
  useEffect(() => { roomStateRef.current = roomState; }, [roomState]);
  useEffect(() => { currentLineIdxRef.current = currentLineIdx; }, [currentLineIdx]);
  useEffect(() => { canSkipRef.current = canSkip; }, [canSkip]);
  useEffect(() => { nextSetRef.current = nextSet; }, [nextSet]);
  useEffect(() => { currentSetRef.current = currentSet; }, [currentSet]);
  useEffect(() => { isFinalSetAndFinishedRef.current = isFinalSetAndFinished; }, [isFinalSetAndFinished]);
  useEffect(() => { currentBlockIdxRef.current = currentBlockIdx; }, [currentBlockIdx]);

  const showJudge = (judge: JudgeResult, chunkKey: string) => {
    setJudgeResult(judge);
    setJudgeChunkKey(chunkKey);
    if (judgeTimerRef.current) clearTimeout(judgeTimerRef.current);
    judgeTimerRef.current = setTimeout(() => {
      setJudgeResult(null);
      setJudgeChunkKey(null);
    }, 1000);
  };

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
        } else { setIsGameOver(true); }
      }
      return;
    }
    if (!isStartedRef.current || !isEngineReadyRef.current || !isMeRef.current || e.key.length > 1 || e.altKey || e.ctrlKey || e.metaKey) return;
    const chunk = currentLineRef.current?.chunks?.[currentChunkIdxRef.current];
    if (!chunk) return;
    const rs = roomStateRef.current;

    if (keygraph.next(e.key.toLowerCase())) {
      setInputCount(c => c + 1);

      const ptr = (keygraph as any)._seq_ptr_cur;
      const chunkNow = currentLineRef.current?.chunks?.[currentChunkIdxRef.current];
      if (chunkNow) {
        const typed = chunkNow.text.slice(0, ptr);
        updatePlayerProgress(
          roomId, playerId,
          currentLineRef.current!.absLineIdx,
          currentChunkIdxRef.current,
          rs?.sharedCombo || 0,
          rs?.maxSharedCombo || 0,
          rs?.sharedScore || 0,
          currentChunkIdxRef.current,
          ptr,
          typed,
          chunkNow.text
        ).catch(err => console.error('Character sync failed:', err));
      }

      const isFinished = keygraph.is_finished();
      if (isFinished) {
        setComboAnimKey(k => k + 1);
        const comboAfterIncrement = (rs?.sharedCombo || 0) + 1;
        const mult = getComboMultiplier(comboAfterIncrement);

        const currentLine = currentLineRef.current!;
        const currentChunkIdx = currentChunkIdxRef.current;
        const currentLineIdx = currentLineIdxRef.current;
        const currentSet = currentSetRef.current;
        const currentBlockIdx = currentBlockIdxRef.current;
        const gl = rs?.globalLineIdx ?? 0;
        const gc = rs?.globalChunkIdx ?? 0;

        // ===== 速度倍率計算 =====
        // 今打ち終えたチャンクの文字数を累計に加算
        typedCharsInSetRef.current += currentLine.chunks[currentChunkIdx].text.length;
        const elapsedSec = measureStartTimeRef.current
          ? (Date.now() - measureStartTimeRef.current) / 1000
          : 1;
        const typedChars = typedCharsInSetRef.current;
        const charsPerSec = typedChars / Math.max(elapsedSec, 0.1);
        const speedMult = charsPerSec / 5; // 基準3文字/秒


        // ===== チャンク完了ごとに音・判定 =====
        try { clear_sound.play(); } catch (_) { }

        // 判定：currentSet.timeMs ～ nextSet.timeMs のインターバルを6等分
        const p = playerRef.current;
        const nowVideoMs = p && typeof p.getCurrentTime === 'function'
          ? p.getCurrentTime() * 1000
          : currentTime * 1000;
        const setStartMs = currentSet?.timeMs ?? 0;
        const nextSetMs = mapData.displaySets[currentBlockIdx + 1]?.timeMs
          ?? (endTimeMs ?? (nowVideoMs + 10000));
        const intervalMs = nextSetMs - setStartMs;
        const remainMs = nextSetMs - nowVideoMs;
        const judge = calcJudge(remainMs, intervalMs);
        const chunkKey = `${currentLine.absLineIdx}-${currentChunkIdx}`;
        showJudge(judge, chunkKey);

        // ===== スコア加算 =====
        const perfectBonus = judge === 'PERFECT' ? 5 : 0;
        const addScore = Math.round(10 * mult * speedMult) + perfectBonus;
        if (rs?.sharedScore !== undefined) incrementSharedScore(roomId, rs.sharedScore + addScore);

        // ===== グローバル進捗 =====
        const isCorrectOrder = currentLine.absLineIdx === gl && currentChunkIdx === gc;
        if (isCorrectOrder) {
          const combo = (rs?.sharedCombo || 0) + 1;
          updateSharedCombo(roomId, combo, Math.max(rs?.maxSharedCombo || 0, combo));
          let nl = currentLine.absLineIdx, nc = currentChunkIdx + 1;
          if (nc >= currentLine.chunks.length) { nl++; nc = 0; }
          updateGlobalProgress(roomId, nl, nc);
        } else {
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
              const pid = getAssignedPlayerId(currentSet.lines[i].absLineIdx, playerIds);
              if (pid === playerId) { nextM = i; break; }
            }
          }
          if (nextM !== -1) {
            setCurrentLineIdx(nextM);
            setCurrentChunkIdx(0);
            nextLineIdxForFirebase = currentSet!.lines[nextM].absLineIdx;
            nextChunkIdxForFirebase = 0;
            nextChunkToBuild = currentSet!.lines[nextM].chunks[0];
          } else {
            // ===== セット内全担当行を打ち終えた → 速度サンプル記録 =====
            setCurrentLineIdx(-1);
            nextLineIdxForFirebase = -1;
            nextChunkIdxForFirebase = 0;

            const finalElapsedSec = measureStartTimeRef.current
              ? (Date.now() - measureStartTimeRef.current) / 1000
              : 1;
            const finalCPS = typedCharsInSetRef.current / Math.max(finalElapsedSec, 0.1);
            const newSamples = [...speedSamplesRef.current, finalCPS];
            speedSamplesRef.current = newSamples;
            updatePlayerSpeedSamples(roomId, playerId, newSamples).catch(console.error);
          }
        }

        if (roomId && playerId) {
          updatePlayerProgress(roomId, playerId, nextLineIdxForFirebase, nextChunkIdxForFirebase, 0, 0, 0, nextChunkIdxForFirebase, 0, '', '');
        }

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
    } else { try { miss_sound.play(); } catch (_) { } }
  }, [roomId, playerId, endTimeMs, playerIds, getAssignedPlayerId, currentTime, isMine, mapData.displaySets]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [handleKeydown]);

  useEffect(() => {
    if (!isStarted || isGameOver || !roomState || !currentSet || currentLineIdx === -1) return;
    const gl = roomState.globalLineIdx ?? 0;
    const myA = currentLine?.absLineIdx ?? -1;
    if (gl > myA || (currentLineIdx === 0 && !isMe)) {
      const idx = currentSet.lines.findIndex(l => {
        const pid = getAssignedPlayerId(l.absLineIdx, playerIds);
        return l.absLineIdx >= gl && pid === playerId;
      });
      if (idx !== -1) {
        if (idx > currentLineIdx || (currentLineIdx === 0 && !isMe)) {
          setCurrentLineIdx(idx);
          setCurrentChunkIdx(0);
        }
      } else if (currentSet.lines.length > 0 && gl > currentSet.lines[currentSet.lines.length - 1].absLineIdx) {
        setCurrentLineIdx(-1);
      }
    }
  }, [roomState?.globalLineIdx, currentSet, isStarted, isGameOver, isMe, currentLineIdx, currentLine, playerIds, getAssignedPlayerId, playerId]);

  const lyricsAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lyricsAreaRef.current) {
      const activeLine = lyricsAreaRef.current.querySelector('.lyric-line.active');
      if (activeLine) {
        lyricsAreaRef.current.scrollTo({ top: (activeLine as HTMLElement).offsetTop, behavior: 'smooth' });
      }
    }
  }, [roomState?.globalLineIdx, currentBlockIdx]);

  useEffect(() => {
    if (!mapData.displaySets || mapData.displaySets.length === 0 || !isStarted || isGameOver) return;
    const gl = roomState?.globalLineIdx ?? 0;
    const totalSets = mapData.displaySets.length;
    const lastSet = mapData.displaySets[totalSets - 1];
    const lastLineInLastSet = lastSet.lines[lastSet.lines.length - 1];
    const lastAbsIdx = lastLineInLastSet?.absLineIdx ?? -1;
    if (currentBlockIdx >= totalSets - 1 && lastAbsIdx !== -1 && gl > lastAbsIdx) {
      setIsGameOver(true);
      try { playerRef.current?.stopVideo(); } catch (e) { }
    }
  }, [roomState?.globalLineIdx, mapData.displaySets, isGameOver, isStarted, currentBlockIdx]);

  // リザルト用速度統計
  const speedStats = useMemo(() => {
    if (!roomState?.players) return null;
    const result: Record<string, { avg: number; median: number }> = {};
    for (const [pid, p] of Object.entries(roomState.players)) {
      const samples: number[] = (p as any).speedSamples || [];
      if (samples.length === 0) continue;
      const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
      result[pid] = { avg, median };
    }
    return result;
  }, [roomState?.players]);

  if (!mapData || !mapData.displaySets || mapData.displaySets.length === 0 || !currentSet) return <div>Loading...</div>;
  const scoreText = (roomState?.sharedScore || 0).toString().padStart(6, '0');
  const currentCombo = roomState?.sharedCombo || 0;
  const multiplier = getComboMultiplier(currentCombo);

  return (
    <div className='flex flex-col items-center w-full max-w-none mx-auto p-0 h-full overflow-hidden'>
      <div className="w-full border-4 border-white rounded-none bg-white/5 backdrop-blur-sm p-0 flex flex-col h-full overflow-hidden">

        <div className="w-full bg-white/10 border-b-2 border-white/20 flex-shrink-0 stage-container" style={{ position: 'relative' }}>
          <PlayerLane roomState={roomState} playerId={playerId} />
          {!isGameOver && !isStarted && (
            <div style={{
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              background: 'rgba(255, 240, 245, 0.88)', backdropFilter: 'blur(4px)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              zIndex: 100, gap: 12,
            }} className="animate-in fade-in duration-500 start-overlay">
              <div style={{ textAlign: 'center' }} className="animate-in slide-in-from-top-4 duration-700">
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f48', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 }}>READY TO PLAY</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: '#222', letterSpacing: -0.5, lineHeight: 1 }}>{mapData.title || 'Unknown Stage'}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginTop: 4 }}>{mapData.artist || 'Unknown Artist'}</div>
              </div>
              {isHost ? (
                <button onClick={() => setRoomStartTime(roomId)} style={{
                  padding: '10px 40px', fontSize: 22, fontWeight: 900, color: '#fff',
                  background: 'linear-gradient(135deg, #f48, #f06)', border: 'none', borderRadius: 40,
                  cursor: 'pointer', boxShadow: '0 4px 16px rgba(255,0,100,0.3)',
                }} className="hover:scale-110 active:scale-95 transition-all transform">START</button>
              ) : (
                <div style={{
                  padding: '10px 30px', fontSize: 16, fontWeight: 900, color: '#f48',
                  background: '#fff', border: '2px solid #f48', borderRadius: 40, opacity: 0.8,
                }} className="animate-pulse">WAITING FOR HOST...</div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }} className="animate-in fade-in slide-in-from-bottom-4 duration-1000">
                {roomState && Object.values(roomState.players).map(p => (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 4, background: '#fff', borderRadius: 20,
                    padding: '3px 10px', fontSize: 12, fontWeight: 600, boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                  }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.color }} />
                    <span style={{ color: '#444' }}>{p.name}</span>
                    {p.id === playerId && <span style={{ color: '#f48', marginLeft: 2 }}>YOU</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {!isGameOver && (
          <div className="w-full flex flex-col gap-0">
            {/* 歌詞エリア */}
            <div className="lyrics-area scrollbar-hide" ref={lyricsAreaRef} data-typing-progress={inputCount}>
              {currentSet?.lines.map((line: any, idx: number) => {
                const globalLineIdx = roomState?.globalLineIdx ?? 0;
                const nowMs = currentTime * 1000;
                const isPreStart = nowMs < (currentSet?.timeMs ?? 0);
                const isLineActive = line.absLineIdx === globalLineIdx && !isPreStart;
                const linePlayerId = getAssignedPlayerId(line.absLineIdx, playerIds);
                const linePlayerColor = roomState?.players?.[linePlayerId]?.color || '#e0195a';
                return (
                  <div key={idx} className={`lyric-line ${isLineActive ? 'active' : ''}`} style={{
                    color: linePlayerColor, borderLeftColor: linePlayerColor,
                    backgroundColor: isLineActive ? `${linePlayerColor}15` : 'transparent'
                  }}>
                    {line.chunks.map((chunk: any, cIdx: number) => {
                      const gl = roomState?.globalLineIdx ?? 0;
                      const gc = roomState?.globalChunkIdx ?? 0;
                      const p = roomState?.players?.[linePlayerId];
                      let isChunkFinished = false, isChunkActive = false, charPtr = 0;
                      if (line.absLineIdx < gl || (line.absLineIdx === gl && cIdx < gc)) {
                        isChunkFinished = true;
                      } else if (p) {
                        if (p.currentLineIdx === -1 || line.absLineIdx < p.currentLineIdx) {
                          isChunkFinished = true;
                        } else if (line.absLineIdx === p.currentLineIdx) {
                          if (cIdx < p.currentChunkIdx) { isChunkFinished = true; }
                          else if (cIdx === p.currentChunkIdx) {
                            isChunkActive = true;
                            if (p.id === playerId && line.absLineIdx === currentLine?.absLineIdx) {
                              charPtr = (keygraph as any)._seq_ptr_cur;
                            } else { charPtr = (p.currentTyping || "").length; }
                          }
                        }
                      }
                      const thisChunkKey = `${line.absLineIdx}-${cIdx}`;
                      const isJudgeTarget = judgeChunkKey === thisChunkKey && judgeResult !== null;
                      return (
                        <span key={cIdx} style={{ position: 'relative', display: 'inline-block' }}>
                          {/* チャンク上の判定テキスト — 左にははみ出してよい、右にははみ出さない */}
                          {isJudgeTarget && (
                            <span style={{
                              position: 'absolute',
                              top: 0,
                              right: '1em',
                              bottom: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                              fontSize: '1.3em',
                              fontWeight: 900,
                              fontStyle: 'italic',
                              whiteSpace: 'nowrap',
                              color: linePlayerColor,
                              textShadow: `0 0 8px ${linePlayerColor}, 0 0 20px ${linePlayerColor}, 0 0 40px ${linePlayerColor}, 2px 2px 0 rgba(0,0,0,0.6), -1px -1px 0 rgba(0,0,0,0.6)`,
                              WebkitTextStroke: `1px rgba(0,0,0,0.4)`,
                              pointerEvents: 'none',
                              zIndex: 20,
                              animation: 'judgePopIn 0.15s ease-out forwards',
                              letterSpacing: '0.02em',
                            }}>
                              {judgeResult}
                            </span>
                          )}
                          {(Array.from(chunk.text) as string[]).map((char, charIdx) => {
                            const isCharFinished = isChunkFinished || (isChunkActive && charIdx < charPtr);
                            let className = '';
                            if (isCharFinished) className = 'opacity-30';
                            else if (isPreStart) className = 'opacity-0';
                            return <span key={charIdx} className={className}>{char.toUpperCase()}</span>;
                          })}
                          {cIdx < line.chunks.length - 1 && '　'}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div className="w-full flex flex-col relative overflow-hidden border-b-4 border-white/10 target-bar"
              style={{ backgroundColor: roomState?.players?.[playerId]?.color || '#fb7185' }}>
              {isStarted && !isGameOver && (() => {
                const myColor = roomState?.players?.[playerId]?.color ?? '#ffffff';
                const line = currentSet.lines[0];
                const nextSet = mapData.displaySets[currentBlockIdx + 1];
                const now = currentTime * 1000;
                const setEnd = nextSet ? nextSet.timeMs : (videoDuration * 1000);
                let start, end;
                if (currentBlockIdx === 0 && now < line.timeMs) { start = 0; end = line.timeMs; }
                else { start = line.timeMs; end = setEnd; }
                const progress = Math.max(0, Math.min(100, (now - start) / Math.max(1, end - start) * 100));
                return (
                  <div className="w-full h-4 bg-black/20">
                    <div className="h-full transition-all duration-100"
                      style={{ backgroundColor: myColor, boxShadow: `0 0 10px ${myColor}88`, width: `${progress}%` }} />
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
                      <span className="text-3xl font-black italic tracking-wider drop-shadow-lg">
                        <span className="text-white/40">{(keygraph.key_done() || '').toUpperCase()}</span>
                        <span className="text-white">{(keygraph.key_candidate() || '').toUpperCase()}</span>
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
                      <div key={`mult-${multiplier}`}
                        className="text-sm font-black italic leading-none px-1.5 py-0.5 rounded-full animate-bounce"
                        style={{
                          background: multiplier >= 8 ? 'linear-gradient(135deg, #ff0080, #ff6600)'
                            : multiplier >= 5 ? 'linear-gradient(135deg, #7c3aed, #e11d48)'
                              : multiplier >= 4 ? 'linear-gradient(135deg, #0ea5e9, #7c3aed)'
                                : multiplier >= 3 ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                                  : 'linear-gradient(135deg, #10b981, #3b82f6)',
                          color: 'white', boxShadow: '0 0 15px rgba(255,255,255,0.4)', textShadow: '0 0 8px rgba(255,255,255,0.8)',
                        }}>x{multiplier}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="w-full flex shrink-0 score-video-area">
              <div className="flex-1 min-w-0 p-3 flex flex-col items-center justify-center bubble-bg bg-[#fff5f8] border-r-2 border-rose-200 overflow-visible">
                <span className="font-black uppercase tracking-widest mb-0.5 score-label" style={{ color: '#1a1a1a', opacity: 1, textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>合計スコア</span>
                <div className="font-black tracking-tighter shrink-0 score-value" style={{ color: '#1a1a1a', textShadow: '0 2px 4px rgba(0,0,0,0.2)', opacity: 1 }}>{scoreText}</div>
              </div>
              <div className="flex-[0_0_auto] w-[391px] h-full bg-black relative group border-x-2 border-white/10 flex flex-col items-center justify-center shrink-0">
                <div id='youtube-player' className="w-full h-full" />
              </div>
              <div className="flex-1 min-w-0 p-3 flex flex-col justify-between bubble-bg bg-white overflow-y-auto">
                <div className="flex flex-col">
                  <span className="text-[12px] font-black text-rose-300 uppercase italic">再生中</span>
                  <div className="text-2xl font-black text-zinc-700 truncate mt-0.5 tracking-tighter italic">{mapData.title || 'Unknown Stage'}</div>
                  <div className="text-sm font-bold text-zinc-400 truncate mt-1">{mapData.artist || 'Unknown Artist'}</div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => { try { playerRef.current?.stopVideo(); } catch (e) { } onBackToMenu(); }}
                    className="flex-1 bg-rose-400 text-white font-black rounded-none hover:bg-rose-500 shadow-sm transition-colors menu-button">MENU</button>
                  <button className="flex-1 bg-white border border-zinc-100 text-zinc-400 font-black rounded-none hover:bg-zinc-50 transition-colors help-button">ヘルプ</button>
                </div>
              </div>
            </div>

            <div className="w-full bg-zinc-200 h-1 overflow-hidden relative footer-area">
              <div className="h-full bg-gradient-to-r from-rose-400 to-rose-500 transition-all duration-500 ease-out"
                style={{ width: `${Math.max(0, Math.min(100, (currentTime / (videoDuration || 1)) * 100))}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* リザルト — 画面全体オーバーレイ */}
      {isGameOver && (
        <div className='fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white/95 backdrop-blur-md overflow-y-auto text-center'>
          <div className='absolute -top-20 -left-20 w-96 h-96 bg-rose-100 blur-3xl opacity-60' />
          <div className='absolute -bottom-20 -right-20 w-96 h-96 bg-purple-100 blur-3xl opacity-60' />

          <div className='relative z-10 flex flex-col items-center gap-6 py-10'>
            <div style={{ fontSize: 'clamp(80px, 14vw, 160px)', fontWeight: 900, fontStyle: 'italic', letterSpacing: '-0.04em', lineHeight: 1 }}
              className='text-rose-400 drop-shadow-2xl'>
              FINISH!
            </div>

            <div className='flex flex-col gap-2'>
              <div className='font-black uppercase tracking-tighter' style={{ fontSize: 'clamp(24px, 4vw, 48px)', color: '#1a1a1a', textShadow: '0 2px 4px rgba(0,0,0,0.15)' }}>
                ステージスコア: <span className='text-rose-500'>{scoreText}</span>
              </div>
              <div className='font-bold uppercase tracking-[0.5em] text-zinc-500' style={{ fontSize: '15px' }}>
                最大コンボ: {roomState?.maxSharedCombo || 0}
              </div>
            </div>

            {/* 速度リザルト */}
            {speedStats && Object.keys(speedStats).length > 0 && (
              <div className="w-full max-w-sm bg-zinc-50 border border-zinc-100 p-4">
                <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3">タイピング速度</div>
                <div className="flex flex-col gap-2">
                  {Object.entries(speedStats)
                    .sort(([, a], [, b]) => b.avg - a.avg)
                    .map(([pid, stats]) => {
                      const p = roomState?.players?.[pid];
                      if (!p) return null;
                      return (
                        <div key={pid} className="flex items-center gap-3">
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                          <span className="text-[12px] font-bold text-zinc-600 w-20 truncate">
                            {p.name}{pid === playerId ? ' ★' : ''}
                          </span>
                          <div className="flex-1 bg-zinc-200 h-2 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (stats.avg / 10) * 100)}%`, background: p.color }} />
                          </div>
                          <span className="text-[11px] font-mono text-zinc-500 w-16 text-right">
                            <span className="font-black" style={{ color: p.color }}>{(stats.avg * 60).toFixed(0)}</span> c/m                          </span>
                          <span className="text-[10px] font-mono text-zinc-400 w-14 text-right">
                            中{(stats.median * 60).toFixed(0)}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            <button onClick={() => { try { playerRef.current?.stopVideo(); } catch (e) { } onBackToMenu(); }}
              className='bg-rose-500 hover:bg-rose-600 text-white font-black text-xl px-24 py-6 rounded-none shadow-2xl shadow-rose-200 transition-all hover:scale-110 active:scale-95'>
              ステージ選択に戻る
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes judgePopIn {
          0%   { transform: scale(0.4) translateY(12px); opacity: 0; }
          60%  { transform: scale(1.2) translateY(-4px); opacity: 1; }
          100% { transform: scale(1)   translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
};