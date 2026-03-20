import { ref, onValue, set, update, get, onDisconnect, remove } from "firebase/database";
import { db, fs } from "../configs/firebase";
import {
  doc, getDoc, setDoc, collection, getDocs,
  query, limit, runTransaction, writeBatch, updateDoc
} from "firebase/firestore";

// ============================================================
// スロット定義（色・ホスト情報を一元管理）
// ★ PLAYER_COLORS を廃止し、こちらに集約
// ============================================================
export type SlotId = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";

export interface SlotData {
  slotId: SlotId;
  color: string;
  isHost: boolean;
  occupiedBy: string | null; // playerId or null
}

// スロット番号 → 色・ホストフラグの対応表
// PlayerLane.tsx の getColorLabel と色を合わせています
export const SLOT_CONFIG = [
  { slotId: "1", color: "#FF416C", isHost: true },
  { slotId: "2", color: "#2B86C5", isHost: false },
  { slotId: "3", color: "#3DFC64", isHost: false },
  { slotId: "4", color: "#FBD72B", isHost: false },
  { slotId: "5", color: "#A855F7", isHost: false },
  { slotId: "6", color: "#FF8C00", isHost: false },
  { slotId: "7", color: "#00BCD4", isHost: false },
  { slotId: "8", color: "#FF69B4", isHost: false },
] as const;



// ============================================================
// プレイヤー・ルームの型定義
// ============================================================

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  slotId: SlotId;    // ★ 追加: スロットID（退室時のFirestore解放に使用）
  isHost: boolean;   // ★ 追加: ホストフラグ（joinedAtソートを廃止）
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
}

// ============================================================
// Firestoreスロット管理（内部ヘルパー）
// ============================================================

/**
 * ルーム作成時にFirestoreのスロットを初期化します。
 * 全スロットを occupiedBy: null で用意します。
 */
const initRoomSlots = async (roomId: string): Promise<void> => {
  const batch = writeBatch(fs);
  for (const slot of SLOT_CONFIG) {
    const slotRef = doc(fs, "rooms", roomId, "slots", slot.slotId);
    batch.set(slotRef, { ...slot, occupiedBy: null });
  }
  await batch.commit();
};

/**
 * Firestoreトランザクションでスロットをアトミックに取得します。
 * 同時入室の競合は runTransaction が自動リトライします。
 */
const acquireSlot = async (roomId: string, playerId: string): Promise<SlotData> => {
  return await runTransaction(fs, async (tx) => {
    // スロットを番号順に全取得（固定4件）
    const slotDocs = await Promise.all(
      SLOT_CONFIG.map(s => tx.get(doc(fs, "rooms", roomId, "slots", s.slotId)))
    );
    const slots: SlotData[] = slotDocs.map(d => d.data() as SlotData);

    // 既に自分が入っているスロットがあれば再利用（再接続対応）
    const mySlot = slots.find(s => s.occupiedBy === playerId);
    if (mySlot) return mySlot;

    // 番号が若い順に空きスロットを探す
    const available = slots.find(s => s.occupiedBy === null);
    if (!available) throw new Error("ROOM_FULL");

    // アトミックに占有
    const slotRef = doc(fs, "rooms", roomId, "slots", available.slotId);
    tx.update(slotRef, { occupiedBy: playerId });

    return { ...available, occupiedBy: playerId };
  });
};

/**
 * Firestoreのスロットを解放します（退室・切断時）。
 */
export const releaseSlot = async (roomId: string, slotId: SlotId): Promise<void> => {
  try {
    const slotRef = doc(fs, "rooms", roomId, "slots", slotId);
    const snap = await getDoc(slotRef);
    if (snap.exists()) {
      await updateDoc(slotRef, { occupiedBy: null });
    }
  } catch (err) {
    // 部屋ごと削除済みの場合などは無視
    console.warn("releaseSlot: slot may already be gone", err);
  }
};

// ============================================================
// 入退室
// ============================================================

/**
 * 部屋へ参加します。
 * ★ color引数を廃止 → Firestoreスロットから色を決定します。
 * 戻り値で color / isHost / slotId を返します。
 */
export const joinRoom = async (
  roomId: string,
  playerId: string,
  playerName: string
): Promise<{ color: string; isHost: boolean; slotId: SlotId }> => {
  console.log("joinRoom started:", { roomId, playerId, playerName });

  // スロットが存在しない（初回入室）なら初期化
  const firstSlotSnap = await getDoc(doc(fs, "rooms", roomId, "slots", "1"));
  if (!firstSlotSnap.exists()) {
    await initRoomSlots(roomId);
  }

  // トランザクションでスロットをアトミックに確保
  const slot = await acquireSlot(roomId, playerId);

  // RDBにプレイヤー情報を書き込む
  const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
  await set(playerRef, {
    id: playerId,
    name: playerName,
    color: slot.color,     // Firestoreスロットから取得した色
    slotId: slot.slotId,   // スロットID（退室時の解放に使用）
    isHost: slot.isHost,   // ホストフラグ
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
    joinedAt: Date.now(),  // ★ serverTimestamp をやめ Date.now() に統一（即時確定）
    lastSeen: Date.now(),
  });

  // RDB切断時にプレイヤー情報を自動削除
  onDisconnect(playerRef).remove();

  // タブを閉じたときにFirestoreスロットも解放
  // （onDisconnect はFirestoreに対応していないため beforeunload で補完）
  const handleUnload = () => releaseSlot(roomId, slot.slotId);
  window.addEventListener("beforeunload", handleUnload, { once: true });

  console.log("joinRoom completed:", slot);
  return { color: slot.color, isHost: slot.isHost, slotId: slot.slotId };
};

/**
 * 部屋から退出します。
 * ★ slotId引数を追加 → Firestoreスロットを解放します。
 */
