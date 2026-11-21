import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  nextError: null as unknown,
  calls: [] as { name: string; data: Record<string, unknown> }[],
  httpsCallable: vi.fn(),
  getCpFirebase: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (functions: unknown, name: string) => {
    h.httpsCallable(functions, name);
    return async (data: Record<string, unknown>) => {
      h.calls.push({ name, data });
      if (h.nextError) {
        const err = h.nextError;
        h.nextError = null;
        throw err;
      }
      return { data: { cid: 'cid_1', dvIds: ['dv_1'], status: 'published', deleted: true } };
    };
  },
}));

vi.mock('./cp-firebase', () => ({
  getCpFirebase: () => h.getCpFirebase(),
}));

import {
  CpCallError,
  clearCpMocks,
  cpEntryAddRosterByRep,
  cpEntryConfirmRoster,
  cpEntryJoinRoster,
  cpEntryLeaveRoster,
  cpEntryLockRosters,
  cpEntryRegister,
  cpEntryReview,
  cpEntrySetPaymentStatus,
  cpEntryUnlockRosters,
  cpEntryWithdraw,
  cpHostClearSchedule,
  cpHostConfirmMatchResult,
  cpHostCreate,
  cpHostDelete,
  cpHostGenerateSchedule,
  cpHostPublish,
  cpHostAssignStaff,
  cpHostCancelMatch,
  cpHostClearTieDecision,
  cpHostEndCompetition,
  cpHostExplainTie,
  cpHostRecalcStandings,
  cpHostRecordResult,
  cpHostResolveTie,
  cpHostRestoreCompetition,
  cpHostRescheduleMatch,
  cpHostShiftMatchDay,
  cpHostSwapMatches,
  cpHostPostNotice,
  cpHostDeleteNotice,
  cpHostRemoveStaff,
  cpHostResetMatch,
  cpHostSetStatus,
  cpHostSetWalkover,
  cpHostUpdate,
  cpParticipantReport,
  assignStaff,
  registerCpMock,
  removeStaff,
  toCpCallError,
  type CpGenerateScheduleResult,
} from './cp-callables';

const times = {
  regOpenAt: 10,
  regCloseAt: 20,
  firstMatchAt: 30,
  lastMatchAt: 40,
};

const division = {
  name: 'U12',
  playersOnField: 7 as const,
  maxTeams: 8,
  rosterMin: 5,
  rosterMax: 11,
};

const base = {
  name: '春季賽',
  sport: 'football' as const,
  timezone: 'Asia/Taipei' as const,
  ...times,
  venues: [{ name: '場地一' }],
  liveLinks: [] as string[],
  divisions: [division],
};

function lastPayload(): Record<string, unknown> {
  const call = h.calls.at(-1);
  if (!call) throw new Error('沒有送出');
  return call.data;
}

