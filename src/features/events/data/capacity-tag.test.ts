import { describe, expect, it } from 'vitest';
import { buildCapacityTagModel } from './capacity-tag';
import type { EventDoc } from './types';

const base = { id: 'e', type: 'friendly', status: 'open', date: '2030/10/19 18:00~20:00', max: 20, current: 10 } as EventDoc;
const ev = (extra: Record<string, unknown>): EventDoc => ({ ...base, ...extra }) as EventDoc;
const team = (reserved: number, used: number) => [{ teamId: 't', reservedSlots: reserved, usedSlots: used, remainingSlots: reserved - used }];

describe('buildCapacityTagModel（人數標籤口徑，同計量條）', () => {
  it('報名中：已報／上限', () => {
    expect(buildCapacityTagModel(base, 'open')).toEqual({ confirmed: 10, max: 20, state: 'open', long: false });
  });

  it('已報用實際正取（realCurrent，不含團隊保留未報），額滿看正取＋團隊未報 ≥ 上限', () => {
    const m = buildCapacityTagModel(ev({ max: 27, current: 27, realCurrent: 23, teamReservationSummaries: team(8, 4) }), 'open');
    expect(m).toEqual({ confirmed: 23, max: 27, state: 'full', long: false });
  });

  it('沒有 realCurrent 時 current 扣掉團隊未報', () => {
    const m = buildCapacityTagModel(ev({ max: 24, current: 18, teamReservationSummaries: team(8, 4) }), 'open');
    expect(m?.confirmed).toBe(14);
    expect(m?.state).toBe('open');
  });

  it('有候補優先於額滿', () => {
    expect(buildCapacityTagModel(ev({ max: 20, current: 20, waitlist: 3, status: 'full' }), 'full')?.state).toBe('wait');
  });

  it('狀態已是額滿（例如手動額滿）也算額滿', () => {
    expect(buildCapacityTagModel(ev({ max: 20, current: 12 }), 'full')?.state).toBe('full');
  });

  it('尚未開放報名為灰色；不限人數（max 0）只帶已報數、灰色', () => {
    expect(buildCapacityTagModel(base, 'upcoming')?.state).toBe('upcoming');
    expect(buildCapacityTagModel(ev({ max: 0, current: 6 }), 'open')).toEqual({ confirmed: 6, max: 0, state: 'nomax', long: false });
  });

  it('已結束、已取消、外部活動不顯示', () => {
    expect(buildCapacityTagModel(base, 'ended')).toBeNull();
    expect(buildCapacityTagModel(base, 'cancelled')).toBeNull();
    expect(buildCapacityTagModel(ev({ type: 'external' }), 'open')).toBeNull();
  });

  it('6 字以上（128/200）標記 long，收起人形圖示讓標籤不比狀態欄寬', () => {
    expect(buildCapacityTagModel(ev({ max: 200, current: 128 }), 'open')?.long).toBe(true);
    expect(buildCapacityTagModel(ev({ max: 100, current: 99 }), 'open')?.long).toBe(true);
    expect(buildCapacityTagModel(ev({ max: 99, current: 10 }), 'open')?.long).toBe(false);
  });
});
