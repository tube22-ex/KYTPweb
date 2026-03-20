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


  return (
    <div className="w-full relative">
      {/* 舞台エリア (ダークステージ) */}
      <div className="relative w-full stage-floor-dark group rounded-none border-x-4 border-zinc-900 shadow-inner overflow-hidden stage-container">

        {/* 上部の骨組みとスピーカー装飾 */}
        <div className="stage-truss" />
        <div className="stage-speaker stage-speaker-left" />
        <div className="stage-speaker stage-speaker-right" />

        {/* プレイヤー整列 (relativeに変更し、親の高さに影響を与えるようにした) */}
        <div className="relative flex items-end justify-center px-4 gap-8 z-20 min-w-0">
          {players.map(p => (
            <div key={p.id} className="flex-none w-40 flex flex-col items-center transition-all duration-500 hover:scale-110 relative pb-1">
              {/* キャラクター (位置を右に寄せて名前と中央を合わせる) */}
              <div className="relative w-full flex flex-col items-center justify-end group-hover:z-30" style={{ height: '90px', transform: 'translateY(30px) translateX(48px)' }}>
                {/* ホスト/YOUタグ (中央寄せに変更) */}
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex flex-col gap-1 items-center z-30">
                  {p.id === hostId && (
                    <div className="bg-amber-400 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg border-2 border-white animate-bounce whitespace-nowrap">★ HOST</div>
                  )}
                  {p.id === playerId && (
                    <div className="bg-rose-400 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg border-2 border-white whitespace-nowrap">YOU</div>
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

              {/* プレイヤー名 (色を適用・中央揃え・最前面・背景付き) */}
              <div className="text-[15px] font-black truncate max-w-full tracking-tight text-center relative z-40 px-2 py-0.5 rounded-full backdrop-blur-[2px]"
                style={{ color: p.color, backgroundColor: 'rgba(0, 0, 0, 0.25)', marginTop: '-12px' }}>
                {p.name}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
