/**
 * T-090h：轉移經理資料層（候選人、requestId、Callable 呼叫、錯誤對照）。
 * 原因碼以 FC functions/team-transfer.js 的 fail(...) 與 catch 區為準。測試資料只用假 uid。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import zh from '../locales/zh-TW.json';
import {
  buildStaffRemoval,
  buildTransferCachePatch,
  createTransferRequestId,
  getTransferCandidates,
  resolveTransferTeamId,
  teamTransferErrorKey,
  TEAM_TRANSFER_FALLBACK_KEY,
  TRANSFER_REQUEST_ID,
  transferUserTeamViaCallable,
} from './team-transfer';
import { patchCachedTeamWith } from './teams-repo';
import type { TeamDoc, TeamRosterRow } from './types';

const callFn = vi.hoisted(() => vi.fn());
vi.mock('@/data/callables', () => ({ callFn }));
vi.mock('./teams-repo', () => ({ patchCachedTeamWith: vi.fn() }));

const patchWithMock = vi.mocked(patchCachedTeamWith);

/** 取出最近一次 patchCachedTeamWith 的 key 與用 cached 算出的 patch。 */
function lastPatch(cached: TeamDoc): [string, Partial<TeamDoc>] {
  const call = patchWithMock.mock.calls.at(-1);
  if (!call) throw new Error('未更新快取');
  return [call[0], call[1](cached)];
}

function row(uid: string, overrides: Partial<TeamRosterRow> = {}): TeamRosterRow {
  return {
    uid,
    name: `名-${uid}`,
    isMember: true,
    roles: [],
    user: { uid, teamIds: ['tm1'] },
    labelKey: 'clubs.roster.member',
    isMissingName: false,
    ...overrides,
  };
}

function lookup(key: string): unknown {
  let value: unknown = zh;
  for (const part of key.replace(/^clubs\./, '').split('.')) {
    value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
  }
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getTransferCandidates', () => {
  it('排除本人、非成員、沒有使用者資料的幹部佔位列，並去重', () => {
    const roster = [
      row('self'),
      row('m1'),
      row('outsider', { isMember: false }),
      row('stub', { user: null, roles: ['captain'] }),
      row('m2', { name: '' }),
      row('m1'),
    ];
    expect(getTransferCandidates(roster, 'self', 'tm1')).toEqual([
      { uid: 'm1', name: '名-m1' },
      { uid: 'm2', name: '' },
    ]);
  });

  // 審查 P3-2：修正前只有舊式 teamId、teamIds 不含本隊的人也列入（應失敗）。
  it('只收 users.teamIds 含該俱樂部文件 ID 的人', () => {
    const roster = [
      row('ok'),
      row('legacy', { user: { uid: 'legacy', teamId: 'tm1' } }),
      row('other', { user: { uid: 'other', teamIds: ['tm2'] } }),
      row('bad', { user: { uid: 'bad', teamIds: 'tm1' as unknown as string[] } }),
    ];
    expect(getTransferCandidates(roster, 'self', 'tm1')).toEqual([{ uid: 'ok', name: '名-ok' }]);
    expect(getTransferCandidates(roster, 'self', '')).toEqual([]);
  });

  it('沒有登入 uid 時不排除任何成員，空名單回空陣列', () => {
    expect(getTransferCandidates([row('m1')], null, 'tm1')).toEqual([{ uid: 'm1', name: '名-m1' }]);
    expect(getTransferCandidates([], 'self', 'tm1')).toEqual([]);
  });
});

