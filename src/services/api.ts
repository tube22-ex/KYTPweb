export interface YTypingLineRaw {
  time: string;
  lyrics: string;
  word: string;
}

export interface ParsedLine {
  timeMs: number;
  lyrics: string;
  words: string[]; // ひらがなをスペースで分割した配列
  rawWord: string; // 元のword文字列
  isEnd: boolean; // 終了フラグ
}

export interface Chunk {
  text: string;
  timeMs: number;
  isLineHead: boolean;
}

export interface DisplayLine {
  timeMs: number;
  chunks: Chunk[];
}

export interface DisplaySet {
  timeMs: number;
  lines: DisplayLine[];
}

export interface ParseResult {
  lines: ParsedLine[];       // 既存（互換性のため残す）
  displaySets: DisplaySet[]; // 新規追加
  videoId?: string; // YouTube動画ID
}

// ============================================
// よみがな分割ユーティリティ (splitYomi)
// ============================================
const NO_BREAK_BEFORE = new Set([
  'っ', 'ッ', 'ゃ', 'ゅ', 'ょ', 'ャ', 'ュ', 'ョ',
  'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ー', '～'
]);

const JOSHI = [
  'から', 'まで', 'より', 'ので', 'のに', 'けど', 'ても', 'にて',
  'への', 'だけ', 'ほど', 'など', 'やら', 'とか', 'ながら', 'なら',
  'からの', 'までの', 'よりも', 'けれど', 'だから', 'だって',
  'が', 'を', 'は', 'も'
];

function findRepeatEnd(str: string, pos: number): number {
  for (let len = 2; len <= 4; len++) {
    const pattern = str.slice(pos, pos + len);
    if (pattern.length === len && str.startsWith(pattern, pos + len)) {
      return pos + len * 2; // 繰り返し終端を返す
    }
  }
  return -1;
}

function findJoshiEnd(str: string, pos: number): number {
  for (const j of JOSHI) {
    if (str.startsWith(j, pos)) return pos + j.length;
  }
  return -1;
}

function mergeChunks(chunks: string[], minLen: number, maxLen: number): string[] {
  if (!chunks.length) return chunks;
  let result = [...chunks];
  let changed = true;
  while (changed) {
    changed = false;
    const next: string[] = [];
    let i = 0;
    while (i < result.length) {
      const chunk = result[i];
      if (chunk.length < minLen) {
        if (i + 1 < result.length && (chunk + result[i + 1]).length <= maxLen) {
          next.push(chunk + result[i + 1]); i += 2; changed = true; continue;
        } else if (next.length && (next[next.length - 1] + chunk).length <= maxLen) {
          next[next.length - 1] += chunk; i++; changed = true; continue;
        }
      }
      next.push(chunk); i++;
    }
    result = next;
  }
  const final: string[] = [];
  for (let chunk of result) {
    while (chunk.length > maxLen) {
      let i = maxLen;
      while (i > 1 && NO_BREAK_BEFORE.has(chunk[i])) i--;
      if (i <= 0) i = maxLen; // フォールバック: 全てが禁則文字の場合は強制分割
      final.push(chunk.slice(0, i));
      chunk = chunk.slice(i);
    }
    if (chunk) final.push(chunk);
  }
  return final;
}

function splitYomi(yomi: string, maxChunk = 6): string[] {
  const minLen = 4;
  const maxLen = maxChunk;
  yomi = yomi.trim();
  if (!yomi) return [];

  // 括弧で囲まれたものはフィラーとして無視 (例: (ㅇㅇ))
  if ((yomi.startsWith('(') && yomi.endsWith(')')) || (yomi.startsWith('（') && yomi.endsWith('）'))) {
    return [];
  }

  // 既にスペースが含まれている場合はそれベースで分割再結合
  if (/^[a-zA-Z0-9 ]+$/.test(yomi)) {
    return mergeChunks(yomi.split(' ').filter(p => p), minLen, maxLen);
  }
  if (yomi.includes(' ')) {
    const parts = yomi.split(' ').filter(p => p);
    const result: string[] = [];
    for (const p of parts) {
      if (p.length > maxLen) result.push(...splitYomi(p, maxLen));
      else result.push(p);
    }
    return mergeChunks(result, minLen, maxLen);
  }

  // 繰り返しパターンや助詞等でのぶつ切り
  const chunks: string[] = [];
  let start = 0, i = 0;
  while (i < yomi.length) {
    // 繰り返しパターンを優先チェック
    const repeatEnd = findRepeatEnd(yomi, i);
    if (repeatEnd !== -1) {
      chunks.push(yomi.slice(start, repeatEnd));
      start = repeatEnd;
      i = repeatEnd;
      continue;
    }

    const end = findJoshiEnd(yomi, i);
    if (end !== -1) {
      chunks.push(yomi.slice(start, end));
      start = end;
      i = end;
    } else {
      i++;
    }
  }
  if (start < yomi.length) chunks.push(yomi.slice(start));

  // チャンクを指定文字数にマージ
  return mergeChunks(chunks, minLen, maxLen);
}

