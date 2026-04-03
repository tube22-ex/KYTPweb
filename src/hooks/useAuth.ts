import { useState, useEffect } from 'react';
import { signIn } from '../services/sync';

export function useAuth() {
  const [playerId, setPlayerId] = useState<string>("");
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem('kytp_player_name') || 'User_' + Math.random().toString(36).substring(2, 6);
  });
  const [isAuthLoaded, setIsAuthLoaded] = useState(false);

  useEffect(() => {
    localStorage.setItem('kytp_player_name', playerName);
  }, [playerName]);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const uid = await signIn();
        setPlayerId(uid);
        setIsAuthLoaded(true);
      } catch (err) {
        console.error('Authentication failed:', err);
        const saved = localStorage.getItem('kytp_player_id') || Math.random().toString(36).substring(2, 10);
        localStorage.setItem('kytp_player_id', saved);
        setPlayerId(saved);
        setIsAuthLoaded(true);
      }
    };
    initAuth();
  }, []);

  return {
    playerId,
    playerName,
    setPlayerName,
    isAuthLoaded
  };
}
