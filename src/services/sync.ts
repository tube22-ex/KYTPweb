import {
  ref, onValue, set, update, get,
  onDisconnect, remove
} from "firebase/database";
import { db, fs } from "../configs/firebase";
import {
  doc, getDoc, setDoc, collection,
  getDocs, query, limit, runTransaction,
  writeBatch, updateDoc
} from "firebase/firestore";

// ============================================================
// スロット定義
// ============================================================

export type SlotId = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";

export interface SlotData {
  slotId: SlotId;
  color: string;
  isHost: boolean;
  occupiedBy: string | null;
}

export const SLOT_CONFIG = [
  { slotId: "1" as SlotId, color: "#FF416C", isHost: true },
  { slotId: "2" as SlotId, color: "#2B86C5", isHost: false },
  { slotId: "3" as SlotId, color: "#3DFC64", isHost: false },
  { slotId: "4" as SlotId, color: "#FBD72B", isHost: false },
  { slotId: "5" as SlotId, color: "#A855F7", isHost: false },
  { slotId: "6" as SlotId, color: "#FF8C00", isHost: false },
  { slotId: "7" as SlotId, color: "#00BCD4", isHost: false },
  { slotId: "8" as SlotId, color: "#FF69B4", isHost: false },
];

// ============================================================
// 型定義
// ============================================================

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  slotId: SlotId;
  isHost: boolean;
  currentLineIdx: number;
  currentWordIdx: number;
  currentChunkIdx: number;
  chunkProgress: number;
  combo: number;
  maxCombo: number;
  score: number;
  isReady: boolean;
  isFinished: boolean;
  currentTyping: string;
  currentWord: string;
  joinedAt: number;
  lastSeen: number;
}

export interface RoomState {
  mapId: string | null;
  startTime: number | null;
  status: 'idle' | 'playing' | 'finished';
  sharedScore: number;
  sharedCombo: number;
  maxSharedCombo: number;
  globalLineIdx: number;
  globalChunkIdx: number;
  playbackTime: number;
  players: Record<string, PlayerState>;
  requests?: Record<string, {
    mapId: string;
    playerName: string;
    timestamp: number;
    title?: string;
    videoId?: string;
  }>;
}

// ============================================================
// Firestoreスロット管理
// ============================================================

/**
 * ルーム初回入室時にFirestoreのスロットを初期化します。
 */
const initRoomSlots = async (roomId: string): Promise<void> => {
  const batch = writeBatch(fs);
  for (const slot of SLOT_CONFIG) {
    batch.set(doc(fs, "rooms", roomId, "slots", slot.slotId), {
      slotId: slot.slotId,
      color: slot.color,
      isHost: slot.isHost,
      occupiedBy: null,
    });
  }
  await batch.commit();
};

/**
 * Firestoreトランザクションでスロットをアトミックに取得します。
 */
const acquireSlot = async (
  roomId: string,
  playerId: string
): Promise<SlotData> => {
  return await runTransaction(fs, async (tx) => {
    // 全スロットをトランザクション内で読み取り
    const slotDocs = await Promise.all(
      SLOT_CONFIG.map(s => tx.get(doc(fs, "rooms", roomId, "slots", s.slotId)))
    );

    // 既に自分のスロットがあれば再利用（再接続対応）
    for (const d of slotDocs) {
      const data = d.data() as SlotData;
      if (data?.occupiedBy === playerId) return data;
    }

    // 番号順に空きスロットを探す
    for (const d of slotDocs) {
      const data = d.data() as SlotData;
      if (data && data.occupiedBy === null) {
        tx.update(d.ref, { occupiedBy: playerId });
        return { ...data, occupiedBy: playerId };
      }
    }

    throw new Error("ROOM_FULL");
  });
};

/**
 * Firestoreのスロットを解放します。
 */
export const releaseSlot = async (
  roomId: string,
  slotId: SlotId
): Promise<void> => {
  try {
    const slotRef = doc(fs, "rooms", roomId, "slots", slotId);
    const snap = await getDoc(slotRef);
    if (snap.exists()) {
      await updateDoc(slotRef, { occupiedBy: null });
    }
  } catch (err) {
    console.warn("releaseSlot failed:", err);
  }
};

/**
 * Firestoreのルームを完全削除します（スロット含む）。
 */
const deleteFirestoreRoom = async (roomId: string): Promise<void> => {
  console.log("deleteFirestoreRoom called:", roomId); // ★
  try {
    const batch = writeBatch(fs);
    const slotsSnap = await getDocs(collection(fs, "rooms", roomId, "slots"));
    console.log("slots to delete:", slotsSnap.docs.length); // ★
    slotsSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(doc(fs, "rooms", roomId));
    await batch.commit();
    console.log("deleteFirestoreRoom done:", roomId); // ★
  } catch (err) {
    console.warn("deleteFirestoreRoom failed:", err); // ★
  }
};

