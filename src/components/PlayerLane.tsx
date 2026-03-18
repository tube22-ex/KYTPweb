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
    <div className="w-full flex flex-row justify-center items-stretch gap-3 mb-8">
      {players.map(p => (
        <div
          key={p.id}
          className={`flex-1 max-w-[220px] glass rounded-2xl flex flex-col transition-all duration-300 overflow-hidden ${
            p.id === playerId ? 'glow-blue ring-2 ring-blue-500/50 scale-105 z-10' : 'opacity-80'
          }`}
        >
          {/* ★キャラクター立ち絵エリア */}
          <div
            className="w-full aspect-[3/4] bg-black flex items-end justify-center relative overflow-hidden"
            style={{ borderBottom: `2px solid ${p.color}22` }}
          >
            {/* 画像未設定時のプレースホルダー */}
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ background: `linear-gradient(180deg, #000 60%, ${p.color}33 100%)` }}
            >
              <span
                className="text-5xl font-black opacity-20 select-none"
                style={{ color: p.color }}
              >
                {p.name.charAt(0).toUpperCase()}
              </span>
            </div>
            {/* プレイヤー色ライン（下部） */}
            <div className="absolute bottom-0 left-0 w-full h-0.5" style={{ backgroundColor: p.color }} />
          </div>

          {/* カード情報エリア */}
          <div className="p-3 flex flex-col gap-1.5">
            {/* 名前 */}
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
              <span className="font-black text-white truncate font-premium text-sm">{p.name}</span>
              {p.id === playerId && (
                <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-[8px] font-black rounded uppercase tracking-tighter ring-1 ring-blue-500/30 flex-shrink-0">You</span>
              )}
              {p.id === hostId && (
                <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[8px] font-black rounded uppercase tracking-tighter ring-1 ring-amber-500/30 flex-shrink-0">Host</span>
              )}
            </div>

            {/* 進行バー */}
            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden ring-1 ring-white/5">
              <div
                className="h-full transition-all duration-700 ease-out shadow-[0_0_10px_rgba(255,255,255,0.2)]"
                style={{
                  width: `${(p.currentLineIdx / 100) * 100}%`,
                  backgroundColor: p.color
                }}
              />
            </div>

            {/* コンボ / スコア */}
            <div className="flex justify-between items-center tabular-nums">
              <div className="flex gap-2">
                <span className="text-[9px] font-black text-white/40 uppercase">Combo</span>
                <span className="text-[9px] font-black text-orange-400">{p.combo} <span className="text-white/20">/</span> {p.maxCombo || 0}</span>
              </div>
              <div className="text-[10px] font-black text-white/80 font-premium">
                {p.score?.toLocaleString() || 0} <span className="text-[8px] text-white/30 ml-0.5">pts</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
