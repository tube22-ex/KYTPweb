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
      {/* 舞台エリア (さらに薄く調整) */}
      <div className="relative w-full aspect-[21/3] overflow-hidden stage-floor-cute group bubble-bg rounded-none border-x-4 border-white shadow-inner">
        {/* 装飾的な雲やキラキラなどを背景に追加可能 */}
        <div className="absolute top-4 left-10 w-24 h-8 bg-white/40 rounded-full blur-xl animate-pulse" />
        <div className="absolute bottom-10 right-20 w-32 h-12 bg-white/30 rounded-full blur-2xl animate-pulse" style={{ animationDelay: '1s' }} />

        {/* プレイヤー整列 */}
        <div className="absolute inset-0 flex items-end justify-center px-16 pb-0 gap-12 z-20">
          {players.map(p => (
            <div key={p.id} className="flex-1 flex flex-col items-center transition-all duration-500 hover:scale-110 relative">
              {/* キャラクター (高さを抑える) */}
              <div className="relative h-24 w-full flex flex-col items-center justify-end">
                {/* ホスト/YOUタグ (さらに強調) */}
                <div className="absolute -top-4 right-1/2 translate-x-12 flex flex-col gap-1 items-end z-30">
                  {p.id === hostId && (
                    <div className="bg-amber-400 text-white text-[12px] font-black px-2 py-0.5 rounded-full shadow-lg border-2 border-white animate-bounce">★ HOST</div>
                  )}
                  {p.id === playerId && (
                    <div className="bg-rose-400 text-white text-[12px] font-black px-2 py-0.5 rounded-full shadow-lg border-2 border-white">♥ YOU</div>
                  )}
                </div>

                <img
                  src="https://proxy.misskeyusercontent.jp/avatar.webp?url=https%3A%2F%2Fmedia.misskeyusercontent.jp%2Fio%2F93adc6b2-1440-427f-98ae-f66f32477d4d.webp&avatar=1"
                  alt=""
                  className="h-full w-auto object-contain drop-shadow-[0_5px_10px_rgba(0,0,0,0.2)]"
                />
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