// ③ JsonLine配列 → Chunk配列（フラット）
function toChunks(jsonLines: ParsedLine[]): Chunk[] {
  const result: Chunk[] = [];
  for (const line of jsonLines) {
    if (!line.rawWord.trim()) continue; // 空行スキップ
    const texts = splitYomi(line.rawWord);
    texts.forEach((text, idx) => {
      result.push({
        text,
        timeMs: line.timeMs,
        isLineHead: idx === 0
      });
    });
  }
  return result;
}

// ④ Chunk配列 → DisplayLine配列
function buildDisplayLines(chunks: Chunk[], lineMaxChars = 12): DisplayLine[] {
  const lines: DisplayLine[] = [];
  let current: DisplayLine | null = null;

  for (const chunk of chunks) {
    const currentLen = current?.chunks.reduce((s, c) => s + c.text.length, 0) ?? 0;
    const wouldOverflow = currentLen + chunk.text.length > lineMaxChars;

    // 新しい行を開始する条件：
    // ① 文字数オーバー
    // ② isLineHead:true かつ 現在行が空でない
    const shouldBreak = wouldOverflow || (chunk.isLineHead && current !== null && current.chunks.length > 0);

    if (!current || shouldBreak) {
      current = { timeMs: chunk.timeMs, chunks: [] };
      lines.push(current);
    }
    current.chunks.push(chunk);
  }
  return lines;
}

// ⑤ DisplayLine配列 → DisplaySet配列
function buildDisplaySets(lines: DisplayLine[], setMaxLines = 4): DisplaySet[] {
  const sets: DisplaySet[] = [];
  let current: DisplaySet | null = null;

  for (const line of lines) {
    const isNewOrigin = line.chunks[0]?.isLineHead === true;
    const isFull = (current?.lines.length ?? 0) >= setMaxLines;

    // 新しいセットを開始する条件：
    // ① 現在のセットが4行満杯
    // ② この行の先頭チャンクがisLineHead:true（元行データの先頭）
    //    かつ現在のセットが1行以上ある
    const shouldBreak = isFull || (isNewOrigin && current !== null && current.lines.length > 0);

    if (!current || shouldBreak) {
      // ★絶対ルール：セットの1行目先頭チャンクはisLineHead:trueのみ許可
      if (!isNewOrigin && current) {
        // isLineHead:falseなら今のセットに追加 (強引に)
        current.lines.push(line);
        continue;
      }
      current = { timeMs: line.timeMs, lines: [] };
      sets.push(current);
    }
    current.lines.push(line);
  }
  return sets;
}
// ============================================

export const fetchMapData = async (mapId: string | number): Promise<ParseResult> => {
  const response = await fetch(`https://ytyping.net/api/maps/${mapId}/json`);
  if (!response.ok) {
    throw new Error(`Failed to fetch map data: ${response.statusText}`);
  }

  const data: YTypingLineRaw[] = await response.json();

  const parsedLines: ParsedLine[] = data.map(line => {
    // 時間をミリ秒に変換
    const timeMs = parseFloat(line.time) * 1000;

    // カスタム splitYomi 関数でよみがなを分割
    const words = splitYomi(line.word);

    return {
      timeMs,
      lyrics: line.lyrics,
      words,
      rawWord: line.word,
      isEnd: line.lyrics === 'end' && line.word === '' // 両方満たす場合のみ
    };
  });

  // メタデータから動画IDを取得 (https://ytyping.net/api/maps/${mapId})
  let videoId = undefined;
  try {
    const metaResponse = await fetch(`https://ytyping.net/api/maps/${mapId}`);
    if (metaResponse.ok) {
      const metaData = await metaResponse.json();
      console.log('Map Meta Data:', metaData);
      // APIレスポンスを確認したところ、media.videoId に格納されている
      videoId = metaData.media?.videoId || metaData.media?.youtube_id || metaData.media?.video_id;
      if (!videoId) {
        console.warn('videoId not found in media object:', metaData.media);
      }
    } else {
      console.warn('Failed to fetch map metadata:', metaResponse.status);
    }
  } catch (err) {
    console.warn('Failed to fetch videoId from metadata API:', err);
  }

  // displaySets を生成 ('end' 行は除外して構築)
  const filteredLines = parsedLines.filter(l => !l.isEnd);
  const chunks = toChunks(filteredLines);
  const displayLines = buildDisplayLines(chunks);
  const displaySets = buildDisplaySets(displayLines);

  return { lines: parsedLines, displaySets, videoId };
};
