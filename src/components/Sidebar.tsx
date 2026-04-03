import React from 'react';
import { PlayedHistoryItem } from '../hooks/useHistory';

interface SidebarProps {
  showHistory: boolean;
  setShowHistory: (val: boolean) => void;
  history: PlayedHistoryItem[];
  onHistoryItemClick: (id: string) => void;
  selectedFont: string;
  setSelectedFont: (val: string) => void;
  volume: number;
  setVolume: (val: number) => void;
  seVolume: number;
  setSeVolume: (val: number) => void;
  hideVideo: boolean;
  setHideVideo: (val: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  showHistory, setShowHistory, history, onHistoryItemClick,
  selectedFont, setSelectedFont, volume, setVolume,
  seVolume, setSeVolume, hideVideo, setHideVideo
}) => {
  const HistoryCard = ({ item }: { item: PlayedHistoryItem }) => (
    <button
      onClick={() => onHistoryItemClick(item.id)}
      className="group flex gap-2 bg-white border border-rose-50 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all p-2 text-left active:scale-95 w-full overflow-hidden"
    >
      <div className="w-12 aspect-video flex-shrink-0 overflow-hidden bg-zinc-50 rounded-sm">
        <img src={item.thumbnail} alt="" className="w-full h-full object-cover grayscale-[0.2] group-hover:grayscale-0 transition-all scale-110 group-hover:scale-100" />
      </div>
      <div className="flex flex-col justify-center min-w-0 flex-1">
        <div className="text-[10px] font-black text-rose-300 mb-0 tabular-nums uppercase italic"># {item.id}</div>
        <div className="text-[12px] font-black text-zinc-500 truncate leading-tight group-hover:text-rose-400 transition-colors uppercase italic tracking-tighter">{item.title}</div>
      </div>
    </button>
  );

  return (
    <div className={`left-column relative h-full flex flex-row items-start ${showHistory ? 'has-history' : ''}`} style={{ flexShrink: 0 }}>
      <aside className={`relative flex flex-col h-full transition-all duration-200 ease-out overflow-hidden ${showHistory ? 'open' : ''}`}
        style={{ flexShrink: 0, width: showHistory ? '196px' : '0px' }}>
        <div className="w-[196px] flex flex-col h-full pr-1">
          <div className="flex items-center justify-between mb-3 ml-1 flex-shrink-0 pt-3">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-3 bg-rose-400 rounded-full"></div>
              <h2 className="text-[10px] font-black text-rose-300 uppercase tracking-[0.2em] italic">History</h2>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 pr-1 overflow-y-auto custom-scrollbar flex-1 pb-4">
            {history.map(item => <HistoryCard key={item.id} item={item} />)}
            <div className="mt-8 pr-1">
              <div className="flex items-center gap-1.5 mb-3 ml-1">
                <div className="w-1 h-3 bg-rose-400 rounded-full"></div>
                <h2 className="text-[8px] font-black text-rose-300 uppercase tracking-[0.2em] italic">Settings</h2>
              </div>
              <div className="bg-white border border-rose-50 shadow-sm p-3 flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-black text-rose-300 uppercase italic tracking-tighter">Font Style</label>
                  <select
                    value={selectedFont}
                    onChange={(e) => setSelectedFont(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-100 p-1.5 text-[10px] font-bold text-zinc-600 focus:outline-none focus:border-rose-200 appearance-none cursor-pointer"
                  >
                    <option value="'M PLUS Rounded 1c', sans-serif">Rounded (Default)</option>
                    <option value="'Zen Maru Gothic', sans-serif">Kawaii (Round)</option>
                    <option value="'Noto Sans JP', sans-serif">Modern (Gothic)</option>
                    <option value="'Shippori Mincho', serif">Elegant (Mincho)</option>
                    <option value="'Potta One', cursive">Pop (Bold)</option>
                    <option value="'Noto Sans Mono', monospace">Monospace (JP)</option>
                    <option value="'Orbitron', sans-serif">Digital (Futuristic)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5 mt-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[9px] font-black text-rose-300 uppercase italic tracking-tighter">BGM Volume</label>
                    <span className="text-[10px] font-black text-zinc-400 tabular-nums">{volume}%</span>
                  </div>
                  <input
                    type="range" min="0" max="100" value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="w-full h-1.5 bg-rose-100 rounded-lg appearance-none cursor-pointer accent-rose-400"
                  />
                </div>
                <div className="flex flex-col gap-1.5 mt-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[9px] font-black text-rose-300 uppercase italic tracking-tighter">SE Volume</label>
                    <span className="text-[10px] font-black text-zinc-400 tabular-nums">{seVolume}%</span>
                  </div>
                  <input
                    type="range" min="0" max="100" value={seVolume}
                    onChange={(e) => setSeVolume(Number(e.target.value))}
                    className="w-full h-1.5 bg-rose-100 rounded-lg appearance-none cursor-pointer accent-purple-400"
                  />
                </div>
                <div className="flex items-center justify-between mt-1">
                  <label className="text-[9px] font-black text-rose-300 uppercase italic">Hide Video</label>
                  <input type="checkbox" checked={hideVideo} onChange={e => setHideVideo(e.target.checked)} className="accent-rose-400" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="history-toggle-container">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="history-toggle-btn"
          title="履歴の表示切替"
        >
          <span className="text-[10px] tabular-nums">{showHistory ? '◀' : '▶'}</span>
        </button>
      </div>
    </div>
  );
};
