import { describe, expect, it } from 'vitest';
import { collectRepClubs, isClubRepresentative, representativeClubs } from './rep-clubs';

describe('俱樂部代表（對齊 Rules isCurrentUserTeamCaptainOrLeader）', () => {
  it('隊長、建立者、擁有者、領隊算代表；教練不算', () => {
    expect(isClubRepresentative('u1', { captainUid: 'u1' })).toBe(true);
    expect(isClubRepresentative('u1', { creatorUid: 'u1' })).toBe(true);
    expect(isClubRepresentative('u1', { ownerUid: 'u1' })).toBe(true);
    expect(isClubRepresentative('u1', { leaderUid: 'u1' })).toBe(true);
    expect(isClubRepresentative('u1', { leaderUids: ['u2', 'u1'] })).toBe(true);
    expect(isClubRepresentative('u1', { coachUids: ['u1'], leaderUid: 'u2' })).toBe(false);
    expect(isClubRepresentative('u1', { coachUids: ['u1'] })).toBe(false);
    expect(isClubRepresentative('', { captainUid: '' })).toBe(false);
    expect(isClubRepresentative('u1', null)).toBe(false);
  });

  it('合併查詢結果時領隊留下、教練剔除、同隊不重複', () => {
    const clubs = collectRepClubs('u1', [
      { id: 'fs_lead', data: { id: 'club_lead', name: '領隊隊', leaderUids: ['u1'], coachUids: ['u9'] } },
      { id: 'fs_coach', data: { id: 'club_coach', name: '教練隊', coachUids: ['u1'] } },
      { id: 'fs_lead_dup', data: { name: '領隊隊', leaderUid: 'u1', id: 'club_lead' } },
      { id: 'fs_blank', data: { captainUid: 'u1', name: '  ' } },
    ]);
    expect(clubs).toEqual([{ id: 'club_lead', name: '領隊隊' }]);
  });

  it('三處讀的是同一份 repClubs，不是另一份清單', () => {
    const clubs = [{ id: 'club_a', name: '示範隊A' }];
    expect(representativeClubs({ repClubs: clubs })).toBe(clubs);
  });
});
