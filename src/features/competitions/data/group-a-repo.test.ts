import { describe, expect, it } from 'vitest';
import { divisionFromDoc } from './cp-repo';

// 賽事 A 組 B3：組別文件的 schedule.matchCount 讀成 scheduledMatches，給「產生賽程會取代 N 場」用。
describe('divisionFromDoc scheduledMatches', () => {
  const raw = { name: '成人組', playersOnField: 5, maxTeams: 8, rosterMin: 7, rosterMax: 12, feePerTeam: 0, entryCount: 0, approvedCount: 0, order: 0 };
  it('有賽程讀場次數；沒有賽程或缺欄是 0', () => {
    expect(divisionFromDoc('dv_a', { ...raw, schedule: { matchCount: 6, ranking: 'points' } })?.scheduledMatches).toBe(6);
    expect(divisionFromDoc('dv_a', { ...raw })?.scheduledMatches).toBe(0);
    expect(divisionFromDoc('dv_a', { ...raw, schedule: { ranking: 'points' } })?.scheduledMatches).toBe(0);
  });
});
