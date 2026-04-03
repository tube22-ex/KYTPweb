import { useState, useEffect, useRef } from 'react';
import { 
  RoomState, 
  joinRoom, 
  subscribeToRoom, 
  getRoomState, 
  deleteRoomIfEmpty, 
  subscribeToAllRooms, 
  updatePlayerHeartbeat, 
  releaseSlot,
  SlotId,
  leaveRoom as cleanupPlayer,
  determineHostId
} from '../services/sync';

interface UseRoomProps {
  playerId: string;
  playerName: string;
  selectedCharaId: string;
}

export function useRoom({ playerId, playerName, selectedCharaId }: UseRoomProps) {
  const [inRoom, setInRoom] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [allRooms, setAllRooms] = useState<Record<string, RoomState> | null>(null);
  const [mySlotId, setMySlotId] = useState<SlotId | null>(null);
  const hasPrefilledRef = useRef(false);

  // ユーザー入力のルームIDにプレフィックスを付けてFirebase用IDに変換
  const toFirebaseRoomId = (rawId: string) => `room-${rawId}`;
  const toDisplayRoomId = (firebaseId: string) => firebaseId.replace(/^room-/, '');

  // 全ルーム情報の購読
  useEffect(() => {
    if (!inRoom) {
      hasPrefilledRef.current = false;
      const unsub = subscribeToAllRooms((rooms) => {
        setAllRooms(rooms);
        if (!hasPrefilledRef.current) {
          if (!rooms || Object.keys(rooms).length === 0) {
            setRoomInput(prev => prev === '' ? '部屋' : prev);
          }
          hasPrefilledRef.current = true;
        }
        // Ghost player cleanup
        if (rooms) {
          const now = Date.now();
          Object.keys(rooms).forEach(rid => {
            const r = rooms[rid];
            const pIds = Object.keys(r.players || {});
            if (pIds.length === 0) {
              deleteRoomIfEmpty(rid);
              return;
            }
            pIds.forEach(pid => {
              const p = r.players[pid];
              if (now - (p.lastSeen || 0) > 180000) {
                const ghostSlotId = (p as any).slotId as SlotId | undefined;
                cleanupPlayer(rid, pid, ghostSlotId ?? null);
              }
            });
          });
        }
      });
      return unsub;
    }
  }, [inRoom]);

  // 個別ルームの購読
  useEffect(() => {
    if (inRoom && roomId) {
      const unsub = subscribeToRoom(roomId, (state) => {
        setRoomState(state);
      });
      return () => {
        unsub();
        setRoomState(null);
      };
    }
  }, [inRoom, roomId]);

  // ハートビート
  useEffect(() => {
    if (inRoom && roomId && playerId) {
      const interval = setInterval(() => {
        updatePlayerHeartbeat(roomId, playerId);
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [inRoom, roomId, playerId]);

  // 退室検知 (パージ等)
  useEffect(() => {
    if (inRoom && roomState && playerId && roomState.players && !roomState.players[playerId]) {
      handleLeave();
      alert('長時間操作がなかったため、自動的に退室しました。');
    }
  }, [inRoom, roomState, playerId]);

  // Unload時のスロット解放
  useEffect(() => {
    if (!inRoom || !roomId || !playerId || !mySlotId) return;
    const handleUnload = () => {
      releaseSlot(roomId, mySlotId);
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [inRoom, roomId, playerId, mySlotId]);

  const handleJoin = async (targetId: string = roomInput) => {
    const trimmed = targetId.trim();
    if (!trimmed || !playerName.trim()) return;
    const idToJoin = toFirebaseRoomId(trimmed);

    try {
      await deleteRoomIfEmpty(idToJoin);
      const currentState = await getRoomState(idToJoin);
      if (currentState?.status === 'playing') {
        alert('プレイ中の部屋には入室できません。');
        return;
      }

      const { slotId } = await joinRoom(idToJoin, playerId, playerName, selectedCharaId);
      setMySlotId(slotId);
      setRoomId(idToJoin);
      setInRoom(true);
    } catch (err: any) {
      console.error('Failed to join room:', err);
      if (err.message === 'ROOM_FULL') {
        alert('この部屋は満員です（最大8名）。');
      } else {
        alert('入室に失敗しました。');
      }
    }
  };

  const handleLeave = () => {
    setInRoom(false);
    setRoomId('');
    setRoomState(null);
    setMySlotId(null);
  };

  const isHost = determineHostId(roomState?.players) === playerId;

  return {
    inRoom, setInRoom,
    roomId, setRoomId,
    roomInput, setRoomInput,
    roomState,
    allRooms,
    mySlotId,
    handleJoin,
    handleLeave,
    isHost,
    toDisplayRoomId
  };
}
