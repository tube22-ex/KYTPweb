import { ref, onValue, set, update, serverTimestamp, get } from "firebase/database";
import { db } from "../configs/firebase";

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
}

export const PLAYER_COLORS = [
  '#FF416C', // Premium Red
  '#2B86C5', // Premium Blue
  '#3DFC64', // Premium Green
  '#FBD72B'  // Premium Yellow
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
      currentWord: ''
    });
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
    currentWord: currentWord ?? ''
  });
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
    globalChunkIdx: 0
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
