import React from 'react';
import { RoomState, determineHostId } from '../services/sync';
import { CHARACTERS, DEFAULT_CHARACTER_ID } from '../constants/characters';

interface PlayerLaneProps {
  roomState: RoomState | null;
  playerId: string;
  taraiPlayers?: Set<string>;    // たらいを降らせるプレイヤーIDセット
  badShakePlayers?: Set<string>; // BAD判定シェイクするプレイヤーIDセット
}

export const PlayerLane: React.FC<PlayerLaneProps> = ({ roomState, playerId, taraiPlayers, badShakePlayers }) => {
  if (!roomState || !roomState.players) return null;

  // プレイヤーを slotId 順に並び替えて、全クライアントで順番を一致させる
  const players = Object.values(roomState.players).sort((a, b) => {
    const sA = a.slotId || "";
    const sB = b.slotId || "";
    return sA.localeCompare(sB);
  });
  const hostId = determineHostId(roomState.players);

  // 5人以上なら2段グリッド
  const useGrid = players.length >= 5;

  // 5人以上でも2段に分けず、すべて topRow に入れる
  const topRow = players;
  const bottomRow: typeof players = []; // 下段は常に空にする
  const renderPlayerCard = (p: typeof players[number]) => {
    const hasTarai = taraiPlayers?.has(p.id);
    const hasBadShake = badShakePlayers?.has(p.id);
    const taraiKey = `tarai-${p.id}-${hasTarai ? 'on' : 'off'}`;
    const badShakeKey = `shake-${p.id}-${hasBadShake ? 'on' : 'off'}`;

    const charId = p.characterId || DEFAULT_CHARACTER_ID;
    const charDef = CHARACTERS[charId] || CHARACTERS[DEFAULT_CHARACTER_ID];
    const charScale = charDef.scale ?? 1.0;
    const taraiLandingY = (charDef.taraiOffset ?? -35);
    const vOffset = charDef.verticalOffset ?? 0;
    const tXOffset = charDef.tagOffset ?? 0;

    return (
      <div
        key={`${p.id}-${charId}`}
        className={`flex-none flex flex-col items-center transition-all duration-500 hover:scale-105 relative pb-1 ${useGrid ? 'w-24' : 'w-40'}`}
      >
        <div
          className="relative w-full flex flex-col items-center justify-end"
          style={{ height: useGrid ? '70px' : '90px' }}
        >
          {/* HOST / YOU タグ : ステージ上の「絶対的な高さ」に固定 + キャラクターごとの左右オフセット */}
          <div 
            className="absolute left-1/2 flex flex-col gap-1 items-center z-30 pointer-events-none" 
            style={{ 
              bottom: useGrid ? '75px' : '95px',
              transform: `translateX(calc(-50% + ${tXOffset}px))` 
            }}
          >
            {p.id === hostId && (
              <div className="bg-amber-400 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg border-2 border-white animate-bounce whitespace-nowrap">
                ★ HOST
              </div>
            )}
            {p.id === playerId && (
              <div className="bg-rose-400 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg border-2 border-white whitespace-nowrap">
                YOU
              </div>
            )}
          </div>

          {/* ★ キャラクター本体 */}
          <div
            className="relative inline-block h-full origin-bottom z-10"
            style={{ transform: `translateY(${vOffset}px) scale(${charScale})` }}
          >
            <img
              key={badShakeKey}
              src={charDef.image}
              alt={p.name}
              className={`relative z-10 h-full w-auto object-contain brightness-[0.95] contrast-[1.1] drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)] ${hasBadShake ? 'bad-shake' : ''}`}
            />
          </div>

          {/* ★ たらい落下 : charDef.taraiOffset に基づき、このカード専用の高さで実行 */}
          <div
            key={taraiKey}
            className={hasTarai ? "tarai-drop" : ""}
            style={{
              position: 'absolute',
              top: `${taraiLandingY}px`,
              left: '50%',
              transform: `translateX(-50%) scale(${charDef.taraiScale ?? 1.0})`,
              fontSize: useGrid ? '2.2rem' : '2.8rem',
              zIndex: 50,
              lineHeight: 1,
              userSelect: 'none',
              opacity: 0,
            }}
          >
            ⌨️
          </div>

          {/* プレイヤー名 : 床面に固定 */}
          <div
            className={`font-black truncate max-w-[120%] tracking-tight text-center absolute left-1/2 -translate-x-1/2 z-40 px-2.5 py-0.5 rounded-full backdrop-blur-md shadow-sm border border-black/10 ${useGrid ? 'text-[11px] bottom-1' : 'text-[13px] bottom-2'}`}
            style={{
              color: p.color,
              backgroundColor: 'rgba(0, 0, 0, 0.55)',
              boxShadow: `0 0 10px ${p.color}22`,
            }}
          >
            {p.name}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full relative">
      <div className="relative w-full stage-floor-dark group rounded-none border-x-4 border-zinc-900 shadow-inner overflow-visible stage-container">
        <div className="stage-truss" />
        <div className="stage-speaker stage-speaker-left" />
        <div className="stage-speaker stage-speaker-right" />

        <div className="relative flex flex-col items-center justify-end z-20">
          {/* 上段 */}
          <div className={`flex items-end justify-center px-4 gap-${useGrid ? '4' : '8'} min-w-0 w-full`}>
            {topRow.map(p => renderPlayerCard(p))}
          </div>

          {/* 下段（5人以上の時のみ、ジグザグ感を出すため少し上にずらす） */}
          {useGrid && bottomRow.length > 0 && (
            <div className="flex items-end justify-center px-4 gap-4 min-w-0" style={{ marginTop: '-10px' }}>
              {bottomRow.map(p => renderPlayerCard(p))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};