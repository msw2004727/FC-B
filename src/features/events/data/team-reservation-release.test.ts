import { describe, expect, it } from 'vitest';
import {
  countReleasedSummary,
  formatReleaseCountdown,
  getTeamReservationReleaseMeta,
  hasTeamReservationReleasedAt,
  normalizeReleaseHours,
} from './team-reservation-release';

const MIN = 60_000;
const H = 3_600_000;

describe('formatReleaseCountdown', () => {
  it.each([
    ['59 分', 59 * MIN, '59 分鐘後釋出'],
    ['60 分', 60 * MIN, '1 小時後釋出'],
    ['47h59m', 47 * H + 59 * MIN, '47 小時後釋出'],
    ['48h', 48 * H, '2 天後釋出'],
    ['0', 0, '即將釋出'],
    ['負值', -5 * MIN, '即將釋出'],
  ])('%s → %s', (_label, ms, expected) => {
    expect(formatReleaseCountdown(ms)).toBe(expected);
  });

  it('三段一律 floor', () => {
    expect(formatReleaseCountdown(59 * MIN + 59_999)).toBe('59 分鐘後釋出');
    expect(formatReleaseCountdown(6 * H - 1)).toBe('5 小時後釋出');
    expect(formatReleaseCountdown(3 * 24 * H - 1)).toBe('2 天後釋出');
  });
});

describe('normalizeReleaseHours／hasTeamReservationReleasedAt／countReleasedSummary', () => {
  it('只認允許值，其餘為 0', () => {
    for (const hours of [0, 3, 6, 12, 24, 48, 72]) expect(normalizeReleaseHours(hours)).toBe(hours);
    for (const raw of [undefined, null, 5, '12', -3, Number.NaN]) expect(normalizeReleaseHours(raw)).toBe(0);
  });

  it('releasedAt 存在即為終態', () => {
    expect(hasTeamReservationReleasedAt({ seconds: 1 })).toBe(true);
    expect(hasTeamReservationReleasedAt(undefined)).toBe(false);
    expect(hasTeamReservationReleasedAt(null)).toBe(false);
  });

  it('摘要先驗形狀，不符的項目不計', () => {
    expect(countReleasedSummary([{ teamId: 't1', teamName: 'A', releasedSlots: 2 }])).toBe(1);
    expect(countReleasedSummary([])).toBe(0);
    expect(countReleasedSummary('x')).toBe(0);
    expect(countReleasedSummary([{ teamId: '', releasedSlots: 1 }, { teamId: 't', releasedSlots: -1 }, { teamId: 't', releasedSlots: 1.5 }])).toBe(0);
  });
});

describe('getTeamReservationReleaseMeta', () => {
  // 2026/06/10 14:00 台北開始。
  const START = Date.parse('2026-06-10T14:00:00+08:00');
  const event = { status: 'open', date: '2026/06/10 14:00~16:00', teamReservationReleaseHours: 12 };

  it('hours>0、未釋出、有團隊保留 → 倒數（releaseAt = start − hours）', () => {
    expect(getTeamReservationReleaseMeta(event, 4, START - 18 * H)).toEqual({ kind: 'countdown', text: '6 小時後釋出', soon: false });
    expect(getTeamReservationReleaseMeta(event, 4, START - 12 * H - 45 * MIN)).toEqual({ kind: 'countdown', text: '45 分鐘後釋出', soon: true });
    expect(getTeamReservationReleaseMeta(event, 4, START - 11 * H)).toEqual({ kind: 'countdown', text: '即將釋出', soon: true });
    expect(getTeamReservationReleaseMeta({ ...event, teamReservationReleaseHours: 72 }, 4, START - 6 * 24 * H))
      .toEqual({ kind: 'countdown', text: '3 天後釋出', soon: false });
  });

  it('hours 為 0、沒有欄位、沒有團隊保留、已開始或已結束 → none', () => {
    expect(getTeamReservationReleaseMeta({ ...event, teamReservationReleaseHours: 0 }, 4, START - 18 * H)).toEqual({ kind: 'none' });
    expect(getTeamReservationReleaseMeta({ status: 'open', date: event.date }, 4, START - 18 * H)).toEqual({ kind: 'none' });
    expect(getTeamReservationReleaseMeta(event, 0, START - 18 * H)).toEqual({ kind: 'none' });
    expect(getTeamReservationReleaseMeta(event, 4, START + MIN)).toEqual({ kind: 'none' });
    expect(getTeamReservationReleaseMeta({ ...event, status: 'cancelled' }, 4, START - 18 * H)).toEqual({ kind: 'none' });
  });

  it('已釋出：summary 非空才顯示已釋出；summary 空不顯示任何釋出字樣', () => {
    const released = { ...event, teamReservationReleasedAt: { seconds: 1 } };
    expect(getTeamReservationReleaseMeta(
      { ...released, teamReservationReleasedSummary: [{ teamId: 't1', teamName: 'A', releasedSlots: 3 }] },
      0,
      START - H,
    )).toEqual({ kind: 'released' });
    expect(getTeamReservationReleaseMeta({ ...released, teamReservationReleasedSummary: [] }, 0, START - H)).toEqual({ kind: 'none' });
    expect(getTeamReservationReleaseMeta(released, 0, START - H)).toEqual({ kind: 'none' });
    // 釋出後手動再預留：照常顯示數字，不再倒數。
    expect(getTeamReservationReleaseMeta(
      { ...released, teamReservationReleasedSummary: [{ teamId: 't1', teamName: 'A', releasedSlots: 3 }] },
      2,
      START - H,
    )).toEqual({ kind: 'none' });
  });
});
