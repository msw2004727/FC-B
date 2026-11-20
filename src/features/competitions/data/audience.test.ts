import { Timestamp } from 'firebase/firestore';
import { afterEach, describe, expect, it } from 'vitest';
import { clockFromBase } from '../live/clock';
import { taipeiMs } from '../format';
import type { EntryDoc, SummaryEntry } from './types';
import {
  DASH,
  audienceMatchFromDoc,
  bindVisible,
  hasLiveOnMatchDay,
  mergeSummaryShard,
  pageLoop,
  parseStats,
  parseTimelineDoc,
  parseVoidDoc,
  pkPair,
  scorerTables,
  showsCorrected,
  summaryVenue,
  teamNameByEnId,
} from './audience';
import { matchDayOf } from './match-day';

function entry(partial: Partial<SummaryEntry> & Pick<SummaryEntry, 'id' | 'st'>): SummaryEntry {
  return {
    dv: 'dv_1',
    r: 1,
    no: 1,
    k: null,
    v: null,
    h: { id: 'en_h', n: '主' },
    a: { id: 'en_a', n: '客' },
    s: [0, 0],
    wo: null,
    ...partial,
  };
}

const entryDoc = (id: string, name: string): EntryDoc => ({
  id,
  dvId: 'dv_1',
  teamId: `club_${id}`,
  name,
  status: 'approved',
  rosterCount: 0,
  rosterConfirmed: false,
  teamLogo: null,
});

describe('比分已更正與 PK', () => {
  it('只有已有結果且 cx 是數字才顯示；重置回未賽不顯示', () => {
    expect(showsCorrected({ st: 'finished', cx: 10 })).toBe(true);
    expect(showsCorrected({ st: 'confirmed', cx: 0 })).toBe(true);
    expect(showsCorrected({ st: 'walkover', cx: 3 })).toBe(true);
    expect(showsCorrected({ st: 'scheduled', cx: 10 })).toBe(false);
    expect(showsCorrected({ st: 'live', cx: 10 })).toBe(false);
    expect(showsCorrected({ st: 'confirmed', cx: null })).toBe(false);
    expect(showsCorrected({ st: 'confirmed' })).toBe(false);
  });

  it('p 要兩個有限數字', () => {
    expect(pkPair([4, 3])).toEqual([4, 3]);
    expect(pkPair([0, 0])).toEqual([0, 0]);
    expect(pkPair([1])).toBeNull();
    expect(pkPair(['1', 2])).toBeNull();
    expect(pkPair(null)).toBeNull();
  });
});

describe('場次文件', () => {
  it('留下隊徽、PK 與改分時間，不帶點數', () => {
    const match = audienceMatchFromDoc('mt1', {
      status: 'finished',
      home: { teamId: 'en_h', name: '雷霆隊', logo: ' https://x/h ' },
      away: { id: 'en_a', n: '海風隊' },
      score: { home: 2, away: 1 },
      penaltyScore: { home: 0, away: 0 },
      scoreCorrectedAt: 9,
      rev: 3,
      resetRev: 1,
      homePoints: 3,
      awayPoints: 0,
    });
    expect(match).toMatchObject({
      id: 'mt1',
      status: 'finished',
      score: { home: 2, away: 1 },
      penaltyScore: { home: 0, away: 0 },
      scoreCorrectedAt: 9,
      rev: 3,
      resetRev: 1,
      home: { teamId: 'en_h', name: '雷霆隊', logo: 'https://x/h' },
      away: { teamId: 'en_a', name: '海風隊', logo: null },
    });
    expect(match && 'homePoints' in match).toBe(false);
    expect(match && 'awayPoints' in match).toBe(false);
    expect(audienceMatchFromDoc('mt_bad', { status: 'nope' })).toBeNull();
  });

  it('新外觀卡 3-5：已取消的原因從同一份場次文件解析，沒有或空白是 null', () => {
    const base = { status: 'cancelled', home: { teamId: 'en_h', name: '雷霆隊' }, away: { teamId: 'en_a', name: '海風隊' } };
    expect(audienceMatchFromDoc('mt1', { ...base, cancelReason: ' 大雨，場地無法使用 ' })?.cancelReason).toBe('大雨，場地無法使用');
    expect(audienceMatchFromDoc('mt1', { ...base, cancelReason: '  ' })?.cancelReason).toBeNull();
    expect(audienceMatchFromDoc('mt1', base)?.cancelReason).toBeNull();
    expect(audienceMatchFromDoc('mt1', { ...base, cancelReason: 3 })?.cancelReason).toBeNull();
  });

  it('時間軸有 n、no 就留下', () => {
    expect(parseTimelineDoc({
      seq: 4, type: 'goal', side: 'home', plId: 'pl1', goalKind: 'normal', n: ' 劉冠廷 ', no: 9, matchSecond: 300,
    })).toMatchObject({ number: 9, playerName: '劉冠廷', plId: 'pl1', side: 'home' });
    expect(parseTimelineDoc({ seq: 1 })).toBeNull();
    expect(parseTimelineDoc({ seq: 2, type: 'goal', no: 1.5, n: '  ' })?.number).toBeNull();
  });
});

