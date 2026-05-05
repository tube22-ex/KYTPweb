import kuromoji from 'kuromoji';
import { saveMapDataToCache, getCachedMapData } from './sync';
import { localCache } from './localCache';
import { getGlobalRebuildRules } from './globalConfig';
// ============================================
// Kuromoji Dict Load Fix (Vite/Browser)
// ============================================
// Vite の開発サーバが .gz ファイルを自動解凍したり MIME タイプを誤判定したりするのを防ぐため、
// 辞書ファイルに .bin 拡張子を付けてリクエストを書き換えます。
//tes
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
  timestamp?: number;
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

const splitYomiCache = new Map<string, string[]>();

export async function splitYomi(
  _lyrics: string,
  word: string,
  MIN = 3,
  MAX = 14,
  protectedWords: string[] = [],
  separationWords: string[] = []
): Promise<string[]> {
  const cacheKey = `${word}_${MIN}_${MAX}_${protectedWords.join(',')}_${separationWords.join(',')}`;
  if (splitYomiCache.has(cacheKey)) {
    return splitYomiCache.get(cacheKey)!;
  }

  const katakanaToHiragana = (src: string) =>
    src.replace(/[\u30a1-\u30f6]/g, (m) => String.fromCharCode(m.charCodeAt(0) - 0x60));

  const normalizeText = (text: string) => {
    return text
      .replace(/[ー－―—‐-]/g, 'ー')
      .replace(/[！!]/g, '!')
      .replace(/[？?]/g, '?')
      .replace(/[…‥]/g, '...')
      .replace(/[　\s]/g, '');
  };

  const cleanRegex = /[^a-zA-Z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\uff10-\uff19\uff21-\uff3a\uff41-\uff5aー]/g;

  // 1. スペース（半角・全角）で事前分割
  const initialParts = word.split(/[ 　]/).filter(p => p.length > 0);
  if (initialParts.length === 0) return [];

  const results: string[] = [];
  const SMALL_CHARS = /[っッゃゅょャュョぁぃぅぇぉァィゥェォー]/;

  const normalizedProtected = protectedWords
    .filter(pw => pw.trim().length > 0)
    .map(pw => katakanaToHiragana(normalizeText(pw.trim()).replace(cleanRegex, '')));

  const normalizedSeparation = separationWords
    .filter(sw => sw.trim().length > 0)
    .map(sw => katakanaToHiragana(normalizeText(sw.trim()).replace(cleanRegex, '')));

  for (const part of initialParts) {
    if (/^[a-zA-Z0-9!?. ,:;'"\-()[\]{}<>/\\#$%&|^~@+*=！!．，：；”’（）［］｛｝＜＞／＼＃＄％＆｜＾〜＠＋＊＝]+$/.test(part)) {
      const cleanPart = part.replace(/[^a-zA-Z0-9]/g, '');
      if (cleanPart) results.push(cleanPart);
      continue;
    }

    const cleanWord = katakanaToHiragana(normalizeText(part).replace(cleanRegex, '')).trim();
    if (!cleanWord) continue;

    // 分割禁止・強制分割のインデックスを構築
    const forbiddenSplit = new Set<number>();
    for (const pw of normalizedProtected) {
      let pos = cleanWord.indexOf(pw);
      while (pos !== -1) {
        for (let i = pos; i < pos + pw.length - 1; i++) forbiddenSplit.add(i);
        pos = cleanWord.indexOf(pw, pos + 1);
      }
    }

    const mandatorySplit = new Set<number>();
    for (const sw of normalizedSeparation) {
      let pos = cleanWord.indexOf(sw);
      while (pos !== -1) {
        if (pos > 0) mandatorySplit.add(pos - 1);
        mandatorySplit.add(pos + sw.length - 1);
        pos = cleanWord.indexOf(sw, pos + 1);
      }
    }

    try {
      const tokenizer = await getTokenizer();
      const tokens = tokenizer.tokenize(cleanWord);

      // --- Chunksの作成 ---
      // トークン境界と強制分割点を組み合わせて、最小単位のChunckに分ける
      const atomicChunks: { text: string; mustSplitAfter: boolean; canSplitAfter: boolean }[] = [];
      let charIdx = 0;
      for (const t of tokens) {
        let text = t.surface_form;
        let innerOffset = 0;

        while (text.length > 0) {
          let splitAt = -1;
          for (let jj = 0; jj < text.length - 1; jj++) {
            if (mandatorySplit.has(charIdx + innerOffset + jj)) {
              splitAt = jj;
              break;
            }
          }

          if (splitAt !== -1) {
            const piece = text.slice(0, splitAt + 1);
            atomicChunks.push({ text: piece, mustSplitAfter: true, canSplitAfter: true });
            text = text.slice(splitAt + 1);
            innerOffset += piece.length;
          } else {
            // トークン末尾
            const absoluteEndIdx = charIdx + innerOffset + text.length - 1;
            const pos = t.pos, posData1 = t.pos_detail_1;
            const isFuzoku = ['助詞', '助動詞'].includes(pos);
            const isNonIndep = posData1 === '非自立';
            const isSuffix = posData1 === '接尾';
            const isSmallChar = SMALL_CHARS.test(text);

            // 文法的・あるいは指定により分割可能か
            const isNaturalSplit = !isFuzoku && !isNonIndep && !isSuffix && !isSmallChar;
            const mustSplit = mandatorySplit.has(absoluteEndIdx);
            const canSplit = !forbiddenSplit.has(absoluteEndIdx);

            atomicChunks.push({
              text,
              mustSplitAfter: mustSplit,
              canSplitAfter: (isNaturalSplit || mustSplit) && canSplit
            });
            break;
          }
        }
        charIdx += t.surface_form.length;
      }

      // --- Grouping (Natural Splitに従う) ---
      let groups: string[] = [];
      let cur = '';
      for (const chunk of atomicChunks) {
        cur += chunk.text;
        if (chunk.canSplitAfter) {
          groups.push(cur);
          cur = '';
        }
      }
      if (cur) groups.push(cur);

      // --- Merging (MIN/MAX設定に従う。ただしMandatoryは尊重) ---
      const applyMerge = (inputGroups: string[]) => {
        let currentGroups = [...inputGroups];
        let changed = true;
        while (changed) {
          changed = false;
          const next: string[] = [];
          let i = 0;
          let offset = 0;
          while (i < currentGroups.length) {
            const g = currentGroups[i];
            const endIdx = offset + g.length - 1;
            const mustSplit = mandatorySplit.has(endIdx);
            const canSplit = !forbiddenSplit.has(endIdx);

            if (!mustSplit && (g.length < MIN || !canSplit)) {
              // 次と結合
              if (i + 1 < currentGroups.length && (g + currentGroups[i + 1]).length <= MAX) {
                next.push(g + currentGroups[i + 1]);
                offset += (g + currentGroups[i + 1]).length;
                i += 2; changed = true; continue;
              }
              // 前と結合
              if (next.length > 0 && (next[next.length - 1] + g).length <= MAX) {
                next[next.length - 1] += g;
                offset += g.length;
                i++; changed = true; continue;
              }
            }
            next.push(g);
            offset += g.length;
            i++;
          }
          currentGroups = next;
        }
        return currentGroups;
      };

      let merged = applyMerge(groups);

      // 強制結合 (MINを絶対満たしたい場合)
      const forceMerge = (inputGroups: string[]) => {
        const next: string[] = [];
        let i = 0, offset = 0;
        while (i < inputGroups.length) {
          let g = inputGroups[i];
          const endIdx = offset + g.length - 1;
          const mustSplit = mandatorySplit.has(endIdx);
          const canSplit = !forbiddenSplit.has(endIdx);
          if (!mustSplit && (g.length < MIN || !canSplit)) {
            if (i + 1 < inputGroups.length) {
              g += inputGroups[i + 1];
              offset += g.length; i += 2;
            } else if (next.length > 0) {
              next[next.length - 1] += g;
              offset += g.length; i++; continue;
            } else { offset += g.length; i++; }
          } else { offset += g.length; i++; }
          next.push(g);
        }
        return next;
      };
      merged = forceMerge(merged);

      // --- Split (MAX超え) ---
      const smartSplit = (text: string, maxLen: number, startIdxOffset: number): string[] => {
        const parts: string[] = [];
        let temp = text, currentOffset = startIdxOffset;
        while (temp.length > maxLen) {
          let splitLen = maxLen;
          if (temp.length < maxLen + MIN) splitLen = Math.floor(temp.length / 2);
          let j = splitLen;
          while (j > 1 && (SMALL_CHARS.test(temp[j]) || forbiddenSplit.has(currentOffset + j - 1))) j--;
          if (j <= 1) {
            j = splitLen;
            while (j < temp.length && (SMALL_CHARS.test(temp[j]) || forbiddenSplit.has(currentOffset + j - 1))) j++;
            if (j >= temp.length) break;
          }
          parts.push(temp.slice(0, j));
          temp = temp.slice(j);
          currentOffset += j;
        }
        if (temp) parts.push(temp);
        return parts;
      };

      const finalResult: string[] = [];
      let finalOffset = 0;
      for (const g of merged) {
        finalResult.push(...smartSplit(g, MAX, finalOffset));
        finalOffset += g.length;
      }
      results.push(...finalResult);
    } catch (e) {
      console.warn('kuromoji error fallback:', e);
      results.push(part);
    }
  }
  splitYomiCache.set(cacheKey, results);
  return results;
}

// ③ JsonLine配列 → Chunk配列（フラット）
export function toChunks(jsonLines: ParsedLine[]): Chunk[] {
  const result: Chunk[] = [];
  let prevTimeMs = -1;

  jsonLines.forEach((line, lineIdx) => {
    if (!line.rawWord.trim() || line.isEnd) return;
    const t = Math.round(line.timeMs);

    // もし前の行と全く同じ時間（YouTubeの複数行キャプション等）なら、同じ元歌詞の続きとみなす
    const isNewOriginalLyric = prevTimeMs === -1 || prevTimeMs !== t;
    prevTimeMs = t;

    line.words
      .filter(text => text.trim().length > 0)
      .forEach((text, idx) => {
        result.push({
          text,
          timeMs: t,
          isLineHead: idx === 0 && isNewOriginalLyric,
          absLineIdx: lineIdx
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
  let linesInCurrentOriginal = 0;

  for (const chunk of chunks) {
    if (chunk.isLineHead) linesInCurrentOriginal = 0;
    const currentLen = current?.chunks.reduce((s, c) => s + c.text.length, 0) ?? 0;
    const wouldOverflow = currentLen + chunk.text.length > lineMaxChars;
    const isNewOriginal = chunk.isLineHead;
    const shouldBreak = (wouldOverflow || isNewOriginal) && current !== null && current.chunks.length > 0;

    if (!current || shouldBreak) {
      if (current && !isNewOriginal && linesInCurrentOriginal >= 4) {
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
  const groups: DisplayLine[][] = [];
  allLines.forEach(line => {
    const originIdx = line.chunks[0].absLineIdx;
    let group = groups.find(g => g[0].chunks[0].absLineIdx === originIdx);
    if (!group) { group = []; groups.push(group); }
    group.push(line);
  });

  let currentSet: DisplaySet | null = null;
  for (const group of groups) {
    const lastLineInSet = currentSet?.lines[currentSet.lines.length - 1];
    const isTooFar = lastLineInSet && (group[0].timeMs - lastLineInSet.timeMs >= 6000);
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
  const sMapId = String(mapId);

  // 1. ローカルキャッシュ (IndexedDB) を最優先でチェック
  try {
    const local = await localCache.get(sMapId);
    if (local && local.displaySets) {
      console.log('[LocalCache] Using IndexedDB for:', mapId);
      return local as ParseResult;
    }
  } catch (err) {
    console.warn('[LocalCache] Get failed:', err);
  }

  // 2. クラウドキャッシュ (Firestore) をチェック (他プレイヤーの編集反映用)
  try {
    const cached = await getCachedMapData(sMapId);
    if (cached && (cached as any).displaySets) {
      console.log('[CloudCache] Using Firestore for:', mapId);
      // ローカルにも保存しておく
      localCache.set(sMapId, cached).catch(console.error);
      return cached as ParseResult;
    }
  } catch (err) {
    console.warn('[CloudCache] Get failed:', err);
  }

  // 3. 通常のフェッチ & パース
  const response = await fetch(`https://ytyping.net/api/maps/${mapId}/json`);
  if (!response.ok) {
    throw new Error(`Failed to fetch map data: ${response.statusText}`);
  }

  const data: YTypingLineRaw[] = await response.json();

  // 共通ルールを取得
  const globalRules = await getGlobalRebuildRules();
  const protectedArr = globalRules?.protectedWords.split(',').map(s => s.trim()).filter(Boolean) || [];
  const separatedArr = globalRules?.separatedWords.split(',').map(s => s.trim()).filter(Boolean) || [];

  const parsedLines: ParsedLine[] = await Promise.all(
    data.map(async (line, index) => ({
      timeMs: parseFloat(line.time) * 1000,
      lyrics: line.lyrics,
      words: await splitYomi(line.lyrics, line.word, 3, 14, protectedArr, separatedArr),
      rawWord: line.word,
      isEnd: (index === data.length - 1 && line.lyrics === 'end' && (!line.word || line.word.trim() === '')),
      absLineIdx: index
    }))
  );

  // メタデータから動画IDを取得
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

  // displaySets のセット自体の timeMs は
  // セットの1行目の timeMs にしておく (BLOCK時間の表示用)
  for (const set of displaySets) {
    const setTimeMs = set.lines[0]?.chunks[0]?.timeMs ?? 0;
    set.timeMs = setTimeMs;
    // 個別の line.timeMs や chunk.timeMs は、元歌詞の時間を保持するため上書きしない
  }

  const result: ParseResult = {
    lines: parsedLines,
    displaySets,
    videoId,
    title: title ? String(title) : undefined,
    artist: artist ? String(artist) : undefined,
    timestamp: Date.now()
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
