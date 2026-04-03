import { useState, useEffect } from 'react';

export interface RegenHistoryEntry {
  id: string; // "YYYY-MM-DD HH:mm:ss"
  blocks: any[]; // MapBlock[]
}

const LS_KEY = (id: string) => `regen_history_${id}`;
const MAX_HIST = 20;

export function useEditorHistory(initialId: string | null) {
  const [history, setHistory] = useState<RegenHistoryEntry[]>([]);

  useEffect(() => {
    if (!initialId) {
      setHistory([]);
      return;
    }
    const saved = localStorage.getItem(LS_KEY(initialId));
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        setHistory([]);
      }
    } else {
      setHistory([]);
    }
  }, [initialId]);

  const addHistory = (blocks: any[]) => {
    if (!initialId) return;
    const now = new Date();
    const id = now.toLocaleString('ja-JP');
    const newEntry: RegenHistoryEntry = { id, blocks: JSON.parse(JSON.stringify(blocks)) };
    const newHistory = [newEntry, ...history].slice(0, MAX_HIST);
    setHistory(newHistory);
    localStorage.setItem(LS_KEY(initialId), JSON.stringify(newHistory));
  };

  const clearHistory = () => {
    if (!initialId) return;
    setHistory([]);
    localStorage.removeItem(LS_KEY(initialId));
  };

  return { history, addHistory, clearHistory };
}
