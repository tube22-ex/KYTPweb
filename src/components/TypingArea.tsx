import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { ParseResult } from '../services/api';
import keygraph from '../utils/keygraph';
import { sound, miss_sound, clear_sound, bad_sound } from '../utils/sound';
import { updatePlayerProgress, updatePlayerSpeedSamples, updatePlayerCompletedBlock, setRoomStartTime, getServerTimeOffset, incrementSharedScore, updateSharedCombo, updateGlobalProgress, updateRoomPlayback, determineHostId, updateRoomFailure, updatePlayerBufferReady, clearPlayerBufferReady, resetRoomGameplayState, resetPlayerGameplayState } from '../services/sync';
import { PlayerLane } from './PlayerLane';
import { useMultiplayer } from '../contexts/MultiplayerContext';

interface Props {
  mapData: ParseResult;
  onBackToMenu: () => void;
  onBlockChange: (idx: number) => void;
  onLineChange?: (lineIdx: number) => void;
  volume: number;
  hideVideo: boolean;
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

// ★ 半角英数字・記号を全角に変換（ひらがなと文字幅を揃える）
const toFullWidthCache = new Map<string, string>();
const toFullWidth = (str: string): string => {
  if (toFullWidthCache.has(str)) return toFullWidthCache.get(str)!;
  const res = str.replace(/[!-~]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0));
  toFullWidthCache.set(str, res);
  return res;
};

const calcJudge = (remainMs: number, intervalMs: number): JudgeResult => {
  if (intervalMs <= 0) return 'BAD';
  const ratio = remainMs / intervalMs;
  if (ratio > 5 / 6) return 'PERFECT';
  if (ratio > 3 / 6) return 'GOOD';
  if (ratio > 1 / 6) return 'OK';
  return 'BAD';
};