describe('cp callables（欄位與錯誤轉換）', () => {
  beforeEach(() => {
    h.nextError = null;
    h.calls.length = 0;
    h.httpsCallable.mockClear();
    h.getCpFirebase.mockReset();
    h.getCpFirebase.mockResolvedValue({ functions: { region: 'asia-east1' } });
    clearCpMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    clearCpMocks();
    vi.unstubAllEnvs();
  });

  it('mock 模式不連 Functions', async () => {
    vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
    registerCpMock('cpHost', 'publish', (data) => ({ cid: data.cid, status: 'published' as const }));
    await expect(cpHostPublish({ cid: 'cid_1' })).resolves.toEqual({ cid: 'cid_1', status: 'published' });
    expect(h.httpsCallable).not.toHaveBeenCalled();
    expect(h.getCpFirebase).not.toHaveBeenCalled();
  });

  it('沒註冊的 mock 維持原錯誤，不轉成 UNKNOWN', async () => {
    vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
    await expect(cpHostPublish({ cid: 'cid_1' })).rejects.toThrow('[cp] 未註冊的 mock');
    try {
      await cpHostPublish({ cid: 'cid_1' });
    } catch (err) {
      expect(err).not.toBeInstanceOf(CpCallError);
    }
  });

  it('每個動作只送契約列出的鍵', async () => {
    await cpHostCreate({ ...base, hostType: 'personal' });
    expect(h.calls.at(-1)?.name).toBe('cpHost');
    expect(lastPayload()).toEqual({ action: 'create', ...base, hostType: 'personal' });
    expect(lastPayload()).not.toHaveProperty('hostTeamId');
    expect(lastPayload()).not.toHaveProperty('feeNote');
    expect(lastPayload()).not.toHaveProperty('hostDisplay');

    await cpHostCreate({ ...base, hostType: 'club', hostTeamId: 'team_1', feeNote: '現場繳' });
    expect(lastPayload()).toEqual({
      action: 'create',
      ...base,
      hostType: 'club',
      hostTeamId: 'team_1',
      feeNote: '現場繳',
    });
    expect(lastPayload()).not.toHaveProperty('hostDisplay');

    await cpHostCreate({ ...base, hostType: 'club', hostTeamId: 'team_1' });
    expect(lastPayload()).not.toHaveProperty('feeNote');

    await cpHostUpdate({ cid: 'cid_1' });
    expect(lastPayload()).toEqual({ action: 'update', cid: 'cid_1' });

    await cpHostUpdate({ cid: 'cid_1', name: '更名', schedule: times });
    expect(lastPayload()).toEqual({ action: 'update', cid: 'cid_1', name: '更名', ...times });
    expect(lastPayload()).not.toHaveProperty('schedule');

    await cpHostPublish({ cid: 'cid_1' });
    expect(h.calls.at(-1)?.name).toBe('cpHost');
    expect(lastPayload()).toEqual({ action: 'publish', cid: 'cid_1' });

    await cpHostSetStatus({ cid: 'cid_1', status: 'published' });
    expect(lastPayload()).toEqual({ action: 'setStatus', cid: 'cid_1', status: 'published' });
    expect(lastPayload()).not.toHaveProperty('reason');

    await cpHostSetStatus({ cid: 'cid_1', status: 'postponed', reason: '雨' });
    expect(lastPayload()).toEqual({ action: 'setStatus', cid: 'cid_1', status: 'postponed', reason: '雨' });

    await cpHostDelete({ cid: 'cid_1' });
    expect(lastPayload()).toEqual({ action: 'delete', cid: 'cid_1' });

    await cpEntryRegister({ cid: 'cid_1', dvId: 'dv_1', teamId: 'team_1' });
    expect(h.calls.at(-1)?.name).toBe('cpEntry');
    expect(lastPayload()).toEqual({ action: 'registerEntry', cid: 'cid_1', dvId: 'dv_1', teamId: 'team_1' });

    await cpEntryRegister({
      cid: 'cid_1',
      dvId: 'dv_1',
      teamId: 'team_1',
      teamName: '隊名',
      contactName: '聯絡人',
      contactPhone: '分機甲',
    });
    expect(Object.keys(lastPayload()).sort()).toEqual([
      'action', 'cid', 'contactName', 'contactPhone', 'dvId', 'teamId', 'teamName',
    ]);

    await cpEntryReview({ cid: 'cid_1', enId: 'en_1', decision: 'approve' });
    expect(lastPayload()).toEqual({ action: 'reviewEntry', cid: 'cid_1', enId: 'en_1', decision: 'approve' });
    expect(lastPayload()).not.toHaveProperty('reason');

    await cpEntryReview({ cid: 'cid_1', enId: 'en_1', decision: 'reject', reason: '額滿' });
    expect(lastPayload()).toMatchObject({ decision: 'reject', reason: '額滿' });

    await cpEntryWithdraw({ cid: 'cid_1', enId: 'en_1' });
    expect(lastPayload()).toEqual({ action: 'withdrawEntry', cid: 'cid_1', enId: 'en_1' });

    await cpEntryJoinRoster({ cid: 'cid_1', enId: 'en_1', number: 7, privacyAck: true });
    expect(lastPayload()).toEqual({
      action: 'joinRoster',
      cid: 'cid_1',
      enId: 'en_1',
      number: 7,
      privacyAck: true,
    });

    await cpEntryJoinRoster({
      cid: 'cid_1',
      enId: 'en_1',
      number: 1,
      position: 'custom',
      positionText: '自由',
      nickname: '小七',
      realName: '王小明',
      guardianConsent: true,
      privacyAck: true,
    });
    expect(lastPayload()).toMatchObject({ position: 'custom', positionText: '自由', guardianConsent: true });
    expect(lastPayload()).not.toHaveProperty('publicName');

    await cpEntryAddRosterByRep({
      cid: 'cid_1',
      enId: 'en_1',
      number: 9,
      realName: '王小明',
      birthday: '2014-01-02',
      privacyAck: true,
    });
    expect(lastPayload()).toEqual({
      action: 'addRosterByRep',
      cid: 'cid_1',
      enId: 'en_1',
      number: 9,
      realName: '王小明',
      birthday: '2014-01-02',
      privacyAck: true,
    });

    await cpEntryLeaveRoster({ cid: 'cid_1', plId: 'pl_1' });
    expect(lastPayload()).toEqual({ action: 'leaveRoster', cid: 'cid_1', plId: 'pl_1' });

    await cpEntryConfirmRoster({ cid: 'cid_1', enId: 'en_1' });
    expect(lastPayload()).toEqual({ action: 'confirmRoster', cid: 'cid_1', enId: 'en_1' });

    await cpEntryLockRosters({ cid: 'cid_1' });
    expect(lastPayload()).toEqual({ action: 'lockRosters', cid: 'cid_1' });

    await cpEntryUnlockRosters({ cid: 'cid_1', reason: '補人' });
    expect(lastPayload()).toEqual({ action: 'unlockRosters', cid: 'cid_1', reason: '補人' });

    await cpEntrySetPaymentStatus({ cid: 'cid_1', enId: 'en_1', paymentStatus: 'paid' });
    expect(lastPayload()).toEqual({
      action: 'setPaymentStatus',
      cid: 'cid_1',
      enId: 'en_1',
      paymentStatus: 'paid',
    });

    await cpParticipantReport({ cid: 'cid_1', reason: 'fake' });
    expect(h.calls.at(-1)?.name).toBe('cpParticipant');
    expect(lastPayload()).toEqual({ action: 'reportCompetition', cid: 'cid_1', reason: 'fake' });
    expect(lastPayload()).not.toHaveProperty('detail');

    await cpParticipantReport({ cid: 'cid_1', reason: 'other', detail: '補充' });
    expect(lastPayload()).toEqual({
      action: 'reportCompetition',
      cid: 'cid_1',
      reason: 'other',
      detail: '補充',
    });
  });

  it('details.reason 轉成 { reason, params }，未知則 UNKNOWN 且丟掉 params', async () => {
    h.nextError = { details: { reason: 'BANNED_WORD', field: 'name' } };
    await expect(cpHostPublish({ cid: 'cid_1' })).rejects.toMatchObject({
      name: 'CpCallError',
      reason: 'BANNED_WORD',
      params: { field: 'name' },
    });

    h.nextError = { customData: { details: { reason: 'FIELD_LENGTH', min: 1, max: 6 } } };
    await expect(cpHostPublish({ cid: 'cid_1' })).rejects.toMatchObject({
      reason: 'FIELD_LENGTH',
      params: { min: 1, max: 6 },
    });

    h.nextError = { details: { reason: '   ', field: 'name' } };
    await expect(cpHostPublish({ cid: 'cid_1' })).rejects.toMatchObject({ reason: 'UNKNOWN', params: {} });

    h.nextError = { details: { reason: 12, field: 'name' } };
    await expect(cpHostPublish({ cid: 'cid_1' })).rejects.toMatchObject({ reason: 'UNKNOWN', params: {} });

    h.nextError = new Error('network');
    await expect(cpHostPublish({ cid: 'cid_1' })).rejects.toMatchObject({ reason: 'UNKNOWN', params: {} });

    h.nextError = { details: ['BANNED_WORD'] };
    await expect(cpHostPublish({ cid: 'cid_1' })).rejects.toMatchObject({ reason: 'UNKNOWN', params: {} });

    const existing = new CpCallError('ROSTERS_LOCKED', { n: 1 });
    expect(toCpCallError(existing)).toBe(existing);
  });

  it('第 3 步動作只送契約列出的鍵，null 與 0 與 false 都留著', async () => {
    const days = [{ date: '2027-01-09', start: '09:00', end: '18:00' }];
    await cpHostGenerateSchedule({
      cid: 'cid_1',
      dvId: 'dv_1',
      legs: 1,
      matchMinutes: 20,
      days,
      venueIdx: [0],
    });
    expect(h.calls.at(-1)?.name).toBe('cpHost');
    expect(lastPayload()).toEqual({
      action: 'generateSchedule',
      cid: 'cid_1',
      dvId: 'dv_1',
      legs: 1,
      matchMinutes: 20,
      days,
      venueIdx: [0],
    });
    expect(lastPayload()).not.toHaveProperty('ranking');
    expect(lastPayload()).not.toHaveProperty('bufferMinutes');
    expect(lastPayload()).not.toHaveProperty('minRestMinutes');
    expect(lastPayload()).not.toHaveProperty('seed');
    expect(lastPayload()).not.toHaveProperty('dryRun');
    expect(lastPayload()).not.toHaveProperty('penaltyScore');

    await cpHostGenerateSchedule({
      cid: 'cid_1',
      dvId: 'dv_1',
      legs: 2,
      ranking: 'goalDiffFirst',
      matchMinutes: 25,
      bufferMinutes: 5,
      minRestMinutes: 0,
      days,
      venueIdx: [0, 1],
      seed: 0,
      dryRun: false,
    });
    expect(lastPayload()).toEqual({
      action: 'generateSchedule',
      cid: 'cid_1',
      dvId: 'dv_1',
      legs: 2,
      ranking: 'goalDiffFirst',
      matchMinutes: 25,
      bufferMinutes: 5,
      minRestMinutes: 0,
      days,
      venueIdx: [0, 1],
      seed: 0,
      dryRun: false,
    });

    await cpHostClearSchedule({ cid: 'cid_1', dvId: 'dv_1' });
    expect(lastPayload()).toEqual({ action: 'clearSchedule', cid: 'cid_1', dvId: 'dv_1' });

    await cpHostRescheduleMatch({
      cid: 'cid_1',
      mtId: 'mt_1',
      expectedRev: 3,
      kickoffAt: null,
      venueIdx: null,
    });
    expect(lastPayload()).toEqual({
      action: 'rescheduleMatch',
      cid: 'cid_1',
      mtId: 'mt_1',
      expectedRev: 3,
      kickoffAt: null,
      venueIdx: null,
    });

    await cpHostRecordResult({
      cid: 'cid_1',
      mtId: 'mt_1',
      expectedRev: 4,
      score: { home: 2, away: 1 },
      confirm: true,
    });
    expect(lastPayload()).toEqual({
      action: 'recordResult',
      cid: 'cid_1',
      mtId: 'mt_1',
      expectedRev: 4,
      score: { home: 2, away: 1 },
      confirm: true,
    });
    expect(lastPayload()).not.toHaveProperty('penaltyScore');

    await cpHostConfirmMatchResult({ cid: 'cid_1', mtId: 'mt_1', expectedRev: 5 });
    expect(lastPayload()).toEqual({
      action: 'confirmMatchResult',
      cid: 'cid_1',
      mtId: 'mt_1',
      expectedRev: 5,
    });

    await cpHostSetWalkover({
      cid: 'cid_1',
      mtId: 'mt_1',
      expectedRev: 6,
      forfeitSide: 'away',
      reason: '未到場',
    });
    expect(lastPayload()).toEqual({
      action: 'setWalkover',
      cid: 'cid_1',
      mtId: 'mt_1',
      expectedRev: 6,
      forfeitSide: 'away',
      reason: '未到場',
    });

    await cpHostResetMatch({ cid: 'cid_1', mtId: 'mt_1', expectedRev: 7, reason: '記錯' });
    expect(lastPayload()).toEqual({
      action: 'resetMatch',
      cid: 'cid_1',
      mtId: 'mt_1',
      expectedRev: 7,
      reason: '記錯',
    });

    await cpHostRecalcStandings({ cid: 'cid_1', dvId: 'dv_1' });
    expect(lastPayload()).toEqual({ action: 'recalcStandings', cid: 'cid_1', dvId: 'dv_1' });

    await cpHostCancelMatch({ cid: 'cid_1', mtId: 'mt_1', expectedRev: 8, reason: '大雨' });
    expect(lastPayload()).toEqual({
      action: 'cancelMatch', cid: 'cid_1', mtId: 'mt_1', expectedRev: 8, reason: '大雨',
    });
    await cpHostEndCompetition({ cid: 'cid_1', reason: '剩餘場次不再進行' });
    expect(lastPayload()).toEqual({ action: 'endCompetition', cid: 'cid_1', reason: '剩餘場次不再進行' });
    await cpHostRestoreCompetition({ cid: 'cid_1', reason: '誤按結束' });
    expect(lastPayload()).toEqual({ action: 'restoreCompetition', cid: 'cid_1', reason: '誤按結束' });
    await cpHostExplainTie({ cid: 'cid_1', dvId: 'dv_1', teamIds: ['en_a', 'en_b'] });
    expect(lastPayload()).toEqual({
      action: 'explainTie', cid: 'cid_1', dvId: 'dv_1', teamIds: ['en_a', 'en_b'],
    });
    expect(lastPayload()).not.toHaveProperty('groupId');
    await cpHostResolveTie({
      cid: 'cid_1', dvId: 'dv_1', groupId: 'A', order: ['en_b', 'en_a'],
      method: 'host', reason: '依報名先後', expectedVersion: 3,
    });
    expect(lastPayload()).toEqual({
      action: 'resolveTie',
      cid: 'cid_1',
      dvId: 'dv_1',
      groupId: 'A',
      order: ['en_b', 'en_a'],
      method: 'host',
      reason: '依報名先後',
      expectedVersion: 3,
    });
    await cpHostClearTieDecision({
      cid: 'cid_1', dvId: 'dv_1', groupId: 'A', reason: '重算', expectedVersion: 4,
    });
    expect(lastPayload()).toEqual({
      action: 'clearTieDecision',
      cid: 'cid_1',
      dvId: 'dv_1',
      groupId: 'A',
      reason: '重算',
      expectedVersion: 4,
    });

    await cpHostCreate({ ...base, hostType: 'personal', category: 'cup' });
    expect(lastPayload()).toMatchObject({ action: 'create', category: 'cup', hostType: 'personal' });

    await cpHostUpdate({ cid: 'cid_1', category: 'friendly' });
    expect(lastPayload()).toEqual({ action: 'update', cid: 'cid_1', category: 'friendly' });
  });

  it('改期 force、順延、對調、公告與聯絡文字只送有值的鍵', async () => {
    await cpHostRescheduleMatch({
      cid: 'cid_1', mtId: 'mt_1', expectedRev: 3, kickoffAt: 1, venueIdx: 0, force: true,
    });
    expect(lastPayload()).toEqual({
      action: 'rescheduleMatch', cid: 'cid_1', mtId: 'mt_1', expectedRev: 3, kickoffAt: 1, venueIdx: 0, force: true,
    });

    await cpHostRescheduleMatch({
      cid: 'cid_1', mtId: 'mt_1', expectedRev: 3, kickoffAt: 1, venueIdx: 0, force: false,
    });
    expect(lastPayload()).not.toHaveProperty('force');

    await cpHostShiftMatchDay({ cid: 'cid_1', fromDate: '2027-01-09', toDate: '2027-01-12', reason: '雨天' });
    expect(lastPayload()).toEqual({
      action: 'shiftMatchDay', cid: 'cid_1', fromDate: '2027-01-09', toDate: '2027-01-12', reason: '雨天',
    });
    await cpHostShiftMatchDay({
      cid: 'cid_1', fromDate: '2027-01-09', toDate: '2027-01-12', reason: '雨天', force: true,
    });
    expect(lastPayload().force).toBe(true);

    await cpHostSwapMatches({
      cid: 'cid_1', mtIdA: 'mt_1', mtIdB: 'mt_2', expectedRevA: 3, expectedRevB: 4, reason: '對調場地',
    });
    expect(lastPayload()).toEqual({
      action: 'swapMatches',
      cid: 'cid_1',
      mtIdA: 'mt_1',
      mtIdB: 'mt_2',
      expectedRevA: 3,
      expectedRevB: 4,
      reason: '對調場地',
    });
    expect(lastPayload()).not.toHaveProperty('force');

    await cpHostPostNotice({ cid: 'cid_1', text: '今晚改期' });
    expect(lastPayload()).toEqual({ action: 'postNotice', cid: 'cid_1', text: '今晚改期' });
    await cpHostDeleteNotice({ cid: 'cid_1', noticeId: 'nt_1' });
    expect(lastPayload()).toEqual({ action: 'deleteNotice', cid: 'cid_1', noticeId: 'nt_1' });

    await cpHostCreate({ ...base, hostType: 'personal', contactNote: '賽前群組' });
    expect(lastPayload().contactNote).toBe('賽前群組');
    await cpHostCreate({ ...base, hostType: 'personal' });
    expect(lastPayload()).not.toHaveProperty('contactNote');

    await cpHostUpdate({ cid: 'cid_1', contactNote: null });
    expect(lastPayload()).toEqual({ action: 'update', cid: 'cid_1', contactNote: null });
    await cpHostUpdate({ cid: 'cid_1', contactNote: '賽前群組' });
    expect(lastPayload()).toEqual({ action: 'update', cid: 'cid_1', contactNote: '賽前群組' });
    await cpHostUpdate({ cid: 'cid_1' });
    expect(lastPayload()).not.toHaveProperty('contactNote');
  });

  it('封面：沒選不送 cover 鍵（舊 cpHost 收到 cover 會回 UNKNOWN_FIELD）；換新送物件、移除送 null', async () => {
    const cover = {
      url: 'https://firebasestorage.googleapis.com/v0/b/b1/o/images%2Fcompetitions%2Fc_aaaaaaaaaaaaaaaa%2Fcover_1700000000000.webp?alt=media',
      thumb: 'https://firebasestorage.googleapis.com/v0/b/b1/o/images%2Fcompetitions%2Fc_aaaaaaaaaaaaaaaa%2Fthumb_1700000000000.webp?alt=media',
    };
    await cpHostCreate({ ...base, hostType: 'personal' });
    expect(Object.keys(lastPayload())).not.toContain('cover');
    await cpHostCreate({ ...base, hostType: 'club', hostTeamId: 'team_1' });
    expect(Object.keys(lastPayload())).not.toContain('cover');
    await cpHostCreate({ ...base, hostType: 'personal', cover });
    expect(lastPayload().cover).toEqual(cover);
    await cpHostCreate({ ...base, hostType: 'club', hostTeamId: 'team_1', cover });
    expect(lastPayload().cover).toEqual(cover);

    await cpHostUpdate({ cid: 'cid_1', category: 'cup' });
    expect(Object.keys(lastPayload())).not.toContain('cover');
    await cpHostUpdate({ cid: 'cid_1', cover });
    expect(lastPayload()).toEqual({ action: 'update', cid: 'cid_1', cover });
    await cpHostUpdate({ cid: 'cid_1', cover: null });
    expect(lastPayload()).toEqual({ action: 'update', cid: 'cid_1', cover: null });
  });

  it('assignStaff／removeStaff 只送契約列出的鍵，省略的選填不送出', async () => {
    await cpHostAssignStaff({
      cid: 'cid_1',
      uid: 'uid_1',
      roles: ['scorer'],
      matchIds: ['mt_a', 'mt_b'],
    });
    expect(h.calls.at(-1)?.name).toBe('cpHost');
    expect(lastPayload()).toEqual({
      action: 'assignStaff',
      cid: 'cid_1',
      uid: 'uid_1',
      roles: ['scorer'],
      matchIds: ['mt_a', 'mt_b'],
    });
    expect(lastPayload()).not.toHaveProperty('expiresAt');

    await assignStaff({
      cid: 'cid_1',
      uid: 'uid_1',
      roles: ['referee'],
      matchIds: [],
      expiresAt: 90,
    });
    expect(lastPayload()).toEqual({
      action: 'assignStaff',
      cid: 'cid_1',
      uid: 'uid_1',
      roles: ['referee'],
      matchIds: [],
      expiresAt: 90,
    });

    await cpHostRemoveStaff({ cid: 'cid_1', uid: 'uid_1' });
    expect(lastPayload()).toEqual({ action: 'removeStaff', cid: 'cid_1', uid: 'uid_1' });
    expect(lastPayload()).not.toHaveProperty('roles');

    await removeStaff({ cid: 'cid_1', uid: 'uid_1', roles: ['scorer'] });
    expect(lastPayload()).toEqual({
      action: 'removeStaff',
      cid: 'cid_1',
      uid: 'uid_1',
      roles: ['scorer'],
    });
  });

  it('指派錯誤代碼原樣轉出', async () => {
    for (const reason of [
      'STAFF_NOT_FOUND',
      'STAFF_PROTECTED',
      'FORBIDDEN',
      'COMPETITION_CLOSED',
      'COMPETITION_ENDED',
      'COMPETITION_HIDDEN',
    ]) {
      h.nextError = { details: { reason } };
      await expect(cpHostAssignStaff({
        cid: 'cid_1',
        uid: 'uid_1',
        roles: ['scorer'],
        matchIds: [],
      })).rejects.toMatchObject({ name: 'CpCallError', reason, params: {} });
    }
  });

  it('generateSchedule 的 daysUsed 是日期陣列', () => {
    const preview = {
      dvId: 'dv_1',
      seed: 7,
      matchCount: 6,
      unplacedCount: 0,
      daysUsed: ['2026-12-05', '2026-12-06'],
      perTeam: 3,
      teamCount: 4,
      dryRun: true,
    } satisfies CpGenerateScheduleResult;
    expect(preview.daysUsed).toEqual(['2026-12-05', '2026-12-06']);
    expect(preview.daysUsed.every((day) => typeof day === 'string')).toBe(true);
  });
});
