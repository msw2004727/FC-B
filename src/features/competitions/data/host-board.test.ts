import { describe, expect, it } from 'vitest';
import { splitCount } from './host-board';

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
