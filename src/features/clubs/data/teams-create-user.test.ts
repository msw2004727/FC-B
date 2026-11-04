// T-090：createUserTeamViaCallable／pickUserTeamCreateFields。
// 修正前應失敗的理由：這兩個函式修正前不存在；一般用戶建立只能 setDoc 直寫 teams（Rules 不允許）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callFnMock, invalidateMock } = vi.hoisted(() => ({
  callFnMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({ getFirebase: vi.fn() }));
vi.mock('@/data/callables', () => ({ callFn: callFnMock }));
vi.mock('./teams-repo', () => ({ invalidateTeams: invalidateMock }));

import { createUserTeamViaCallable, pickUserTeamCreateFields } from './teams-create';

beforeEach(() => {
  callFnMock.mockReset();
  invalidateMock.mockReset();
});

describe('pickUserTeamCreateFields', () => {
  it('只留基本欄位，丟掉 id／members／pinned／幹部欄位與 null imageVariants', () => {
    const picked = pickUserTeamCreateFields({
      name: 'A', nameEn: '', type: 'leisure', sportTag: 'football', teachingEnabled: false,
      image: 'https://example.test/x.png', imageVariants: null,
      id: 'tm_x', members: 1, pinned: false, pinOrder: 0, active: true,
      captainUid: 'me', leaderUids: ['me'], coachUids: [], captain: '我', history: [],
      undefinedField: undefined,
    });
    expect(picked).toEqual({
      name: 'A', nameEn: '', type: 'leisure', sportTag: 'football', teachingEnabled: false,
      image: 'https://example.test/x.png',
    });
  });
});

describe('createUserTeamViaCallable', () => {
  it('呼叫 createUserTeam 並回傳伺服器 teamId，成功後清快取', async () => {
    callFnMock.mockResolvedValue({ ok: true, teamId: 'tm_srv', created: true });
    await expect(createUserTeamViaCallable('req_12345678', { name: 'A' })).resolves.toEqual({
      teamId: 'tm_srv', created: true,
    });
    expect(callFnMock).toHaveBeenCalledWith('createUserTeam', {
      requestId: 'req_12345678', team: { name: 'A' },
    });
    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });

  it('created:false 照實回傳', async () => {
    callFnMock.mockResolvedValue({ ok: true, teamId: 'tm_srv', created: false });
    await expect(createUserTeamViaCallable('req_12345678', { name: 'A' })).resolves.toEqual({
      teamId: 'tm_srv', created: false,
    });
  });

  it('requestId 格式錯誤或含基本欄位以外的鍵，不呼叫 Callable', async () => {
    await expect(createUserTeamViaCallable('short', { name: 'A' })).rejects.toThrow();
    await expect(createUserTeamViaCallable('bad id with space', { name: 'A' })).rejects.toThrow();
    await expect(createUserTeamViaCallable('req_12345678', { name: 'A', id: 'tm_x' })).rejects.toThrow();
    await expect(
      createUserTeamViaCallable('req_12345678', { name: 'A', captainUid: 'other' }),
    ).rejects.toThrow();
    expect(callFnMock).not.toHaveBeenCalled();
  });

  it('伺服器錯誤原樣往外拋（由呼叫端轉文案），不清快取', async () => {
    const error = Object.assign(new Error('USER_TEAM_CREATE_LIMIT'), { code: 'functions/resource-exhausted' });
    callFnMock.mockRejectedValue(error);
    await expect(createUserTeamViaCallable('req_12345678', { name: 'A' })).rejects.toBe(error);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it('回傳缺 teamId 視為失敗', async () => {
    callFnMock.mockResolvedValue({ ok: true, teamId: '', created: true });
    await expect(createUserTeamViaCallable('req_12345678', { name: 'A' })).rejects.toThrow();
  });
});
