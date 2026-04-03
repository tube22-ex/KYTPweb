import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useRoom } from '../hooks/useRoom';
import { RoomState } from '../services/sync';

interface MultiplayerContextType {
  playerId: string;
  playerName: string;
  setPlayerName: (name: string) => void;
  selectedCharaId: string;
  setSelectedCharaId: (id: string) => void;
  isAuthLoaded: boolean;
  inRoom: boolean;
  roomId: string;
  roomInput: string;
  setRoomInput: (val: string) => void;
  roomState: RoomState | null;
  allRooms: Record<string, RoomState> | null;
  handleJoin: (id?: string) => Promise<void>;
  handleLeave: () => void;
  isHost: boolean;
  toDisplayRoomId: (id: string) => string;
}

const MultiplayerContext = createContext<MultiplayerContextType | undefined>(undefined);

export const MultiplayerProvider: React.FC<{ children: ReactNode }> = ({ 
  children 
}) => {
  const { playerId, playerName, setPlayerName, isAuthLoaded } = useAuth();
  
  // キャラクター選択ステート
  const [selectedCharaId, setSelectedCharaId] = useState(() => {
    return localStorage.getItem('kytp_character_id') || 'chara1';
  });

  useEffect(() => {
    localStorage.setItem('kytp_character_id', selectedCharaId);
  }, [selectedCharaId]);

  const room = useRoom({ playerId, playerName, selectedCharaId });

  const value: MultiplayerContextType = {
    playerId,
    playerName,
    setPlayerName,
    selectedCharaId,
    setSelectedCharaId,
    isAuthLoaded,
    ...room
  };

  return (
    <MultiplayerContext.Provider value={value}>
      {children}
    </MultiplayerContext.Provider>
  );
};

export const useMultiplayer = () => {
  const context = useContext(MultiplayerContext);
  if (context === undefined) {
    throw new Error('useMultiplayer must be used within a MultiplayerProvider');
  }
  return context;
};