// ============================================================
// 入退室
// ============================================================

/**
 * 部屋へ参加します。
 */
export const joinRoom = async (
  roomId: string,
  playerId: string,
  playerName: string
): Promise<{ color: string; isHost: boolean; slotId: SlotId }> => {
  console.log("joinRoom started:", { roomId, playerId, playerName });

  // Firestoreにスロットがなければ初期化
  const firstSlot = await getDoc(doc(fs, "rooms", roomId, "slots", "1"));
  if (!firstSlot.exists()) {
    await initRoomSlots(roomId);
  }

  // トランザクションでスロットを確保
  const slot = await acquireSlot(roomId, playerId);

  // RDBにプレイヤー情報を書き込み
  const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
  await set(playerRef, {
    id: playerId,
    name: playerName,
    color: slot.color,
    slotId: slot.slotId,
    isHost: slot.isHost,
    currentLineIdx: 0,
    currentWordIdx: 0,
    currentChunkIdx: 0,
    chunkProgress: 0,
    combo: 0,
    maxCombo: 0,
    score: 0,
    isReady: false,
    isFinished: false,
    currentTyping: "",
    currentWord: "",
    joinedAt: Date.now(),
    lastSeen: Date.now(),
  });

  // RDB切断時にプレイヤーを自動削除
  onDisconnect(playerRef).remove();

  console.log("joinRoom completed:", slot);
  return { color: slot.color, isHost: slot.isHost, slotId: slot.slotId };
};

/**
 * 部屋から退出します。
 */
export const leaveRoom = async (
  roomId: string,
  playerId: string,
  slotId: SlotId | null
): Promise<void> => {
  // Firestoreスロットを解放
  if (slotId) {
    await releaseSlot(roomId, slotId);
  }
  // RDBからプレイヤー削除
  await remove(ref(db, `rooms/${roomId}/players/${playerId}`));
  // 部屋が空なら削除
  await deleteRoomIfEmpty(roomId);
};

// ============================================================
// ホスト判定
// ============================================================

export const determineHostId = (
  players: Record<string, PlayerState> | undefined
): string | null => {
  if (!players) return null;
  const pList = Object.values(players);
  if (pList.length === 0) return null;
  const host = pList.find(p => p.isHost);
  if (host) return host.id;
  return pList.sort((a, b) => a.joinedAt - b.joinedAt)[0].id;
};

// ============================================================
// 部屋の削除
// ============================================================

/**
 * RDBにプレイヤーがいなければ部屋を完全削除します。
 */
export const deleteRoomIfEmpty = async (roomId: string): Promise<boolean> => {
  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  const isEmpty = !playersSnap.exists()
    || !playersSnap.val()
    || Object.keys(playersSnap.val()).length === 0;

  if (isEmpty) {
    // RDB削除
    await remove(ref(db, `rooms/${roomId}`));
    // Firestore削除（スロット含む）
    await deleteFirestoreRoom(roomId);
    return true;
  }
  return false;
};

// ============================================================
// プレイヤー進捗・状態更新
// ============================================================

export const updatePlayerProgress = async (
  roomId: string,
  playerId: string,
  lineIdx: number,
  wordIdx: number,
  combo: number,
  maxCombo: number,
  score: number,
  currentChunkIdx?: number,
  chunkProgress?: number,
  currentTyping?: string,
  currentWord?: string
) => {
  await update(ref(db, `rooms/${roomId}/players/${playerId}`), {
    currentLineIdx: lineIdx,
    currentWordIdx: wordIdx,
    currentChunkIdx: currentChunkIdx ?? 0,
    chunkProgress: chunkProgress ?? 0,
    combo,
    maxCombo,
    score,
    currentTyping: currentTyping ?? "",
    currentWord: currentWord ?? "",
    lastSeen: Date.now(),
  });
};

export const updatePlayerHeartbeat = async (roomId: string, playerId: string) => {
  const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
  const snap = await get(playerRef);
  if (snap.exists()) {
    await update(playerRef, { lastSeen: Date.now() });
  }
};

export const setPlayerFinished = async (roomId: string, playerId: string) => {
  await update(ref(db, `rooms/${roomId}/players/${playerId}`), { isFinished: true });
};

// ============================================================
// ルーム操作
// ============================================================

export const resetRoom = async (roomId: string) => {
  await update(ref(db, `rooms/${roomId}`), {
    status: "idle",
    startTime: null,
    sharedScore: 0,
    sharedCombo: 0,
    maxSharedCombo: 0,
    globalLineIdx: 0,
    globalChunkIdx: 0,
    mapId: null,
  });
};

