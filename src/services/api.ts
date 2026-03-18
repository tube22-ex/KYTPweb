import kuromoji from 'kuromoji';

// ============================================
// Kuromoji Dict Load Fix (Vite/Browser)
// ============================================
// Vite の開発サーバが .gz ファイルを自動解凍したり MIME タイプを誤判定したりするのを防ぐため、
// 辞書ファイルに .bin 拡張子を付けてリクエストを書き換えます。
if (typeof window !== 'undefined' && (window as any).XMLHttpRequest) {
  const originalOpen = (window as any).XMLHttpRequest.prototype.open;
  (window as any).XMLHttpRequest.prototype.open = function (method: string, url: string, ...rest: any[]) {
    let fixedUrl = url;
    if (fixedUrl && fixedUrl.includes('/kuromoji-dict/') && fixedUrl.endsWith('.gz')) {
      fixedUrl += '.bin';
    }
    return originalOpen.call(this, method, fixedUrl, ...rest);
  };
}

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
  absLineIdx: number;
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
// よみがな分割ユーティリティ (kuromoji.js)
// ============================================
const toHira = (str: string) =>
  str.replace(/[ァ-ン]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

let tokenizerPromise: Promise<any> | null = null;

function getTokenizer(): Promise<any> {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji
        .builder({ dicPath: '/kuromoji-dict' })
        .build((err: any, tokenizer: any) => {
          if (err) reject(err);
          else resolve(tokenizer);
        });
    });
  }
  return tokenizerPromise;
}

async function splitYomi(
  lyrics: string,
  word: string,
  MIN = 4,
  MAX = 15
): Promise<string[]> {
  if (!word.trim()) return [];
  if (/^[a-zA-Z0-9 ]+$/.test(word)) return word.split(' ').filter(p => p);

  try {
    const tokenizer = await getTokenizer();
    const tokens = tokenizer.tokenize(lyrics);

    const NO_BREAK = new Set(['っ', 'ッ', 'ゃ', 'ゅ', 'ょ', 'ャ', 'ュ', 'ョ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ー']);

    // 文節グループ化（自立語+付属語）
    const groups: string[] = [];
    let cur = '';
    for (const t of tokens) {
      const pos = t.pos;
      const isFuzoku = ['助詞', '助動詞'].includes(pos);
      const isKigo = pos === '記号';
      if (isKigo) continue;
      if (!isFuzoku) {
        if (cur) groups.push(cur);
        cur = toHira(t.reading || t.surface_form);
      } else if (cur) {
        cur += toHira(t.reading || t.surface_form);
      }
    }
    if (cur) groups.push(cur);

    // マージ
    let result = [...groups];
    let changed = true;
    while (changed) {
      changed = false;
      const next: string[] = [];
      let i = 0;
      while (i < result.length) {
        const g = result[i];
        if (g.length < MIN) {
          if (i + 1 < result.length && (g + result[i + 1]).length <= MAX) {
            next.push(g + result[i + 1]); i += 2; changed = true; continue;
          }
          if (next.length && (next[next.length - 1] + g).length <= MAX) {
            next[next.length - 1] += g; i++; changed = true; continue;
          }
        }
        next.push(g); i++;
      }
      result = next;
    }

    // MAX超え強制分割
    const final: string[] = [];
    for (let r of result) {
      while (r.length > MAX) {
        let j = MAX;
        while (j > 1 && NO_BREAK.has(r[j])) j--;
        final.push(r.slice(0, j));
        r = r.slice(j);
      }
      if (r) final.push(r);
    }

    // wordとの照合（不一致はフォールバック）
    if (final.join('') !== word.replace(/[！？]/g, '')) {
      console.warn('kuromoji mismatch fallback:', lyrics);
      return [word]; // そのまま返す
    }
    return final;

  } catch (e) {
    console.warn('kuromoji error, fallback:', e);
    return [word];
  }
}

// ③ JsonLine配列 → Chunk配列（フラット）
function toChunks(jsonLines: ParsedLine[]): Chunk[] {
  const result: Chunk[] = [];
  for (const line of jsonLines) {
    if (!line.rawWord.trim() || line.isEnd) continue;
    line.words.forEach((text, idx) => {
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
function buildDisplayLines(chunks: Chunk[], lineMaxChars = 15): DisplayLine[] {
  const lines: DisplayLine[] = [];
  let current: DisplayLine | null = null;
  let absCounter = 0;

  for (const chunk of chunks) {
    const currentLen = current?.chunks.reduce((s, c) => s + c.text.length, 0) ?? 0;
    const wouldOverflow = currentLen + chunk.text.length > lineMaxChars;

    // 新しい行を開始する条件：
    // ① 文字数オーバー
    // ② isLineHead:true かつ 現在行が空でない
    const shouldBreak = wouldOverflow || (chunk.isLineHead && current !== null && current.chunks.length > 0);

    if (!current || shouldBreak) {
      current = { timeMs: chunk.timeMs, chunks: [], absLineIdx: absCounter++ };
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

    if (!current) {
      // 最初のセット
      current = { timeMs: line.timeMs, lines: [] };
      sets.push(current);
    } else if (isFull) {
      // ★4行満杯 → 問答無用で次のセットへ
      current = { timeMs: line.timeMs, lines: [] };
      sets.push(current);
    } else if (isNewOrigin) {
      // 元行データの先頭チャンク → 新しいセットへ
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

  const parsedLines: ParsedLine[] = await Promise.all(
    data.map(async line => ({
      timeMs: parseFloat(line.time) * 1000,
      lyrics: line.lyrics,
      words: await splitYomi(line.lyrics, line.word),
      rawWord: line.word,
      isEnd: line.lyrics === 'end' && line.word === ''
    }))
  );

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
