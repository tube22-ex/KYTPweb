
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { ParseResult } from '../services/api';
import keygraph from '../utils/keygraph';
import { sound, miss_sound } from '../utils/sound';
import { updatePlayerProgress, RoomState, setRoomStartTime, getServerTimeOffset, PLAYER_COLORS, incrementSharedScore, updateSharedCombo, updateGlobalProgress } from '../services/sync';

interface Props {
  mapData: ParseResult;
  roomId: string;
  playerId: string;
  roomState: RoomState | null;
  onBackToMenu: () => void;
}

// ============================
// LineItem: 1行の表示
// ============================
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
  currentWord,
  isFuture,
  currentBlockIdx
}) => {
  const isActiveLine = lineIdx === currentLineIdx;
  const uLineIdx = currentBlockIdx * 4 + lineIdx;

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
          // 自分がアクティブな場合
          if (isEngineReady && isActiveLine) {
            const isActiveChunk = i === currentChunkIdx;
            const isChunkDone = i < currentChunkIdx;

            if (isActiveChunk) {
              const done = keygraph.seq_done() || '';
              const rest = keygraph.seq_candidates() || '';
              return (
                <span key={i}>
                  {i > 0 && <span className='opacity-30'>　</span>}
                  <span className='text-white/30'>{done}</span>
                  <span style={{ color: playerColor }}>{rest.slice(0, 1)}</span>
                  <span className='text-white/40'>{rest.slice(1)}</span>
                </span>
              );
            } else if (isChunkDone) {
              return (
                <span key={i}>
                  {i > 0 && <span className='opacity-30'>　</span>}
                  <span className='text-white/30'>{chunk.text}</span>
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

          // 他人がアクティブな場合 (文字列ベースの表示)
          if (isSomeoneElseActive) {
            const theirChunkIdx = opponentChunkIdx ?? 0;
            const theirTyping = currentTyping ?? '';
            const theirWord = currentWord ?? '';

            // スロットベースの行番号差分で過去/現在チャンクを判定
            const theirLineIdxRelative = (uLineIdx ?? -1) - (currentBlockIdx * 4);
            const isPastChunk = lineIdx < theirLineIdxRelative 
              || (lineIdx === theirLineIdxRelative && i < theirChunkIdx);
            
            const isCurrentChunk = lineIdx === theirLineIdxRelative 
              && i === theirChunkIdx 
              && chunk.text === theirWord;

            if (isPastChunk) {
              return (
                <span key={i}>
                  {i > 0 && <span className='opacity-30'>　</span>}
                  <span className='text-white/30'>{chunk.text}</span>
                </span>
              );
            }
            if (isCurrentChunk) {
              const doneText = theirTyping;
              const restText = chunk.text.slice(doneText.length);
              const activeChar = restText[0] ?? '';
              const remainingText = restText.slice(1);
              return (
                <span key={i}>
                  {i > 0 && <span className='opacity-30'>　</span>}
                  <span className='text-white/30'>{doneText}</span>
                  <span style={{ color: playerColor }}>{activeChar}</span>
                  <span className='text-white/40'>{remainingText}</span>
                </span>
              );
            }
            return (
              <span key={i}>
                {i > 0 && <span className='opacity-30'>　</span>}
                <span className='text-white/40'>{chunk.text}</span>
              </span>
            );
          }

          // 完了済み行、または待機中
          const isLineDone = isDone;
          const isLineFuture = isFuture;
          return (
            <span key={i}>
              {i > 0 && <span className='opacity-30'>　</span>}
              <span className={isLineDone ? 'text-white/30' : isLineFuture ? 'text-white/20' : 'text-white/60'}>
                {chunk.text}
              </span>
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
export const TypingArea: React.FC<Props> = ({ mapData, roomId, playerId, roomState, onBackToMenu }) => {
  const [currentBlockIdx, setCurrentBlockIdx] = useState(0);
  const [currentLineIdx, setCurrentLineIdx] = useState(0);
  const [currentChunkIdx, setCurrentChunkIdx] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const [comboAnimKey, setComboAnimKey] = useState(0);

  const playerRef = useRef<any>(null);
  const instanceIdRef = useRef<number>(0);
  const lastLogTime = useRef(0);

  // ゲーム開始フラグ
  const isStarted = roomState?.startTime != null;

  const playerIds = useMemo(() => {
    if (!roomState || !roomState.players) return [playerId];
    return Object.keys(roomState.players).sort(); // アルファベット順に固定
  }, [roomState?.players, playerId]);
  const numPlayers = playerIds.length || 1;
  const myPos = playerIds.indexOf(playerId);

  const endTimeMs = useMemo(() => {
    const endLine = mapData.lines.find(l => l.isEnd);
    if (endLine) return endLine.timeMs;
    // フォールバック: 最後の歌詞行の時刻 + 3秒
    const lastLine = mapData.lines[mapData.lines.length - 1];
    return lastLine ? lastLine.timeMs + 3000 : undefined;
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
                if (!isGameOver) e.target.playVideo();
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
  // startTime 変化 → 再生制御 & 初期化
  // =====================
  useEffect(() => {
    const start = roomState?.startTime;
    if (start && !isGameOver) {
      const p = playerRef.current;
      if (p && typeof p.playVideo === 'function') {
        const s = p.getPlayerState();
        if (s !== 1 && s !== 3) getServerTimeOffset().then(off => {
          const sec = (Date.now() + off - start) / 1000;
          if (sec > 0) { p.seekTo(sec, true); p.playVideo(); }
          else p.playVideo();
        });
      }
      // 修正2: 初回セットの自分の開始行をセット
      const firstMine = mapData.displaySets[0]?.lines.findIndex((_, idx) => isMine(idx));
      if (firstMine !== -1) setCurrentLineIdx(firstMine);
    } else {
      try { if (playerRef.current?.stopVideo) playerRef.current.stopVideo(); } catch (e) { }
      if (!isGameOver) {
        setCurrentBlockIdx(0); setCurrentLineIdx(0); setCurrentChunkIdx(0);
      }
    }
  }, [roomState?.startTime, isGameOver]);

  const currentSet = mapData.displaySets?.[currentBlockIdx];
  const currentLine = currentSet?.lines?.[currentLineIdx];
  
  // 修正2: 自分の担当行かどうかの判定 (セット内インデックスを使用)
  const isMine = (lineIdxInSet: number): boolean => (lineIdxInSet % numPlayers) === myPos;
  const isMe = currentLine ? isMine(currentLineIdx) : false;

  // =====================
  // ブロック進行タイマー (displaySetsベース)
  // =====================
  useEffect(() => {
    const int = setInterval(() => {
      const p = playerRef.current;
      if (!isStarted || isGameOver) return;

      const start = roomState?.startTime;

      // ① 経過時間ベースのフォールバック強制終了
      //    動画がフリーズしていても必ず endTimeMs を過ぎたら終了させる
      if (endTimeMs && start) {
        const elapsedMs = Date.now() - start;
        if (elapsedMs >= endTimeMs) {
          setIsGameOver(true);
          try { p?.stopVideo?.(); } catch (e) { }
          return;
        }
      }

      if (!p || typeof p.getCurrentTime !== 'function') return;
      const now = Date.now();
      const s = p.getPlayerState();
      if (s === 5 || s === 2 || s === -1) {
        if (now - lastLogTime.current > 3000) { p.playVideo(); lastLogTime.current = now; }
      }
      if (s === 1) {
        const ms = p.getCurrentTime() * 1000;

        // ② 動画時間ベースの終了判定（既存）
        if (endTimeMs && ms >= endTimeMs) {
          setIsGameOver(true);
          try { p.stopVideo(); } catch (e) { }
          return;
        }

        const nextSet = mapData.displaySets?.[currentBlockIdx + 1];
        if (nextSet && ms >= nextSet.timeMs) {
          const nextBlockIdx = currentBlockIdx + 1;
          setCurrentBlockIdx(nextBlockIdx);
          
          // 新しいセットでの自分の最初の行を探す
          const firstMine = mapData.displaySets[nextBlockIdx].lines.findIndex((_, idx) => isMine(idx));
          setCurrentLineIdx(firstMine !== -1 ? firstMine : 0);
          setCurrentChunkIdx(0);
          setIsEngineReady(false);
        }
      }
    }, 50);
    return () => clearInterval(int);
  }, [currentBlockIdx, mapData.displaySets, isStarted, endTimeMs, roomState?.startTime, numPlayers, myPos]);


  // =====================
  // チャンクをエンジンにロード (ハイブリッド・タイミング制限)
  // =====================
  useEffect(() => {
    if (!isStarted || isGameOver || !isMe || !currentLine) {
      setIsEngineReady(false);
      return;
    }

    // 修正: 1行目のみtimeMsチェック
    if (currentLineIdx === 0) {
      const p = playerRef.current;
      if (!p || typeof p.getCurrentTime !== 'function') {
        setIsEngineReady(false); return;
      }
      const currentMs = p.getCurrentTime() * 1000;
      if (currentMs < currentLine.timeMs) {
        setIsEngineReady(false); return;
      }
    }
    // 2行目以降は即座にOK

    const currentChunk = currentLine.chunks?.[currentChunkIdx];
    if (currentChunk) {
      console.log('keygraph.build:', currentChunk.text);
      keygraph.reset();
      keygraph.build(currentChunk.text);
      setIsEngineReady(true);
    } else {
      setIsEngineReady(false);
    }
  }, [currentBlockIdx, currentLineIdx, currentChunkIdx, isStarted, isMe, currentLine, isGameOver]);

  // ★1行目のtimeMs監視タイマー
  useEffect(() => {
    if (!isStarted || currentLineIdx !== 0 || isEngineReady || isGameOver) return;
    const interval = setInterval(() => {
      const p = playerRef.current;
      if (!p || typeof p.getCurrentTime !== 'function') return;
      const currentMs = p.getCurrentTime() * 1000;
      const set0Line = mapData.displaySets?.[currentBlockIdx]?.lines?.[0];
      if (set0Line && currentMs >= set0Line.timeMs) {
        const currentChunk = set0Line.chunks?.[currentChunkIdx];
        if (currentChunk) {
          keygraph.reset();
          keygraph.build(currentChunk.text);
          setIsEngineReady(true);
        }
        clearInterval(interval);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [isStarted, currentLineIdx, currentBlockIdx, isEngineReady, isGameOver, mapData.displaySets, currentChunkIdx]);

  // =====================
  // キーボードイベント
  // =====================
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (!isStarted || !isEngineReady || !isMe || e.key.length > 1 || e.altKey || e.ctrlKey || e.metaKey) return;

      const currentChunk = currentLine?.chunks?.[currentChunkIdx];
      if (!currentChunk) return;

      // グローバルな進行度チェック
      const globalLine = roomState?.globalLineIdx ?? 0;
      const globalChunk = roomState?.globalChunkIdx ?? 0;
      const myAbsLine = currentLine.absLineIdx;
      const myChunkIdx = currentChunkIdx;

      // 順序チェック: 現在の自分が打とうとしている場所が
      // 部屋全体のターゲットより先なら、コンボを強制リセット（飛ばし打ち）
      const isAhead = (myAbsLine > globalLine) || (myAbsLine === globalLine && myChunkIdx > globalChunk);
      const isCurrentTarget = (myAbsLine === globalLine && myChunkIdx === globalChunk);

      if (isAhead) {
        if (roomState?.sharedCombo && roomState?.sharedCombo > 0) {
          updateSharedCombo(roomId, 0, roomState.maxSharedCombo || 0);
        }
      }

      if (keygraph.next(e.key.toLowerCase())) {
        try { 
          sound.currentTime = 0; sound.play(); 
        } catch (_) { }

        setComboAnimKey(k => k + 1);
        if (roomState?.sharedScore !== undefined) incrementSharedScore(roomId, roomState.sharedScore + 10);
        
        // ★入力のたびに chunkProgress をリアルタイム送信 (パーソナル同期用)
        if (roomId && playerId && currentLine) {
          const typingDone = keygraph.seq_done();
          const progress = typingDone ? typingDone.length : 0;
          updatePlayerProgress(
            roomId, playerId, 
            currentBlockIdx * 4 + currentLineIdx, 
            currentChunkIdx, 
            0, 0, 0, 
            currentChunkIdx, progress,
            typingDone || '',
            currentChunk.text
          );
        }

        // チャンクが終了したら次へ
        if (keygraph.is_finished()) {
          // ★共有コンボ加算 (チャンク単位)
          if (isCurrentTarget) {
            const nextCombo = (roomState?.sharedCombo || 0) + 1;
            const nextMax = Math.max(roomState?.maxSharedCombo || 0, nextCombo);
            updateSharedCombo(roomId, nextCombo, nextMax);

            // 全体のターゲットを進める
            let nextGlobalLine = globalLine;
            let nextGlobalChunk = globalChunk + 1;
            if (nextGlobalChunk >= currentLine.chunks.length) {
              nextGlobalLine++;
              nextGlobalChunk = 0;
            }
            updateGlobalProgress(roomId, nextGlobalLine, nextGlobalChunk);
          }

          if (currentChunkIdx + 1 < currentLine.chunks.length) {
            setCurrentChunkIdx(prev => prev + 1);
          } else {
            let nextMine = -1;
            if (currentSet?.lines) {
              for (let i = currentLineIdx + 1; i < currentSet.lines.length; i++) {
                if (isMine(i)) {
                  nextMine = i;
                  break;
                }
              }
            }

            if (nextMine !== -1) {
              setCurrentLineIdx(nextMine);
              setCurrentChunkIdx(0);
            } else {
              const isLastSet = (currentBlockIdx + 1 >= mapData.displaySets.length);
              if (isLastSet) {
                setIsGameOver(true);
                try { playerRef.current?.stopVideo(); } catch (e) { }
              }
            }
          }
          setIsEngineReady(false);
        }
      } else {
        try { miss_sound.play(); } catch (_) { }
        // ミスでの途切れはいらない仕様
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [isStarted, isEngineReady, isMe, currentLine, currentChunkIdx, roomState, roomId, currentBlockIdx, currentLineIdx, mapData.displaySets, numPlayers, myPos]);

  // =====================
  // 進捗同期 (ブロック番号 + 行番号をシリアル化して送信)
  // =====================
  useEffect(() => {
    if (roomId && playerId && currentLine) {
      updatePlayerProgress(
        roomId, playerId, 
        currentBlockIdx * 4 + currentLineIdx, // スロットIDを送信
        currentChunkIdx, 
        0, 0, 0, // 個人コンボは不要
        currentChunkIdx,
        0, 
        '',
        currentLine.chunks[currentChunkIdx]?.text || ''
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBlockIdx, currentLineIdx, currentChunkIdx, roomId, playerId]);

  if (!mapData || !mapData.displaySets || mapData.displaySets.length === 0 || !currentSet) return <div>Loading...</div>;
  const scoreText = (roomState?.sharedScore || 0).toLocaleString();

  // 自分のプレイヤーカラー
  const myColor = roomState?.players?.[playerId]?.color || PLAYER_COLORS[myPos % 4];

  return (
    <div className='flex flex-col items-center mt-2 w-full max-w-4xl glass p-8 rounded-3xl relative overflow-hidden font-premium'>
      <div className='absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500' />

      {/* 
        YouTube プレイヤー: 
        isGameOver の時でも DOM を消さない（removeChild エラー防止のため display: none で隠す） 
      */}
      <div 
        className={'mb-6 rounded-2xl overflow-hidden bg-black items-center justify-center ring-4 ring-white/5 ' + (isGameOver ? 'hidden' : 'flex')}
        style={{ width: '426px', height: '240px' }}
      >
        <div id='youtube-player' />
      </div>

      {/* ゲームオーバー演出でも DOM 構造を大幅に変更しないように、メインUIの中で切り替える */}
      {isGameOver ? (
        <div className='flex flex-col items-center gap-4 py-8 animate-in fade-in zoom-in duration-1000 w-full'>
          <div className='text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-amber-600 italic tracking-tighter'>RESULT</div>
          <div className='text-3xl font-black text-white'>SCORE: <span className='text-yellow-400'>{scoreText}</span></div>
          <div className='text-xl font-bold text-white/60'>MAX SHARED COMBO: {roomState?.maxSharedCombo || 0}</div>
          <button
            onClick={() => {
              try { playerRef.current?.stopVideo(); } catch (e) {}
              onBackToMenu();
            }}
            className='mt-6 px-8 py-3 bg-white/10 hover:bg-white/20 text-white font-black rounded-2xl text-sm transition-colors'
          >
            BACK TO LOBBY
          </button>
        </div>
      ) : (
        <>
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
              {(roomState?.sharedCombo || 0) + ' COMBO'}
            </div>
            <div className='text-5xl'>{scoreText}</div>
          </div>
        </>
      )}

      {/* 歌詞エリア */}
      {!isGameOver && currentSet && (
        <div className='flex flex-col w-full' style={{ minHeight: '16rem' }}>
          {currentSet.lines.map((line: any, lIdx: number) => {
            const pid = playerIds[lIdx % numPlayers]; // セット内の番号でプレイヤーを特定
            const u = roomState?.players?.[pid];
            const isCurrentPlayerMe = pid === playerId;
            const playerColor = u?.color || PLAYER_COLORS[lIdx % 4];

            // 判定ロジック: セット内の相対スロットインデックスを使う
            const uLineIdx = currentBlockIdx * 4 + lIdx;
            const isDone = u && u.currentLineIdx > uLineIdx;
            const isSomeoneElseActive = !isCurrentPlayerMe && u && u.currentLineIdx === uLineIdx;
            const isFuture = u && u.currentLineIdx < uLineIdx;
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
                isFuture={isFuture}
                pidName={pidName}
                currentTyping={u?.currentTyping}
                currentWord={u?.currentWord}
                currentBlockIdx={currentBlockIdx}
              />
            );
          })}
          {/* 足りない分をダミー行で埋めて常に4行分のスペースを確保 */}
          {Array.from({ length: Math.max(0, 4 - currentSet.lines.length) }).map((_, i) => (
            <div
              key={'dummy-' + i}
              className='py-2 px-6 rounded-xl'
              style={{ minHeight: '4rem' }}
            />
          ))}
        </div>
      )}



      {/* START / SYNC ACTIVE ボタン */}
      <div className={'mt-8 text-center ' + (isGameOver ? 'hidden' : 'block')}>
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
