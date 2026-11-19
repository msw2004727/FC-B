import { describe, expect, it } from 'vitest';
import {
  S4_ACTION_LOG,
  S4_LIVE_EVENTS,
  S4_LIVE_VOIDS,
  S4_ROSTER_AWAY,
  S4_ROSTER_HOME,
  STEP4_SCREENS,
  cardIssues,
  deriveScore,
  s4Match,
  sequenceIssues,
} from './step4-fixtures';

describe('第 4 步預覽假資料一致性', () => {
  it('進行中場次比分等於有效進球', () => {
    expect(deriveScore(S4_LIVE_EVENTS, S4_LIVE_VOIDS)).toEqual(s4Match().score);
  });

  it('事件 seq 連續且等於 rev，作廢只指向更早的進球', () => {
    expect(sequenceIssues(S4_LIVE_EVENTS, s4Match().rev)).toEqual([]);
  });

  it('第二張黃牌前同人已有黃牌', () => {
    expect(cardIssues(S4_LIVE_EVENTS, S4_LIVE_VOIDS)).toEqual([]);
  });

  it('事件裡的球員都在兩隊名單上、隊別相符', () => {
    const side = new Map<string, 'home' | 'away'>();
    for (const p of S4_ROSTER_HOME) side.set(p.id, 'home');
    for (const p of S4_ROSTER_AWAY) side.set(p.id, 'away');
    for (const ev of S4_LIVE_EVENTS) {
      if ((ev.type === 'goal' && ev.plId) || ev.type === 'card') {
        expect(side.get(ev.plId!), `e${ev.seq}`).toBe(ev.side);
      }
    }
  });

  it('同隊背號不重複、id 符合 pl_ 格式', () => {
    for (const list of [S4_ROSTER_HOME, S4_ROSTER_AWAY]) {
      expect(new Set(list.map((p) => p.number)).size).toBe(list.length);
      for (const p of list) expect(p.id).toMatch(/^pl_[A-Za-z0-9_-]{1,37}$/);
    }
  });

  it('作廢 seq 低於 resetRev 的事件不計分', () => {
    expect(deriveScore(S4_LIVE_EVENTS, S4_LIVE_VOIDS, 4)).toEqual({ home: 0, away: 0 });
  });

  it('畫面清單不重複；日誌有待送與被拒各至少一筆', () => {
    expect(new Set(STEP4_SCREENS).size).toBe(STEP4_SCREENS.length);
    expect(S4_ACTION_LOG.some((a) => a.state === 'pending')).toBe(true);
    expect(S4_ACTION_LOG.some((a) => a.state === 'rejected')).toBe(true);
  });
});