describe('場地', () => {
  const venues = [{ name: '一號' }, { name: ' 二號 ' }];

  it('未確認用序號，缺值或超出用 v；已確認與棄權用 v', () => {
    expect(summaryVenue({ st: 'scheduled', v: '原場', vi: 1 }, venues)).toBe('二號');
    expect(summaryVenue({ st: 'live', v: '原場', vi: 0 }, venues)).toBe('一號');
    expect(summaryVenue({ st: 'halftime', v: '原場' }, venues)).toBe('原場');
    expect(summaryVenue({ st: 'scheduled', v: '原場', vi: 5 }, venues)).toBe('原場');
    expect(summaryVenue({ st: 'scheduled', v: '原場', vi: -1 }, venues)).toBe('原場');
    expect(summaryVenue({ st: 'scheduled', v: '原場', vi: 1.5 }, venues)).toBe('原場');
    expect(summaryVenue({ st: 'confirmed', v: '確認場', vi: 0 }, venues)).toBe('確認場');
    expect(summaryVenue({ st: 'walkover', v: '棄權場', vi: 0 }, venues)).toBe('棄權場');
    expect(summaryVenue({ st: 'finished', wo: 'away', v: '有棄權', vi: 0 }, venues)).toBe('有棄權');
    expect(summaryVenue({ st: 'scheduled', v: '原場', vi: 0 })).toBe('原場');
  });
});

describe('今天有沒有進行中', () => {
  const now = taipeiMs(2026, 12, 5, 12, 0);

  it('比賽日上的 live／halftime 才算；凌晨場歸前一日', () => {
    expect(hasLiveOnMatchDay([
      entry({ id: 'a', st: 'scheduled', k: now }),
    ], now)).toBe(false);
    expect(hasLiveOnMatchDay([
      entry({ id: 'a', st: 'live', k: now }),
    ], now)).toBe(true);
    expect(hasLiveOnMatchDay([
      entry({ id: 'a', st: 'halftime', k: taipeiMs(2026, 12, 5, 18, 0) }),
    ], now)).toBe(true);
    expect(hasLiveOnMatchDay([
      entry({ id: 'a', st: 'live', k: taipeiMs(2026, 12, 6, 9, 0) }),
    ], now)).toBe(false);
    const early = taipeiMs(2026, 12, 5, 1, 0);
    expect(matchDayOf(early).key).toBe('2026-12-04');
    expect(hasLiveOnMatchDay([
      entry({ id: 'a', st: 'live', k: early }),
    ], taipeiMs(2026, 12, 5, 2, 0))).toBe(true);
    expect(hasLiveOnMatchDay([
      entry({ id: 'a', st: 'live', k: null }),
    ], now)).toBe(false);
  });

  it('監聽換掉同一個比賽日，其他天留著', () => {
    const today = entry({ id: 'old', st: 'live', k: now, s: [0, 0] });
    const other = entry({ id: 'keep', st: 'scheduled', k: taipeiMs(2026, 12, 6, 9, 0) });
    const tbd = entry({ id: 'tbd', st: 'postponed', k: null });
    const next = entry({ id: 'old', st: 'live', k: now, s: [1, 0] });
    const merged = mergeSummaryShard([today, other, tbd], [next], now);
    expect(merged.map((row) => row.id)).toEqual(['keep', 'tbd', 'old']);
    expect(merged.find((row) => row.id === 'old')?.s).toEqual([1, 0]);
  });
});

