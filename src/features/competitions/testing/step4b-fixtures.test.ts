import { describe, expect, it } from 'vitest';
import { taipeiMs } from '../format';
import {
  S4B_ADDITION_APPROVED,
  S4B_ADDITION_CAP,
  S4B_ADDITION_LEFT,
  S4B_ADDITIONS,
  S4B_DRAFT_POINTS,
  S4B_INVITES,
  S4B_MATCHES,
  S4B_NOW,
  S4B_PLAYERS,
  S4B_ROSTER_LINK_EXPIRES,
  S4B_ROSTER_LOCK_AT,
  S4B_STAFF,
  S4B_TEAM_THUNDER,
  S4B_TEAM_WIND,
  S4B_TEMPLATES,
  S4B_TIEBREAK,
  STEP4B_SCREENS,
  additionRemaining,
  canRevokeInvite,
  canSeeRealName,
  competitionDay,
  defaultInviteExpires,
  inviteLife,
  lastKickoff,
  matchById,
  playersByTeam,
  pointsWarn,
  rosterLinkExpires,
  scheduleStatusIssues,
  scorerMatchOrder,
  staffAssignmentCount,
  weekdayIndex,
} from './step4b-fixtures';

const DAY = 24 * 60 * 60 * 1000;

describe('step4b 假資料', () => {
  it('邀請狀態跟到期日一致，撤銷只留給有效連結', () => {
    const life = Object.fromEntries(S4B_INVITES.map((row) => [row.id, inviteLife(row, S4B_NOW)]));
    expect(life).toEqual({
      iv_active: 'active',
      iv_used: 'used',
      iv_revoked: 'revoked',
      iv_expired: 'expired',
    });
    expect(inviteLife({ used: true, revoked: true, expiresAt: S4B_NOW + DAY }, S4B_NOW)).toBe('revoked');
    expect(inviteLife({ used: true, revoked: false, expiresAt: S4B_NOW - DAY }, S4B_NOW)).toBe('used');
    expect(inviteLife({ used: false, revoked: false, expiresAt: S4B_NOW }, S4B_NOW)).toBe('expired');
    expect(inviteLife({ used: false, revoked: false, expiresAt: S4B_NOW + 1 }, S4B_NOW)).toBe('active');
    expect(canRevokeInvite('active')).toBe(true);
    expect(canRevokeInvite('used')).toBe(false);
    expect(canRevokeInvite('revoked')).toBe(false);
    expect(canRevokeInvite('expired')).toBe(false);
    for (const row of S4B_INVITES) {
      for (const id of row.matchIds) expect(matchById(id)).not.toBeNull();
    }
  });

  it('邀請預設到期是末場後 7 天', () => {
    expect(defaultInviteExpires(S4B_MATCHES)).toBe(lastKickoff(S4B_MATCHES) + 7 * DAY);
    expect(lastKickoff(S4B_MATCHES)).toBe(taipeiMs(2027, 1, 10, 16, 0));
  });

  it('登錄連結到期取鎖定日與 14 天中較早的', () => {
    expect(S4B_ROSTER_LINK_EXPIRES).toBe(S4B_ROSTER_LOCK_AT);
    expect(rosterLinkExpires(S4B_NOW, S4B_NOW + 40 * DAY, 14)).toBe(S4B_NOW + 14 * DAY);
    expect(rosterLinkExpires(S4B_NOW, null, 14)).toBe(S4B_NOW + 14 * DAY);
  });

  it('增補餘額是上限減已核可，待審不扣', () => {
    expect(additionRemaining(S4B_ADDITION_CAP, S4B_ADDITION_APPROVED)).toBe(2);
    expect(S4B_ADDITION_LEFT).toBe(2);
    expect(S4B_ADDITIONS.length).toBeGreaterThan(0);
    expect(additionRemaining(S4B_ADDITION_CAP, S4B_ADDITION_APPROVED)).toBe(S4B_ADDITION_LEFT);
  });

  it('檢錄列數跟名單人數一致', () => {
    const teams = playersByTeam(S4B_PLAYERS);
    expect(teams.find((team) => team.teamId === S4B_TEAM_THUNDER)?.players).toHaveLength(4);
    expect(teams.find((team) => team.teamId === S4B_TEAM_WIND)?.players).toHaveLength(4);
    expect(teams.reduce((sum, team) => sum + team.players.length, 0)).toBe(S4B_PLAYERS.length);
  });

  it('05:00 前算前一個比賽日，跨月也一樣', () => {
    expect(competitionDay(taipeiMs(2027, 1, 10, 0, 20))).toMatchObject({ year: 2027, month: 1, day: 9, key: '2027-01-09' });
    expect(competitionDay(taipeiMs(2027, 1, 9, 4, 59))).toMatchObject({ key: '2027-01-08' });
    expect(competitionDay(taipeiMs(2027, 1, 9, 5, 0))).toMatchObject({ key: '2027-01-09' });
    expect(competitionDay(taipeiMs(2027, 1, 1, 3, 0))).toMatchObject({ year: 2026, month: 12, day: 31, key: '2026-12-31' });
    expect(weekdayIndex('2027-01-09')).toBe(6);
  });

  it('記分員場次把今天排前面，再依開賽時間', () => {
    expect(scorerMatchOrder(S4B_MATCHES, S4B_NOW).map((match) => match.id)).toEqual([
      'm_live',
      'm_1400',
      'm_2200',
      'm_2310',
      'm_0020',
      'm_1600',
    ]);
  });

  it('工作人員指派的場次都存在，筆數跟名單一致', () => {
    for (const staff of S4B_STAFF) {
      for (const id of staff.matchIds) expect(matchById(id)?.id).toBe(id);
      expect(staffAssignmentCount(staff)).toBe(staff.matchIds.length);
    }
    expect(staffAssignmentCount(S4B_STAFF[2]!)).toBe(4);
    expect(staffAssignmentCount(S4B_STAFF[3]!)).toBe(1);
  });

  it('範本人數與時間對齊 K8，同分第一條是積分', () => {
    expect(S4B_TEMPLATES.map((item) => [item.id, item.players, item.half, item.halftime])).toEqual([
      ['five', 5, 20, 5],
      ['seven', 7, 25, 5],
      ['eleven', 11, 35, 10],
    ]);
    expect(S4B_TIEBREAK[0]).toBe('points');
  });

  it('十七個畫面 id 不重複', () => {
    expect(STEP4B_SCREENS).toHaveLength(17);
    expect(new Set(STEP4B_SCREENS).size).toBe(17);
  });

  it('已開賽的場次是進行中，還沒開的是未開賽', () => {
    expect(scheduleStatusIssues(S4B_MATCHES, S4B_NOW)).toEqual([]);
    const live = matchById('m_live');
    expect(live?.status).toBe('live');
    expect(live && live.kickoffAt <= S4B_NOW).toBe(true);
    for (const match of S4B_MATCHES) {
      if (match.kickoffAt > S4B_NOW) expect(match.status).toBe('scheduled');
    }
  });

  it('勝分低於和分、負分高於和分會警告', () => {
    expect(pointsWarn(S4B_DRAFT_POINTS.win, S4B_DRAFT_POINTS.draw, S4B_DRAFT_POINTS.loss)).toEqual({
      winLow: true,
      lossHigh: false,
    });
    expect(pointsWarn(1, 2, 0).winLow).toBe(true);
    expect(pointsWarn(3, 1, 0)).toEqual({ winLow: false, lossHigh: false });
    expect(pointsWarn(3, 1, 2)).toEqual({ winLow: false, lossHigh: true });
  });

  it('真名只給主辦，或該隊代表', () => {
    expect(canSeeRealName('host', S4B_TEAM_THUNDER, null)).toBe(true);
    expect(canSeeRealName('host', S4B_TEAM_WIND, S4B_TEAM_THUNDER)).toBe(true);
    expect(canSeeRealName('rep', S4B_TEAM_THUNDER, S4B_TEAM_THUNDER)).toBe(true);
    expect(canSeeRealName('rep', S4B_TEAM_WIND, S4B_TEAM_THUNDER)).toBe(false);
    expect(canSeeRealName('rep', S4B_TEAM_THUNDER, null)).toBe(false);
    expect(canSeeRealName('other', S4B_TEAM_THUNDER, S4B_TEAM_THUNDER)).toBe(false);
  });
});
