import { describe, it, expect, beforeEach } from 'vitest';

import type { InboxMessage } from '@/features/inbox/data/inbox-repo';
import type { TeamDoc } from '@/features/clubs/data/types';

import {
  getMyLatestTeamApplications,
  getTeamApplicationTimeMs,
  getApplicationStatusDisplay,
} from './profile-applications';

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
});

function makeMsg(overrides: Partial<InboxMessage>): InboxMessage {
  return {
    id: 'msg-1',
    ...overrides,
  };
}

function makeTeam(id: string, name: string): TeamDoc {
  return { id, name, _docId: id } as unknown as TeamDoc;
}

describe('getTeamApplicationTimeMs', () => {
  it('timestamp.toMillis() 優先於 createdAt', () => {
    const msg = makeMsg({
      timestamp: { toMillis: () => 1111 },
      createdAt: 2222,
    });
    expect(getTeamApplicationTimeMs(msg)).toBe(1111);
  });

  it('timestamp 具 seconds/nanoseconds 時換算毫秒', () => {
    const msg = makeMsg({
      timestamp: { seconds: 10, nanoseconds: 500_000_000 },
    });
    expect(getTeamApplicationTimeMs(msg)).toBe(10500);
  });

  it('createdAt 為 number 時直接回傳', () => {
    const msg = makeMsg({ createdAt: 5000 });
    expect(getTeamApplicationTimeMs(msg)).toBe(5000);
  });

  it('time 字串 "2024/03/05 08:30" 可解析', () => {
    const msg = makeMsg({ time: '2024/03/05 08:30' });
    const parsed = new Date(2024, 2, 5, 8, 30).getTime();
    expect(getTeamApplicationTimeMs(msg)).toBe(parsed);
  });

  it('都沒有時回 0，退化為 rejectedAt', () => {
    expect(getTeamApplicationTimeMs(makeMsg({}))).toBe(0);
    expect(getTeamApplicationTimeMs(makeMsg({ rejectedAt: 7777 }))).toBe(7777);
  });
});

describe('getMyLatestTeamApplications', () => {
  const team = makeTeam('t1', 'Alpha');

  it('非 team_join_request 或 applicantUid 不符皆略過', () => {
    const ctx = { uid: 'u1', teamIds: [], liveTeams: [team] };
    const msgs: InboxMessage[] = [
      makeMsg({
        id: 'm-other',
        actionType: 'other',
        meta: { applicantUid: 'u1', teamId: 't1', teamName: 'Alpha' },
      }),
      makeMsg({
        id: 'm-wrong-user',
        actionType: 'team_join_request',
        actionStatus: 'pending',
        meta: { applicantUid: 'u2', teamId: 't1', teamName: 'Alpha' },
      }),
    ];
    expect(getMyLatestTeamApplications(msgs, ctx)).toEqual([]);
  });

  it('同 groupId 取狀態權重優先（approved 勝 pending）', () => {
    const ctx = { uid: 'u1', teamIds: [], liveTeams: [team] };
    const msgs: InboxMessage[] = [
      makeMsg({
        id: 'm-pending',
        actionType: 'team_join_request',
        actionStatus: 'pending',
        createdAt: 2000,
        meta: { applicantUid: 'u1', teamId: 't1', teamName: 'Alpha', groupId: 'g1' },
      }),
      makeMsg({
        id: 'm-approved',
        actionType: 'team_join_request',
        actionStatus: 'approved',
        createdAt: 1000,
        meta: { applicantUid: 'u1', teamId: 't1', teamName: 'Alpha', groupId: 'g1' },
      }),
    ];
    const out = getMyLatestTeamApplications(msgs, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('approved');
    expect(out[0]?.teamName).toBe('Alpha');
  });

  it('俱樂部已不存在 → 不顯示', () => {
    const ctx = { uid: 'u1', teamIds: [], liveTeams: [] };
    const msgs: InboxMessage[] = [
      makeMsg({
        id: 'm-1',
        actionType: 'team_join_request',
        actionStatus: 'pending',
        createdAt: 1000,
        meta: { applicantUid: 'u1', teamId: 't1', teamName: 'Alpha' },
      }),
    ];
    expect(getMyLatestTeamApplications(msgs, ctx)).toEqual([]);
  });

  it('已入隊 → 不顯示', () => {
    const ctx = { uid: 'u1', teamIds: ['t1'], liveTeams: [team] };
    const msgs: InboxMessage[] = [
      makeMsg({
        id: 'm-1',
        actionType: 'team_join_request',
        actionStatus: 'pending',
        createdAt: 1000,
        meta: { applicantUid: 'u1', teamId: 't1', teamName: 'Alpha' },
      }),
    ];
    expect(getMyLatestTeamApplications(msgs, ctx)).toEqual([]);
  });

  it('時間倒序排列', () => {
    const teamB = makeTeam('t2', 'Beta');
    const ctx = { uid: 'u1', teamIds: [], liveTeams: [team, teamB] };
    const msgs: InboxMessage[] = [
      makeMsg({
        id: 'm-a',
        actionType: 'team_join_request',
        actionStatus: 'pending',
        createdAt: 1000,
        meta: { applicantUid: 'u1', teamId: 't1', teamName: 'Alpha' },
      }),
      makeMsg({
        id: 'm-b',
        actionType: 'team_join_request',
        actionStatus: 'pending',
        createdAt: 3000,
        meta: { applicantUid: 'u1', teamId: 't2', teamName: 'Beta' },
      }),
    ];
    const out = getMyLatestTeamApplications(msgs, ctx);
    expect(out.map((x) => x.teamId)).toEqual(['t2', 't1']);
  });
});

describe('getApplicationStatusDisplay', () => {
  it('四個已知狀態回對應中文與色票', () => {
    expect(getApplicationStatusDisplay('pending').label).toBe('審核中');
    expect(getApplicationStatusDisplay('approved').label).toBe('已通過');
    expect(getApplicationStatusDisplay('rejected').label).toBe('已拒絕');
    expect(getApplicationStatusDisplay('ignored').label).toBe('已逾期');
  });

  it('未知狀態退回「審核中」', () => {
    expect(getApplicationStatusDisplay('cancelled').label).toBe('審核中');
  });
});