const LyricLineMemo = React.memo(({
  line,
  isLineActive,
  linePlayerColor,
  gl,
  gc,
  p,
  isPreStart,
  playerId,
  currentLineAbsIdx,
  keygraphPtr,
  judgeChunkKey,
  judgeResult
}: {
  line: any;
  isLineActive: boolean;
  linePlayerColor: string;
  gl: number;
  gc: number;
  p: any;
  isPreStart: boolean;
  playerId: string;
  currentLineAbsIdx?: number;
  keygraphPtr: number;
  judgeChunkKey: string | null;
  judgeResult: JudgeResult | null;
}) => {
  return (
    <div className={`lyric-line ${isLineActive ? 'active' : ''}`} style={{
      color: linePlayerColor, borderLeftColor: linePlayerColor,
      backgroundColor: isLineActive ? `${linePlayerColor}15` : 'transparent'
    }}>
      {line.chunks.map((chunk: any, cIdx: number) => {
        let isChunkFinished = false, isChunkActive = false, charPtr = 0;
        if (line.absLineIdx < gl || (line.absLineIdx === gl && cIdx < gc)) {
          isChunkFinished = true;
        } else if (p) {
          const lineIsBeforeGlobal = line.absLineIdx < gl;
          if ((p.currentLineIdx === -1 && lineIsBeforeGlobal) || (p.currentLineIdx !== -1 && line.absLineIdx < p.currentLineIdx)) {
            isChunkFinished = true;
          } else if (line.absLineIdx === p.currentLineIdx) {
            if (cIdx < p.currentChunkIdx) { isChunkFinished = true; }
            else if (cIdx === p.currentChunkIdx) {
              isChunkActive = true;
              if (p.id === playerId && line.absLineIdx === currentLineAbsIdx) {
                charPtr = keygraphPtr;
              } else { charPtr = (p.currentTyping || "").length; }
            }
          }
        }
        const thisChunkKey = `${line.absLineIdx}-${cIdx}`;
        const isJudgeTarget = judgeChunkKey === thisChunkKey && judgeResult !== null;
        return (
          <span key={cIdx} style={{ position: 'relative', display: 'inline-block' }}>
            {isJudgeTarget && (
              <span style={{
                position: 'absolute', top: 0, right: '1em', bottom: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                fontSize: '1.3em', fontWeight: 900, fontStyle: 'italic',
                whiteSpace: 'nowrap', color: linePlayerColor,
                textShadow: `0 0 8px ${linePlayerColor}, 0 0 20px ${linePlayerColor}, 0 0 40px ${linePlayerColor}, 2px 2px 0 rgba(0,0,0,0.6), -1px -1px 0 rgba(0,0,0,0.6)`,
                WebkitTextStroke: `1px rgba(0,0,0,0.4)`,
                pointerEvents: 'none', zIndex: 20,
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
              return <span key={charIdx} className={className}>{toFullWidth(char)}</span>;
            })}
            {cIdx < line.chunks.length - 1 && '　'}
          </span>
        );
      })}
    </div>
  );
}, (prevProps, nextProps) => {
  if (
    prevProps.isLineActive !== nextProps.isLineActive ||
    prevProps.linePlayerColor !== nextProps.linePlayerColor ||
    prevProps.gl !== nextProps.gl ||
    prevProps.gc !== nextProps.gc ||
    prevProps.isPreStart !== nextProps.isPreStart ||
    prevProps.playerId !== nextProps.playerId ||
    prevProps.currentLineAbsIdx !== nextProps.currentLineAbsIdx ||
    prevProps.keygraphPtr !== nextProps.keygraphPtr ||
    prevProps.judgeChunkKey !== nextProps.judgeChunkKey ||
    prevProps.judgeResult !== nextProps.judgeResult ||
    prevProps.line.absLineIdx !== nextProps.line.absLineIdx
  ) {
    return false;
  }
  if (!prevProps.p && !nextProps.p) return true;
  if (!prevProps.p || !nextProps.p) return false;
  if (
    prevProps.p.currentLineIdx !== nextProps.p.currentLineIdx ||
    prevProps.p.currentChunkIdx !== nextProps.p.currentChunkIdx ||
    prevProps.p.id !== nextProps.p.id ||
    prevProps.p.currentTyping !== nextProps.p.currentTyping
  ) {
    return false;
  }
  return true;
});

export const TypingArea: React.FC<Props> = ({ mapData, onBackToMenu, onBlockChange, onLineChange, volume, hideVideo }) => {
  const { roomId, playerId, roomState, isHost } = useMultiplayer();
  
  const [currentBlockIdx, setCurrentBlockIdx] = useState(0);
  const [currentLineIdx, setCurrentLineIdx] = useState(0);
  const [currentChunkIdx, setCurrentChunkIdx] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const [comboAnimKey, setComboAnimKey] = useState(0);
  const [inputCount, setInputCount] = useState(0);
  // ★ ビッグコンボ表示用
  const [bigComboValue, setBigComboValue] = useState(0);
  const [bigComboVisible, setBigComboVisible] = useState(false);
  const bigComboTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [playerState, setPlayerState] = useState<number>(-1);

  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null);
  const [judgeChunkKey, setJudgeChunkKey] = useState<string | null>(null);
  const judgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ★ たらい演出 / BADシェイク演出
  const [taraiPlayers, setTaraiPlayers] = useState<Set<string>>(new Set());
  const [badShakePlayers, setBadShakePlayers] = useState<Set<string>>(new Set());
  const taraiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badShakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ★ プリロード同期フロー — タイマーを役割ごとに分離
  const [isBuffering, setIsBuffering] = useState(false);
  const isBufferingRef = useRef(false);
  const bufferCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // ★ タイマーを2つに分離（共有すると allReady→setRoomStartTime のreturnクリーンアップが再生タイマーをキャンセルしてしまう）
  const allReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);   // ホスト: 全員揃った→3秒後にsetRoomStartTime
  const playbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);   // 全員: startTime受信→正確なplayVideo()

  const measureStartTimeRef = useRef<number | null>(null);
  const setTotalCharsRef = useRef<number>(0);
  const typedCharsInSetRef = useRef<number>(0);
  const speedSamplesRef = useRef<number[]>([]);

  const playerRef = useRef<any>(null);

  // ★ メニューに戻る際のリセット処理
  const handleBackToMenu = async () => {
    try {
      playerRef.current?.stopVideo();
    } catch (_) { }

    try {
      if (isHost) {
        await resetRoomGameplayState(roomId);
      }
      await resetPlayerGameplayState(roomId, playerId);
    } catch (err) {
      console.warn("Firebase reset failed:", err);
    }
    
    onBackToMenu();
  };
  const instanceIdRef = useRef<number>(0);
  const preparedRef = useRef<string>("");

  // ★ getCurrentTime キャッシュref（postMessage呼び出し削減）
  const currentTimeMsRef = useRef(0);

  // ★ ptr変化検知用ref（同じptrを重複送信しない）
  const lastSentPtrRef = useRef<number>(-1);
  const lastSentLineRef = useRef<number>(-1);
  const lastSentChunkRef = useRef<number>(-1);

  // ★ 二重音防止フラグ
  const justPlayedClearSoundRef = useRef<boolean>(false);
  const justPlayedBadSoundRef = useRef<boolean>(false);

  const isStarted = roomState?.startTime != null;

  // ★ 依存配列をスロット順に並び替えて固定（PlayerLaneの表示順と一致させる）
  const playerIdsKey = roomState?.players 
    ? Object.values(roomState.players).sort((a: any, b: any) => (a.slotId || "").localeCompare(b.slotId || "")).map((p: any) => p.id).join(',')
    : playerId;

  const playerIds = useMemo(() => {
    if (!roomState || !roomState.players) return [playerId];
    return Object.values(roomState.players)
      .sort((a: any, b: any) => (a.slotId || "").localeCompare(b.slotId || ""))
      .map((p: any) => p.id);
  }, [playerIdsKey, roomState?.players, playerId]);

  // ★ playerIds のref（ブロック切り替え時に最新値を同期的に参照）
  const playerIdsRef = useRef(playerIds);
  useEffect(() => { playerIdsRef.current = playerIds; }, [playerIds]);

  const getAssignedPlayerId = useMemo(() => {
    return (absLineIdx: number, pids: string[]) => {
      const n = pids.length;
      if (n === 0) return "";
      return pids[absLineIdx % n];
    };
  }, []);

  const endTimeMs = useMemo(() => {
    const endLine = mapData.lines.find(l => l.isEnd);
    if (endLine) return endLine.timeMs + 10000;
    const lastLine = mapData.lines[mapData.lines.length - 1];
    return lastLine ? lastLine.timeMs + 13000 : undefined;
  }, [mapData.lines]);

  const isMine = React.useCallback((absLineIdx: number): boolean =>
    getAssignedPlayerId(absLineIdx, playerIds) === playerId,
    [playerIds, playerId, getAssignedPlayerId]);

  // ★ isMine をrefに逃がす（handleKeydown の依存配列から外すため）
  const isMineRef = useRef(isMine);
  useEffect(() => { isMineRef.current = isMine; }, [isMine]);

  useEffect(() => {
    try {
      sound.init();
      miss_sound.init();
      clear_sound.init();
    } catch (e) {
      console.warn('Sound init failed:', e);
    }
    // サーバー時刻オフセットをマウント時に先行取得してキャッシュ（START押下時の遅延を防ぐ）
    getServerTimeOffset().catch(console.error);
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
        height: '180', width: '320', videoId: mapData.videoId,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, origin: window.location.origin, enablejsapi: 1 },
        events: {
          onReady: (e: any) => {
            if (instanceIdRef.current !== curId) { e.target.destroy(); return; }
            playerRef.current = e.target;
            try { e.target.setVolume(volume); } catch (err) { }
            setVideoDuration(e.target.getDuration());
            // ★ YouTubeが生成したiframeを直接スタイル制御して黒帯を除去
            const iframe = e.target.getIframe();
            if (iframe) {
              iframe.style.position = 'absolute';
              iframe.style.top = '50%';
              iframe.style.left = '50%';
              iframe.style.width = '320px';
              iframe.style.height = '180px';
              iframe.style.transform = 'translate(-50%, -50%)';
              iframe.style.border = 'none';
            }
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
    if (!start || isGameOver) {
      // startTime未設定またはゲームオーバー時はビデオを停止・状態をリセット
      if (!start) {
        try { playerRef.current?.stopVideo(); } catch (e) { }
        if (!isGameOver) {
          setCurrentBlockIdx(0); setCurrentLineIdx(0); setCurrentChunkIdx(0);
          preparedRef.current = "";
        }
      }
    }
    // 実際の再生開始は上の「プリロード同期フロー」useEffectが担当するため、ここでは再生しない
  }, [roomState?.startTime, isGameOver]);



  // TypingArea.tsx 210行目付近
  // ★ ゲーム開始時に自分のFirebase進捗をリセット（前回の残り値をクリア）
  const prevStartTimeRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const start = roomState?.startTime;
    if (start != null && prevStartTimeRef.current !== start) {
      prevStartTimeRef.current = start;
      if (roomId && playerId) {
        // 1. 基本的な進捗（行・文字・スコア等）をリセット
        updatePlayerProgress(roomId, playerId, 0, 0, 0, 0, 0, 0, 0, '', '');

        // 2. ★追加：ブロック完了フラグを「未完了(-1)」にリセット
        updatePlayerCompletedBlock(roomId, playerId, -1).catch(console.error);
      }
    } else if (start == null) {
      prevStartTimeRef.current = null;
    }
  }, [roomState?.startTime, roomId, playerId]);


  const currentSet = mapData.displaySets?.[currentBlockIdx];
  const currentLine = useMemo(() => currentSet?.lines?.[currentLineIdx], [currentSet, currentLineIdx]);
  const isMe = currentLine ? isMine(currentLine.absLineIdx) : false;
  const activeLinePlayerId = currentLine ? getAssignedPlayerId(currentLine.absLineIdx, playerIds) : "";
  const isSomeoneElseActive = activeLinePlayerId !== "" && activeLinePlayerId !== playerId;

  useEffect(() => {
    onBlockChange(currentBlockIdx);
    onLineChange?.(currentLine?.absLineIdx ?? 0);
  }, [currentBlockIdx, currentLine, onBlockChange, onLineChange]);

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
    if (isGameOver) {
      setIsBuffering(false);
      isBufferingRef.current = false;
      prevBufferingRef.current = false;
      if (bufferCheckIntervalRef.current) clearInterval(bufferCheckIntervalRef.current);
      if (allReadyTimerRef.current) clearTimeout(allReadyTimerRef.current);
      if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
    }
  }, [isGameOver]);

  // ★ currentTime表示専用interval（150ms）
  useEffect(() => {
    const int = setInterval(() => {
      const p = playerRef.current;
      if (!isStarted || isGameOver || !p || typeof p.getCurrentTime !== 'function') return;
      const t = p.getCurrentTime();
      currentTimeMsRef.current = t * 1000;
      setCurrentTime(t);
    }, 150);
    return () => clearInterval(int);
  }, [isStarted, isGameOver]);

  // ★ ゲーム開始時およびブロック切り替え時に進捗比較基準をリセット（音の誤爆防止）
  useEffect(() => {
    if (isStarted && !isGameOver && roomState?.players) {
      console.log(`[Sync] Baseline reset (Block: ${currentBlockIdx}).`);
      prevComboRef.current = roomState.sharedCombo || 0;
      
      const baseline: Record<string, { lineIdx: number; chunkIdx: number }> = {};
      for (const [pid, p] of Object.entries(roomState.players)) {
        baseline[pid] = { lineIdx: p.currentLineIdx, chunkIdx: p.currentChunkIdx };
      }
      prevOtherPlayersProgressRef.current = baseline;
    }
  }, [isStarted, currentBlockIdx]);

  // ★ ブロック切り替え＆ゲームオーバー監視（50ms）
  useEffect(() => {
    if (!isStarted || isGameOver || !mapData.displaySets) return;
    const int = setInterval(() => {
      const ms = currentTimeMsRef.current;
      const ns = nextSetRef.current;
      const isEnd = endTimeMs != null && ms >= endTimeMs;
      if (isEnd && !isGameOver) { setIsGameOver(true); return; }
      if (ns && ms >= ns.timeMs) {
        // ==========================================
        // 【1. Buzzer Snapshot】 変数をリセットする前の「今の状態」を保存
        // ==========================================
        const snap_prevBlockIdx = currentBlockIdx;
        const snap_currentLines = mapData.displaySets[snap_prevBlockIdx].lines;
        const snap_rs = roomStateRef.current;
        const snap_gl = snap_rs?.globalLineIdx ?? 0;
        const snap_gc = snap_rs?.globalChunkIdx ?? 0;
        const snap_playerIds = playerIdsRef.current; // 判定中の配役を固定

        // 自分の進捗はリセット前のローカル記録（lastSentLineRef）をコピー
        // const snap_myAbsLineIdx = lastSentLineRef.current;
        // const snap_myChunkIdx = lastSentChunkRef.current;
        const lLineOfEndBlock = snap_currentLines[snap_currentLines.length - 1];

        // ==========================================
        // 【2. Next Block Preparation】 次のセットに向けた変数更新
        // ==========================================
        const nextBlockIdx = currentBlockIdx + 1;
        const nLines = mapData.displaySets[nextBlockIdx].lines;

        // ★ 次のセットにおける自分の担当行を探す
        const firstM = nLines.findIndex(l =>
          getAssignedPlayerId(l.absLineIdx, snap_playerIds) === playerId
        );
        const newLocalLineIdx = firstM !== -1 ? firstM : 0;

        // ★ エンジン・タイピング状態の初期化
        if (firstM !== -1) {
          const firstChunk = nLines[firstM].chunks?.[0];
          if (firstChunk) {
            keygraph.reset();
            keygraph.build(firstChunk.text);
            const key = `${nLines[firstM].absLineIdx}-0`;
            preparedRef.current = key;
            // リセット
            lastSentPtrRef.current = -1;
            lastSentLineRef.current = nLines[firstM].absLineIdx;
            lastSentChunkRef.current = 0;
            setIsEngineReady(true);
          }
        } else {
          setIsEngineReady(false);
          preparedRef.current = "";
          // 担当がない場合も、一応Refは更新（判定バグ防止）
          lastSentLineRef.current = -1;
          lastSentChunkRef.current = 0;
        }

        // UI表示を次へ進める
        setCurrentBlockIdx(nextBlockIdx);
        setCurrentLineIdx(newLocalLineIdx);
        setCurrentChunkIdx(0);

        // ==========================================
        // 【3. Delayed Final Judgment】
        // ホストのみ判定を行い、結果をFirebaseに書き込む。
        // ゲストはFirebaseの lastFailure を購読してアニメーションを実行する。
        // バッファ 150ms → 400ms に延長（滑り込み入力のラグを吸収）
        // ==========================================
        setTimeout(() => {
          const latestRs = roomStateRef.current;

          // 全体の成否判定：滑り込み更新も考慮
          const final_gl = latestRs?.globalLineIdx ?? snap_gl;
          const final_gc = latestRs?.globalChunkIdx ?? snap_gc;
          const blockFinishedByAny = lLineOfEndBlock && (final_gl > lLineOfEndBlock.absLineIdx || (final_gl === lLineOfEndBlock.absLineIdx && final_gc >= lLineOfEndBlock.chunks.length));

          if (!blockFinishedByAny) {
            console.log(`[Judgement] Failure Triggered for Block ${snap_prevBlockIdx}. Checking who failed...`);

            if (isHost) {
              // ★ ホストのみ「誰が失敗したか」を確定し Firebase に書き込む
              const unfinishedPlayerIds: string[] = [];

              if (latestRs && latestRs.players) {
                Object.values(latestRs.players).forEach(p => {
                  const myLines = snap_currentLines.filter(l =>
                    getAssignedPlayerId(l.absLineIdx, snap_playerIds) === p.id
                  );
                  if (myLines.length === 0) return;

                  const completed = (p.completedBlockIdx ?? -1) >= snap_prevBlockIdx;
                  console.log(`  - Checking ${p.name}(${p.id.slice(0, 4)}): completedBlockIdx=${p.completedBlockIdx ?? -1}, snap_prevBlockIdx=${snap_prevBlockIdx} => ${completed ? 'ALL CLEAR' : 'PENALTY'}`);
                  if (!completed) unfinishedPlayerIds.push(p.id);
                });
              }

              if (unfinishedPlayerIds.length > 0) {
                // Firebase に失敗リストを書き込む → 全クライアントがこれを受信してアニメーション
                updateRoomFailure(roomId, snap_prevBlockIdx, unfinishedPlayerIds).catch(console.error);

                // ホスト自身もたらい演出（他クライアントと同じタイミングで表示）
                setTaraiPlayers(new Set(unfinishedPlayerIds));
                setBadShakePlayers(new Set(unfinishedPlayerIds));
                if (taraiTimerRef.current) clearTimeout(taraiTimerRef.current);
                if (badShakeTimerRef.current) clearTimeout(badShakeTimerRef.current);
                taraiTimerRef.current = setTimeout(() => setTaraiPlayers(new Set()), 1500);
                badShakeTimerRef.current = setTimeout(() => setBadShakePlayers(new Set()), 1500);

                setTimeout(() => {
                  try {
                    const audio = new Audio('/sound/tarai.mp3');
                    const baseVol = typeof (window as any).clearVolume !== 'undefined' ? (window as any).clearVolume : 1.0;
                    audio.volume = Math.min(1.0, baseVol * 1.5);
                    audio.play();
                  } catch (_) { }
                }, 200);
              }

              // ホストのみ：コンボリセットとグローバル進捗更新
              blockChangingRef.current = true;
              updateSharedCombo(roomId, 0, latestRs?.maxSharedCombo || 0);
              updateGlobalProgress(roomId, nLines[0]?.absLineIdx ?? (final_gl + 1), 0);
              setTimeout(() => { blockChangingRef.current = false; }, 500);

            }
            // ゲストは何もしない（lastFailure の購読で対応）
          } else {
            console.log(`[Judgement] Block ${snap_prevBlockIdx} was successfully finished in time (by someone).`);
          }
        }, 400); // ★ 150ms → 400ms に延長（滑り込みラグ吸収）

      }
    }, 50);
    return () => clearInterval(int);
  }, [currentBlockIdx, mapData.displaySets, isStarted, endTimeMs, isGameOver, isHost, roomId, playerId]);

  // ホストが現在の再生時間を定期的に同期（送信）する
  useEffect(() => {
    // ホストではない、またはゲームが始まっていない場合は何もしない
    if (!isHost || !isStarted || isGameOver) return;

    const interval = setInterval(() => {
      const p = playerRef.current;
      // YouTubeプレイヤーが準備完了かつ再生中 (1) の場合のみ実行
      if (p && typeof p.getCurrentTime === 'function' && p.getPlayerState() === 1) {
        const time = p.getCurrentTime();
        // services/sync.ts の updateRoomPlayback を呼び出してサーバーの値を更新
        updateRoomPlayback(roomId, time).catch(console.error);
      }
    }, 1000); // 1秒間隔（必要に応じて 500ms などに短縮可）

    return () => clearInterval(interval);
  }, [isHost, isStarted, isGameOver, roomId]);

  // ゲストがホストの再生時間に自分のプレイヤーを合わせる
  useEffect(() => {
    // ホスト自身は同期対象外。また、データがない場合は何もしない
    if (isHost || !isStarted || isGameOver || !roomState?.playbackTime) return;

    const p = playerRef.current;
    if (p && typeof p.getCurrentTime === 'function' && typeof p.seekTo === 'function') {
      const myTime = p.getCurrentTime();
      const serverTime = roomState.playbackTime;

      // 自分の再生位置とサーバー（ホスト）の時間の差分を計算
      const diff = Math.abs(serverTime - myTime);

      // 許容範囲（ここでは1.0秒）を超えてズレている場合のみ、強制的に位置を合わせる
      if (diff > 0.5) {
        // 第2引数を true にすると、シーク後に再生を継続しようとします
        p.seekTo(serverTime, true);
      }
    }
    // roomState.playbackTime が更新されるたびにこの処理が走る
  }, [isHost, isStarted, isGameOver, roomState?.playbackTime]);

  // ============================================================
  // ★ プリロード同期フロー
  // ============================================================

  // ゲスト：isBuffering（=いずれかのプレイヤーがisBufferReady書き込み前の状態）を検知して
  // 自分もプリロードを実行し、完了後 isBufferReady=true を書き込む
  const prevBufferingRef = useRef(false);
  useEffect(() => {
    if (!roomState || isStarted) return;

    const players = Object.values(roomState.players || {});
    if (players.length === 0) return;

    const hostId = determineHostId(roomState.players);
    const hostPlayer = hostId ? roomState.players[hostId] : null;

    if (hostPlayer?.isBufferReady && !prevBufferingRef.current && !isHost) {
      prevBufferingRef.current = true;
      setIsBuffering(true);
      isBufferingRef.current = true;
      console.log(`[Sync:Guest] Host isBufferReady detected. Starting preload...`);

      const p = playerRef.current;
      if (p && typeof p.seekTo === 'function') {
        clearPlayerBufferReady(roomId, playerId).then(() => {
          console.log('[Sync:Guest] Cleared own isBufferReady. Seeking to 0.1s...');
          p.seekTo(0.1, true);
          p.playVideo();
          setTimeout(async () => {
            try { p.pauseVideo(); } catch (_) { }
            console.log('[Sync:Guest] Paused after preload. Writing isBufferReady=true...');
            await updatePlayerBufferReady(roomId, playerId);
            console.log('[Sync:Guest] ✅ isBufferReady=true written.');
          }, 500);
        });
      } else {
        console.warn('[Sync:Guest] ⚠ playerRef not ready during preload. Marking ready anyway.');
        updatePlayerBufferReady(roomId, playerId).catch(console.error);
      }
    }

    if (!hostPlayer?.isBufferReady && prevBufferingRef.current && isStarted) {
      console.log('[Sync:Guest] Host isBufferReady cleared after game start. Resetting local flags.');
      prevBufferingRef.current = false;
      setIsBuffering(false);
      isBufferingRef.current = false;
    }
  }, [roomState?.players, isStarted, isHost, roomId, playerId]);

  // ホスト：全員のisBufferReadyがtrueになったら startTime を3秒後にセット
  useEffect(() => {
    if (!isHost || !isBuffering || isStarted) return;

    const players = Object.values(roomState?.players || {});
    if (players.length === 0) return;

    const readyStatus = players.map(p => `${p.name}:${p.isBufferReady ? '✓' : '...'}`).join(' | ');
    const allReady = players.every(p => p.isBufferReady === true);
    console.log(`[Sync:Host] BufferReady check — ${readyStatus} — allReady=${allReady}`);

    if (!allReady) return;

    console.log('[Sync:Host] ✅ All players buffer-ready. Writing startTime with startDelay=3000ms...');

    if (allReadyTimerRef.current) clearTimeout(allReadyTimerRef.current);
    allReadyTimerRef.current = setTimeout(async () => {
      allReadyTimerRef.current = null;
      console.log('[Sync:Host] ⏱ Clearing isBufferReady flags and calling setRoomStartTime...');
      for (const p of players) {
        clearPlayerBufferReady(roomId, p.id).catch(console.error);
      }
      setIsBuffering(false);
      isBufferingRef.current = false;
      prevBufferingRef.current = false;
      // startDelay=3000 を渡す → 各クライアントは受信時刻+3秒後に playVideo()
      // これにより時計ズレの影響を受けずに全員が同じタイミングで再生できる
      await setRoomStartTime(roomId, 3000);
      console.log('[Sync:Host] 🚀 setRoomStartTime(startDelay=3000) done.');
    }, 0); // ← ローカルの setTimeout 3秒待ちは不要。Firebase書き込み → 受信側が3秒待つ

    // ★ クリーンアップは allReadyTimerRef のみ。playbackTimerRef とは分離。
    return () => {
      if (allReadyTimerRef.current) {
        console.log('[Sync:Host] ⚠ allReady useEffect cleanup — cancelling allReadyTimer');
        clearTimeout(allReadyTimerRef.current);
      }
    };
  }, [roomState?.players, isHost, isBuffering, isStarted, roomId]);

  // startTime確定後：各クライアントが正確な時刻に playVideo() を実行
  // ★ クライアントの時計ズレに影響されない方式:
  //   startDelay が書き込まれた値を受信した瞬間の Date.now() に足して再生開始時刻とする
  //   これにより serverTimeOffset の精度に依存しない
  const receivedStartAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!roomState?.startTime || isGameOver) return;

    // startTime が変化した瞬間（新しい値）の受信時刻を記録
    if (receivedStartAtRef.current === null) {
      receivedStartAtRef.current = Date.now();
    }

    const p = playerRef.current;
    const receivedAt = receivedStartAtRef.current;
    const startDelay = roomState.startDelay ?? 0;

    console.log(`[Sync:Play] startTime received. startDelay=${startDelay}ms | receivedAt=${receivedAt} | playTarget=${receivedAt + startDelay}`);

    if (!p || typeof p.playVideo !== 'function') {
      console.warn('[Sync:Play] ⚠ playerRef not ready when startTime arrived!');
      return;
    }

    if (playbackTimerRef.current) {
      console.log('[Sync:Play] playbackTimer already set, skipping duplicate.');
      return;
    }

    const nowMs = Date.now();
    const delayMs = (receivedAt + startDelay) - nowMs;

    console.log(`[Sync:Play] nowMs=${nowMs} | delayMs=${delayMs.toFixed(0)}ms`);

    if (delayMs > 0) {
      console.log(`[Sync:Play] ⏳ Scheduling playVideo() in ${delayMs.toFixed(0)}ms`);
      playbackTimerRef.current = setTimeout(() => {
        console.log('[Sync:Play] ▶ playVideo() fired (scheduled)');
        playbackTimerRef.current = null;
        try { p.seekTo(0, true); p.playVideo(); } catch (e) { console.error('[Sync:Play] playVideo error:', e); }
        setIsBuffering(false);
      }, delayMs);
    } else {
      // 受信が遅れてすでに開始時刻を過ぎている場合（遅延参加など）
      const sec = (-delayMs) / 1000;
      console.log(`[Sync:Play] ▶ playVideo() fired immediately, seekTo=${sec.toFixed(2)}s`);
      playbackTimerRef.current = null;
      try { p.seekTo(sec, true); p.playVideo(); } catch (e) { console.error('[Sync:Play] playVideo error:', e); }
      setIsBuffering(false);
    }

    return () => {
      if (playbackTimerRef.current) {
        console.log('[Sync:Play] ⚠ startTime changed — cancelling old playbackTimer');
        clearTimeout(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      receivedStartAtRef.current = null; // 次の startTime 変化に備えてリセット
    };
  }, [roomState?.startTime, isGameOver]);

  // ============================================================


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

  // ★ エンジン起動待ち監視（50ms）— currentTimeMsRefから読む
  useEffect(() => {
    if (!isStarted || isEngineReady || isGameOver || !currentSet || !currentLine || !isMe) return;
    const int = setInterval(() => {
      const ms = currentTimeMsRef.current;
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
            // ★ ptr送信履歴をリセット
            lastSentPtrRef.current = -1;
            lastSentLineRef.current = currentLine.absLineIdx;
            lastSentChunkRef.current = currentChunkIdx;
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

  // ★ コンボ途切れ検知
  const prevComboRef = useRef<number>(0);
  const blockChangingRef = useRef<boolean>(false); // セット切替中はコンボ途切れ音を鳴らさない

  useEffect(() => {
    const currentCombo = roomState?.sharedCombo ?? 0;
    const prevCombo = prevComboRef.current;

    // ★ コンボ増加演出（自分でも他人でも）
    if (currentCombo > prevCombo) {
      setBigComboValue(currentCombo);
      setBigComboVisible(true);
      if (bigComboTimerRef.current) clearTimeout(bigComboTimerRef.current);
      bigComboTimerRef.current = setTimeout(() => setBigComboVisible(false), 1200);

      // 他プレイヤーがコンボを増やした場合のみ音を鳴らす（自分の分は handleKeydown で再生済み）
      if (!justPlayedClearSoundRef.current) {
        try { clear_sound.play(); } catch (_) { }
      }
      justPlayedClearSoundRef.current = false; // フラグをリセット
    }

    // ★ コンボ途切れ音
    if (prevCombo > 0 && currentCombo === 0 && !blockChangingRef.current) {
      // コンボが途切れたら即座にアニメーションを消す
      setBigComboVisible(false);
      if (bigComboTimerRef.current) clearTimeout(bigComboTimerRef.current);

      if (!justPlayedBadSoundRef.current) {
        // ★ コンボが途切れた際にも bad_sound を鳴らす
        try { bad_sound.play(); } catch (_) { }

        try {
          const breakAudio = new Audio('/sounds/combo_break.mp3');
          const baseVol = typeof (window as any).clearVolume !== 'undefined'
            ? (window as any).clearVolume : 1.0;
          breakAudio.volume = baseVol;
          breakAudio.play();
        } catch (_) { }
      }
      justPlayedBadSoundRef.current = false; // フラグをリセット
    }
    prevComboRef.current = currentCombo;
  }, [roomState?.sharedCombo]);


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
      const absLineNow = currentLineRef.current?.absLineIdx ?? -1;
      const chunkIdxNow = currentChunkIdxRef.current;

      if (chunkNow) {
        // ★ ptr・行・チャンクが前回送信と変化した時だけ送信（ミスタイプや重複をスキップ）
        const ptrChanged = ptr !== lastSentPtrRef.current
          || absLineNow !== lastSentLineRef.current
          || chunkIdxNow !== lastSentChunkRef.current;

        if (ptrChanged) {
          lastSentPtrRef.current = ptr;
          lastSentLineRef.current = absLineNow;
          lastSentChunkRef.current = chunkIdxNow;
          const typed = chunkNow.text.slice(0, ptr);
          updatePlayerProgress(
            roomId, playerId,
            absLineNow,
            chunkIdxNow,
            rs?.sharedCombo || 0,
            rs?.maxSharedCombo || 0,
            rs?.sharedScore || 0,
            chunkIdxNow,
            ptr,
            typed,
            chunkNow.text
          ).catch(err => console.error('Character sync failed:', err));
        }
      }

      const isFinished = keygraph.is_finished();
      if (isFinished) {
        setComboAnimKey(k => k + 1);
        const comboAfterIncrement = (rs?.sharedCombo || 0) + 1;
        // setBigComboValue と setBigComboVisible は sharedCombo の監視 useEffect に一本化するため削除
        const mult = getComboMultiplier(comboAfterIncrement);

        const currentLine = currentLineRef.current!;
        const currentChunkIdx = currentChunkIdxRef.current;
        const currentLineIdx = currentLineIdxRef.current;
        const currentSet = currentSetRef.current;
        const currentBlockIdx = currentBlockIdxRef.current;
        const gl = rs?.globalLineIdx ?? 0;
        const gc = rs?.globalChunkIdx ?? 0;

        typedCharsInSetRef.current += keygraph.key_done().length;
        const elapsedSec = measureStartTimeRef.current
          ? (Date.now() - measureStartTimeRef.current) / 1000
          : 1;
        const typedChars = typedCharsInSetRef.current;
        const charsPerSec = typedChars / Math.max(elapsedSec, 0.1);
        const speedMult = charsPerSec / 5;

        const nowVideoMs = currentTimeMsRef.current;
        const setStartMs = currentSet?.timeMs ?? 0;
        const nextSetMs = mapData.displaySets[currentBlockIdx + 1]?.timeMs
          ?? (endTimeMs ?? (nowVideoMs + 10000));
        const intervalMs = nextSetMs - setStartMs;
        const remainMs = nextSetMs - nowVideoMs;
        const judge = calcJudge(remainMs, intervalMs);
        const chunkKey = `${currentLine.absLineIdx}-${currentChunkIdx}`;
        showJudge(judge, chunkKey);

        const perfectBonus = judge === 'PERFECT' ? 5 : 0;
        const addScore = Math.round(10 * mult * speedMult) + perfectBonus;
        if (rs?.sharedScore !== undefined) incrementSharedScore(roomId, rs.sharedScore + addScore);

        const isCorrectOrder = currentLine.absLineIdx === gl && currentChunkIdx === gc;
        if (isCorrectOrder) {
          // 正解順ならコンボ加算
          const combo = (rs?.sharedCombo || 0) + 1;
          updateSharedCombo(roomId, combo, Math.max(rs?.maxSharedCombo || 0, combo));

          // ★ 正解順の時のみ成功音を鳴らす
          if (judge === 'BAD') {
            justPlayedBadSoundRef.current = true; // おそらくBAD判定＝ミス等ではないが、音が重ならないように
            try { bad_sound.play(); } catch (_) { }
          } else {
            justPlayedClearSoundRef.current = true;
            try { clear_sound.play(); } catch (_) { }
          }
          
          let nl = currentLine.absLineIdx, nc = currentChunkIdx + 1;
          if (nc >= currentLine.chunks.length) { nl++; nc = 0; }

          // ★ オートアドバンス：既に完了されている単語をスキップ
          const players = rs?.players || {};
          const pids = playerIdsRef.current;
          while (true) {
            const lineInSet = currentSet?.lines.find(l => l.absLineIdx === nl);
            if (!lineInSet) break;
            if (nc >= lineInSet.chunks.length) { nl++; nc = 0; continue; }

            const targetPid = getAssignedPlayerId(nl, pids);
            const targetP = players[targetPid];
            const isTargetFinished = targetP && (
              (targetP.currentLineIdx === -1 && nl <= currentSet!.lines[currentSet!.lines.length - 1].absLineIdx) ||
              (targetP.currentLineIdx !== -1 && targetP.currentLineIdx > nl) ||
              (targetP.currentLineIdx === nl && targetP.currentChunkIdx > nc)
            );

            if (isTargetFinished) {
              nc++;
              if (nc >= lineInSet.chunks.length) { nl++; nc = 0; }
            } else {
              break;
            }
          }
          updateGlobalProgress(roomId, nl, nc);
        } else {
          // ★ 順序飛ばしの場合はコンボリセット
          justPlayedBadSoundRef.current = true;
          try { bad_sound.play(); } catch (_) { }
          updateSharedCombo(roomId, 0, rs?.maxSharedCombo || 0);
        }

        let nextLineIdxForFirebase = currentLine.absLineIdx;
        let nextChunkIdxForFirebase = currentChunkIdx + 1;
        let nextChunkToBuild = null;

        if (nextChunkIdxForFirebase < currentLine.chunks.length) {
          setCurrentChunkIdx(nextChunkIdxForFirebase);
          nextChunkToBuild = currentLine.chunks[nextChunkIdxForFirebase];
        } else {
          const currentPlayerIds = playerIdsRef.current;
          let nextM = -1;
          if (currentSet?.lines) {
            for (let i = currentLineIdx + 1; i < currentSet.lines.length; i++) {
              const pid = getAssignedPlayerId(currentSet.lines[i].absLineIdx, currentPlayerIds);
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
            // ★ 全ての担当行を終えた場合、判定用に「最後の行の次」をセット
            const lastAbsIdx = currentLine.absLineIdx;
            setCurrentLineIdx(-1);
            nextLineIdxForFirebase = lastAbsIdx + 1;
            nextChunkIdxForFirebase = 0;

            // ★ 完了フラグをFirebaseに書き込む（判定で使用）
            updatePlayerCompletedBlock(roomId, playerId, currentBlockIdx).catch(console.error);

            const finalElapsedSec = measureStartTimeRef.current
              ? (Date.now() - measureStartTimeRef.current) / 1000
              : 1;
            const finalCPS = typedCharsInSetRef.current / Math.max(finalElapsedSec, 0.1);
            const newSamples = [...speedSamplesRef.current, finalCPS];
            speedSamplesRef.current = newSamples;
            updatePlayerSpeedSamples(roomId, playerId, newSamples).catch(console.error);
          }
        }

        // ★ チャンク完了時は即時送信（ptrリセット）
        lastSentPtrRef.current = -1;
        lastSentLineRef.current = nextLineIdxForFirebase;
        lastSentChunkRef.current = nextChunkIdxForFirebase;
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
  }, [roomId, playerId, endTimeMs, getAssignedPlayerId, mapData.displaySets]);

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

  // ============================================================
  // ★ ゲスト：Firebase の lastFailure を購読してたらいアニメーションを実行
  // ホストはすでに自分でアニメーションをセットしているため、ここではスキップ
  // ============================================================
  const lastFailureTimestampRef = useRef<number>(0);
  useEffect(() => {
    if (isHost || !isStarted) return; // ホストは判定時に直接セット済み & 開始前は実行しない
    const failure = roomState?.lastFailure;
    if (!failure) return;
    // 同じ失敗イベントを重複処理しないよう timestamp で制御
    if (failure.timestamp <= lastFailureTimestampRef.current) return;
    lastFailureTimestampRef.current = failure.timestamp;

    const ids = new Set<string>(failure.failedPlayerIds);
    if (ids.size === 0) return;

    setTaraiPlayers(ids);
    setBadShakePlayers(ids);
    if (taraiTimerRef.current) clearTimeout(taraiTimerRef.current);
    if (badShakeTimerRef.current) clearTimeout(badShakeTimerRef.current);
    taraiTimerRef.current = setTimeout(() => setTaraiPlayers(new Set()), 1500);
    badShakeTimerRef.current = setTimeout(() => setBadShakePlayers(new Set()), 1500);

    setTimeout(() => {
      try {
        const audio = new Audio('/sound/tarai.mp3');
        const baseVol = typeof (window as any).clearVolume !== 'undefined' ? (window as any).clearVolume : 1.0;
        audio.volume = Math.min(1.0, baseVol * 1.5);
        audio.play();
      } catch (_) { }
    }, 200);
  }, [roomState?.lastFailure, isHost]);

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

  // ★ 他プレイヤーのチャンク完了を検知して判定表示と打ち切り音を鳴らす
  const prevOtherPlayersProgressRef = useRef<Record<string, { lineIdx: number; chunkIdx: number }>>({});


  useEffect(() => {
    if (!roomState?.players || !isStarted || isGameOver) return;
    for (const [pid, p] of Object.entries(roomState.players)) {
      if (pid === playerId) continue;
      const prev = prevOtherPlayersProgressRef.current[pid];
      const curr = { lineIdx: p.currentLineIdx, chunkIdx: p.currentChunkIdx };

      if (prev) {
        const advanced =
          (curr.lineIdx > prev.lineIdx) ||
          (curr.lineIdx === prev.lineIdx && curr.chunkIdx > prev.chunkIdx) ||
          (curr.lineIdx === -1 && prev.lineIdx !== -1);

        // ★修正：進捗があった場合でも、ゲーム開始直後の同期ズレ（前回の残り値）による誤爆を防ぐ
        // currentBlockIdx === 0 のときは判定（showJudge）をスキップする
        if (advanced) {
          // ★ コンボ音の判定は sharedCombo の監視に一本化したため、ここでの clear_sound.play() は削除
          
          if (currentBlockIdxRef.current > 0) { // 第1ブロック以降のみ判定を表示
            const completedChunkKey = `${prev.lineIdx}-${prev.chunkIdx}`;
            const nowVideoMs = currentTimeMsRef.current;
            const setStartMs = currentSetRef.current?.timeMs ?? 0;
            const nextSetMs = mapData.displaySets[currentBlockIdxRef.current + 1]?.timeMs
              ?? (endTimeMs ?? (nowVideoMs + 10000));
            showJudge(calcJudge(nextSetMs - nowVideoMs, nextSetMs - setStartMs), completedChunkKey);
          }
        }
      }
      prevOtherPlayersProgressRef.current[pid] = curr;
    }
  }, [roomState?.players, isStarted, isGameOver, playerId, endTimeMs, mapData.displaySets]);
  if (!mapData || !mapData.displaySets || mapData.displaySets.length === 0 || !currentSet) return <div>Loading...</div>;
  const scoreText = (roomState?.sharedScore || 0).toString().padStart(6, '0');
  const currentCombo = roomState?.sharedCombo || 0;
  const multiplier = getComboMultiplier(currentCombo);

  return (
    <div className='flex flex-col items-center w-full max-w-none mx-auto p-0 h-full overflow-hidden'>
      <div className="w-full border-4 border-white rounded-none bg-white/5 backdrop-blur-sm p-0 flex flex-col h-full overflow-hidden">

        <div className="w-full bg-white/10 border-b-2 border-white/20 flex-shrink-0 stage-container" style={{ position: 'relative' }}>
          <PlayerLane 
            taraiPlayers={taraiPlayers} 
            badShakePlayers={badShakePlayers} 
          />

          {/* ★ ビッグコンボ表示 */}
          {bigComboVisible && (
            <div style={{
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none', zIndex: 50,
            }}>
              <div key={bigComboValue} style={{
                fontFamily: "'M PLUS Rounded 1c', sans-serif",
                fontSize: 'clamp(30px, 5vw, 60px)',
                fontWeight: 900,
                fontStyle: 'italic',
                color: '#fff',
                lineHeight: 1,
                letterSpacing: '-0.04em',
                textShadow: '0 0 30px rgba(255,200,0,0.8), 0 0 60px rgba(255,100,0,0.6), 3px 3px 0 rgba(0,0,0,0.4)',
                WebkitTextStroke: '2px rgba(255,150,0,0.8)',
                animation: 'bigComboIn 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
              }}>
                Combo {bigComboValue}
              </div>
            </div>
          )}
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
                isBuffering ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      padding: '10px 36px', fontSize: 18, fontWeight: 900, color: '#f48',
                      background: '#fff', border: '2px solid #f48', borderRadius: 40, opacity: 0.9,
                    }} className="animate-pulse">同期中...</div>
                    <div style={{ fontSize: 12, color: '#aaa', fontWeight: 600 }}>
                      全員のバッファ完了を待っています
                    </div>
                    {/* 各プレイヤーのバッファ完了状況 */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                      {roomState && Object.values(roomState.players).map(p => (
                        <div key={p.id} style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          background: p.isBufferReady ? '#f0fff4' : '#fff',
                          border: `1.5px solid ${p.isBufferReady ? '#22c55e' : '#fca5a5'}`,
                          borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 600,
                        }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.isBufferReady ? '#22c55e' : '#fca5a5' }} />
                          <span style={{ color: '#444' }}>{p.name}</span>
                          <span style={{ color: p.isBufferReady ? '#22c55e' : '#f87171' }}>
                            {p.isBufferReady ? '✓' : '...'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button onClick={async () => {
                    console.log('[Sync:Host] START button clicked. Beginning preload sync flow...');
                    setIsBuffering(true);
                    isBufferingRef.current = true;

                    try {
                      const p = playerRef.current;
                      if (p && typeof p.seekTo === 'function') {
                        console.log('[Sync:Host] Seeking to 0.1s for preload...');
                        p.seekTo(0.1, true);
                        p.playVideo();
                        setTimeout(() => {
                          try { p.pauseVideo(); console.log('[Sync:Host] Paused after preload.'); } catch (_) { }
                        }, 300);
                      } else {
                        console.warn('[Sync:Host] ⚠ playerRef not ready at START click.');
                      }
                    } catch (_) { }

                    await clearPlayerBufferReady(roomId, playerId);
                    console.log('[Sync:Host] Cleared own isBufferReady. Writing true in 500ms...');
                    setTimeout(async () => {
                      await updatePlayerBufferReady(roomId, playerId);
                      console.log('[Sync:Host] ✅ Own isBufferReady=true written.');
                    }, 500);
                  }} style={{
                    padding: '10px 40px', fontSize: 22, fontWeight: 900, color: '#fff',
                    background: 'linear-gradient(135deg, #f48, #f06)', border: 'none', borderRadius: 40,
                    cursor: 'pointer', boxShadow: '0 4px 16px rgba(255,0,100,0.3)',
                  }} className="hover:scale-110 active:scale-95 transition-all transform">START</button>
                )
              ) : (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6
                }}>
                  <div style={{
                    padding: '10px 30px', fontSize: 16, fontWeight: 900, color: '#f48',
                    background: '#fff', border: '2px solid #f48', borderRadius: 40, opacity: 0.8,
                  }} className="animate-pulse">
                    {isBuffering ? '同期中...' : 'WAITING FOR HOST...'}
                  </div>
                  {isBuffering && (
                    <div style={{ fontSize: 12, color: '#aaa', fontWeight: 600 }}>
                      動画をプリロードしています
                    </div>
                  )}
                </div>
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
            <div className="lyrics-area scrollbar-hide" ref={lyricsAreaRef} data-typing-progress={inputCount} style={{ fontSize: '1.6em' }}>
              {currentSet?.lines.map((line: any) => {
                const globalLineIdx = roomState?.globalLineIdx ?? 0;
                const nowMs = currentTimeMsRef.current;
                const isPreStart = nowMs < (currentSet?.timeMs ?? 0);
                const isLineActive = line.absLineIdx === globalLineIdx && !isPreStart;
                const linePlayerId = getAssignedPlayerId(line.absLineIdx, playerIds);
                const linePlayerColor = roomState?.players?.[linePlayerId]?.color || '#e0195a';
                return (
                  <LyricLineMemo
                    key={line.absLineIdx}
                    line={line}
                    isLineActive={isLineActive}
                    linePlayerColor={linePlayerColor}
                    gl={globalLineIdx}
                    gc={roomState?.globalChunkIdx ?? 0}
                    p={roomState?.players?.[linePlayerId]}
                    isPreStart={isPreStart}
                    playerId={playerId}
                    currentLineAbsIdx={currentLine?.absLineIdx}
                    keygraphPtr={(keygraph as any)._seq_ptr_cur}
                    judgeChunkKey={judgeChunkKey}
                    judgeResult={judgeResult}
                  />
                );
              })}
            </div>

            <div className="w-full flex flex-col relative overflow-hidden target-bar shrink-0"
              style={{ backgroundColor: roomState?.players?.[playerId]?.color || '#fb7185' }}>
              {isStarted && !isGameOver && (() => {
                const myColor = roomState?.players?.[playerId]?.color ?? '#ffffff';
                const line = currentSet.lines[0];
                const nextSet = mapData.displaySets[currentBlockIdx + 1];
                const now = currentTimeMsRef.current;
                const setEnd = nextSet ? nextSet.timeMs : (videoDuration * 1000);
                let start, end;
                const lineTimeMs = line ? line.timeMs : currentSet.timeMs;
                if (currentBlockIdx === 0 && now < lineTimeMs) { start = 0; end = lineTimeMs; }
                else { start = lineTimeMs; end = setEnd; }
                const progress = Math.max(0, Math.min(100, (now - start) / Math.max(1, end - start) * 100));
                return (
                  <div className="w-full h-4 bg-black/20 flex-shrink-0">
                    <div className="h-full"
                      style={{
                        backgroundColor: myColor,
                        boxShadow: `0 0 10px ${myColor}88`,
                        width: `${progress}%`,
                        transition: 'width 150ms linear'
                      }} />
                  </div>
                );
              })()}
              <div className="flex items-center justify-between px-6 py-0">
                <div className="flex flex-col items-start leading-none" style={{ gap: 0 }}>
                  <span className="text-[9px] font-black text-rose-100 uppercase italic leading-none">Target</span>
                  <span className="text-xs font-black text-white italic leading-none">{isMe ? '打って！' : '待機'}</span>
                </div>
                <div className="flex-1 flex items-center justify-start pl-6">
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
                {currentCombo > 0 && (
                  <div className="flex flex-col items-end" style={{ gap: 0 }}>
                    <span className="text-[8px] font-black text-rose-100 uppercase italic text-right tracking-widest leading-none">Combo</span>
                    <div key={comboAnimKey} className="flex items-baseline gap-0.5 combo-pop">
                      <div className="text-xl font-black italic text-white leading-none">{currentCombo}</div>
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
                )}
              </div>
            </div>
            <div className="w-full flex shrink-0 score-video-area">
              <div className="flex-1 min-w-0 p-2 flex flex-col items-center justify-center bubble-bg bg-[#fff5f8] border-r-2 border-rose-200">
                <span className="font-black uppercase tracking-widest mb-0.5 score-label" style={{ color: '#1a1a1a', opacity: 1, textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>合計スコア</span>
                <div className="font-black tracking-tighter shrink-0 score-value" style={{ color: '#1a1a1a', textShadow: '0 2px 4px rgba(0,0,0,0.2)', opacity: 1 }}>{scoreText}</div>
              </div>
              {/* ★ overflow:hiddenでiframeをクロップして黒帯を除去 */}
              <div
                className="flex-[0_0_auto] h-full relative shrink-0"
                style={{
                  width: '320px',
                  overflow: 'hidden',
                  backgroundColor: '#fff5f8',
                  visibility: hideVideo ? 'hidden' : 'visible'
                }}
              >
                <div
                  id="youtube-player"
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    width: '320px',
                    height: '180px',
                    transform: 'translate(-50%, -50%)',
                    border: 'none',
                  }}
                />
              </div>
              <div className="flex-1 min-w-0 p-2 flex flex-col justify-between bubble-bg bg-white overflow-hidden">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-black text-rose-300 uppercase italic">再生中</span>
                  <div className="text-sm font-black text-zinc-700 tracking-tighter italic break-words leading-tight">{mapData.title || 'Unknown Stage'}</div>
                  <div className="text-xs font-bold text-zinc-400 break-words">{mapData.artist || 'Unknown Artist'}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleBackToMenu}
                    className="flex-1 bg-rose-400 text-white font-black rounded-none hover:bg-rose-500 shadow-sm transition-colors menu-button">MENU</button>
                  <button className="flex-1 bg-white border border-zinc-100 text-zinc-400 font-black rounded-none hover:bg-zinc-50 transition-colors help-button">ヘルプ</button>
                </div>
              </div>
            </div>

            {/* ★ 全体プログレスバー（150ms linear補間） */}
            <div className="w-full bg-zinc-200 h-1 overflow-hidden relative footer-area">
              <div className="h-full bg-gradient-to-r from-rose-400 to-rose-500"
                style={{
                  width: `${Math.max(0, Math.min(100, (currentTime / (videoDuration || 1)) * 100))}%`,
                  transition: 'width 150ms linear'
                }} />
            </div>
          </div>
        )}
      </div>

      {isGameOver && (
        <div className='fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white/95 backdrop-blur-md overflow-y-auto text-center'>
          <div className='absolute -top-20 -left-20 w-96 h-96 bg-rose-100 blur-3xl opacity-60' />
          <div className='absolute -bottom-20 -right-20 w-96 h-96 bg-purple-100 blur-3xl opacity-60' />
          <div className='relative z-10 flex flex-col items-center gap-6 py-10'>
            <div style={{ fontSize: 'clamp(80px, 14vw, 160px)', fontWeight: 900, fontStyle: 'italic', letterSpacing: '-0.04em', lineHeight: 1 }}
              className='text-rose-400 drop-shadow-2xl'>FINISH!</div>
            <div className='flex flex-col gap-2'>
              <div className='font-black uppercase tracking-tighter' style={{ fontSize: 'clamp(24px, 4vw, 48px)', color: '#1a1a1a', textShadow: '0 2px 4px rgba(0,0,0,0.15)' }}>
                ステージスコア: <span className='text-rose-500'>{scoreText}</span>
              </div>
              <div className='font-bold uppercase tracking-[0.5em] text-zinc-500' style={{ fontSize: '15px' }}>
                最大コンボ: {roomState?.maxSharedCombo || 0}
              </div>
            </div>
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
                            <span className="font-black" style={{ color: p.color }}>{(stats.avg * 60).toFixed(0)}</span> c/m
                          </span>
                          <span className="text-[10px] font-mono text-zinc-400 w-14 text-right">
                            中{(stats.median * 60).toFixed(0)}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
            <button onClick={handleBackToMenu}
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
        @keyframes bigComboIn {
          0%   { transform: scale(0.3) translateY(20px); opacity: 0; }
          60%  { transform: scale(1.15) translateY(-8px); opacity: 1; }
          80%  { transform: scale(0.95) translateY(0); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};