export const leaveRoom = async (
  roomId: string,
  playerId: string,
  slotId: SlotId | null  // ghostプレイヤー削除時はnullの場合がある
): Promise<void> => {
  // Firestoreスロットを解放
  if (slotId) {
    await releaseSlot(roomId, slotId);
  }

  // RDBからプレイヤー削除
  const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
  await remove(playerRef);

  // 部屋が空なら削除
  await deleteRoomIfEmpty(roomId);
};

// ============================================================
// ホスト判定
// ============================================================

/**
 * ホストプレイヤーのIDを返します。
 * ★ joinedAtソートを廃止 → RDBの isHost フラグを参照します。
 */
export const determineHostId = (
  players: Record<string, PlayerState> | undefined
): string | null => {
  if (!players) return null;
  const host = Object.values(players).find(p => p.isHost);
  return host?.id ?? null;
};

// ============================================================
// プレイヤー進捗・状態更新
// ============================================================

/**
 * 自分の打鍵進捗を送信します。
 */
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
  const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
  await update(playerRef, {
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

/**
 * プレイヤーの生存確認（ハートビート）を更新します。
 */
export const updatePlayerHeartbeat = async (roomId: string, playerId: string) => {
  const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
  const snap = await get(playerRef);
  if (snap.exists()) {
    await update(playerRef, { lastSeen: Date.now() });
  }
};

/**
 * プレイヤーの完了状態を更新します。
 */
export const setPlayerFinished = async (roomId: string, playerId: string) => {
  const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
  await update(playerRef, { isFinished: true });
};

/**
 * 部屋が空なら部屋ごと削除します。
 */
export const deleteRoomIfEmpty = async (roomId: string): Promise<boolean> => {
  const playersRef = ref(db, `rooms/${roomId}/players`);
  const snapshot = await get(playersRef);
  if (!snapshot.exists() || !snapshot.val() || Object.keys(snapshot.val()).length === 0) {
    await remove(ref(db, `rooms/${roomId}`));
    return true;
  }
  return false;
};

// ============================================================
// ルーム操作
// ============================================================

/**
 * 部屋を初期状態（ロビー）に戻します。
 */
export const resetRoom = async (roomId: string) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, {
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

/**
 * 曲IDを変更します。（ホスト用）
 */
export const setRoomMapId = async (roomId: string, mapId: string) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, {
    mapId,
    startTime: null,
    sharedScore: 0,
  });
};

/**
 * プレイを開始し、サーバー時刻を書き込みます。
 */
export const setRoomStartTime = async (roomId: string) => {
  const { serverTimestamp } = await import("firebase/database");
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, {
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

/**
 * 共有スコアを更新します。
 */
export const incrementSharedScore = async (roomId: string, amount: number) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, { sharedScore: amount });
};

/**
 * 共有コンボを更新します。
 */
export const updateSharedCombo = async (roomId: string, combo: number, maxCombo: number) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, { sharedCombo: combo, maxSharedCombo: maxCombo });
};

/**
 * 部屋全体のタイピング進捗を更新します。
 */
export const updateGlobalProgress = async (roomId: string, lineIdx: number, chunkIdx: number) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, { globalLineIdx: lineIdx, globalChunkIdx: chunkIdx });
};

/**
 * 再生時間を更新します。（ホスト用）
 */
export const updateRoomPlayback = async (roomId: string, time: number) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, { playbackTime: time });
};

/**
 * 部屋のステータスを変更します。
 */
export const setRoomStatus = async (roomId: string, status: "idle" | "playing" | "finished") => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, { status });
};

/**
 * 部屋の状態を1回だけ取得します。
 */
export const getRoomState = async (roomId: string): Promise<RoomState | null> => {
  const roomRef = ref(db, `rooms/${roomId}`);
  const snapshot = await get(roomRef);
  return snapshot.exists() ? (snapshot.val() as RoomState) : null;
};

/**
 * 部屋のステートを購読します。
 */
export const subscribeToRoom = (
  roomId: string,
  callback: (state: RoomState | null) => void
) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  return onValue(roomRef, (snapshot) => {
    callback(snapshot.exists() ? (snapshot.val() as RoomState) : null);
  });
};

/**
 * ローカル時計とFirebaseサーバーのズレを取得します。
 */
export const getServerTimeOffset = (): Promise<number> => {
  return new Promise((resolve) => {
    const offsetRef = ref(db, ".info/serverTimeOffset");
    onValue(offsetRef, (snap) => resolve(snap.val() || 0), { onlyOnce: true });
  });
};

// ============================================================
// 譜面キャッシュ
// ============================================================

export const getCachedMapData = async (mapId: string | number): Promise<any | null> => {
  const docRef = doc(fs, "mapCache", String(mapId));
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
};

export const saveMapDataToCache = async (mapId: string | number, data: any) => {
  const docRef = doc(fs, "mapCache", String(mapId));
  await setDoc(docRef, data);
};

export const getAllCachedMaps = async (): Promise<any[]> => {
  console.log("getAllCachedMaps called");
  const cacheRef = collection(fs, "mapCache");
  const q = query(cacheRef, limit(50));
  try {
    const snap = await getDocs(q);
    console.log("getAllCachedMaps success, count:", snap.docs.length);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("getAllCachedMaps error:", err);
    throw err;
  }
};

/**
 * 全ての部屋リストを購読します。
 */
export const subscribeToAllRooms = (
  callback: (rooms: Record<string, RoomState> | null) => void
) => {
  const roomsRef = ref(db, "rooms");
  return onValue(roomsRef, (snapshot) => {
    callback(snapshot.exists() ? (snapshot.val() as Record<string, RoomState>) : null);
  });
};