export const setRoomMapId = async (roomId: string, mapId: string) => {
  await update(ref(db, `rooms/${roomId}`), {
    mapId,
    startTime: null,
    sharedScore: 0,
  });
};

export const setRoomStartTime = async (roomId: string) => {
  const { serverTimestamp } = await import("firebase/database");
  await update(ref(db, `rooms/${roomId}`), {
    startTime: serverTimestamp(),
    status: "playing",
    sharedScore: 0,
    sharedCombo: 0,
    maxSharedCombo: 0,
    globalLineIdx: 0,
    globalChunkIdx: 0,
    playbackTime: 0,
  });
};

export const incrementSharedScore = async (roomId: string, amount: number) => {
  await update(ref(db, `rooms/${roomId}`), { sharedScore: amount });
};

export const updateSharedCombo = async (roomId: string, combo: number, maxCombo: number) => {
  await update(ref(db, `rooms/${roomId}`), { sharedCombo: combo, maxSharedCombo: maxCombo });
};

export const updateGlobalProgress = async (roomId: string, lineIdx: number, chunkIdx: number) => {
  await update(ref(db, `rooms/${roomId}`), { globalLineIdx: lineIdx, globalChunkIdx: chunkIdx });
};

export const updateRoomPlayback = async (roomId: string, time: number) => {
  await update(ref(db, `rooms/${roomId}`), { playbackTime: time });
};

export const setRoomStatus = async (roomId: string, status: "idle" | "playing" | "finished") => {
  await update(ref(db, `rooms/${roomId}`), { status });
};

export const getRoomState = async (roomId: string): Promise<RoomState | null> => {
  const snapshot = await get(ref(db, `rooms/${roomId}`));
  return snapshot.exists() ? (snapshot.val() as RoomState) : null;
};

export const subscribeToRoom = (
  roomId: string,
  callback: (state: RoomState | null) => void
) => {
  return onValue(ref(db, `rooms/${roomId}`), async (snapshot) => {
    if (!snapshot.exists()) {
      // RDBの部屋が消えたらFirestoreも掃除
      await deleteFirestoreRoom(roomId);
      callback(null);
      return;
    }
    const state = snapshot.val() as RoomState;
    // プレイヤーが0人になったらFirestoreも掃除
    const playerCount = Object.keys(state.players || {}).length;
    if (playerCount === 0) {
      await deleteFirestoreRoom(roomId);
    }
    callback(state);
  });
};

export const getServerTimeOffset = (): Promise<number> => {
  return new Promise((resolve) => {
    onValue(ref(db, ".info/serverTimeOffset"), (snap) => {
      resolve(snap.val() || 0);
    }, { onlyOnce: true });
  });
};

export const subscribeToAllRooms = (
  callback: (rooms: Record<string, RoomState> | null) => void
) => {
  return onValue(ref(db, "rooms"), async (snapshot) => {
    if (!snapshot.exists()) {
      callback(null);
      return;
    }
    const rooms = snapshot.val() as Record<string, RoomState>;
    // 各部屋のプレイヤーが0人ならFirestoreも掃除
    for (const [rid, room] of Object.entries(rooms)) {
      const playerCount = Object.keys(room.players || {}).length;
      if (playerCount === 0) {
        await deleteFirestoreRoom(rid);
        await remove(ref(db, `rooms/${rid}`));
      }
    }
    callback(rooms);
  });
};

// ============================================================
// リクエスト
// ============================================================

export const requestMap = async (
  roomId: string,
  mapId: string,
  playerName: string,
  title?: string,
  videoId?: string
) => {
  const key = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  await set(ref(db, `rooms/${roomId}/requests/${key}`), {
    mapId,
    playerName,
    timestamp: Date.now(),
    title: title || null,
    videoId: videoId || null,
  });
};

export const removeRequest = async (roomId: string, requestId: string) => {
  await remove(ref(db, `rooms/${roomId}/requests/${requestId}`));
};

export const clearRequests = async (roomId: string) => {
  await remove(ref(db, `rooms/${roomId}/requests`));
};

// ============================================================
// 譜面キャッシュ（Firestore）
// ============================================================

export const getCachedMapData = async (mapId: string | number): Promise<any | null> => {
  const snap = await getDoc(doc(fs, "mapCache", String(mapId)));
  return snap.exists() ? snap.data() : null;
};

export const saveMapDataToCache = async (mapId: string | number, data: any) => {
  await setDoc(doc(fs, "mapCache", String(mapId)), data);
};

export const getAllCachedMaps = async (): Promise<any[]> => {
  console.log("getAllCachedMaps called");
  try {
    const snap = await getDocs(query(collection(fs, "mapCache"), limit(50)));
    console.log("getAllCachedMaps success, count:", snap.docs.length);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("getAllCachedMaps error:", err);
    throw err;
  }
};