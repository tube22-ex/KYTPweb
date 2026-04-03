import React from 'react';

export const AppHeader: React.FC = () => {
  return (
    <header className="flex flex-col items-center relative z-10 w-full text-center flex-shrink-0" style={{ height: '70px', paddingTop: '10px' }}>
      <h1 className="text-3xl font-black mb-0 font-premium bg-clip-text text-transparent bg-gradient-to-br from-rose-400 via-rose-500 to-purple-500 tracking-tighter drop-shadow-sm leading-none">
        通うタイピング
      </h1>
      <div className="flex items-center justify-center gap-1.5 mt-1">
        <div className="h-[1px] w-6 bg-rose-200"></div>
        <p className="text-[7px] font-black uppercase tracking-[0.5em] text-rose-400 font-premium">Browser Edition</p>
        <div className="h-[1px] w-6 bg-rose-200"></div>
      </div>
    </header>
  );
};
