// 第 3 步純函式：分類、賽事階段、隊徽底色與首字。不讀時鐘、不讀網路。
// crestIndex 的雜湊與預覽 harness 相同（乘 31 的無號雜湊再 mod 8），輸入是 teamId。

import type { CompetitionCategory, CompetitionStatus } from './types';

const CREST_COUNT = 8;

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
 * live：首場（含）到末場（含）。
 * done：已過末場，或已寫 endedAt，或狀態是 cancelled。
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
  if (now > doc.lastMatchAt) return 'done';
  if (now >= doc.firstMatchAt) return 'live';
  if (now > doc.regCloseAt) return 'warm';
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