describe('射手榜加總', () => {
  const teams = [entryDoc('en_h', '雷霆隊'), entryDoc('en_a', '海風隊')];
  const name = (enId: string) => teamNameByEnId(enId, teams);

  it('跨場加總、進球與紅黃牌排序、同分同名次、缺名與缺隊是破折號', () => {
    const stats = parseStats({
      m: {
        mt_1: {
          pl_a: { n: '王一', e: 'en_h', g: 1, y: 1, r: 0 },
          pl_b: { n: '李二', e: 'en_missing', g: 2, y: 0, r: 1 },
        },
        mt_2: {
          pl_a: { g: 1, y: 0, r: 0 },
          pl_c: { y: 2, r: 1 },
          pl_d: { n: ' ', g: 0, y: 0, r: 0 },
        },
      },
    });
    const table = scorerTables(stats, name);
    expect(table.empty).toBe(false);
    expect(table.stalled).toBe(false);
    expect(table.scorers.map((row) => [row.rank, row.displayName, row.teamName, row.goals])).toEqual([
      [1, '王一', '雷霆隊', 2],
      [1, '李二', DASH, 2],
    ]);
    expect(table.cards.map((row) => [row.rank, row.displayName, row.yellow, row.red])).toEqual([
      [1, DASH, 2, 1],
      [2, '李二', 0, 1],
      [3, '王一', 1, 0],
    ]);
  });

  it('stalledAt 為 0 也算停更；沒有紀錄是空的；超過 50 名才截斷', () => {
    expect(parseStats({ stalledAt: 0, stalledMt: 'mt_x', m: {} }).stalled).toBe(true);
    expect(parseStats({ m: {} }).stalled).toBe(false);
    expect(scorerTables(parseStats({ m: { mt: { pl: { g: 0, y: 0, r: 0 } } } }), () => null).empty).toBe(true);
    const players: Record<string, { n: string; g: number }> = {};
    for (let i = 0; i < 51; i += 1) players[`pl_${i}`] = { n: `員${i}`, g: 51 - i };
    const table = scorerTables(parseStats({ stalledAt: 5, m: { mt: players } }), () => '雷霆隊');
    expect(table.stalled).toBe(true);
    expect(table.capped).toBe(true);
    expect(table.scorers).toHaveLength(50);
    expect(table.scorers[0]?.rank).toBe(1);
    expect(table.scorers[49]?.rank).toBe(50);
    expect(table.scorers.some((row) => row.displayName === '員50')).toBe(false);
  });

  it('同進球數同名次，下一名跳號', () => {
    const table = scorerTables(parseStats({
      m: { mt: { a: { n: '甲', g: 3, e: 'en_h' }, b: { n: '乙', g: 3, e: 'en_h' }, c: { n: '丙', g: 1, e: 'en_h' } } },
    }), (enId) => teamNameByEnId(enId, teams));
    expect(table.scorers.map((row) => [row.displayName, row.rank])).toEqual([
      ['甲', 1],
      ['乙', 1],
      ['丙', 3],
    ]);
    expect(table.scorers.every((row) => row.isMinor === false)).toBe(true);
  });
});

