import React from 'react';
import { RoomState, determineHostId } from '../services/sync';

interface PlayerLaneProps {
  roomState: RoomState | null;
  playerId: string;
}

export const PlayerLane: React.FC<PlayerLaneProps> = ({ roomState, playerId }) => {
  if (!roomState || !roomState.players) return null;

  const players = Object.values(roomState.players);
  const hostId = determineHostId(roomState.players);

  // 5人以上なら2段グリッド
  const useGrid = players.length >= 5;

  // 2段に分割（上段: ceil(n/2), 下段: floor(n/2)）
  const topRow = useGrid ? players.slice(0, Math.ceil(players.length / 2)) : players;
  const bottomRow = useGrid ? players.slice(Math.ceil(players.length / 2)) : [];

  const PlayerCard = ({ p }: { p: typeof players[number] }) => (
    <div
      key={p.id}
      className={`flex-none flex flex-col items-center transition-all duration-500 hover:scale-110 relative pb-1 ${useGrid ? 'w-28' : 'w-40'}`}
    >
      <div
        className="relative w-full flex flex-col items-center justify-end group-hover:z-30"
        style={{
          height: useGrid ? '70px' : '90px',
          transform: useGrid
            ? 'translateY(20px) translateX(36px)'
            : 'translateY(30px) translateX(48px)'
        }}
      >
        {/* HOST / YOU タグ */}
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex flex-col gap-1 items-center z-30">
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

        <div className="relative inline-block h-full">
          <img
            src="https://i.imgur.com/3zyCq3U.png"
            alt=""
            className="relative z-10 h-full w-auto object-contain brightness-[0.90] contrast-[1.2] drop-shadow-[0_10px_15px_rgba(0,0,0,0.6)]"
          />
        </div>
      </div>

      {/* プレイヤー名 */}
      <div
        className={`font-black truncate max-w-full tracking-tight text-center relative z-40 px-2 py-0.5 rounded-full backdrop-blur-[2px] ${useGrid ? 'text-[12px]' : 'text-[15px]'}`}
        style={{
          color: p.color,
          backgroundColor: 'rgba(0, 0, 0, 0.25)',
          marginTop: '-12px'
        }}
      >
        {p.name}
      </div>
    </div>
  );

  return (
    <div className="w-full relative">
      <div className="relative w-full stage-floor-dark group rounded-none border-x-4 border-zinc-900 shadow-inner overflow-hidden stage-container">
        <div className="stage-truss" />
        <div className="stage-speaker stage-speaker-left" />
        <div className="stage-speaker stage-speaker-right" />

        <div className="relative flex flex-col items-center justify-end z-20">
          {/* 上段 */}
          <div className={`flex items-end justify-center px-4 gap-${useGrid ? '4' : '8'} min-w-0 w-full`}>            {topRow.map(p => <PlayerCard key={p.id} p={p} />)}
          </div>

          {/* 下段（5人以上の時のみ、ジグザグ感を出すため少し上にずらす） */}
          {useGrid && bottomRow.length > 0 && (
            <div className="flex items-end justify-center px-4 gap-4 min-w-0" style={{ marginTop: '-10px' }}>
              {bottomRow.map(p => <PlayerCard key={p.id} p={p} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};