// 審查 P3-1：比照 functions/team-transfer.js#buildStaffRemoval（uid 與名字陣列依索引對位）。
describe('buildStaffRemoval／buildTransferCachePatch', () => {
  const staffTeam: TeamDoc = {
    id: 'tm1',
    leaderUids: ['old', 'L2', 'new'],
    leaders: ['舊經理', '領隊二', '新經理'],
    leaderNames: ['舊經理', '領隊二', '新經理'],
    leaderUid: 'old',
    leader: '舊經理',
    coachUids: ['C1', 'new'],
    coaches: ['教練一', '新經理'],
  };

  it('只移除該 uid 與對位名字，不在名單時不回欄位', () => {
    expect(buildStaffRemoval(staffTeam, 'old')).toEqual({
      leaderUids: ['L2', 'new'],
      leaders: ['領隊二', '新經理'],
      leaderNames: ['領隊二', '新經理'],
      leaderUid: 'L2',
      leader: '領隊二',
    });
    expect(buildStaffRemoval(staffTeam, 'nobody')).toEqual({});
    expect(buildStaffRemoval({ coachUids: ['C1', 'new'], coaches: ['教練一', '新經理'] }, 'new')).toEqual({
      coachUids: ['C1'],
      coaches: ['教練一'],
      coachNames: ['教練一'],
    });
  });

  it('舊、新經理都從領隊／教練移除，擁有者三欄與經理名字改為新經理', () => {
    expect(buildTransferCachePatch(staffTeam, 'old', 'new', '新經理')).toEqual({
      leaderUids: ['L2'],
      leaders: ['領隊二'],
      leaderNames: ['領隊二'],
      leaderUid: 'L2',
      leader: '領隊二',
      coachUids: ['C1'],
      coaches: ['教練一'],
      coachNames: ['教練一'],
      captainUid: 'new',
      creatorUid: 'new',
      ownerUid: 'new',
      captain: '新經理',
      captainName: '新經理',
    });
  });

  it('最後一位領隊被移除時 leaderUid 清空、leader 為空字串', () => {
    expect(buildStaffRemoval({ leaderUids: ['old'], leaders: ['舊'], leaderUid: 'old', leader: '舊' }, 'old'))
      .toEqual({ leaderUids: [], leaders: [], leaderNames: [], leaderUid: undefined, leader: '' });
  });
});

