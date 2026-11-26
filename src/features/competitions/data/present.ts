// 第 3 步純函式：分類、賽事階段、隊徽底色與首字。不讀時鐘、不讀網路。
// crestIndex 的雜湊與預覽 harness 相同（乘 31 的無號雜湊再 mod 8），輸入是 teamId。

import type { CompetitionCategory, CompetitionStatus } from './types';

const CREST_COUNT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 末場那天的台北日結束（次日 00:00）絕對毫秒。
 * hi = lastMatchAt - (lastMatchAt + 8h) % 1天 + 1天。now >= hi 才算已過那一天。
 */
export function taipeiDayEnd(lastMatchAt: number): number {
  const intoDay = (lastMatchAt + TAIPEI_OFFSET_MS) % DAY_MS;
  return lastMatchAt - intoDay + DAY_MS;
}

/** 台北日期 YYYYMMDD。摘要片 id 是 d + 這個字串。 */
export function taipeiYmd(ms: number): string {
  const date = new Date(ms + TAIPEI_OFFSET_MS);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export type CompetitionPhase = 'recruit' | 'warm' | 'live' | 'done';

/** 缺值、空值、不認得的字都視為 league。 */
export function categoryOf(source: { category?: unknown } | null | undefined): CompetitionCategory {
  const value = source && typeof source === 'object' ? source.category : undefined;
  if (value === 'league' || value === 'cup' || value === 'friendly') return value;
  return 'league';
}

/**
 * 招募、預熱、進行中、已結束。
 * recruit：報名截止（含）以前，也含還沒開報名。
 * warm：報名已截止、首場還沒到。
 * live：首場（含）起，直到末場那天的台北日結束前。末場已過、午夜未到仍是 live。
 * done：過了末場那天（台北日期）結束後（now >= 該日 24:00），或已寫 endedAt，或狀態是 cancelled。
 * 末場日結束：hi = lastMatchAt - (lastMatchAt + 8h) % 1天 + 1天。
 * ASSUMPTION: 延期與草稿仍照時間走，不另開階段。有 endedAt 就是已結束，不管 now。
 * 回傳代碼對預覽 harness：recruit 招募中、warm 預熱中、live 進行中、done 已結束。
 */
export function competitionPhase(
  doc: {
    status: CompetitionStatus;
    regOpenAt: number;
    regCloseAt: number;
    firstMatchAt: number;
    lastMatchAt: number;
    endedAt: number | null;
  },
  now: number,
): CompetitionPhase {
  if (doc.endedAt != null || doc.status === 'cancelled') return 'done';
  if (now >= taipeiDayEnd(doc.lastMatchAt)) return 'done';
  if (now >= doc.firstMatchAt) return 'live';
  // 與後端 REG_CLOSED（now >= regCloseAt）同一條邊界。
  if (now >= doc.regCloseAt) return 'warm';
  return 'recruit';
}

/** 同 id 永遠同色。空字串是 0。 */
export function crestIndex(teamId: string): number {
  let hash = 0;
  for (const ch of teamId) {
    const cp = ch.codePointAt(0) ?? 0;
    hash = (hash * 31 + cp) >>> 0;
  }
  return hash % CREST_COUNT;
}

/**
 * 隊名第一個字素。空字串與只有空白回「?」。
 * ASSUMPTION: 先 trim，避免名稱前後空白讓首字變成空白。
 */
export function crestInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const SegmenterCtor = (Intl as unknown as {
    Segmenter?: new (
      locales?: string,
      options?: { granularity: 'grapheme' },
    ) => { segment(input: string): Iterable<{ segment: string }> };
  }).Segmenter;
  if (SegmenterCtor) {
    const first = new SegmenterCtor(undefined, { granularity: 'grapheme' }).segment(trimmed)[Symbol.iterator]().next().value?.segment;
    if (first) return first;
  }
  // ASSUMPTION: 沒有 Intl.Segmenter 的舊瀏覽器只取第一個 code point，組合字或帶變體選擇符的 emoji 可能被拆開（Flash 初審 P2，影響極小）
  return [...trimmed][0] ?? '?';
}