describe('紀錄分頁', () => {
  function fetchOf(seqs: readonly number[]) {
    const sorted = [...seqs].sort((a, b) => a - b);
    return async (page: { afterSeq: number; limit: number; cursor: number | null }) => {
      const eligible = sorted.filter((seq) => seq > page.afterSeq);
      const start = page.cursor == null ? 0 : eligible.indexOf(page.cursor) + 1;
      return eligible.slice(start, start + page.limit);
    };
  }

  it('0、100、101、200 筆的頁數與讀取量', async () => {
    await expect(pageLoop(fetchOf([]), 0, 0)).resolves.toEqual({ rows: [], reads: 1 });
    const hundred = await pageLoop(fetchOf(Array.from({ length: 100 }, (_, i) => i + 1)), 0, 0);
    expect(hundred.rows).toHaveLength(100);
    // 滿頁代表後面可能還有，會再查一次。沒有第 101 筆時這一頁是空的，讀取多 1，合計 102。
    expect(hundred.reads).toBe(102);
    const oneMore = await pageLoop(fetchOf(Array.from({ length: 101 }, (_, i) => i + 1)), 0, 0);
    expect(oneMore.rows).toHaveLength(101);
    expect(oneMore.reads).toBe(103);
    const full = await pageLoop(fetchOf(Array.from({ length: 250 }, (_, i) => i + 1)), 0, 0);
    expect(full.rows).toHaveLength(200);
    expect(full.reads).toBe(202);
    expect(full.rows[199]).toBe(200);
  });

  it('已讀滿 200 不再查；補讀只拿 seq 大於已讀最大值', async () => {
    await expect(pageLoop(fetchOf([1, 2, 3]), 0, 200)).resolves.toEqual({ rows: [], reads: 0 });
    const more = await pageLoop(fetchOf([1, 2, 3, 4]), 2, 2);
    expect(more.rows).toEqual([3, 4]);
    expect(more.reads).toBe(3);
  });
});

describe('可見才監聽', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState');
  });

  function setVisibility(value: DocumentVisibilityState): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  }

  it('隱藏時不掛，回前景才掛，再隱藏就解除', () => {
    setVisibility('hidden');
    let live = 0;
    const stop = bindVisible(() => {
      live += 1;
      return () => {
        live -= 1;
      };
    });
    expect(live).toBe(0);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(live).toBe(1);
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(live).toBe(0);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(live).toBe(1);
    stop();
    expect(live).toBe(0);
  });
});

describe('觀眾頁時鐘讀真實 Firestore Timestamp（11-20 走查回歸）', () => {
  it('clockBase.startedAt 是 Timestamp 時時鐘會走，不停在暫停累計秒數', () => {
    const startMs = taipeiMs(2026, 11, 20, 13, 0);
    const match = audienceMatchFromDoc('mt1', {
      status: 'live',
      home: { teamId: 'en_h', name: '雷霆隊' },
      away: { teamId: 'en_a', name: '海風隊' },
      score: { home: 0, away: 1 },
      clockBase: { startedAt: Timestamp.fromMillis(startMs), pausedSec: 30, running: true, period: 'h1' },
      rev: 2,
      resetRev: 0,
    });
    expect(match?.clockBase.startedAt).toBe(startMs);
    expect(clockFromBase(match!.clockBase, startMs + 90_000).elapsedSec).toBe(120);
    expect(clockFromBase(match!.clockBase, startMs + 91_000).elapsedSec).toBe(121);
  });
});

describe('其他時間欄位讀真實 Firestore Timestamp（顧問 §3.381）', () => {
  const at = taipeiMs(2026, 11, 20, 14, 30);
  const base = {
    status: 'scheduled',
    home: { teamId: 'en_h', name: '雷霆隊' },
    away: { teamId: 'en_a', name: '海風隊' },
    rev: 1,
    resetRev: 0,
  };

  it('kickoffAt 是 Timestamp 時讀得到開賽時刻', () => {
    expect(audienceMatchFromDoc('mt1', { ...base, kickoffAt: Timestamp.fromMillis(at) })?.kickoffAt).toBe(at);
  });

  it('scoreCorrectedAt 是 Timestamp 時讀得到更正時間', () => {
    const match = audienceMatchFromDoc('mt1', { ...base, status: 'finished', scoreCorrectedAt: Timestamp.fromMillis(at) });
    expect(match?.scoreCorrectedAt).toBe(at);
  });

  it('時間軸 createdAt 是 Timestamp 時不會變成 0', () => {
    expect(parseTimelineDoc({ seq: 3, type: 'goal', side: 'home', matchSecond: 60, createdAt: Timestamp.fromMillis(at) })?.event.createdAt).toBe(at);
  });

  it('作廢紀錄 createdAt 是 Timestamp 時不會變成 0', () => {
    expect(parseVoidDoc('3', { targetSeq: 3, seq: 5, createdAt: Timestamp.fromMillis(at) })?.createdAt).toBe(at);
  });
});
