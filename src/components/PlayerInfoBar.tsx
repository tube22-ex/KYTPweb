import React from 'react';
import { useMultiplayer } from '../contexts/MultiplayerContext';

interface PlayerInfoBarProps {}

export const PlayerInfoBar: React.FC<PlayerInfoBarProps> = () => {
  const { roomState, playerId, playerName, isHost } = useMultiplayer();
  if (!roomState) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-[#fff0f5] border-b-2 border-rose-400 flex-shrink-0 animate-in fade-in slide-in-from-top-1 duration-300">
      <div className="flex items-center gap-2 pr-3 border-r border-rose-100">
        <div
          className="w-3.5 h-3.5 rounded-full shadow-sm border border-white"
          style={{ background: roomState.players[playerId]?.color || '#ccc' }}
        />
        <span className="text-[14px] font-black text-zinc-700 italic tracking-tighter uppercase">{playerName}</span>
        <span className="text-[9px] font-black text-rose-300 bg-white px-1 rounded-sm border border-rose-50 shadow-sm leading-none py-0.5">YOU</span>
        {isHost && (
          <span className="text-[9px] font-black text-amber-400 bg-white px-1 rounded-sm border border-amber-100 shadow-sm leading-none py-0.5">★ HOST</span>
        )}
      </div>
      <div className="flex items-center gap-4 pl-1">
        {Object.values(roomState.players).filter(p => p.id !== playerId).map(p => (
          <div key={p.id} className="flex items-center gap-1.5 opacity-80 hover:opacity-100 transition-opacity">
            <div className="w-2.5 h-2.5 rounded-full border border-white shadow-[0_0_4px_rgba(0,0,0,0.1)]" style={{ background: p.color }} />
            <span className="text-[12px] font-bold text-zinc-500 italic tracking-tight">{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
