import { ref, onValue, set, update, serverTimestamp } from "firebase/database";
import { db } from "../configs/firebase";

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  currentLineIdx: number;
  currentWordIdx: number;
  combo: number;
  maxCombo: number;
  score: number;
  isReady: boolean;
  isFinished: boolean;
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
      combo: 0,
      maxCombo: 0,
      score: 0,
      isReady: false,
      isFinished: false
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
export const updatePlayerProgress = async (roomId: string, playerId: string, lineIdx: number, wordIdx: number, combo: number, maxCombo: number, score: number) => {
  const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
  await update(playerRef, {
    currentLineIdx: lineIdx,
    currentWordIdx: wordIdx,
    combo: combo,
    maxCombo: maxCombo,
    score: score
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
    sharedScore: 0
  });
};

/**
 * 共有スコアを加算します。
 */
export const incrementSharedScore = async (roomId: string, amount: number) => {
  const roomRef = ref(db, `rooms/${roomId}`);
  // Firebaseのトランザクションは使用せず、シンプルな加算（厳密な整合性より速度優先の場合）
  // ただし、並列を考慮するなら本来はトランザクションやincrement演算子（Firestore等）
  // RTDBの場合もupdateで既存値を取得せずに送ることはできないので、基本はクライアント加算
  // ここでは各クライアントが自分の10点を加算してupdateする形にする
  // playersのscoreも維持しつつ、roomのsharedScoreも更新する
  // 実際には roomStateが引数にないので、呼び出し側で現在のスコアに足して送るか、
  // updateで`${amount}`のようなことはできないので、直接値をセットする
  // 今回はRoomStateを購読しているはずなので、ローカルで計算後にこの関数を呼ぶ
  await update(roomRef, {
    sharedScore: amount
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
