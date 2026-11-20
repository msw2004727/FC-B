import { describe, expect, it } from 'vitest';
import { taipeiMs } from '../format';
import { hostMatchesBoard, splitCount } from './host-board';

const fill = (template: string) => (n: string, m: string) => template.replace('{teams}', n).replace('{max}', m);

describe('矮板數字格切字（第 4 批 3.3）', () => {
  it('繁中：數字前是小標、數字後是尾巴', () => {
    expect(splitCount(fill('已核准 {teams}／{max} 隊'), 5, 16)).toEqual({ k: '已核准', n: 5, tail: '／16 隊' });
  });

  it('英文句型照樣切', () => {
    expect(splitCount(fill('Approved {teams}/{max} teams'), 3, 8)).toEqual({ k: 'Approved', n: 3, tail: '/8 teams' });
  });

  it('數字在句首、或句子裡沒有數字：切不到，整句當一格', () => {
    expect(splitCount(fill('{teams}/{max} approved'), 3, 8)).toBeNull();
    expect(splitCount(() => '已核准', 3, 8)).toBeNull();
  });
});

describe('賽程管理矮板的數字（第 4 批 3.4）', () => {
  const now = taipeiMs(2027, 1, 9, 12, 0);
  const at = (h: number, m = 0, day = 9) => taipeiMs(2027, 1, day, h, m);

  it('進行中含中場；待確認只算 finished；今天不含已取消；下一場是今天未賽、還沒到的最早一場', () => {
    const board = hostMatchesBoard([
      { id: 'a', status: 'live', kickoffAt: at(11) },
      { id: 'b', status: 'halftime', kickoffAt: at(11, 30) },
      { id: 'c', status: 'finished', kickoffAt: at(10) },
      { id: 'd', status: 'scheduled', kickoffAt: at(9) },
      { id: 'e', status: 'scheduled', kickoffAt: at(15) },
      { id: 'f', status: 'scheduled', kickoffAt: at(14) },
      { id: 'g', status: 'cancelled', kickoffAt: at(13) },
      { id: 'h', status: 'scheduled', kickoffAt: at(9, 0, 10) },
      { id: 'i', status: 'postponed', kickoffAt: null },
    ], now);
    expect(board).toEqual({ live: 2, next: { id: 'f', kickoffAt: at(14) }, today: 6, pending: 1 });
  });

  it('今天沒有場次：下一場是 null、今天 0', () => {
    expect(hostMatchesBoard([{ id: 'x', status: 'scheduled', kickoffAt: at(9, 0, 10) }], now))
      .toEqual({ live: 0, next: null, today: 0, pending: 0 });
  });
});
