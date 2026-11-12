import { describe, expect, it } from 'vitest';
import { shouldFoldTimelineEvent } from './timeline-fold';
import type { EventDoc } from './types';

const at = (iso: string): number => Date.parse(`${iso}+08:00`);
const ev = (over: Partial<EventDoc>): EventDoc => ({ id: 'e', status: 'open', ...over } as EventDoc);

describe('shouldFoldTimelineEvent（顧問 §3.136：結束時間已過或已取消才收合）', () => {
  it('進行中不收合；結束時間一到就收合', () => {
    const e = ev({ date: '2030/10/19 18:00~20:00' });
    expect(shouldFoldTimelineEvent(e, at('2030-10-19T17:59:00'))).toBe(false);
    expect(shouldFoldTimelineEvent(e, at('2030-10-19T19:00:00'))).toBe(false);
    expect(shouldFoldTimelineEvent(e, at('2030-10-19T19:59:59'))).toBe(false);
    expect(shouldFoldTimelineEvent(e, at('2030-10-19T20:00:00'))).toBe(true);
  });

  it('已取消即收合（未開始也收）', () => {
    expect(shouldFoldTimelineEvent(ev({ status: 'cancelled', date: '2030/10/21 18:00~20:00' }), at('2030-10-19T12:00:00'))).toBe(true);
  });

  it('主辦手動標成 ended 但結束時間未到：仍不收合（現場要找卡簽到）', () => {
    expect(shouldFoldTimelineEvent(ev({ status: 'ended', date: '2030/10/19 18:00~20:00' }), at('2030-10-19T19:00:00'))).toBe(false);
  });

  it('沒有結束時間：退回開始時間', () => {
    const e = ev({ date: '2030/10/19 18:00' });
    expect(shouldFoldTimelineEvent(e, at('2030-10-19T17:59:00'))).toBe(false);
    expect(shouldFoldTimelineEvent(e, at('2030-10-19T18:00:00'))).toBe(true);
  });

  it('跨日場次（22:00~01:00）結束在隔天 01:00', () => {
    const e = ev({ date: '2030/10/19 22:00~01:00' });
    expect(shouldFoldTimelineEvent(e, at('2030-10-19T23:30:00'))).toBe(false);
    expect(shouldFoldTimelineEvent(e, at('2030-10-20T00:30:00'))).toBe(false);
    expect(shouldFoldTimelineEvent(e, at('2030-10-20T01:00:00'))).toBe(true);
  });

  it('只有日期：當天 23:59 才收合', () => {
    const e = ev({ date: '2030/10/19' });
    expect(shouldFoldTimelineEvent(e, at('2030-10-19T23:58:00'))).toBe(false);
    expect(shouldFoldTimelineEvent(e, at('2030-10-19T23:59:00'))).toBe(true);
  });

  it('不是站內日期字串時退回開始時間；連開始時間都沒有才看 status', () => {
    const ts = at('2030-10-19T18:00:00');
    expect(shouldFoldTimelineEvent(ev({ date: ts as unknown as string }), ts - 1)).toBe(false);
    expect(shouldFoldTimelineEvent(ev({ date: ts as unknown as string }), ts)).toBe(true);
    expect(shouldFoldTimelineEvent(ev({ date: undefined, status: 'ended' }), 0)).toBe(true);
    expect(shouldFoldTimelineEvent(ev({ date: undefined, status: 'open' }), 0)).toBe(false);
  });
});
