import { ref, onValue, set, update, serverTimestamp, get, onDisconnect, remove } from "firebase/database";
import { db, fs } from "../configs/firebase";
import { doc, getDoc, setDoc, collection, getDocs, query, limit } from "firebase/firestore";

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  currentLineIdx: number;
  currentWordIdx: number;
  currentChunkIdx: number;
  chunkProgress: number;
  combo: number;
  maxCombo: number;
  score: number;
  isReady: boolean;
  isFinished: boolean;
  currentTyping: string;  // 追加: 入力済みひらがな
  currentWord: string;    // 追加: 現在入力中の単語全体
  joinedAt: number;      // 追加: 入室時刻（ホスト判定用）
  lastSeen: number;      // 追加: 生存確認用タイムスタンプ
}

export const PLAYER_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#e91e63',
  '#00bcd4', '#8bc34a', '#ff5722', '#607d8b',
  '#795548', '#673ab7', '#009688', '#cddc39'
];

export interface RoomState {
  mapId: string | null;
  startTime: number | null;
  status: 'idle' | 'playing' | 'finished';
  sharedScore: number;
  sharedCombo: number;      // チーム合計コンボ（ブロック単位）
  maxSharedCombo: number;   // チーム最大合計コンボ
  globalLineIdx: number;    // 現在入力対象の絶対行番号
  globalChunkIdx: number;   // 現在入力対象のチャンク番号
  playbackTime: number;     // 追加: 現在の再生時間（秒）
  players: Record<string, PlayerState>;
}

/**
 * 部屋へプレイヤーとして参加（または初期化）します。
 */
export const joinRoom = async (roomId: string, playerId: string, playerName: string, color: string) => {
  console.log('joinRoom started:', { roomId, playerId, playerName });
  try {
    const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
    console.log('Sending set request to Firebase...');
    await set(playerRef, {
      id: playerId,
      name: playerName,
      color,
      currentLineIdx: 0,
      currentWordIdx: 0,
      currentChunkIdx: 0,
      chunkProgress: 0,
      combo: 0,
      maxCombo: 0,
      score: 0,
      isReady: false,
      isFinished: false,
      currentTyping: '',
      currentWord: '',
      joinedAt: serverTimestamp() as any, // Firebaseサーバー時刻
      lastSeen: Date.now()
    });
    // 接続が切れたらプレイヤー情報を自動削除
    onDisconnect(playerRef).remove();
    console.log('joinRoom successfully completed');
  } catch (error) {
    console.error('Error in joinRoom:', error);
    throw error;
  }
};

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
    combo: combo,
    maxCombo: maxCombo,
    score: score,
    currentTyping: currentTyping ?? '',
    currentWord: currentWord ?? '',
    lastSeen: Date.now()
  });
};

/**
 * プレイヤーの生存確認（ハートビート）を更新します。
 */
export const updatePlayerHeartbeat = async (roomId: string, playerId: string) => {
  const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
  // getで存在確認してから更新し、幽霊として削除された後に勝手に復活するのを防ぐ
  const snap = await get(playerRef);
  if (snap.exists()) {
    await update(playerRef, {
      lastSeen: Date.now()
    });
  }
};

/**
 * プレイヤーの完了状態を更新します。
 */
export const setPlayerFinished = async (roomId: string, playerId: string) => {
  const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
  await update(playerRef, {
    isFinished: true
  });
};

/**
 * 部屋が空（またはプレイヤー情報の階層がない）なら部屋ごと削除します。
 */
export const deleteRoomIfEmpty = async (roomId: string) => {
  const playersRef = ref(db, `rooms/${roomId}/players`);
  const snapshot = await get(playersRef);
  if (!snapshot.exists() || !snapshot.val() || Object.keys(snapshot.val()).length === 0) {
    await remove(ref(db, `rooms/${roomId}`));
    return true;
  }
  return false;
};

/**
 * 部屋から退出します。
 */
export const leaveRoom = async (roomId: string, playerId: string) => {
  const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
  // プレイヤーを削除
  await remove(playerRef);
  // 部屋が空かチェックして削除
  await deleteRoomIfEmpty(roomId);
};
/**
 * 部屋を初期状態（ロビー）に戻します。
 */
export const resetRoom = async (roomId: string) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, {
    status: 'idle',
    startTime: null,
    sharedScore: 0,
    sharedCombo: 0,
    maxSharedCombo: 0,
    globalLineIdx: 0,
    globalChunkIdx: 0,
    mapId: null
  });
};

