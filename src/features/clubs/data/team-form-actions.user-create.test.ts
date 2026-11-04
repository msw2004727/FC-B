/**
 * T-090：一般用戶（role=user＋user.activity.team_create）建立俱樂部改走 Callable createUserTeam，
 * 以及自建俱樂部（createdVia === 'user_capability'）編輯時的成員限制與不觸發角色升級。
 *
 * 修正前應失敗的理由：
 * - 修正前 canCreateTeam 只看 team.create，一般用戶直接回 forbidden，不會呼叫 createUserTeam；
 * - 修正前建立一律先 generateId 上傳圖片再 setDoc 直寫 teams，沒有 requestId、沒有 Callable；
 * - 修正前錯誤訊息是「儲存失敗：<原始錯誤>」，會露出伺服器原因碼；
 * - 修正前自建俱樂部編輯可加入任何 UID 為領隊，並會呼叫 autoPromoteTeamRole。
 * Firebase、Callable、上傳、目錄、成員讀取為 mock；i18n 的 t 回傳 key 本身。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamFormValues } from './team-form-model';
import type { TeamDoc } from './types';
import type { TeamFormViewer } from './team-form-actions';

const mocks = vi.hoisted(() => ({
  getFirebase: vi.fn(),
  doc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  callFn: vi.fn(),
  deliverInboxMessage: vi.fn(),
  uploadImageDataUrl: vi.fn(),
  verifyUserDirectorySelection: vi.fn(),
  generateId: vi.fn(),
  invalidateTeams: vi.fn(),
  loadTeamMembers: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({ getFirebase: mocks.getFirebase }));
vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  setDoc: mocks.setDoc,
  updateDoc: mocks.updateDoc,
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  deleteField: vi.fn(() => ({ __deleteField: true })),
}));
vi.mock('@/data/callables', () => ({ callFn: mocks.callFn }));
vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  t: (key: string) => key,
}));
vi.mock('@/data/inbox-delivery', () => ({
  deliverInboxMessage: mocks.deliverInboxMessage,
}));
vi.mock('@/features/events/data/event-cover-upload', () => ({
  DEFAULT_EVENT_COVER_URL: 'https://toosterx.com/LOGO/Nocoverimage%20set.png',
  uploadImageDataUrl: mocks.uploadImageDataUrl,
}));
vi.mock('@/features/events/data/user-directory', () => ({
  verifyUserDirectorySelection: mocks.verifyUserDirectorySelection,
}));
vi.mock('@/data/ids', () => ({
  ID_PREFIX: { team: 'tm_' },
  generateId: mocks.generateId,
}));
vi.mock('./teams-repo', () => ({
  invalidateTeams: mocks.invalidateTeams,
  loadTeamMembers: mocks.loadTeamMembers,
}));

import { TW_REGIONS_WITH_OTHER } from './taiwan-regions';
import {
  createUserTeamRequestId,
  submitCreateTeam,
  submitEditTeam,
} from './team-form-actions';

const SERVER_TEAM_ID = 'tm_1792700000000_srv001';
const REQUEST_ID = 'utc_test_request_0001';

type Ref = { collection: string; id: string };

function userViewer(capabilities: readonly string[] = ['user.activity.team_create']): TeamFormViewer {
  return {
    uid: 'me',
    displayName: '我',
    role: 'user',
    capabilities,
    hasPermission: () => false,
  };
}

function values(overrides: Partial<TeamFormValues> = {}): TeamFormValues {
  return {
    type: 'competitive',
    sportTag: 'football',
    name: ' 我的俱樂部 ',
    nameEn: '',
    nationality: '台灣',
    region: TW_REGIONS_WITH_OTHER[0]!,
    founded: '',
    contact: '',
    bio: '',
    eduAccepting: true,
    contactLinksEnabled: false,
    contactLinkDrafts: [],
    captain: { uid: 'me', name: '我' },
    leaders: [{ uid: 'me', name: '我' }],
    coaches: [],
    unresolvedLeaderNames: [],
    unresolvedCoachNames: [],
    unresolvedCaptainName: '',
    ...overrides,
  };
}

function callsOf(name: string): unknown[] {
  return mocks.callFn.mock.calls.filter(([n]) => n === name).map(([, req]) => req);
}

function teamWrites(): unknown[][] {
  return [...mocks.setDoc.mock.calls, ...mocks.updateDoc.mock.calls]
    .filter(([ref]) => (ref as Ref).collection === 'teams');
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getFirebase.mockResolvedValue({ db: {} });
  mocks.doc.mockImplementation((_db: unknown, collection: string, id: string) => ({ collection, id }));
  mocks.generateId.mockReturnValue('tm_client_generated');
  mocks.uploadImageDataUrl.mockImplementation(
    async (_data: string, path: string) => `https://example.test/${path}`,
  );
  mocks.callFn.mockImplementation(async (name: string) => (
    name === 'createUserTeam'
      ? { ok: true, teamId: SERVER_TEAM_ID, created: true }
      : {}
  ));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('T-090 一般用戶建立俱樂部（createUserTeam）', () => {
  it('requestId 格式符合 /^[A-Za-z0-9_-]{8,64}$/，且每次不同', () => {
    const a = createUserTeamRequestId();
    const b = createUserTeamRequestId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(a).not.toBe(b);
  });

  it('走 Callable、不直寫 teams、不送基本欄位以外與幹部欄位', async () => {
    const result = await submitCreateTeam({
      viewer: userViewer(), values: values(), images: {}, requestId: REQUEST_ID,
    });
    expect(result).toEqual({ ok: true, teamId: SERVER_TEAM_ID, roleSyncOk: true });
    expect(mocks.setDoc.mock.calls.filter(([ref]) => (ref as Ref).collection === 'teams')).toHaveLength(0);
    expect(mocks.generateId).not.toHaveBeenCalled();

    const [request] = callsOf('createUserTeam') as Array<{ requestId: string; team: Record<string, unknown> }>;
    expect(request?.requestId).toBe(REQUEST_ID);
    const team = request!.team;
    const allowed = new Set([
      'name', 'nameEn', 'nationality', 'region', 'founded', 'contact', 'bio',
      'contactLinksEnabled', 'contactLinks', 'type', 'sportTag', 'teachingEnabled',
      'eduSettings', 'image', 'imageVariants',
    ]);
    for (const key of Object.keys(team)) expect(allowed.has(key), key).toBe(true);
    for (const key of ['id', 'members', 'pinned', 'pinOrder', 'active', 'createdVia', 'creatorUid',
      'captainUid', 'leaderUids', 'coachUids']) {
      expect(team).not.toHaveProperty(key);
    }
    expect(team.name).toBe('我的俱樂部');
    expect(String(team.image)).toMatch(/^https:\/\//);
    expect(team).not.toHaveProperty('imageVariants');
  });

  it('不呼叫角色升級、不發職位指派通知', async () => {
    await submitCreateTeam({ viewer: userViewer(), values: values(), images: {}, requestId: REQUEST_ID });
    expect(callsOf('autoPromoteTeamRole')).toHaveLength(0);
    expect(callsOf('enqueuePrivilegedLineNotification')).toHaveLength(0);
    expect(mocks.deliverInboxMessage).not.toHaveBeenCalled();
  });

  it('沒有能力碼的一般用戶被擋，不呼叫 Callable', async () => {
    const result = await submitCreateTeam({
      viewer: userViewer([]), values: values(), images: {}, requestId: REQUEST_ID,
    });
    expect(result).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(mocks.callFn).not.toHaveBeenCalled();
  });

  it('領隊含他人時拒絕（只能本人），不呼叫 Callable', async () => {
    const result = await submitCreateTeam({
      viewer: userViewer(),
      values: values({ leaders: [{ uid: 'me', name: '我' }, { uid: 'other', name: '他' }] }),
      images: {},
      requestId: REQUEST_ID,
    });
    expect(result).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(mocks.callFn).not.toHaveBeenCalled();
  });

  it('先建立再上傳圖片，圖片用伺服器 teamId，並以 updateDoc 寫回 image／imageVariants', async () => {
    const order: string[] = [];
    mocks.callFn.mockImplementation(async (name: string) => {
      order.push(`call:${name}`);
      return name === 'createUserTeam' ? { ok: true, teamId: SERVER_TEAM_ID, created: true } : {};
    });
    mocks.uploadImageDataUrl.mockImplementation(async (_d: string, path: string) => {
      order.push(`upload:${path}`);
      return `https://example.test/${path}`;
    });
    const result = await submitCreateTeam({
      viewer: userViewer(),
      values: values(),
      images: { coverDataUrl: 'data:image/webp;base64,AA', cardDataUrl: 'data:image/webp;base64,BB' },
      requestId: REQUEST_ID,
    });
    expect(result).toEqual({ ok: true, teamId: SERVER_TEAM_ID, roleSyncOk: true });
    expect(order[0]).toBe('call:createUserTeam');
    expect(order).toContain(`upload:teams/${SERVER_TEAM_ID}_cover`);
    expect(order).toContain(`upload:teams/${SERVER_TEAM_ID}_card`);
    const writesToTeams = teamWrites();
    expect(writesToTeams).toHaveLength(1);
    const [ref, fields] = writesToTeams[0]! as [Ref, Record<string, unknown>];
    expect(ref.id).toBe(SERVER_TEAM_ID);
    expect(fields.imageVariants).toEqual({
      cover: `https://example.test/teams/${SERVER_TEAM_ID}_cover`,
      card: `https://example.test/teams/${SERVER_TEAM_ID}_card`,
    });
    expect(fields.image).toBe(`https://example.test/teams/${SERVER_TEAM_ID}_cover`);
  });

  it('圖片上傳失敗：仍回成功並標 imagePending，不再呼叫 createUserTeam（不重複建立）', async () => {
    mocks.uploadImageDataUrl.mockRejectedValue(new Error('storage down'));
    const result = await submitCreateTeam({
      viewer: userViewer(),
      values: values(),
      images: { coverDataUrl: 'data:image/webp;base64,AA', cardDataUrl: 'data:image/webp;base64,BB' },
      requestId: REQUEST_ID,
    });
    expect(result).toEqual({ ok: true, teamId: SERVER_TEAM_ID, roleSyncOk: true, imagePending: true });
    expect(callsOf('createUserTeam')).toHaveLength(1);
    expect(teamWrites()).toHaveLength(0);
  });

  it('圖片寫回失敗：仍回成功並標 imagePending', async () => {
    mocks.updateDoc.mockRejectedValue(new Error('permission-denied'));
    const result = await submitCreateTeam({
      viewer: userViewer(),
      values: values(),
      images: { coverDataUrl: 'data:image/webp;base64,AA', cardDataUrl: 'data:image/webp;base64,BB' },
      requestId: REQUEST_ID,
    });
    expect(result).toMatchObject({ ok: true, teamId: SERVER_TEAM_ID, imagePending: true });
    expect(callsOf('createUserTeam')).toHaveLength(1);
  });

  it('錯誤原因碼轉成使用者文案 key，不露出原始錯誤', async () => {
    mocks.callFn.mockRejectedValueOnce(
      Object.assign(new Error('USER_TEAM_CREATE_LIMIT'), { code: 'functions/resource-exhausted' }),
    );
    const limited = await submitCreateTeam({
      viewer: userViewer(), values: values(), images: {}, requestId: REQUEST_ID,
    });
    expect(limited).toEqual({
      ok: false, reason: 'write-failed', message: 'clubs.userCreate.error.ownLimit',
    });

    mocks.callFn.mockRejectedValueOnce(new Error('internal stack at /srv/functions/index.js:123'));
    const unknown = await submitCreateTeam({
      viewer: userViewer(), values: values(), images: {}, requestId: REQUEST_ID,
    });
    expect(unknown).toEqual({
      ok: false, reason: 'write-failed', message: 'clubs.userCreate.error.failed',
    });
    expect(JSON.stringify(unknown)).not.toContain('index.js');
  });

  it('失敗後重送沿用同一個 requestId（由表單傳入）', async () => {
    mocks.callFn.mockRejectedValueOnce(new Error('CREATE_USER_TEAM_RETRY'));
    const first = await submitCreateTeam({
      viewer: userViewer(), values: values(), images: {}, requestId: REQUEST_ID,
    });
    expect(first).toMatchObject({ ok: false, message: 'clubs.userCreate.error.retry' });
    const second = await submitCreateTeam({
      viewer: userViewer(), values: values(), images: {}, requestId: REQUEST_ID,
    });
    expect(second).toMatchObject({ ok: true, teamId: SERVER_TEAM_ID });
    const ids = (callsOf('createUserTeam') as Array<{ requestId: string }>).map(r => r.requestId);
    expect(ids).toEqual([REQUEST_ID, REQUEST_ID]);
  });

  it('伺服器回 created:false（重送已建立）也視為成功', async () => {
    mocks.callFn.mockResolvedValueOnce({ ok: true, teamId: SERVER_TEAM_ID, created: false });
    const result = await submitCreateTeam({
      viewer: userViewer(), values: values(), images: {}, requestId: REQUEST_ID,
    });
    expect(result).toMatchObject({ ok: true, teamId: SERVER_TEAM_ID });
  });

  it('教練以上持有 team.create 維持既有直寫路徑（不呼叫 createUserTeam）', async () => {
    mocks.verifyUserDirectorySelection.mockImplementation(async (uids: string[]) => ({
      ok: true,
      users: uids.map(uid => ({ uid, name: uid, displayName: uid, pictureUrl: '', role: 'coach' })),
      missingUids: [],
      reason: '',
    }));
    mocks.generateId.mockReturnValue('tm_1792700000000_abc123');
    const coach: TeamFormViewer = {
      uid: 'me',
      displayName: '教練',
      role: 'coach',
      capabilities: [],
      hasPermission: code => code === 'team.create',
    };
    const result = await submitCreateTeam({ viewer: coach, values: values(), images: {} });
    expect(result).toMatchObject({ ok: true, teamId: 'tm_1792700000000_abc123' });
    expect(callsOf('createUserTeam')).toHaveLength(0);
    expect(mocks.setDoc.mock.calls.some(([ref]) => (ref as Ref).collection === 'teams')).toBe(true);
  });
});

describe('T-090 自建俱樂部編輯', () => {
  function ownTeam(): TeamDoc {
    return {
      id: SERVER_TEAM_ID,
      _docId: SERVER_TEAM_ID,
      name: '我的俱樂部',
      captainUid: 'me',
      creatorUid: 'me',
      leaderUids: ['me'],
      leaderNames: ['我'],
      coachUids: [],
      createdVia: 'user_capability',
    };
  }

  beforeEach(() => {
    mocks.verifyUserDirectorySelection.mockImplementation(async (uids: string[]) => ({
      ok: true,
      users: uids.map(uid => ({ uid, name: uid, displayName: uid, pictureUrl: '', role: 'user' })),
      missingUids: [],
      reason: '',
    }));
  });

  it('新增非成員為領隊被拒，不寫入', async () => {
    mocks.loadTeamMembers.mockResolvedValue([{ uid: 'me' }, { uid: 'member1' }]);
    const result = await submitEditTeam({
      viewer: userViewer(),
      team: ownTeam(),
      values: values({ leaders: [{ uid: 'me', name: '我' }, { uid: 'stranger', name: '路人' }] }),
      images: {},
    });
    expect(result).toEqual({ ok: false, reason: 'forbidden', message: 'clubs.staffMembersOnly' });
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });

  it('成員讀取失敗時保守拒絕', async () => {
    mocks.loadTeamMembers.mockRejectedValue(new Error('offline'));
    const result = await submitEditTeam({
      viewer: userViewer(),
      team: ownTeam(),
      values: values({ leaders: [{ uid: 'me', name: '我' }, { uid: 'member1', name: '成員' }] }),
      images: {},
    });
    expect(result).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });

  it('新增現有成員為領隊可儲存，且不呼叫 autoPromoteTeamRole', async () => {
    mocks.loadTeamMembers.mockResolvedValue([{ uid: 'me' }, { uid: 'member1' }]);
    const result = await submitEditTeam({
      viewer: userViewer(),
      team: ownTeam(),
      values: values({ leaders: [{ uid: 'me', name: '我' }, { uid: 'member1', name: '成員' }] }),
      images: {},
    });
    expect(result).toMatchObject({ ok: true, teamId: SERVER_TEAM_ID, roleSyncOk: true });
    expect(callsOf('autoPromoteTeamRole')).toHaveLength(0);
  });
});