describe('requestId 與 teamId', () => {
  it('requestId 符合伺服器格式，每次不同', () => {
    const a = createTransferRequestId();
    const b = createTransferRequestId();
    expect(TRANSFER_REQUEST_ID.test(a)).toBe(true);
    expect(TRANSFER_REQUEST_ID.test(b)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('teamId 優先用文件 ID', () => {
    expect(resolveTransferTeamId({ id: 'pub', _docId: 'doc' })).toBe('doc');
    expect(resolveTransferTeamId({ id: 'pub' })).toBe('pub');
  });
});

describe('transferUserTeamViaCallable', () => {
  it('只送三個欄位，成功後就地更新列表快取（擁有者、經理名字、舊新經理移出領隊）', async () => {
    callFn.mockResolvedValue({ ok: true, teamId: 'tm1', newOwnerUid: 'm1', deduplicated: false, notification: null });
    const res = await transferUserTeamViaCallable({
      teamId: 'tm1', newOwnerUid: 'm1', requestId: 'utt_abcdefgh', callerUid: 'self', newOwnerName: '成員甲',
    });
    expect(callFn).toHaveBeenCalledExactlyOnceWith('transferUserTeam', {
      requestId: 'utt_abcdefgh', teamId: 'tm1', newOwnerUid: 'm1',
    });
    expect(res.deduplicated).toBe(false);
    expect(patchWithMock).toHaveBeenCalledTimes(1);
    expect(lastPatch({ id: 'tm1', leaderUids: ['self', 'm1'], leaders: ['我', '成員甲'] })).toEqual(['tm1', {
      leaderUids: [],
      leaders: [],
      leaderNames: [],
      leaderUid: undefined,
      leader: '',
      captainUid: 'm1',
      creatorUid: 'm1',
      ownerUid: 'm1',
      captain: '成員甲',
      captainName: '成員甲',
    }]);
  });

  it('沒有名字、沒有幹部身分時只更新擁有者欄位', async () => {
    callFn.mockResolvedValue({ ok: true, teamId: 'tm1', newOwnerUid: 'm1', deduplicated: true, notification: null });
    await transferUserTeamViaCallable({ teamId: 'tm1', newOwnerUid: 'm1', requestId: 'utt_abcdefgh' });
    expect(lastPatch({ id: 'tm1' })).toEqual(['tm1', { captainUid: 'm1', creatorUid: 'm1', ownerUid: 'm1' }]);
  });

  it.each([
    ['requestId 太短', { teamId: 'tm1', newOwnerUid: 'm1', requestId: 'short' }],
    ['requestId 含非法字元', { teamId: 'tm1', newOwnerUid: 'm1', requestId: 'utt_abc/defgh' }],
    ['缺 teamId', { teamId: '', newOwnerUid: 'm1', requestId: 'utt_abcdefgh' }],
    ['缺 newOwnerUid', { teamId: 'tm1', newOwnerUid: '', requestId: 'utt_abcdefgh' }],
  ])('%s：不呼叫 Callable', async (_label, input) => {
    await expect(transferUserTeamViaCallable(input)).rejects.toThrow();
    expect(callFn).not.toHaveBeenCalled();
    expect(patchWithMock).not.toHaveBeenCalled();
  });

  it('Callable 失敗往外拋，不動快取', async () => {
    callFn.mockRejectedValue(Object.assign(new Error('NEW_OWNER_TEAM_LIMIT'), { code: 'resource-exhausted' }));
    await expect(transferUserTeamViaCallable({
      teamId: 'tm1', newOwnerUid: 'm1', requestId: 'utt_abcdefgh',
    })).rejects.toThrow('NEW_OWNER_TEAM_LIMIT');
    expect(patchWithMock).not.toHaveBeenCalled();
  });
});

describe('teamTransferErrorKey', () => {
  // 原因碼來源：functions/team-transfer.js（fail 呼叫與 catch 區）。
  const cases: Array<[string, string]> = [
    ['AUTH_REQUIRED', 'clubs.transfer.error.authRequired'],
    ['INVALID_CALLER_UID', 'clubs.transfer.error.accountInvalid'],
    ['TRANSFER_USER_TEAM_INVALID_INPUT', 'clubs.transfer.error.invalid'],
    ['TRANSFER_USER_TEAM_UNKNOWN_FIELD', 'clubs.transfer.error.invalid'],
    ['TRANSFER_USER_TEAM_INVALID_REQUEST_ID', 'clubs.transfer.error.invalid'],
    ['TRANSFER_TO_SELF', 'clubs.transfer.error.toSelf'],
    ['TRANSFER_REQUEST_ID_CONFLICT', 'clubs.transfer.error.conflict'],
    ['TEAM_NOT_FOUND', 'clubs.transfer.error.teamNotFound'],
    ['TEAM_NOT_USER_CREATED', 'clubs.transfer.error.notUserCreated'],
    ['TEAM_TRANSFER_DENIED', 'clubs.transfer.error.denied'],
    ['USER_IDENTITY_MISMATCH', 'clubs.transfer.error.accountInvalid'],
    ['NEW_OWNER_NOT_FOUND', 'clubs.transfer.error.newOwnerNotFound'],
    ['NEW_OWNER_IDENTITY_MISMATCH', 'clubs.transfer.error.newOwnerInvalid'],
    ['NEW_OWNER_NOT_MEMBER', 'clubs.transfer.error.notMember'],
    ['NEW_OWNER_TEAM_LIMIT', 'clubs.transfer.error.newOwnerLimit'],
    ['TRANSFER_USER_TEAM_RETRY', 'clubs.transfer.error.retry'],
    ['TRANSFER_USER_TEAM_FAILED', 'clubs.transfer.error.failed'],
  ];

  it.each(cases)('%s → %s，且 zh-TW 有文案', (reason, key) => {
    expect(teamTransferErrorKey(Object.assign(new Error(reason), { code: 'failed-precondition' }))).toBe(key);
    expect(typeof lookup(key)).toBe('string');
  });

  it('details.reason 也能對應', () => {
    expect(teamTransferErrorKey({ message: 'x', details: { reason: 'NEW_OWNER_NOT_MEMBER' } }))
      .toBe('clubs.transfer.error.notMember');
  });

  it('未知錯誤與原始訊息一律回通用文案', () => {
    expect(teamTransferErrorKey(new Error('raw firestore detail'))).toBe(TEAM_TRANSFER_FALLBACK_KEY);
    expect(teamTransferErrorKey(new Error('SOMETHING_ELSE'))).toBe(TEAM_TRANSFER_FALLBACK_KEY);
    expect(teamTransferErrorKey(null)).toBe(TEAM_TRANSFER_FALLBACK_KEY);
    expect(typeof lookup(TEAM_TRANSFER_FALLBACK_KEY)).toBe('string');
  });

  it('unauthenticated 代碼對應請先登入', () => {
    expect(teamTransferErrorKey({ code: 'functions/unauthenticated', message: '' }))
      .toBe('clubs.transfer.error.authRequired');
  });
});
