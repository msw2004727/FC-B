import { describe, expect, it } from 'vitest';
import { clockFromBase, formatMatchClock, undoClock } from '../live/clock';
import { eventLines, pkScore } from '../live/present';
import { derivePublicTable } from '../live/stats';
import {
  S4_ACTION_LOG,
  S4_CONFIRMED,
  S4_CRESTS,
  S4_CREST_URL,
  S4_DETAIL_ROWS,
  S4_FT_AT,
  S4_FT_EVENTS,
  S4_LIVE_EVENTS,
  S4_LIVE_VOIDS,
  S4_NOW,
  S4_PEOPLE,
  S4_ROSTER_AWAY,
  S4_ROSTER_HOME,
  S4_ROSTER_HOME_LONG,
  S4_SCENE_CAP,
  S4_SCENE_FT,
  S4_SCENE_HT,
  S4_SCENE_LIVE,
  S4_SCENE_OFFLINE,
  S4_SCENE_PAUSE_RESERVED,
  S4_SCENE_PAUSED,
  S4_PK_EVENTS,
  S4_PK_VOIDS,
  S4_SCENE_PICK_LONG,
  S4_SCENE_PK,
  S4_SCENE_PK_START,
  S4_SCENE_PRE,
  S4_SCENE_UNAPPLIED,
  S4_SCORE_SCENES,
  S4_UNAPPLIED_LOG,
  S4A_SCREENS,
  STEP4_SCREENS,
  cardIssues,
  deriveScore,
  s4Match,
  sequenceIssues,
} from './step4-fixtures';
import { isProjectStorageDownloadUrl } from '../ui/TeamCrest';

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
    for (const list of [S4_ROSTER_HOME, S4_ROSTER_AWAY, S4_ROSTER_HOME_LONG]) {
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

  it('未開賽是 0:0、rev 0、沒有事件', () => {
    expect(S4_SCENE_PRE.match.score).toEqual({ home: 0, away: 0 });
    expect(S4_SCENE_PRE.match.rev).toBe(0);
    expect(S4_SCENE_PRE.match.status).toBe('scheduled');
    expect(S4_SCENE_PRE.events).toEqual([]);
    expect(deriveScore([...S4_SCENE_PRE.events], [...S4_SCENE_PRE.voids])).toEqual(S4_SCENE_PRE.match.score);
    expect(sequenceIssues([...S4_SCENE_PRE.events], S4_SCENE_PRE.match.rev)).toEqual([]);
  });

  it('背號選擇與兩張亮牌沿用進行中事件，黃牌與第二張黃牌都在', () => {
    expect(S4_SCORE_SCENES['score-pick-player']).toBe(S4_SCENE_LIVE);
    expect(S4_SCORE_SCENES['score-card-yellow']).toBe(S4_SCENE_LIVE);
    expect(S4_SCORE_SCENES['score-card-red-auto']).toBe(S4_SCENE_LIVE);
    const yellow = S4_LIVE_EVENTS.find((event) => event.type === 'card' && event.cardType === 'yellow');
    const second = S4_LIVE_EVENTS.find((event) => event.type === 'card' && event.cardType === 'second_yellow');
    expect(yellow && yellow.type === 'card' ? yellow.plId : '').toBe('pl_hf4');
    expect(yellow && yellow.type === 'card' ? yellow.refSeq : 0).toBeUndefined();
    expect(second && second.type === 'card' ? second.plId : '').toBe('pl_hf4');
    expect(second && second.type === 'card' ? second.refSeq : 0).toBe(3);
  });

  it('中場時鐘階段是 ht', () => {
    expect(S4_SCENE_HT.match.status).toBe('halftime');
    expect(S4_SCENE_HT.match.clockBase.period).toBe('ht');
    expect(S4_SCENE_HT.clock.period).toBe('ht');
    expect(clockFromBase(S4_SCENE_HT.match.clockBase, S4_NOW)).toEqual({
      elapsedSec: 45 * 60,
      holdSec: 8 * 60,
      period: 'ht',
    });
    expect(deriveScore([...S4_SCENE_HT.events], [...S4_SCENE_HT.voids])).toEqual(S4_SCENE_HT.match.score);
  });

  it('終場在現在前 19 秒，撤回倒數是 2:41', () => {
    expect(S4_SCENE_FT.match.status).toBe('finished');
    expect(S4_SCENE_FT.match.finishedAt).toBe(S4_FT_AT);
    expect(S4_NOW - S4_FT_AT).toBe(19_000);
    expect(undoClock(S4_SCENE_FT.match.finishedAt, S4_NOW)).toBe('2:41');
    expect(clockFromBase(S4_SCENE_FT.match.clockBase, S4_NOW).elapsedSec).toBe(90 * 60);
    expect(formatMatchClock(clockFromBase(S4_SCENE_FT.match.clockBase, S4_NOW).elapsedSec)).toBe('90:00');
    expect(S4_SCENE_FT.clock.elapsedSec).toBe(90 * 60);
    expect(sequenceIssues(S4_FT_EVENTS, S4_SCENE_FT.match.rev)).toEqual([]);
    expect(deriveScore(S4_FT_EVENTS, [...S4_SCENE_FT.voids])).toEqual({ home: 1, away: 1 });
  });

  it('未套用與離線畫面都含既有動作日誌', () => {
    for (const entry of S4_ACTION_LOG) {
      expect(S4_SCENE_UNAPPLIED.actionLog.some((item) => item.id === entry.id)).toBe(true);
      expect(S4_SCENE_OFFLINE.actionLog.some((item) => item.id === entry.id)).toBe(true);
    }
    expect(S4_UNAPPLIED_LOG.map((item) => item.rejectReason).filter(Boolean).sort()).toEqual(['conflict', 'locked', 'takenOver']);
    const pending = S4_ACTION_LOG.filter((item) => item.state === 'pending').length;
    expect(S4_SCENE_OFFLINE.link.pendingCount).toBe(pending);
    expect(S4_SCENE_OFFLINE.link.online).toBe(false);
    expect(S4_SCENE_OFFLINE.link.storageUnavailable).toBe(true);
    expect(S4_SCENE_OFFLINE.link.wakeLock).toBe(false);
    for (const entry of S4_UNAPPLIED_LOG) expect(entry.at).toBeLessThanOrEqual(S4_NOW);
  });

  it('詳情列是兩場進行中加一場已更正', () => {
    expect(S4_DETAIL_ROWS.filter((row) => row.live)).toHaveLength(2);
    expect(S4_DETAIL_ROWS.filter((row) => row.corrected)).toHaveLength(1);
    expect(new Set(S4A_SCREENS).size).toBe(S4A_SCREENS.length);
    expect(S4A_SCREENS).toHaveLength(23);
    expect(S4A_SCREENS).toEqual(expect.arrayContaining([
      'score-paused',
      'score-amend',
      'score-cap',
      'score-undo-half',
      'score-pick-player-long',
      'score-pause-reserved',
      'score-timeout',
      'score-timeout-collapsed',
      'score-pk-start',
      'score-pk',
    ]));
    expect(S4A_SCREENS).not.toContain('score-live-thumb');
    expect(S4_ROSTER_HOME_LONG).toHaveLength(18);
    expect(new Set(S4_ROSTER_HOME_LONG.map((player) => player.number)).size).toBe(18);
    expect(S4_SCENE_CAP.eventCount).toBe(192);
    expect(S4_SCENE_PAUSE_RESERVED.eventCount).toBe(135);
    expect(S4_SCENE_PICK_LONG.homeRoster).toHaveLength(18);
    expect(S4_SCORE_SCENES['score-timeout'].timeoutView).toEqual({ side: 'home', leftSec: 47 });
    expect(S4_SCORE_SCENES['score-timeout-collapsed'].timeoutView?.collapsed).toBe(true);
    expect(S4_SCORE_SCENES['score-pick-player-long']).toBe(S4_SCENE_PICK_LONG);
    expect(S4_SCORE_SCENES['score-pause-reserved']).toBe(S4_SCENE_PAUSE_RESERVED);
    expect(isProjectStorageDownloadUrl(S4_CREST_URL)).toBe(true);
    expect(S4_CRESTS.map((row) => row.teamLogo)).toEqual([S4_CREST_URL, null]);
    expect(pkScore(S4_PK_EVENTS, S4_PK_VOIDS)).toEqual({ home: 3, away: 2 });
    expect(S4_SCENE_PK.match.score).toEqual({ home: 2, away: 2 });
    expect(S4_SCENE_PK.match.status).toBe('live');
    expect(S4_SCENE_PK.match.penaltyScore).toBeNull();
    expect(S4_SCENE_PK.match.clockBase).toMatchObject({ running: false, pausedSec: 40 * 60, period: 'pk' });
    expect(deriveScore(S4_PK_EVENTS, S4_PK_VOIDS)).toEqual({ home: 0, away: 0 });
    expect(deriveScore([...S4_SCENE_PK_START.events], [...S4_SCENE_PK_START.voids])).toEqual({ home: 2, away: 2 });
    expect(S4_SCENE_PK_START.match.score).toEqual({ home: 2, away: 2 });
    expect(S4_SCENE_PK_START.match.clockBase).toMatchObject({ running: false, pausedSec: 40 * 60, period: 'h2' });
    const scored = S4_PK_EVENTS.filter((event) => event.type === 'pk' && event.scored);
    const voided = new Set(S4_PK_VOIDS.map((mark) => mark.targetSeq));
    expect(scored.filter((event) => !voided.has(event.seq) && event.type === 'pk' && event.side === 'home')).toHaveLength(3);
    expect(scored.filter((event) => !voided.has(event.seq) && event.type === 'pk' && event.side === 'away')).toHaveLength(2);
    expect(clockFromBase(S4_SCENE_PAUSED.match.clockBase, S4_NOW)).toEqual({
      elapsedSec: 34 * 60,
      holdSec: 83,
      period: 'h1',
    });
  });

  it('PK 依主客交替踢，第 4 輪晚於第 3 輪客隊，比分仍是未作廢的進', () => {
    const kicks = S4_PK_EVENTS.filter((event) => event.type === 'pk');
    expect(kicks.map((event) => `${event.side}:${event.round}:${event.scored}`)).toEqual([
      'home:1:true',
      'away:1:true',
      'home:2:true',
      'away:2:false',
      'home:3:true',
      'away:3:true',
      'home:4:true',
    ]);
    const awayRound3 = kicks.find((event) => event.side === 'away' && event.round === 3);
    const homeRound4 = kicks.find((event) => event.side === 'home' && event.round === 4);
    expect(awayRound3 && homeRound4 && homeRound4.seq > awayRound3.seq).toBe(true);
    expect(S4_PK_VOIDS).toEqual([{ targetSeq: homeRound4?.seq, seq: 8, createdAt: S4_NOW + 8 }]);
    expect(pkScore(S4_PK_EVENTS, S4_PK_VOIDS)).toEqual({ home: 3, away: 2 });

    const recent = eventLines({
      events: S4_PK_EVENTS,
      voids: S4_PK_VOIDS,
      homeName: '雷霆隊',
      awayName: '海風隊',
      homeRoster: S4_ROSTER_HOME,
      awayRoster: S4_ROSTER_AWAY,
      hideVoided: false,
      order: 'recent',
    });
    const labels = recent.map((line) => line.label.replace(/ 已復原$/, ''));
    expect(labels).toEqual([
      '第4輪 雷霆隊 8 吳承恩 進',
      '第3輪 海風隊 1 王大同 進',
      '第3輪 雷霆隊 7 張宇軒 進',
      '第2輪 海風隊 11 郭建宏 沒進',
      '第2輪 雷霆隊 10 蔡明哲 進',
      '第1輪 海風隊 10 謝東霖 進',
      '第1輪 雷霆隊 9 劉冠廷 進',
    ]);
    const round4At = labels.findIndex((label) => label.startsWith('第4輪'));
    const away3At = labels.findIndex((label) => label.startsWith('第3輪') && label.includes('海風隊'));
    expect(round4At).toBeGreaterThanOrEqual(0);
    expect(away3At).toBeGreaterThan(round4At);
    expect(recent[round4At]?.voided).toBe(true);
    expect(recent[away3At]?.voided).toBe(false);
  });

  it('射手榜與紅黃牌數字可由已確認場次推出', () => {
    for (const match of S4_CONFIRMED) {
      expect(sequenceIssues([...match.events], match.events.length)).toEqual([]);
      expect(cardIssues([...match.events], [...match.voids])).toEqual([]);
    }
    expect(deriveScore([...S4_CONFIRMED[0]!.events], [...S4_CONFIRMED[0]!.voids])).toEqual({ home: 3, away: 1 });
    expect(deriveScore([...S4_CONFIRMED[1]!.events], [...S4_CONFIRMED[1]!.voids])).toEqual({ home: 2, away: 1 });
    expect(deriveScore([...S4_CONFIRMED[2]!.events], [...S4_CONFIRMED[2]!.voids])).toEqual({ home: 3, away: 0 });

    const table = derivePublicTable(S4_CONFIRMED, S4_PEOPLE);
    expect(table.scorers.map((row) => [row.displayName, row.teamName, row.goals, row.rank])).toEqual([
      ['劉冠廷', '雷霆隊', 3, 1],
      ['謝東霖', '海風隊', 2, 2],
      ['蔡明哲', '雷霆隊', 2, 2],
      ['陳', '山貓隊', 1, 4],
      ['郭建宏', '海風隊', 1, 4],
    ]);
    expect(table.scorers.some((row) => row.displayName.includes('小弟'))).toBe(false);
    expect(table.cards.map((row) => [row.displayName, row.teamName, row.yellow, row.red])).toEqual([
      ['周子維', '海風隊', 2, 1],
      ['陳', '山貓隊', 0, 1],
      ['鄭凱文', '海風隊', 1, 0],
      ['黃柏翰', '雷霆隊', 1, 0],
    ]);
    expect(table.scorers.find((row) => row.plId === 'pl_cat7')).toBeUndefined();
    expect(table.cards.find((row) => row.plId === 'pl_cat7')).toBeUndefined();
  });
});
