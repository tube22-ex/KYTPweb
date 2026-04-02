import React from 'react';
import { CHARACTERS } from '../constants/characters';
import { updatePlayerCharacter } from '../services/sync';

interface CharacterSelectorProps {
  roomId?: string;
  playerId?: string;
  currentCharacterId: string;
  onSelect?: (id: string) => void;
}

export const CharacterSelector: React.FC<CharacterSelectorProps> = ({
  roomId,
  playerId,
  currentCharacterId,
  onSelect
}) => {
  const handleSelect = (id: string) => {
    if (onSelect) {
      onSelect(id);
    } else if (roomId && playerId) {
      updatePlayerCharacter(roomId, playerId, id).catch(console.error);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 bg-white/40 backdrop-blur-sm border border-rose-100 rounded-xl shadow-sm">
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 bg-rose-400 rounded-full"></div>
        <h3 className="text-xs font-black text-rose-400 uppercase tracking-widest italic">
          Character Select
        </h3>
      </div>
      <div className="flex gap-4 justify-center">
        {Object.values(CHARACTERS).map((chara) => (
          <button
            key={chara.id}
            onClick={() => handleSelect(chara.id)}
            className={`
              relative group flex flex-col items-center gap-2 p-2 transition-all duration-300
              rounded-xl border-2
              ${currentCharacterId === chara.id 
                ? 'bg-rose-50 border-rose-400 scale-105 shadow-md' 
                : 'bg-white/50 border-transparent hover:bg-white hover:border-rose-200'}
            `}
          >
            <div className="relative w-24 h-24 overflow-hidden rounded-lg bg-zinc-50">
              <img
                src={chara.image}
                alt={chara.name}
                className={`
                  w-full h-full object-contain transition-all duration-500
                  ${currentCharacterId === chara.id ? 'scale-110' : 'group-hover:scale-105 grayscale-[0.2] group-hover:grayscale-0'}
                `}
              />
              {currentCharacterId === chara.id && (
                <div className="absolute inset-0 bg-rose-400/10 border-2 border-rose-400 rounded-lg pointer-events-none" />
              )}
            </div>
            <span className={`text-[11px] font-black tracking-tighter ${currentCharacterId === chara.id ? 'text-rose-500' : 'text-zinc-500'}`}>
              {chara.name}
            </span>
            {currentCharacterId === chara.id && (
              <div className="absolute -top-1 -right-1 bg-rose-400 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm animate-pulse">
                SELECTED
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};
