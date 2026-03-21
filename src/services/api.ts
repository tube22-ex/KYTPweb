import kuromoji from 'kuromoji';
import { saveMapDataToCache, getCachedMapData } from './sync';
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
  absLineIdx: number; // 絶対行番号
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
  title?: string;
  artist?: string;
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

export async function splitYomi(
  _lyrics: string,
  word: string,
  MIN = 3,
  MAX = 14
): Promise<string[]> {
  const katakanaToHiragana = (src: string) =>
    src.replace(/[\u30a1-\u30f6]/g, (m) => String.fromCharCode(m.charCodeAt(0) - 0x60));

  // 1. スペース（半角・全角）で事前分割
  const initialParts = word.split(/[ 　]/).filter(p => p.length > 0);
  if (initialParts.length === 0) return [];

  const results: string[] = [];
  const SMALL_CHARS = /[っッゃゅょャュョぁぃぅぇぉァィゥェォー]/;

  for (const part of initialParts) {
    // 英語・記号のみのパーツはそのまま採用（ただし記号は除去）
    if (/^[a-zA-Z0-9!?. ,:;'"\-()[\]{}<>/\\#$%&|^~@+*=！!．，：；”’（）［］｛｝＜＞／＼＃＄％＆｜＾〜＠＋＊＝]+$/.test(part)) {
      // 英数字のみを残す（記号をすべて削除）
      const cleanPart = part.replace(/[^a-zA-Z0-9]/g, '');
      if (cleanPart) results.push(cleanPart);
      continue;
    }

    // 日本語が含まれるパーツの処理
    // 記号をすべて削除
    const cleanWord = katakanaToHiragana(part.replace(/[^a-zA-Z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/g, '')).trim();
    if (!cleanWord) continue;

    try {
      const tokenizer = await getTokenizer();
      const tokens = tokenizer.tokenize(cleanWord);

      // 文節グループ化
      const groups: string[] = [];
      let cur = '';
      for (const t of tokens) {
        const pos = t.pos;
        const pos1 = t.pos_detail_1;
        const isFuzoku = ['助詞', '助動詞'].includes(pos);
        const isNonIndep = pos1 === '非自立';
        const isSuffix = pos1 === '接尾';
        const isSmallChar = SMALL_CHARS.test(t.surface_form);

        if (!isFuzoku && !isNonIndep && !isSuffix && !isSmallChar) {
          if (cur) groups.push(cur);
          cur = t.surface_form;
        } else {
          cur += t.surface_form;
        }
      }
      if (cur) groups.push(cur);

      // パーツ内でのマージ（MAXを超えない範囲でMINに近づける）
      let partResult = [...groups];
      let changed = true;
      while (changed) {
        changed = false;
        const next: string[] = [];
        let i = 0;
        while (i < partResult.length) {
          const g = partResult[i];
          if (g.length < MIN) {
            if (i + 1 < partResult.length && (g + partResult[i + 1]).length <= MAX) {
              next.push(g + partResult[i + 1]); i += 2; changed = true; continue;
            }
            if (next.length && (next[next.length - 1] + g).length <= MAX) {
              next[next.length - 1] += g; i++; changed = true; continue;
            }
          }
          next.push(g); i++;
        }
        partResult = next;
      }

      // 強制マージ（MINを満たさないものを、MAXを多少超えても良いので結合する）
      {
        const next: string[] = [];
        let i = 0;
        while (i < partResult.length) {
          let g = partResult[i];
          if (g.length < MIN) {
            if (i + 1 < partResult.length) { g = g + partResult[i + 1]; i += 2; }
            else if (next.length > 0) { next[next.length - 1] += g; i++; continue; }
            else { i++; }
          } else { i++; }
          next.push(g);
        }
        partResult = next;
      }

      // MAX超え強制分割用関数
      const smartSplit = (text: string, maxLen: number): string[] => {
        const parts: string[] = [];
        let temp = text;
        while (temp.length > maxLen) {
          let splitLen = maxLen;
          if (temp.length < maxLen + MIN) splitLen = Math.floor(temp.length / 2);
          let j = splitLen;
          while (j > 1 && SMALL_CHARS.test(temp[j])) j--;
          parts.push(temp.slice(0, j));
          temp = temp.slice(j);
        }
        if (temp) parts.push(temp);
        return parts;
      };

      const finalPart = partResult.flatMap(r => smartSplit(r, MAX));
      results.push(...finalPart);

    } catch (e) {
      console.warn('kuromoji error for part, fallback:', e);
      results.push(part);
    }
  }

  return results;
}

// ③ JsonLine配列 → Chunk配列（フラット）
export function toChunks(jsonLines: ParsedLine[]): Chunk[] {
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
export function buildDisplayLines(chunks: Chunk[], lineMaxChars = 14): DisplayLine[] {
  const lines: DisplayLine[] = [];
  let current: DisplayLine | null = null;
  let absCounter = 0;
  let linesInCurrentOriginal = 0; // 現在の元データ行が何個の表示行に分割されたか

  for (const chunk of chunks) {
    if (chunk.isLineHead) {
      linesInCurrentOriginal = 0;
    }

    const currentLen = current?.chunks.reduce((s, c) => s + c.text.length, 0) ?? 0;
    const wouldOverflow = currentLen + chunk.text.length > lineMaxChars;
    // 新しい行を開始すべきか
    const isNewOriginal = chunk.isLineHead;
    const shouldBreak = (wouldOverflow || isNewOriginal) && current !== null && current.chunks.length > 0;

    if (!current || shouldBreak) {
      // すでに4行ある場合は、5行目を作らずに4行目に追加し続ける（文字数制限を突破）
      if (current && !isNewOriginal && linesInCurrentOriginal >= 4) {
        // 新しい行を作らず、既存のcurrent(4行目)にマージされる
      } else {
        current = { timeMs: chunk.timeMs, chunks: [], absLineIdx: absCounter++ };
        lines.push(current);
        linesInCurrentOriginal++;
      }
    }
    current.chunks.push(chunk);
  }
  return lines;
}

// ⑤ DisplayLine配列 → DisplaySet配列
export function buildDisplaySets(allLines: DisplayLine[], setMaxLines = 4): DisplaySet[] {
  const sets: DisplaySet[] = [];

  // まず、DisplayLineを「元の歌詞の行（absLineIdx）」ごとにグループ化する
  const groups: DisplayLine[][] = [];
  allLines.forEach(line => {
    const originIdx = line.chunks[0].absLineIdx;
    let group = groups.find(g => g[0].chunks[0].absLineIdx === originIdx);
    if (!group) {
      group = [];
      groups.push(group);
    }
    group.push(line);
  });

  let currentSet: DisplaySet | null = null;

  for (const group of groups) {
    // 現在のセットの最後の行の開始時間を確認
    const lastLineInSet = currentSet && currentSet.lines.length > 0
      ? currentSet.lines[currentSet.lines.length - 1]
      : null;

    // 6秒以上離れているかチェック (isTooFar)
    const isTooFar = lastLineInSet && (group[0].timeMs - lastLineInSet.timeMs >= 6000);

    // このグループ（1つの元歌詞行）を現在のセットに追加すると overflow するか？
    const willOverflow = currentSet && (currentSet.lines.length + group.length > setMaxLines);

    if (!currentSet || willOverflow || isTooFar) {
      currentSet = { timeMs: group[0].timeMs, lines: [] };
      sets.push(currentSet);
    }

    group.forEach(line => currentSet?.lines.push(line));
  }

  return sets;
}
// ============================================

export const fetchMapData = async (mapId: string | number): Promise<ParseResult> => {
  // 1. キャッシュをチェック (編集済みのデータを優先的に返す)
  try {
    const cached = await getCachedMapData(String(mapId));
    if (cached && (cached as any).displaySets) {
      console.log('Using cached map data for:', mapId);
      return cached as ParseResult;
    }
  } catch (err) {
    console.warn('Failed to fetch from cache:', err);
  }

  const response = await fetch(`https://ytyping.net/api/maps/${mapId}/json`);
  if (!response.ok) {
    throw new Error(`Failed to fetch map data: ${response.statusText}`);
  }

  const data: YTypingLineRaw[] = await response.json();

  const parsedLines: ParsedLine[] = await Promise.all(
    data.map(async (line, index) => ({
      timeMs: parseFloat(line.time) * 1000,
      lyrics: line.lyrics,
      words: await splitYomi(line.lyrics, line.word),
      rawWord: line.word,
      isEnd: (index === data.length - 1 && line.lyrics === 'end' && (!line.word || line.word.trim() === '')),
      absLineIdx: index
    }))
  );

  console.log('[api.ts] fetchMapData', {
    totalLines: parsedLines.length,
    endLineIdx: parsedLines.findIndex(l => l.isEnd),
    firstFewLines: parsedLines.slice(0, 3)
  });

  // メタデータから動画IDを取得 (https://ytyping.net/api/maps/${mapId})
  let videoId = undefined;
  let title = undefined;
  let artist = undefined;
  try {
    const metaResponse = await fetch(`https://ytyping.net/api/maps/${mapId}`);
    if (metaResponse.ok) {
      const metaData = await metaResponse.json();
      const info = metaData.info || metaData.map || metaData;
      videoId = metaData.media?.videoId || metaData.media?.youtube_id || metaData.media?.video_id || info.media?.videoId || info.media?.youtube_id || info.media?.video_id || info.video_id;
      title = info.name || info.title || info.map_name || info.music?.title;
      artist = info.artist?.name || info.creator?.name || (typeof info.artist === 'string' ? info.artist : undefined) || info.artistName || info.music?.artist || info.artist;
    }
  } catch (err) {
    console.warn('Failed to fetch map metadata:', err);
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

  const result = {
    lines: parsedLines,
    displaySets,
    videoId,
    title: title ? String(title) : undefined,
    artist: artist ? String(artist) : undefined
  };

  console.log('[api.ts] Final Check', {
    totalParsedLines: parsedLines.length,
    displaySetsCount: displaySets.length,
    lastPlayableAbsIdx: displaySets.length > 0 ? displaySets[displaySets.length - 1].lines.slice(-1)[0].absLineIdx : -1,
    lastLyrics: parsedLines.slice(-5).map(l => l.lyrics)
  });

  // キャッシュに保存
  try {
    await saveMapDataToCache(mapId, result);
  } catch (err) {
    console.warn('Failed to save to cache:', err);
  }

  return result;
};
