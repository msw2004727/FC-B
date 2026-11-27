import { describe, expect, it } from 'vitest';
import { computeSportPromptDue } from './viewer';

describe('computeSportPromptDue', () => {
  it('四欄齊且無 promptAt 為 true', () => {
    expect(computeSportPromptDue({ gender: '男', birthday: '2000/01/01', region: '台北市' })).toBe(true);
  });

  it('缺任一欄為 false', () => {
    expect(computeSportPromptDue({ gender: '男', birthday: '2000/01/01' })).toBe(false);
    expect(computeSportPromptDue({ gender: '男', region: '台北市' })).toBe(false);
    expect(computeSportPromptDue({ birthday: '2000/01/01', region: '台北市' })).toBe(false);
  });

  it('有 promptAt 為 false', () => {
    expect(computeSportPromptDue({ gender: '男', birthday: '2000/01/01', region: '台北市', favSportsPromptAt: 1 })).toBe(false);
  });
});