/**
 * 曲IDを変更します。（ホスト用）
 */
export const setRoomMapId = async (roomId: string, mapId: string) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, {
    mapId: mapId,
    // 曲が変わったら開始時刻等はリセット
    startTime: null,
    sharedScore: 0
  });
};

/**
 * プレイを開始し、サーバー時刻を書き込みます。（全員で一斉に音楽を開始するため）
 */
export const setRoomStartTime = async (roomId: string) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, {
    startTime: serverTimestamp(),
    status: 'playing',
    sharedScore: 0,
    sharedCombo: 0,
    maxSharedCombo: 0,
    globalLineIdx: 0,
    globalChunkIdx: 0,
    playbackTime: 0
  });
};

/**
 * 共有スコアを加算します。
 */
export const incrementSharedScore = async (roomId: string, amount: number) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, {
    sharedScore: amount
  });
};

/**
 * 共有コンボを更新します。
 */
export const updateSharedCombo = async (roomId: string, combo: number, maxCombo: number) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, {
    sharedCombo: combo,
    maxSharedCombo: maxCombo
  });
};

/**
 * 部屋全体のタイピング進捗（現在どのチャンクを打つべきか）を更新します。
 */
export const updateGlobalProgress = async (roomId: string, lineIdx: number, chunkIdx: number) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, {
    globalLineIdx: lineIdx,
    globalChunkIdx: chunkIdx
  });
};

/**
 * 再生時間を更新します。（ホスト用）
 */
export const updateRoomPlayback = async (roomId: string, time: number) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, {
    playbackTime: time
  });
};

/**
 * 部屋のステータスを変更します。
 */
export const setRoomStatus = async (roomId: string, status: 'idle' | 'playing' | 'finished') => {
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, {
    status: status
  });
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
 * 部屋のステート（他プレイヤーの進捗や曲の変更）を購読します。
 */
export const subscribeToRoom = (roomId: string, callback: (state: RoomState | null) => void) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  return onValue(roomRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val() as RoomState);
    } else {
      callback(null);
    }
  });
};

/**
 * 端末のローカル時計とFirebaseサーバーの時計のズレ（オフセット）を取得します。
 */
export const getServerTimeOffset = (): Promise<number> => {
  return new Promise((resolve) => {
    const offsetRef = ref(db, ".info/serverTimeOffset");
    onValue(offsetRef, (snap) => {
      resolve(snap.val() || 0);
    }, { onlyOnce: true });
  });
};

/**
 * 部屋のホスト（最も早く入室した人）を取得します。
 */
export const determineHostId = (players: Record<string, PlayerState> | undefined): string | null => {
  if (!players) return null;
  const pList = Object.values(players);
  if (pList.length === 0) return null;
  // joinedAtでソート（欠落時は降格）、安定のためIDでもソート
  const sorted = [...pList].sort((a, b) => {
    const tA = a.joinedAt || Infinity;
    const tB = b.joinedAt || Infinity;
    if (tA !== tB) return tA - tB;
    return a.id.localeCompare(b.id);
  });
  return sorted[0].id;
};

/**
 * 譜面データのキャッシュを取得します。
 */
export const getCachedMapData = async (mapId: string | number): Promise<any | null> => {
  const docRef = doc(fs, "mapCache", String(mapId));
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
};

/**
 * 譜面データをキャッシュに保存します。
 */
export const saveMapDataToCache = async (mapId: string | number, data: any) => {
  const docRef = doc(fs, "mapCache", String(mapId));
  await setDoc(docRef, data);
};

/**
 * キャッシュされている全ての譜面データを取得します（最新20件）。
 */
export const getAllCachedMaps = async (): Promise<any[]> => {
  console.log('getAllCachedMaps called');
  const cacheRef = collection(fs, "mapCache");
  const q = query(cacheRef, limit(50));
  try {
    const snap = await getDocs(q);
    console.log('getAllCachedMaps success, count:', snap.docs.length);
    return snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (err) {
    console.error('getAllCachedMaps error:', err);
    throw err;
  }
};

/**
 * 全ての部屋リストを購読します。
 */
export const subscribeToAllRooms = (callback: (rooms: Record<string, RoomState> | null) => void) => {
  const roomsRef = ref(db, "rooms");
  return onValue(roomsRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val() as Record<string, RoomState>);
    } else {
      callback(null);
    }
  });
};
