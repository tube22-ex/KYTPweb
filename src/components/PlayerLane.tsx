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
      case '#ef4444': return '赤';
      case '#3b82f6': return '青';
      case '#22c55e': return '緑';
      case '#eab308': return '黄';
      default: return '他';
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto relative">
      {/* 舞台エリア (かわいい系) */}
      <div className="relative w-full aspect-[21/4] overflow-hidden stage-floor-cute group bubble-bg rounded-none">
        {/* 装飾的な雲やキラキラなどを背景に追加可能 */}
        <div className="absolute top-4 left-10 w-24 h-8 bg-white/40 rounded-full blur-xl animate-pulse" />
        <div className="absolute bottom-10 right-20 w-32 h-12 bg-white/30 rounded-full blur-2xl animate-pulse" style={{ animationDelay: '1s' }} />

        {/* プレイヤー整列 */}
        <div className="absolute inset-0 flex items-end justify-center px-16 pb-2 gap-12 z-20">
          {players.map(p => (
            <div key={p.id} className="flex-1 flex flex-col items-center transition-all duration-500 hover:scale-110">
              {/* キャラクター（立ち絵風アバター） */}
              <div className="relative w-14 aspect-square flex items-center justify-center mb-2">
                <div 
                  className="w-full h-full flex items-center justify-center rounded-none relative overflow-hidden shadow-lg transform rotate-3 hover:rotate-0 transition-transform"
                  style={{ 
                    background: `white`, 
                    border: `3px solid ${p.color}aa`,
                    boxShadow: p.id === playerId ? `0 0 20px ${p.color}44` : 'none'
                  }}
                >
                  <span className="text-3xl font-black select-none" style={{ color: p.color }}>
                    {p.name.charAt(0).toUpperCase()}
                  </span>

                  {/* ホスト/YOUタグ (かわいいバッジ風) */}
                  <div className="absolute top-0.5 right-0.5 flex flex-col gap-0.5 items-end">
                    {p.id === hostId && (
                      <div className="bg-amber-400 text-white text-[8px] font-black px-1.5 rounded-full shadow-sm leading-tight border border-white">★</div>
                    )}
                    {p.id === playerId && (
                      <div className="bg-rose-400 text-white text-[8px] font-black px-1.5 rounded-full shadow-sm leading-tight border border-white">♥</div>
                    )}
                  </div>
                </div>
              </div>

              {/* プレイヤー情報ラベル (ぷっくりしたピル形状) */}
              <div className="flex flex-col items-center w-full gap-1">
                <div 
                  className="px-3 py-0.5 rounded-none text-[10px] font-black text-white shadow-sm flex items-center gap-1 leading-none"
                  style={{ backgroundColor: p.color }}
                >
                   {getColorLabel(p.color)}
                </div>
                <div className="text-[10px] font-black text-zinc-600 truncate max-w-full tracking-tight">
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
