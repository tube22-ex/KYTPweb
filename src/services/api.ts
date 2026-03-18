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
  absLineIdx: number; // オリジナルの行番号
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
  _lyrics: string,
  word: string,
  MIN = 3,
  MAX = 14
): Promise<string[]> {
  const katakanaToHiragana = (src: string) =>
    src.replace(/[\u30a1-\u30f6]/g, (m) => String.fromCharCode(m.charCodeAt(0) - 0x60));

  const cleanWord = katakanaToHiragana(word.replace(/[！？!?　 、。・]/g, '')).trim();
  if (!cleanWord) return [];
  if (/^[a-zA-Z0-9 ]+$/.test(cleanWord)) return cleanWord.split(' ').filter(p => p);

  try {
    const tokenizer = await getTokenizer();
    const tokens = tokenizer.tokenize(cleanWord);

    const SMALL_CHARS = /[っッゃゅょャュョぁぃぅぇぉァィゥェォー]/;

    // 文節グループ化（自立語 + 付属語/非自立語/接尾辞）
    const groups: string[] = [];
    let cur = '';
    for (const t of tokens) {
      const pos = t.pos;
      const pos1 = t.pos_detail_1;
      
      const isFuzoku = ['助詞', '助動詞'].includes(pos);
      const isNonIndep = pos1 === '非自立'; // 「いって(しまっ)た」の「しまっ」など
      const isSuffix = pos1 === '接尾';     // 「〜さ」「〜くん」など
      const isSmallChar = SMALL_CHARS.test(t.surface_form); // 形態素が「ゃ」「っ」などで始まっている場合
      
      if (!isFuzoku && !isNonIndep && !isSuffix && !isSmallChar) {
        if (cur) groups.push(cur);
        cur = t.surface_form;
      } else {
        cur += t.surface_form;
      }
    }
    if (cur) groups.push(cur);

    // ★追加
    console.log('【groups】', cleanWord, '→', groups);

    // マージ（基本：MAXを超えない範囲でMINに近づける）
    let result = [...groups];
    let changed = true;
    while (changed) {
      changed = false;
      const next: string[] = [];
      let i = 0;
      while (i < result.length) {
        const g = result[i];
        if (g.length < MIN) {
          // 次と結合（MAX内）
          if (i + 1 < result.length && (g + result[i + 1]).length <= MAX) {
            next.push(g + result[i + 1]); i += 2; changed = true; continue;
          }
          // 前と結合（MAX内）
          if (next.length && (next[next.length - 1] + g).length <= MAX) {
            next[next.length - 1] += g; i++; changed = true; continue;
          }
        }
        next.push(g); i++;
      }
      result = next;
    }

    // 強制マージ（MINを満たさないものを、MAXを多少超えても良いので結合する）
    // 例: MIN=4, MAX=6 の時、[3, 4] -> [7] にする
    {
      const next: string[] = [];
      let i = 0;
      while (i < result.length) {
        let g = result[i];
        if (g.length < MIN) {
          if (i + 1 < result.length) {
            // 次があるなら結合
            g = g + result[i + 1];
            i += 2;
          } else if (next.length > 0) {
            // 次がないが前があるなら、前の末尾に結合
            next[next.length - 1] += g;
            i++;
            continue;
          } else {
            i++;
          }
        } else {
          i++;
        }
        next.push(g);
      }
      result = next;
    }
    console.log('【merged】', result);

    // MAX超え強制分割
    const smartSplit = (text: string, maxLen: number): string[] => {
      const parts: string[] = [];
      let temp = text;
      while (temp.length > maxLen) {
        let splitLen = maxLen;
        if (temp.length < maxLen + MIN) splitLen = Math.floor(temp.length / 2);
        let j = splitLen;
        const initialJ = j;
        while (j > 1 && SMALL_CHARS.test(temp[j])) j--;
        if (j !== initialJ) console.log('【smartSplit adj】', temp.slice(0, initialJ), '→', j, ':', temp[j]);
        parts.push(temp.slice(0, j));
        temp = temp.slice(j);
      }
      if (temp) parts.push(temp);
      return parts;
    };

    const final = result.flatMap(r => smartSplit(r, MAX));
    console.log('【final】', final);

    // 照合
    if (final.join('') !== cleanWord) {
      console.warn('kuromoji mismatch:', cleanWord, '→', final);
      return smartSplit(cleanWord, MAX);
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
  jsonLines.forEach((line, lineIdx) => {
    if (!line.rawWord.trim() || line.isEnd) return;
    line.words
      .filter(text => text.trim().length > 0)
      .forEach((text, idx) => {
        result.push({
          text,
          timeMs: line.timeMs,
          isLineHead: idx === 0,
          absLineIdx: lineIdx // オリジナルの行番号を保持
        });
      });
  });
  return result;
}

// ④ Chunk配列 → DisplayLine配列
function buildDisplayLines(chunks: Chunk[], lineMaxChars = 14): DisplayLine[] {
  const lines: DisplayLine[] = [];
  let current: DisplayLine | null = null;
  let absCounter = 0;

  for (const chunk of chunks) {
    const currentLen = current?.chunks.reduce((s, c) => s + c.text.length, 0) ?? 0;
    const wouldOverflow = currentLen + chunk.text.length > lineMaxChars;
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

    if (!current || isFull || isNewOrigin) {
      // セットが空、満杯、または新しい歌詞の開始点なら新セット
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

  // displaySets の全行・全チャンクの timeMs を
  // セットの1行目の timeMs に統一する
  for (const set of displaySets) {
    const setTimeMs = set.lines[0]?.chunks[0]?.timeMs ?? 0;
    set.timeMs = setTimeMs;
    for (const line of set.lines) {
      line.timeMs = setTimeMs;
      for (const chunk of line.chunks) {
        chunk.timeMs = setTimeMs;
      }
    }
  }

  return { lines: parsedLines, displaySets, videoId };
};
