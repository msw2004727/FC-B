import { describe, expect, it } from 'vitest';
import { categoryOf, competitionPhase, crestIndex, crestInitial } from './present';
import type { CompetitionStatus } from './types';

function refIndex(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return hash % 8;
}

const times = {
  status: 'published' as CompetitionStatus,
  regOpenAt: 100,
  regCloseAt: 200,
  firstMatchAt: 300,
  lastMatchAt: 400,
  endedAt: null as number | null,
};

describe('categoryOf', () => {
  it('只收三種分類，缺值與亂值都是 league', () => {
    expect(categoryOf(undefined)).toBe('league');
    expect(categoryOf(null)).toBe('league');
    expect(categoryOf({})).toBe('league');
    expect(categoryOf({ category: 'league' })).toBe('league');
    expect(categoryOf({ category: 'cup' })).toBe('cup');
    expect(categoryOf({ category: 'friendly' })).toBe('friendly');
    expect(categoryOf({ category: 'knockout' })).toBe('league');
    expect(categoryOf({ category: '' })).toBe('league');
    expect(categoryOf({ category: 1 })).toBe('league');
  });
});

describe('competitionPhase', () => {
  it('依時間分成招募、預熱、進行中、已結束', () => {
    expect(competitionPhase(times, 50)).toBe('recruit');
    expect(competitionPhase(times, 100)).toBe('recruit');
    expect(competitionPhase(times, 200)).toBe('recruit');
    expect(competitionPhase(times, 201)).toBe('warm');
    expect(competitionPhase(times, 299)).toBe('warm');
    expect(competitionPhase(times, 300)).toBe('live');
    expect(competitionPhase(times, 400)).toBe('live');
    // 400、401 都還在末場那個台北日裡，過了末場時刻也不結束。
    expect(competitionPhase(times, 401)).toBe('live');
  });

  it('末場當天晚於 lastMatchAt 但未過午夜仍是進行中，過午夜才結束', () => {
    const lastMatchAt = Date.parse('2026-12-05T18:30:00+08:00');
    const sameEvening = Date.parse('2026-12-05T23:59:00+08:00');
    const midnight = Date.parse('2026-12-06T00:00:00+08:00');
    const doc = {
      ...times,
      firstMatchAt: Date.parse('2026-12-05T09:00:00+08:00'),
      lastMatchAt,
    };
    expect(competitionPhase(doc, lastMatchAt)).toBe('live');
    expect(competitionPhase(doc, lastMatchAt + 60 * 60 * 1000)).toBe('live');
    expect(competitionPhase(doc, sameEvening)).toBe('live');
    expect(competitionPhase(doc, midnight - 1)).toBe('live');
    expect(competitionPhase(doc, midnight)).toBe('done');
    expect(competitionPhase({ ...doc, endedAt: lastMatchAt }, sameEvening)).toBe('done');
    expect(competitionPhase({ ...doc, status: 'cancelled' }, sameEvening)).toBe('done');
  });

  it('已寫結束時間或已取消就是已結束；草稿與延期仍照時間', () => {
    expect(competitionPhase({ ...times, endedAt: 150 }, 120)).toBe('done');
    expect(competitionPhase({ ...times, endedAt: 0 }, 120)).toBe('done');
    expect(competitionPhase({ ...times, status: 'cancelled' }, 150)).toBe('done');
    expect(competitionPhase({ ...times, status: 'draft' }, 150)).toBe('recruit');
    expect(competitionPhase({ ...times, status: 'postponed' }, 250)).toBe('warm');
    expect(competitionPhase({ ...times, status: 'postponed' }, 350)).toBe('live');
  });
});

describe('crestIndex', () => {
  it('落在 0～7，同 id 永遠同值，空字串是 0', () => {
    expect(crestIndex('')).toBe(0);
    const ids = ['team_a', 'team_b', '海風隊', '山貓隊', 'en_1', 'en_2', 'α', '⚽️'];
    const seen = new Set<number>();
    for (const id of ids) {
      const index = crestIndex(id);
      expect(index).toBe(refIndex(id));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(8);
      expect(crestIndex(id)).toBe(index);
      seen.add(index);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('crestInitial', () => {
  it('取第一個字素，空的回問號', () => {
    expect(crestInitial('')).toBe('?');
    expect(crestInitial('   ')).toBe('?');
    expect(crestInitial('海風隊')).toBe('海');
    expect(crestInitial('  青鳥隊')).toBe('青');
    expect(crestInitial('A隊')).toBe('A');
    expect(crestInitial('a\u0301隊')).toBe('a\u0301');
    expect(crestInitial('⚽️隊')).toBe('⚽️');
  });
});
