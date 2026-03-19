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

  const getColorLabel = (color: string) => {
    switch (color) {
      case '#FF416C': return '赤';
      case '#2B86C5': return '青';
      case '#3DFC64': return '緑';
      case '#FBD72B': return '黄';
      default: return '他';
    }
  };

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
            <div key={p.id} className="flex-none w-40 flex flex-col items-center transition-all duration-500 hover:scale-110 relative">
              {/* キャラクター (さらに低く調整) */}
              <div className="relative w-full flex flex-col items-center justify-end group-hover:z-30" style={{ height: '120px' }}>
                {/* ホスト/YOUタグ (さらに強調) */}
                <div className="absolute -top-4 right-1/2 translate-x-12 flex flex-col gap-1 items-end z-30">
                  {p.id === hostId && (
                    <div className="bg-amber-400 text-white text-[12px] font-black px-2 py-0.5 rounded-full shadow-lg border-2 border-white animate-bounce">★ HOST</div>
                  )}
                  {p.id === playerId && (
                    <div className="bg-rose-400 text-white text-[12px] font-black px-2 py-0.5 rounded-full shadow-lg border-2 border-white">♥ YOU</div>
                  )}
                </div>

                <div className="relative inline-block h-full">
                  <img
                    src="https://i.imgur.com/3zyCq3U.png"//画像URL
                    alt=""
                    className="relative z-10 h-full w-auto object-contain brightness-[0.90] contrast-[1.2] drop-shadow-[0_10px_15px_rgba(0,0,0,0.6)]"
                  />
                </div>
              </div>

              {/* プレイヤー情報 (さらに拡大) */}
              <div className="flex flex-col items-center w-full gap-1 pb-1">
                <div
                  className="px-4 py-1 rounded-none text-[12px] font-black text-white shadow-sm leading-none"
                  style={{ backgroundColor: p.color }}
                >
                  {getColorLabel(p.color)}
                </div>
                <div className="text-sm font-black text-zinc-600 truncate max-w-full tracking-tight">
                  {p.name}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
