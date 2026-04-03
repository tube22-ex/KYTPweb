import React, { useEffect, useRef } from 'react';
import { ParseResult } from '../services/api';

interface GuideProps {
  showGuide: boolean;
  setShowGuide: (val: boolean) => void;
  mapData: ParseResult | null;
  activeBlockIdx: number;
}

export const Guide: React.FC<GuideProps> = ({
  showGuide, setShowGuide, mapData, activeBlockIdx
}) => {
  const guideRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (guideRef.current && showGuide) {
      const activeBlock = guideRef.current.querySelector('.guide-block-active');
      if (activeBlock) {
        guideRef.current.scrollTo({
          top: (activeBlock as HTMLElement).offsetTop,
          behavior: 'smooth'
        });
      }
    }
  }, [activeBlockIdx, showGuide]);

  return (
    <div className={`right-column guide-column relative h-full flex flex-row items-start ${showGuide ? 'has-guide' : ''}`} style={{ flexShrink: 0 }}>
      <button
        onClick={() => setShowGuide(!showGuide)}
        className="guide-toggle flex h-12 w-6 bg-white border border-rose-100 border-r-0 items-center justify-center text-rose-300 hover:bg-rose-50 hover:text-rose-500 transition-all z-30 shadow-sm mt-4 rounded-l-md"
        title={showGuide ? "ガイドを閉じる" : "ガイドを開く"}
      >
        <span className="text-[10px] tabular-nums">{showGuide ? '▶' : '◀'}</span>
      </button>
      <aside className={`relative flex flex-col h-full transition-all duration-200 ease-out overflow-hidden ${showGuide ? 'open' : ''}`}
        style={{
          width: showGuide ? '290px' : '0px',
          minWidth: showGuide ? '290px' : '0px',
          maxWidth: showGuide ? '290px' : '0px',
          flexShrink: 0,
          alignSelf: 'stretch',
          overflow: 'hidden',
          borderLeft: showGuide ? '2px solid #fee' : 'none',
        }}>
        <div className="guide-blocks custom-scrollbar h-full overflow-y-auto" ref={guideRef} style={{ width: '290px' }}>
          <div className="flex items-center gap-1.5 mb-3 ml-1 flex-shrink-0 pt-3">
            <div className="w-1.5 h-3 bg-purple-400 rounded-full"></div>
            <h2 className="text-[10px] font-black text-purple-300 uppercase tracking-[0.2em] italic">Guide</h2>
          </div>
          <div className="flex flex-col gap-2">
            {mapData?.displaySets.map((set, idx) => (
              <button
                key={idx}
                className={`group relative p-3 border-l-4 transition-all text-left ${activeBlockIdx === idx
                  ? 'bg-rose-50 border-rose-400 shadow-md translate-x-1 guide-block-active'
                  : 'bg-white border-zinc-100 hover:bg-zinc-50 hover:border-zinc-300'
                  }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-[10px] font-black italic ${activeBlockIdx === idx ? 'text-rose-400' : 'text-zinc-300'}`}>BLOCK {String(idx + 1).padStart(2, '0')}</span>
                  <span className="text-[9px] font-bold text-zinc-300 tabular-nums">
                    {Math.floor(set.timeMs / 1000 / 60)}:{String(Math.floor((set.timeMs / 1000) % 60)).padStart(2, '0')}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 mt-2">
                  {set.lines.slice(0, 4).map((line: any, lIdx: number) => (
                    <div
                      key={lIdx}
                      className={`text-[11px] font-bold leading-tight pb-1 ${activeBlockIdx === idx ? 'text-rose-900' : 'text-zinc-500'
                        } ${lIdx < Math.min(set.lines.length, 4) - 1 ? 'border-b border-zinc-100/50' : ''}`}
                    >
                      {line.chunks.map((c: any) => c.text).join('　') || '...'}
                    </div>
                  ))}
                  {set.lines.length > 4 && (
                    <div className="text-[9px] font-bold text-zinc-300 italic">... and {set.lines.length - 4} more</div>
                  )}
                </div>
                {activeBlockIdx === idx && (
                  <div className="absolute top-0 right-1 h-full w-1 bg-rose-400 rounded-full"></div>
                )}
              </button>
            ))}
            {mapData && (
              <div style={{ minHeight: '400px', flexShrink: 0 }} />
            )}
          </div>
        </div>
      </aside>
    </div>
  );
};
