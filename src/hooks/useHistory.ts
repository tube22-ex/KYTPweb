import { useState, useEffect } from 'react';
import { ParseResult } from '../services/api';

export interface PlayedHistoryItem {
  id: string;
  title: string;
  thumbnail: string;
  timestamp: number;
}

export function useHistory() {
  const [history, setHistory] = useState<PlayedHistoryItem[]>(() => {
    const saved = localStorage.getItem('kytp_history');
    return saved ? JSON.parse(saved) : [];
  });

  const [showHistory, setShowHistory] = useState(() => {
    return localStorage.getItem('kytp_show_history') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('kytp_show_history', showHistory.toString());
  }, [showHistory]);

  const saveToHistory = (data: ParseResult, mid: string) => {
    if (!data.videoId) return;
    const thumbnail = `https://img.youtube.com/vi/${data.videoId}/mqdefault.jpg`;
    const newItem: PlayedHistoryItem = {
      id: mid,
      title: data.title || 'Unknown Stage',
      thumbnail,
      timestamp: Date.now()
    };
    const newHistory = [newItem, ...history.filter(h => h.id !== mid)].slice(0, 5);
    setHistory(newHistory);
    localStorage.setItem('kytp_history', JSON.stringify(newHistory));
  };

  return {
    history,
    saveToHistory,
    showHistory,
    setShowHistory
  };
}
