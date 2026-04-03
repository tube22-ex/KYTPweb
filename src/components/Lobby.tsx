import { useMultiplayer } from '../contexts/MultiplayerContext';
import { CharacterSelector } from './CharacterSelector';

interface LobbyProps {}

export const Lobby: React.FC<LobbyProps> = () => {
  const {
    roomInput, setRoomInput, playerName, setPlayerName,
    allRooms, handleJoin, toDisplayRoomId,
    selectedCharaId, setSelectedCharaId
  } = useMultiplayer();

  const onJoin = handleJoin; // Alias for compatibility
  return (
    <div className="bg-white border-4 border-white shadow-xl p-8 rounded-none w-full max-w-md mx-auto relative z-10 overflow-hidden bubble-bg animate-in zoom-in-95 duration-500">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-rose-400 to-purple-400"></div>
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-black font-premium text-zinc-700 italic uppercase tracking-tighter mb-1">部屋選択</h1>
        <p className="text-[10px] text-rose-300 font-black uppercase tracking-[0.2em]">部屋名を入力して入室</p>
      </div>
      <div className="flex flex-col gap-4">
        <button
          onClick={() => onJoin()}
          className="w-full py-4 bg-rose-400 hover:bg-rose-500 text-white font-black shadow-lg transition-all active:scale-95 text-sm uppercase font-premium"
        >
          入室
        </button>

        <div className="flex flex-col gap-2">
          <input
            type="text"
            placeholder="ルームID"
            value={roomInput}
            onChange={e => setRoomInput(e.target.value)}
            className="px-4 py-3 rounded-none bg-zinc-50 border-2 border-zinc-100 focus:outline-none focus:border-rose-300 focus:bg-white transition-all font-black text-zinc-700 shadow-inner text-sm"
          />
          <input
            type="text"
            placeholder="プレイヤー名"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            className="px-4 py-3 rounded-none bg-zinc-50 border-2 border-zinc-100 focus:outline-none focus:border-rose-300 focus:bg-white transition-all font-black text-zinc-700 shadow-inner text-sm"
          />
        </div>

        <div className="pt-2 border-t border-zinc-100">
          <div className="flex items-center gap-1.5 mb-2 ml-1">
            <div className="w-1 h-3 bg-rose-300 rounded-full"></div>
            <h2 className="text-[9px] font-black text-rose-300 uppercase tracking-[0.2em] italic">Active Rooms</h2>
          </div>
          {!allRooms || Object.keys(allRooms).length === 0 ? (
            <div className="text-[10px] text-zinc-300 italic text-center py-4 bg-zinc-50 border border-dashed border-zinc-200">
              現在稼働中の部屋はありません
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
              {Object.entries(allRooms).map(([rid, state]) => {
                const pCount = Object.keys(state.players || {}).length;
                const isPlaying = state.status === 'playing';
                return (
                  <button
                    key={rid}
                    onClick={() => setRoomInput(toDisplayRoomId(rid))}
                    onDoubleClick={() => {
                      if (!isPlaying) onJoin(toDisplayRoomId(rid));
                      else alert('プレイ中の部屋には入室できません。');
                    }}
                    className="flex items-center justify-between p-2 bg-zinc-50 border border-zinc-100 hover:border-rose-200 hover:bg-white transition-all group"
                  >
                    <div className="flex items-center gap-2">
                       <span className="text-[11px] font-black text-zinc-500 group-hover:text-rose-400 uppercase italic">
                         {toDisplayRoomId(rid)}
                       </span>
                       {isPlaying && (
                         <span className="text-[8px] font-black text-rose-300 bg-white px-1 border border-rose-100 animate-pulse">PLAYING</span>
                       )}
                    </div>
                    <span className="text-[10px] font-bold text-zinc-400 tabular-nums">{pCount} / 8</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        
        <div className="pt-4 border-t border-zinc-100">
          <div className="flex items-center gap-1.5 mb-3 ml-1">
            <div className="w-1 h-3 bg-rose-400 rounded-full"></div>
            <h2 className="text-[9px] font-black text-rose-300 uppercase tracking-[0.2em] italic">Character</h2>
          </div>
          <CharacterSelector currentCharacterId={selectedCharaId} onSelect={setSelectedCharaId} />
        </div>
      </div>
    </div>
  );
};
