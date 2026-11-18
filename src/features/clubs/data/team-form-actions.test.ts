/**
 * 使用真的 form-model、club-policy、teams-create、op-log、
 * recalculateRole 與 bestEffort；Firebase、Callable、目錄、上傳及投遞為 mock。
 *
 * 所有直接寫入均檢查集合，只允許 teams 與 operationLogs。
 * 此附件環境不可執行命令；本測試尚未實際執行。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectoryVerification } from '@/features/events/data/user-directory';
import type { TeamFormValues } from './team-form-model';
import type { TeamDoc } from './types';
import type {
  SubmitCreateTeamInput,
  SubmitEditTeamInput,
  TeamFormViewer,
} from './team-form-actions';

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
  trace: [] as string[],
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
vi.mock('./teams-repo', () => ({ invalidateTeams: mocks.invalidateTeams }));
// 成員管理模組的其他寫入能力不屬本卡；若意外呼叫，測試直接失敗。
vi.mock('./teams-write', () => ({
  saveTeamRoleChange: () => { throw new Error('unexpected member role write'); },
  saveTeamMemberNote: () => { throw new Error('unexpected member note write'); },
}));

import * as opLog from '@/data/op-log';
import { recalculateRole } from '../components/legacy/member-management-actions';
import {
  DEFAULT_TEAM_COVER_URL,
  resolveDefaultTeamCoverImage,
  submitCreateTeam,
  submitEditTeam,
} from './team-form-actions';
import { TW_REGIONS_WITH_OTHER } from './taiwan-regions';

const teamId = 'tm_1792700000000_abc123';
const timestamp = { __serverTimestamp: true };
const db = {};
const names: Record<string, string> = {
  cap: '經理甲',
  lead: '領隊甲',
  coach: '教練甲',
  nextCap: '經理乙',
  nextLead: '領隊乙',
  nextCoach: '教練乙',
};

type Ref = { collection: string; id: string };
type Fields = Record<string, unknown>;

function viewer(
  uid: string | null = 'cap',
  permissions: readonly string[] = ['team.create', 'team.assign_coach'],
): TeamFormViewer {
  return {
    uid,
    displayName: '操作者',
    hasPermission: code => permissions.includes(code),
  };
}

function values(): TeamFormValues {
  return {
    type: 'education',
    sportTag: 'football',
    name: ' 測試俱樂部 ',
    nameEn: ' Test Club ',
    nationality: '台灣',
    region: TW_REGIONS_WITH_OTHER[0]!,
    founded: '2026',
    contact: ' 聯絡資料 ',
    bio: ' 俱樂部簡介 ',
    eduAccepting: false,
    contactLinksEnabled: false,
    contactLinkDrafts: [],
    captain: { uid: 'cap', name: '過期經理名' },
    leaders: [{ uid: 'lead', name: '過期領隊名' }],
    coaches: [{ uid: 'coach', name: '過期教練名' }],
    unresolvedLeaderNames: [],
    unresolvedCoachNames: [],
    unresolvedCaptainName: '',
  };
}

function team(): TeamDoc {
  return {
    id: teamId,
    _docId: 'legacy-document',
    name: '舊名稱',
    captainUid: 'cap',
    captain: '經理甲',
    captainName: '經理甲',
    leaderUids: ['lead'],
    leaderNames: ['領隊甲'],
    coachUids: ['coach'],
    coachNames: ['教練甲'],
    image: 'https://example.test/old-cover',
    imageVariants: {
      cover: 'https://example.test/old-cover',
      card: 'https://example.test/old-card',
    },
  };
}

function createInput(
  overrides: Partial<SubmitCreateTeamInput> = {},
): SubmitCreateTeamInput {
  return { viewer: viewer(), values: values(), images: {}, ...overrides };
}

function editInput(
  overrides: Partial<SubmitEditTeamInput> = {},
): SubmitEditTeamInput {
  return { viewer: viewer(), team: team(), values: values(), images: {}, ...overrides };
}

function verification(uids: string[]): DirectoryVerification {
  return {
    ok: true,
    users: uids.map(uid => ({
      uid,
      name: names[uid] || uid,
      displayName: names[uid] || uid,
      pictureUrl: '',
      role: 'user',
    })),
    missingUids: [],
    reason: '',
  };
}

function writes(collection: string): unknown[][] {
  return mocks.setDoc.mock.calls.filter(
    ([ref]) => (ref as Ref).collection === collection,
  );
}

function createdFields(): Fields {
  const call = writes('teams')[0];
  expect(call).toBeDefined();
  return call![1] as Fields;
}

function editedFields(): Fields {
  const call = mocks.updateDoc.mock.calls[0];
  expect(call).toBeDefined();
  return call![1] as Fields;
}

function logFields(): Fields[] {
  return writes('operationLogs').map(call => call[1] as Fields);
}

function recalcUids(): string[] {
  return mocks.callFn.mock.calls
    .filter(([name]) => name === 'autoPromoteTeamRole')
    .map(([, input]) => (input as { targetUid: string }).targetUid);
}

function lineTargets(): string[] {
  return mocks.callFn.mock.calls
    .filter(([name]) => name === 'enqueuePrivilegedLineNotification')
    .map(([, input]) => (input as { uid: string }).uid);
}

function expectNoSideEffects(): void {
  expect(mocks.callFn).not.toHaveBeenCalled();
  expect(mocks.deliverInboxMessage).not.toHaveBeenCalled();
  expect(writes('operationLogs')).toHaveLength(0);
}

function expectNoWrites(): void {
  expect(mocks.setDoc).not.toHaveBeenCalled();
  expect(mocks.updateDoc).not.toHaveBeenCalled();
  expect(mocks.invalidateTeams).not.toHaveBeenCalled();
  expectNoSideEffects();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.trace.length = 0;
  mocks.getFirebase.mockResolvedValue({ db });
  mocks.doc.mockImplementation((_db: unknown, collection: string, id: string) => ({
    collection, id,
  }));
  mocks.generateId.mockImplementation(() => {
    mocks.trace.push('id');
    return teamId;
  });
  mocks.verifyUserDirectorySelection.mockImplementation(async (uids: string[]) => {
    mocks.trace.push('verify');
    return verification(uids);
  });
  mocks.uploadImageDataUrl.mockImplementation(async (_data: string, path: string) => {
    mocks.trace.push(`upload:${path}`);
    return `https://example.test/${path}`;
  });
  mocks.setDoc.mockImplementation(async (ref: Ref) => {
    mocks.trace.push(`set:${ref.collection}`);
  });
  mocks.updateDoc.mockImplementation(async (ref: Ref) => {
    mocks.trace.push(`update:${ref.collection}`);
  });
  mocks.invalidateTeams.mockImplementation(() => {
    mocks.trace.push('invalidate');
  });
  mocks.callFn.mockImplementation(async (name: string) => {
    mocks.trace.push(`call:${name}`);
    return {};
  });
  mocks.deliverInboxMessage.mockImplementation(async () => {
    mocks.trace.push('inbox');
    return {};
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  try {
    // 非空成功案例也會跑此斷言，避免只以「沒有寫入」形成空泛驗收。
    for (const [ref] of [...mocks.setDoc.mock.calls, ...mocks.updateDoc.mock.calls]) {
      expect(['teams', 'operationLogs']).toContain((ref as Ref).collection);
    }
    for (const [, collection] of mocks.doc.mock.calls) {
      expect(['teams', 'operationLogs']).toContain(collection);
    }
  } finally {
    vi.restoreAllMocks();
  }
});

describe('卡 1b 退修：教練指派權限', () => {
  it.each(['create', 'edit'] as const)(
    '%s 無權限新增已解析教練，在目錄驗證、上傳及寫入前拒絕',
    async (mode) => {
      const currentViewer = viewer('cap', ['team.create']);
      const input = mode === 'create'
        ? createInput({ viewer: currentViewer, images: { coverDataUrl: 'data:cover' } })
        : editInput({ viewer: currentViewer, images: { coverDataUrl: 'data:cover' } });
      input.values.coaches.push({ uid: 'nextCoach', name: '教練乙' });

      const result = mode === 'create'
        ? await submitCreateTeam(input)
        : await submitEditTeam(input as SubmitEditTeamInput);

      expect(result).toEqual({
        ok: false, reason: 'forbidden', message: '權限不足',
      });
      expect(mocks.verifyUserDirectorySelection).not.toHaveBeenCalled();
      expect(mocks.uploadImageDataUrl).not.toHaveBeenCalled();
      expect(mocks.generateId).not.toHaveBeenCalled();
      expectNoWrites();
    },
  );

  it('建立時未連結的教練姓名也需要指派權限', async () => {
    const input = createInput({ viewer: viewer('cap', ['team.create']) });
    input.values.coaches = [];
    input.values.unresolvedCoachNames = ['舊教練'];

    expect(await submitCreateTeam(input)).toEqual({
      ok: false, reason: 'forbidden', message: '權限不足',
    });
    expect(mocks.verifyUserDirectorySelection).not.toHaveBeenCalled();
    expect(mocks.uploadImageDataUrl).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it.each([
    'team.assign_coach',
    'team.manage_all',
    'team.manage.entry',
  ])('建立：%s 單獨提供教練指派權限', async (permission) => {
    const result = await submitCreateTeam(createInput({
      viewer: viewer('cap', ['team.create', permission]),
    }));
    expect(result).toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(createdFields()['coachUids']).toEqual(['coach']);
  });

  it.each([
    'team.assign_coach',
    'team.manage_all',
    'team.manage.entry',
  ])('編輯：%s 單獨提供新增教練權限', async (permission) => {
    const input = editInput({ viewer: viewer('cap', [permission]) });
    input.values.coaches.push({ uid: 'nextCoach', name: '教練乙' });

    expect(await submitEditTeam(input))
      .toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(editedFields()['coachUids']).toEqual(['coach', 'nextCoach']);
    expect(lineTargets()).toEqual(['nextCoach']);
  });

  it('無指派權限但教練未變仍可儲存', async () => {
    expect(await submitEditTeam(editInput({ viewer: viewer('cap', []) })))
      .toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(editedFields()['coachUids']).toEqual(['coach']);
    expect(lineTargets()).toEqual([]);
  });

  it('無指派權限但只移除教練仍可儲存', async () => {
    const input = editInput({ viewer: viewer('cap', []) });
    input.values.coaches = [];

    expect(await submitEditTeam(input))
      .toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(editedFields()['coachUids']).toEqual([]);
    expect(lineTargets()).toEqual([]);
    expect(logFields()).toContainEqual(expect.objectContaining({
      type: 'team_position',
      typeName: '俱樂部職位變更',
      content: '移除「教練甲」的「測試俱樂部」教練職位',
    }));
  });

  it('建立時沒有教練不需要指派權限', async () => {
    const input = createInput({ viewer: viewer('cap', ['team.create']) });
    input.values.coaches = [];

    expect(await submitCreateTeam(input))
      .toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(createdFields()['coachUids']).toEqual([]);
  });
});

describe('卡 1b 退修：送出快照', () => {
  it.each(['create', 'edit'] as const)(
    '%s 等待目錄時修改原表單及圖片，不改變寫入、差異及通知',
    async (mode) => {
      const input = editInput({
        images: { coverDataUrl: 'data:original-cover', cardDataUrl: 'data:original-card' },
      });
      input.values.unresolvedLeaderNames = ['未連結領隊'];
      input.values.unresolvedCoachNames = ['未連結教練'];
      input.values.unresolvedCaptainName = '未連結經理';
      input.values.contactLinksEnabled = true;
      input.values.contactLinkDrafts = ['https://example.test/original'];

      let finish!: (result: DirectoryVerification) => void;
      mocks.verifyUserDirectorySelection.mockImplementationOnce(
        () => new Promise<DirectoryVerification>((resolve) => { finish = resolve; }),
      );
      const pending = mode === 'create'
        ? submitCreateTeam(input)
        : submitEditTeam(input);

      await vi.waitFor(() =>
        expect(mocks.verifyUserDirectorySelection).toHaveBeenCalledTimes(1));
      expect(mocks.uploadImageDataUrl).not.toHaveBeenCalled();
      expectNoWrites();

      // 同時測物件欄位突變、物件替換、陣列 push 與字串陣列修改。
      input.values.captain!.uid = 'mutatedCaptain';
      input.values.captain!.name = '等待期間經理';
      input.values.captain = { uid: 'nextCap', name: '替換經理' };
      input.values.leaders[0]!.uid = 'mutatedLeader';
      input.values.leaders[0]!.name = '等待期間領隊';
      input.values.leaders.push({ uid: 'nextLead', name: '新增領隊' });
      input.values.coaches[0]!.uid = 'mutatedCoach';
      input.values.coaches[0]!.name = '等待期間教練';
      input.values.coaches.push({ uid: 'nextCoach', name: '新增教練' });
      input.values.unresolvedLeaderNames[0] = '被改的未連結領隊';
      input.values.unresolvedCoachNames.push('被加的未連結教練');
      input.values.unresolvedCaptainName = '被改的未連結經理';
      input.values.contactLinkDrafts[0] = 'https://example.test/changed';
      input.values.contactLinksEnabled = false;
      input.values.name = '等待期間改名';
      input.values.eduAccepting = true;
      input.images.coverDataUrl = 'data:changed-cover';
      input.images.cardDataUrl = 'data:changed-card';

      // 編輯差異與名稱快取也必須保留送出時的基準。
      input.team.coachUids = ['mutatedCoach'];
      input.team.leaderUids = ['mutatedLeader'];
      input.team.captainUid = 'mutatedCaptain';

      finish(verification(['cap', 'lead', 'coach']));
      expect(await pending).toEqual({ ok: true, teamId, roleSyncOk: true });

      expect(mocks.verifyUserDirectorySelection)
        .toHaveBeenCalledExactlyOnceWith(['cap', 'lead', 'coach']);
      const fields = mode === 'create' ? createdFields() : editedFields();
      expect(fields).toMatchObject({
        name: '測試俱樂部',
        captainUid: 'cap',
        captainName: '經理甲',
        leaderUids: ['lead'],
        leaderNames: ['領隊甲', '未連結領隊'],
        coachUids: ['coach'],
        coachNames: ['教練甲', '未連結教練'],
        contactLinksEnabled: true,
        contactLinks: [
          expect.objectContaining({ url: 'https://example.test/original' }),
        ],
        eduSettings: { acceptingStudents: false, teachingEnabled: true },
      });
      expect(mocks.uploadImageDataUrl).toHaveBeenNthCalledWith(
        1, 'data:original-cover', `teams/${teamId}_cover`,
      );
      expect(mocks.uploadImageDataUrl).toHaveBeenNthCalledWith(
        2, 'data:original-card', `teams/${teamId}_card`,
      );
      expect(recalcUids()).toEqual(mode === 'create'
        ? ['cap', 'lead', 'coach']
        : ['cap', 'coach']);
      expect(lineTargets()).toEqual(mode === 'create' ? ['cap', 'lead', 'coach'] : []);
      expect(mocks.deliverInboxMessage.mock.calls.map(
        ([message]) => (message as { targetUid: string }).targetUid,
      )).toEqual(mode === 'create' ? ['cap', 'lead', 'coach'] : []);

      const written = JSON.stringify([
        ...mocks.setDoc.mock.calls, ...mocks.updateDoc.mock.calls,
      ]);
      for (const uid of [
        'mutatedCaptain', 'mutatedLeader', 'mutatedCoach',
        'nextCap', 'nextLead', 'nextCoach',
      ]) {
        expect(written).not.toContain(uid);
        expect(recalcUids()).not.toContain(uid);
        expect(lineTargets()).not.toContain(uid);
      }
    },
  );

  it('編輯無已解析經理時，未連結經理姓名也保留送出快照', async () => {
    const input = editInput();
    input.values.captain = null;
    input.values.unresolvedCaptainName = '舊經理姓名';

    let finish!: (result: DirectoryVerification) => void;
    mocks.verifyUserDirectorySelection.mockImplementationOnce(
      () => new Promise<DirectoryVerification>((resolve) => { finish = resolve; }),
    );
    const pending = submitEditTeam(input);
    await vi.waitFor(() =>
      expect(mocks.verifyUserDirectorySelection).toHaveBeenCalledTimes(1));

    input.values.unresolvedCaptainName = '等待期間改名';
    finish(verification(['lead', 'coach']));

    expect(await pending).toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(editedFields()['captainUid']).toBeNull();
    expect(editedFields()['captainName']).toBe('舊經理姓名');
  });

  it.each(['create', 'edit'] as const)(
    '%s deferred 回應未涵蓋快照 UID，即使原表單已改成回應 UID 仍拒絕',
    async (mode) => {
      const input = editInput({ images: { coverDataUrl: 'data:cover' } });
      let finish!: (result: DirectoryVerification) => void;
      mocks.verifyUserDirectorySelection.mockImplementationOnce(
        () => new Promise<DirectoryVerification>((resolve) => { finish = resolve; }),
      );
      const pending = mode === 'create'
        ? submitCreateTeam(input)
        : submitEditTeam(input);
      await vi.waitFor(() =>
        expect(mocks.verifyUserDirectorySelection).toHaveBeenCalledTimes(1));

      input.values.leaders[0]!.uid = 'nextLead';
      finish(verification(['cap', 'nextLead', 'coach']));

      expect(await pending).toEqual({
        ok: false,
        reason: 'verify-failed',
        message: '無法確認人員資料，請重新搜尋後再試',
      });
      expect(mocks.uploadImageDataUrl).not.toHaveBeenCalled();
      expectNoWrites();
    },
  );

  it.each(['create', 'edit'] as const)(
    '%s users 含 UID 但 missingUids 同時列出時仍拒絕',
    async (mode) => {
      const response = verification(['cap', 'lead', 'coach']);
      response.missingUids = [' lead '];
      mocks.verifyUserDirectorySelection.mockResolvedValueOnce(response);
      const input = editInput({ images: { coverDataUrl: 'data:cover' } });

      expect(await (mode === 'create'
        ? submitCreateTeam(input)
        : submitEditTeam(input))).toEqual({
        ok: false,
        reason: 'verify-failed',
        message: '無法確認人員資料，請重新搜尋後再試',
      });
      expect(mocks.uploadImageDataUrl).not.toHaveBeenCalled();
      expectNoWrites();
    },
  );
});

describe('卡 1b 退修：移除職務日誌', () => {
  it.each([
    ['leader', 'lead', '領隊'],
    ['coach', 'coach', '教練'],
  ] as const)('單獨移除 %s：優先使用目錄姓名，不寄指派通知', async (role, uid, label) => {
    const input = editInput({ viewer: viewer('cap', []) });
    if (role === 'leader') input.values.leaders = [];
    else input.values.coaches = [];

    mocks.verifyUserDirectorySelection.mockImplementation(async (uids: string[]) => {
      const result = verification(uids);
      if (uids.length === 1 && uids[0] === uid) {
        result.users[0]!.name = `目錄${label}`;
        result.users[0]!.displayName = `目錄${label}`;
      }
      return result;
    });

    expect(await submitEditTeam(input))
      .toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(logFields().map(log => log['content'])).toEqual([
      '編輯「測試俱樂部」',
      `移除「目錄${label}」的「測試俱樂部」${label}職位`,
    ]);
    expect(logFields()[1]).toMatchObject({
      type: 'team_position',
      typeName: '俱樂部職位變更',
      actorUid: 'cap',
      operator: '操作者',
    });
    expect(lineTargets()).toEqual([]);
    expect(mocks.deliverInboxMessage).not.toHaveBeenCalled();
    expect(recalcUids()).toContain(uid);
    expect(mocks.verifyUserDirectorySelection)
      .toHaveBeenNthCalledWith(2, [uid]);
  });

  it.each(['missing', 'reject'] as const)(
    '舊人員目錄 %s：快取存在用快取，沒有名稱用 ?',
    async (mode) => {
      const input = editInput({ viewer: viewer('cap', []) });
      input.values.leaders = [];
      input.values.coaches = [];
      input.team.leaderNames = ['快取領隊'];
      input.team.coachNames = [];
      mocks.verifyUserDirectorySelection.mockResolvedValueOnce(verification(['cap']));
      if (mode === 'missing') {
        mocks.verifyUserDirectorySelection.mockResolvedValueOnce({
          ...verification([]),
          ok: false,
          missingUids: ['lead', 'coach'],
        });
      } else {
        mocks.verifyUserDirectorySelection.mockRejectedValueOnce(new Error('offline'));
      }

      expect(await submitEditTeam(input))
        .toEqual({ ok: true, teamId, roleSyncOk: true });
      expect(logFields().map(log => log['content'])).toEqual([
        '編輯「測試俱樂部」',
        '移除「快取領隊」的「測試俱樂部」領隊職位',
        '移除「?」的「測試俱樂部」教練職位',
      ]);
      for (const log of logFields().slice(1)) {
        expect(log).toMatchObject({
          type: 'team_position', typeName: '俱樂部職位變更',
        });
      }
      expect(lineTargets()).toEqual([]);
      expect(recalcUids()).toEqual(['cap', 'coach', 'lead']);
    },
  );

  it('目錄查無時支援舊 leaderUid/leader 及 coaches 名稱快取', async () => {
    const input = editInput({ viewer: viewer('cap', []) });
    input.values.leaders = [];
    input.values.coaches = [];
    delete input.team.leaderUids;
    delete input.team.leaderNames;
    input.team.leaderUid = 'lead';
    input.team.leader = '相容領隊';
    delete input.team.coachNames;
    input.team.coaches = ['相容教練'];
    mocks.verifyUserDirectorySelection
      .mockResolvedValueOnce(verification(['cap']))
      .mockResolvedValueOnce({
        ...verification([]), missingUids: ['lead', 'coach'],
      });

    expect(await submitEditTeam(input))
      .toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(logFields().map(log => log['content'])).toEqual([
      '編輯「測試俱樂部」',
      '移除「相容領隊」的「測試俱樂部」領隊職位',
      '移除「相容教練」的「測試俱樂部」教練職位',
    ]);
  });

  it('經理轉移優先目錄姓名，文案逐字對齊 A', async () => {
    const input = editInput();
    input.values.captain = { uid: 'nextCap', name: '舊快取' };
    input.team.captainName = '過期舊經理';
    mocks.verifyUserDirectorySelection
      .mockResolvedValueOnce(verification(['nextCap', 'lead', 'coach']))
      .mockResolvedValueOnce(verification(['cap']));

    expect(await submitEditTeam(input))
      .toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(logFields().map(log => log['content'])).toEqual([
      '編輯「測試俱樂部」',
      '「測試俱樂部」俱樂部經理由「經理甲」轉移至「經理乙」',
    ]);
    expect(logFields()[1]).toMatchObject({
      type: 'team_position', typeName: '俱樂部職位變更',
    });
    expect(lineTargets()).toEqual(['nextCap']);
  });

  it('舊經理查無目錄時使用送出時名稱快取', async () => {
    const input = editInput();
    input.values.captain = { uid: 'nextCap', name: '經理乙' };
    input.team.captainName = '送出時舊經理';
    let finish!: (result: DirectoryVerification) => void;
    mocks.verifyUserDirectorySelection
      .mockImplementationOnce(() => new Promise<DirectoryVerification>((resolve) => {
        finish = resolve;
      }))
      .mockResolvedValueOnce({
        ...verification([]), missingUids: ['cap'],
      });

    const pending = submitEditTeam(input);
    await vi.waitFor(() =>
      expect(mocks.verifyUserDirectorySelection).toHaveBeenCalledTimes(1));
    input.team.captainName = '等待期間舊經理';
    finish(verification(['nextCap', 'lead', 'coach']));

    expect(await pending).toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(logFields()).toContainEqual(expect.objectContaining({
      type: 'team_position',
      content: '「測試俱樂部」俱樂部經理由「送出時舊經理」轉移至「經理乙」',
    }));
  });

  it('原先沒有經理時使用 A 的設定文案', async () => {
    const input = editInput({ viewer: viewer('admin', ['team.manage_all']) });
    delete input.team.captainUid;
    input.team.captain = '';
    input.team.captainName = '';

    expect(await submitEditTeam(input))
      .toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(logFields()).toContainEqual(expect.objectContaining({
      type: 'team_position',
      typeName: '俱樂部職位變更',
      content: '設定「經理甲」為「測試俱樂部」俱樂部經理',
    }));
  });
});

describe('卡 1b 退修：角色同步回應', () => {
  it.each([
    { response: null, expected: false },
    { response: { success: false }, expected: false },
    {
      response: { success: true, oldRole: 'user', newRole: 'coach' },
      expected: true,
    },
    { response: { skipped: true }, expected: true },
  ])('建立回應 $response → roleSyncOk=$expected', async ({ response, expected }) => {
    mocks.callFn.mockImplementation(async (name: string) =>
      name === 'autoPromoteTeamRole' ? response : {});

    expect(await submitCreateTeam(createInput()))
      .toEqual({ ok: true, teamId, roleSyncOk: expected });
    expect(writes('teams')).toHaveLength(1);
    expect(recalcUids()).toEqual(['cap', 'lead', 'coach']);
    expect(lineTargets()).toEqual(['cap', 'lead', 'coach']);
    expect(logFields()).toHaveLength(4);
    expect(logFields().some(log => log['type'] === 'role')).toBe(false);
  });

  it.each([
    { response: null, expected: false },
    { response: { success: false }, expected: false },
    { response: { success: true }, expected: true },
    { response: { skipped: true }, expected: true },
  ])('編輯被移除者回應 $response → roleSyncOk=$expected', async ({ response, expected }) => {
    const input = editInput();
    input.values.coaches = [];
    mocks.callFn.mockImplementation(async (
      name: string,
      args: { targetUid?: string },
    ) => name === 'autoPromoteTeamRole' && args.targetUid === 'coach'
      ? response
      : { success: true });

    expect(await submitEditTeam(input))
      .toEqual({ ok: true, teamId, roleSyncOk: expected });
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    expect(recalcUids()).toEqual(['cap', 'coach']);
    expect(lineTargets()).toEqual([]);
  });

  it('recalculateRole 原樣回傳 Callable 回應物件', async () => {
    const response = { success: true, oldRole: 'user', newRole: 'coach' };
    mocks.callFn.mockResolvedValueOnce(response);

    expect(await recalculateRole('coach', teamId)).toBe(response);
    expect(mocks.callFn).toHaveBeenCalledExactlyOnceWith(
      'autoPromoteTeamRole', { targetUid: 'coach', teamId },
    );
  });

  it('recalculateRole 暫時性錯誤重試一次，回傳第二次回應物件', async () => {
    const response = { success: true, targetUid: 'coach' };
    mocks.callFn
      .mockRejectedValueOnce({ code: 'functions/unavailable' })
      .mockResolvedValueOnce(response);

    expect(await recalculateRole('coach', teamId)).toBe(response);
    expect(mocks.callFn).toHaveBeenCalledTimes(2);
    expect(mocks.callFn).toHaveBeenNthCalledWith(
      2, 'autoPromoteTeamRole', { targetUid: 'coach', teamId },
    );
  });

  it('暫時性錯誤重試一次後 success:true，送出 roleSyncOk=true', async () => {
    let attempts = 0;
    mocks.callFn.mockImplementation(async (
      name: string,
      args: { targetUid?: string },
    ) => {
      if (name === 'autoPromoteTeamRole') {
        if (args.targetUid === 'lead') {
          attempts += 1;
          if (attempts === 1) throw { code: 'functions/unavailable' };
        }
        return { success: true, targetUid: args.targetUid };
      }
      return {};
    });

    expect(await submitCreateTeam(createInput()))
      .toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(attempts).toBe(2);
    expect(recalcUids().filter(uid => uid === 'lead')).toHaveLength(2);
  });
});

describe('submitCreateTeam', () => {
  it('完整流程、每一欄 payload、通知與操作日誌', async () => {
    const now = () => 1792700000000;
    const result = await submitCreateTeam(createInput({
      images: { coverDataUrl: 'data:image/png;base64,cover', cardDataUrl: 'data:image/png;base64,card' },
      now,
    }));

    expect(result).toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(mocks.verifyUserDirectorySelection)
      .toHaveBeenCalledExactlyOnceWith(['cap', 'lead', 'coach']);
    expect(mocks.generateId).toHaveBeenCalledExactlyOnceWith('tm_');
    expect(mocks.uploadImageDataUrl).toHaveBeenNthCalledWith(
      1, 'data:image/png;base64,cover', `teams/${teamId}_cover`, now,
    );
    expect(mocks.uploadImageDataUrl).toHaveBeenNthCalledWith(
      2, 'data:image/png;base64,card', `teams/${teamId}_card`, now,
    );
    expect(createdFields()).toEqual({
      id: teamId,
      name: '測試俱樂部',
      nameEn: 'Test Club',
      nationality: '台灣',
      region: values().region,
      founded: '2026',
      contact: '聯絡資料',
      bio: '俱樂部簡介',
      contactLinksEnabled: false,
      contactLinks: [],
      leader: '領隊甲',
      leaderUid: 'lead',
      leaders: ['領隊甲'],
      leaderUids: ['lead'],
      leaderNames: ['領隊甲'],
      captain: '經理甲',
      captainUid: 'cap',
      captainName: '經理甲',
      coaches: ['教練甲'],
      coachUids: ['coach'],
      coachNames: ['教練甲'],
      type: 'education',
      sportTag: 'football',
      teachingEnabled: true,
      eduSettings: { acceptingStudents: false, teachingEnabled: true },
      members: 3,
      image: `https://example.test/teams/${teamId}_cover`,
      imageVariants: {
        cover: `https://example.test/teams/${teamId}_cover`,
        card: `https://example.test/teams/${teamId}_card`,
      },
      active: true,
      pinned: false,
      pinOrder: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      gf: 0,
      ga: 0,
      history: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(writes('teams')[0]).toHaveLength(2);
    expect(mocks.updateDoc).not.toHaveBeenCalled();
    expect(mocks.trace.slice(0, 6)).toEqual([
      'verify', 'id',
      `upload:teams/${teamId}_cover`,
      `upload:teams/${teamId}_card`,
      'set:teams', 'invalidate',
    ]);
    for (const entry of ['call:autoPromoteTeamRole', 'inbox', 'set:operationLogs']) {
      expect(mocks.trace.indexOf(entry)).toBeGreaterThan(mocks.trace.indexOf('invalidate'));
    }
    expect(recalcUids()).toEqual(['cap', 'lead', 'coach']);

    const recipients = [
      ['cap', 'captain', '俱樂部經理'],
      ['lead', 'leader', '領隊'],
      ['coach', 'coach', '教練'],
    ] as const;
    for (const [uid, key, label] of recipients) {
      const title = '俱樂部職位指派';
      const body = `您已被設為「測試俱樂部」的${label}。`;
      expect(mocks.callFn).toHaveBeenCalledWith(
        'autoPromoteTeamRole', { targetUid: uid, teamId },
      );
      expect(mocks.deliverInboxMessage).toHaveBeenCalledWith({
        title, body,
        category: 'system',
        categoryName: '系統',
        targetUid: uid,
        senderName: '系統',
        senderUid: 'cap',
      });
      expect(mocks.callFn).toHaveBeenCalledWith(
        'enqueuePrivilegedLineNotification',
        {
          uid, title, body, category: 'system',
          source: `team_role_assignment:${key}`,
        },
      );
    }
    expect(mocks.deliverInboxMessage).toHaveBeenCalledTimes(3);
    expect(logFields().map(({ type, typeName, content, actorUid, operator }) => ({
      type, typeName, content, actorUid, operator,
    }))).toEqual([
      {
        type: 'team_create', typeName: '建立俱樂部',
        content: '建立「測試俱樂部」', actorUid: 'cap', operator: '操作者',
      },
      ...[
        '設定「經理甲」為「測試俱樂部」俱樂部經理',
        '新增「領隊甲」為「測試俱樂部」領隊',
        '新增「教練甲」為「測試俱樂部」教練',
      ].map(content => ({
        type: 'team_position', typeName: '俱樂部職位變更',
        content, actorUid: 'cap', operator: '操作者',
      })),
    ]);
  });

  it.each([
    viewer(null),
    viewer('cap', []),
  ])('未登入或無建立權限', async (currentViewer) => {
    expect(await submitCreateTeam(createInput({ viewer: currentViewer })))
      .toEqual({ ok: false, reason: 'forbidden' });
    expect(mocks.verifyUserDirectorySelection).not.toHaveBeenCalled();
    expect(mocks.uploadImageDataUrl).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it('驗證失敗回傳原文案', async () => {
    const input = createInput();
    input.values.name = ' ';
    expect(await submitCreateTeam(input)).toEqual({
      ok: false, reason: 'invalid', message: '請輸入俱樂部名稱',
    });
    expect(mocks.verifyUserDirectorySelection).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it('新增經理必須是登入者', async () => {
    const input = createInput();
    input.values.captain = { uid: 'nextCap', name: '經理乙' };
    expect(await submitCreateTeam(input)).toEqual({
      ok: false, reason: 'captain-mismatch',
    });
    expect(mocks.verifyUserDirectorySelection).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it.each(['reject', 'not-ok', 'missing', 'unreported-missing'])(
    '驗證 %s 時不產生 ID、不上傳、不寫入',
    async (mode) => {
      if (mode === 'reject') {
        mocks.verifyUserDirectorySelection.mockRejectedValueOnce(new Error('offline'));
      } else {
        const response = verification(['cap', 'lead', 'coach']);
        if (mode === 'not-ok') response.ok = false;
        if (mode === 'missing') response.missingUids = ['lead'];
        if (mode === 'unreported-missing') {
          response.users = response.users.filter(user => user.uid !== 'lead');
        }
        mocks.verifyUserDirectorySelection.mockResolvedValueOnce(response);
      }
      expect(await submitCreateTeam(createInput())).toEqual({
        ok: false,
        reason: 'verify-failed',
        message: '無法確認人員資料，請重新搜尋後再試',
      });
      expect(mocks.generateId).not.toHaveBeenCalled();
      expect(mocks.uploadImageDataUrl).not.toHaveBeenCalled();
      expectNoWrites();
    },
  );

  it('無圖直接用預設 HTTPS 封面', async () => {
    expect(resolveDefaultTeamCoverImage()).toBe(DEFAULT_TEAM_COVER_URL);
    expect(await submitCreateTeam(createInput())).toEqual({
      ok: true, teamId, roleSyncOk: true,
    });
    expect(mocks.uploadImageDataUrl).not.toHaveBeenCalled();
    expect(createdFields()['image']).toBe(DEFAULT_TEAM_COVER_URL);
    expect(createdFields()).not.toHaveProperty('imageVariants');
  });

  it.each(['null', 'reject'])('圖片 %s 仍建立，回退預設封面', async (mode) => {
    if (mode === 'null') mocks.uploadImageDataUrl.mockResolvedValue(null);
    else mocks.uploadImageDataUrl.mockRejectedValue(new Error('upload unavailable'));

    expect(await submitCreateTeam(createInput({
      images: { coverDataUrl: 'data:image/png;base64,cover' },
    }))).toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(createdFields()['image']).toBe(DEFAULT_TEAM_COVER_URL);
    expect(createdFields()).not.toHaveProperty('imageVariants');
  });

  it('cover 失敗、card 成功：只寫 card 並作為主圖', async () => {
    mocks.uploadImageDataUrl.mockResolvedValueOnce(null);
    await submitCreateTeam(createInput({
      images: { coverDataUrl: 'data:cover', cardDataUrl: 'data:card' },
    }));
    expect(createdFields()['image']).toBe(`https://example.test/teams/${teamId}_card`);
    expect(createdFields()['imageVariants']).toEqual({
      card: `https://example.test/teams/${teamId}_card`,
    });
  });

  it('同 UID 多職務：驗證及重算去重，通知仍依職務送出', async () => {
    const input = createInput();
    input.values.coaches = [{ uid: 'lead', name: '領隊甲' }];
    await submitCreateTeam(input);
    expect(mocks.verifyUserDirectorySelection)
      .toHaveBeenCalledExactlyOnceWith(['cap', 'lead']);
    expect(createdFields()['members']).toBe(2);
    expect(recalcUids()).toEqual(['cap', 'lead']);
    expect(lineTargets()).toEqual(['cap', 'lead', 'lead']);
  });

  it('寫入失敗不啟動副作用', async () => {
    mocks.setDoc.mockRejectedValueOnce(new Error('permission-denied'));
    expect(await submitCreateTeam(createInput())).toEqual({
      ok: false, reason: 'write-failed', message: '儲存失敗：permission-denied',
    });
    expect(mocks.invalidateTeams).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it('等待主寫入完成後才開始副作用', async () => {
    let finish!: () => void;
    mocks.setDoc.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    const pending = submitCreateTeam(createInput());
    await vi.waitFor(() => expect(writes('teams')).toHaveLength(1));
    expectNoSideEffects();
    finish();
    expect(await pending).toEqual({ ok: true, teamId, roleSyncOk: true });
  });

  it.each(['inbox', 'line', 'log'])('%s 失敗不影響 ok 與角色同步', async (kind) => {
    if (kind === 'inbox') {
      mocks.deliverInboxMessage.mockRejectedValueOnce(new Error('failed'));
    }
    if (kind === 'line') {
      mocks.callFn.mockImplementation(async (name: string) => {
        if (name === 'enqueuePrivilegedLineNotification') throw new Error('failed');
        return {};
      });
    }
    if (kind === 'log') {
      vi.spyOn(opLog, 'writeOpLog').mockRejectedValueOnce(new Error('failed'));
    }
    expect(await submitCreateTeam(createInput()))
      .toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(mocks.deliverInboxMessage).toHaveBeenCalledTimes(3);
    expect(lineTargets()).toEqual(['cap', 'lead', 'coach']);
    expect(recalcUids()).toEqual(['cap', 'lead', 'coach']);
    expect(console.warn).toHaveBeenCalled();
  });

  it('重算失敗保留 ok，roleSyncOk=false', async () => {
    mocks.callFn.mockImplementation(async (name: string, args: { targetUid?: string }) => {
      if (name === 'autoPromoteTeamRole' && args.targetUid === 'lead') {
        throw new Error('role failed');
      }
      return {};
    });
    expect(await submitCreateTeam(createInput()))
      .toEqual({ ok: true, teamId, roleSyncOk: false });
    expect(lineTargets()).toEqual(['cap', 'lead', 'coach']);
    expect(logFields()).toHaveLength(4);
    expect(console.warn).toHaveBeenCalled();
  });

  it('重算暫時性錯誤沿用一次重試；重試成功 roleSyncOk=true', async () => {
    let attempts = 0;
    mocks.callFn.mockImplementation(async (name: string, args: { targetUid?: string }) => {
      if (name === 'autoPromoteTeamRole' && args.targetUid === 'lead') {
        attempts += 1;
        if (attempts === 1) throw { code: 'functions/unavailable' };
      }
      return {};
    });
    expect(await submitCreateTeam(createInput()))
      .toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(attempts).toBe(2);
  });

  it('重算兩次皆失敗 roleSyncOk=false', async () => {
    mocks.callFn.mockImplementation(async (name: string, args: { targetUid?: string }) => {
      if (name === 'autoPromoteTeamRole' && args.targetUid === 'lead') {
        throw { code: 'functions/internal' };
      }
      return {};
    });
    expect(await submitCreateTeam(createInput()))
      .toEqual({ ok: true, teamId, roleSyncOk: false });
    expect(recalcUids().filter(uid => uid === 'lead')).toHaveLength(2);
  });

  it('沒有 displayName 時 operator 為系統', async () => {
    await submitCreateTeam(createInput({
      viewer: {
        uid: 'cap',
        hasPermission: code => ['team.create', 'team.assign_coach'].includes(code),
      },
    }));
    expect(logFields()).toHaveLength(4);
    expect(logFields().every(log => log['operator'] === '系統')).toBe(true);
    expect(logFields().every(log => log['actorUid'] === 'cap')).toBe(true);
  });
});

describe('submitEditTeam', () => {
  it('無新圖不碰圖片欄位；_docId 優先，未改職務不通知', async () => {
    expect(await submitEditTeam(editInput()))
      .toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(mocks.uploadImageDataUrl).not.toHaveBeenCalled();
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    expect(mocks.updateDoc.mock.calls[0]?.[0]).toEqual({
      collection: 'teams', id: 'legacy-document',
    });
    expect(editedFields()).not.toHaveProperty('image');
    expect(editedFields()).not.toHaveProperty('imageVariants');
    for (const key of [
      'id', 'members', 'creatorUid', 'ownerUid', 'avatarUrl',
      'wins', 'draws', 'losses', 'gf', 'ga', 'history',
      'active', 'pinned', 'pinOrder', 'createdAt',
    ]) {
      expect(editedFields()).not.toHaveProperty(key);
    }
    expect(editedFields()['name']).toBe('測試俱樂部');
    expect(editedFields()['captainName']).toBe('經理甲');
    expect(editedFields()['updatedAt']).toEqual(timestamp);
    expect(recalcUids()).toEqual(['cap', 'coach']);
    expect(mocks.deliverInboxMessage).not.toHaveBeenCalled();
    expect(lineTargets()).toEqual([]);
    expect(logFields()).toEqual([
      expect.objectContaining({
        type: 'team_edit',
        typeName: '編輯俱樂部',
        content: '編輯「測試俱樂部」',
        actorUid: 'cap',
        operator: '操作者',
      }),
    ]);
  });

  it('只上傳本次 card，以 public id 作 Storage 路徑', async () => {
    await submitEditTeam(editInput({ images: { cardDataUrl: 'data:new-card' } }));
    expect(mocks.uploadImageDataUrl).toHaveBeenCalledExactlyOnceWith(
      'data:new-card', `teams/${teamId}_card`,
    );
    expect(editedFields()['image']).toBe(`https://example.test/teams/${teamId}_card`);
    expect(editedFields()['imageVariants']).toEqual({
      card: `https://example.test/teams/${teamId}_card`,
    });
  });

  it('編輯新圖全部失敗時省略圖片欄位，保留既有圖', async () => {
    mocks.uploadImageDataUrl.mockResolvedValue(null);
    expect(await submitEditTeam(editInput({
      images: { coverDataUrl: 'data:new-cover' },
    }))).toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(editedFields()).not.toHaveProperty('image');
    expect(editedFields()).not.toHaveProperty('imageVariants');
  });

  it('缺少 public id 時 Storage 及角色同步採 _docId', async () => {
    const currentTeam = team();
    delete currentTeam.id;
    expect(await submitEditTeam(editInput({
      team: currentTeam, images: { coverDataUrl: 'data:cover' },
    }))).toEqual({ ok: true, teamId: 'legacy-document', roleSyncOk: true });
    expect(mocks.uploadImageDataUrl).toHaveBeenCalledExactlyOnceWith(
      'data:cover', 'teams/legacy-document_cover',
    );
    expect(mocks.callFn).toHaveBeenCalledWith('autoPromoteTeamRole', {
      targetUid: 'cap', teamId: 'legacy-document',
    });
  });

  it('新幹部通知；移除者重算及寫日誌，舊人員另查目錄姓名', async () => {
    const input = editInput();
    input.values.captain = { uid: 'nextCap', name: '舊快取' };
    input.values.leaders = [{ uid: 'nextLead', name: '舊快取' }];
    input.values.coaches = [{ uid: 'nextCoach', name: '舊快取' }];

    expect(await submitEditTeam(input))
      .toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(mocks.verifyUserDirectorySelection)
      .toHaveBeenNthCalledWith(1, ['nextCap', 'nextLead', 'nextCoach']);
    expect(mocks.verifyUserDirectorySelection)
      .toHaveBeenNthCalledWith(2, ['cap', 'lead', 'coach']);
    expect(mocks.verifyUserDirectorySelection).toHaveBeenCalledTimes(2);
    expect(recalcUids()).toEqual([
      'nextCap', 'nextLead', 'nextCoach', 'cap', 'coach', 'lead',
    ]);
    expect(lineTargets()).toEqual(['nextCap', 'nextLead', 'nextCoach']);
    expect(mocks.deliverInboxMessage.mock.calls.map(
      ([message]) => (message as { targetUid: string }).targetUid,
    )).toEqual(['nextCap', 'nextLead', 'nextCoach']);
    expect(logFields().map(log => log['content'])).toEqual([
      '編輯「測試俱樂部」',
      '「測試俱樂部」俱樂部經理由「經理甲」轉移至「經理乙」',
      '新增「領隊乙」為「測試俱樂部」領隊',
      '移除「領隊甲」的「測試俱樂部」領隊職位',
      '新增「教練乙」為「測試俱樂部」教練',
      '移除「教練甲」的「測試俱樂部」教練職位',
    ]);
  });

  it('舊格式 leaderUid 參與差異計算，既有領隊不重複通知', async () => {
    const currentTeam = team();
    delete currentTeam.leaderUids;
    currentTeam.leaderUid = 'lead';
    await submitEditTeam(editInput({ team: currentTeam }));
    expect(lineTargets()).toEqual([]);
    expect(recalcUids()).toEqual(['cap', 'coach']);
  });

  it('非教學型刪除 eduSettings，未連結舊名保留且不參與 UID 驗證', async () => {
    const input = editInput();
    input.values.type = 'leisure';
    input.values.unresolvedLeaderNames = ['舊領隊'];
    input.values.unresolvedCoachNames = ['舊教練'];
    await submitEditTeam(input);
    expect(editedFields()['eduSettings']).toEqual({ __deleteField: true });
    expect(editedFields()['teachingEnabled']).toBe(false);
    expect(editedFields()['leaderNames']).toEqual(['領隊甲', '舊領隊']);
    expect(editedFields()['coachNames']).toEqual(['教練甲', '舊教練']);
    expect(mocks.verifyUserDirectorySelection)
      .toHaveBeenCalledExactlyOnceWith(['cap', 'lead', 'coach']);
  });

  it('非 owner 且無 manage_all 時 forbidden', async () => {
    expect(await submitEditTeam(editInput({
      viewer: viewer('stranger', ['team.create']),
    }))).toEqual({ ok: false, reason: 'forbidden', message: '權限不足' });
    expect(mocks.verifyUserDirectorySelection).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it.each(['ownerUid', 'creatorUid'] as const)(
    '%s 可編輯，但不得轉移經理',
    async (field) => {
      const currentTeam = { ...team(), [field]: 'owner' };
      const input = editInput({ team: currentTeam, viewer: viewer('owner', []) });
      input.values.captain = { uid: 'nextCap', name: '經理乙' };
      expect(await submitEditTeam(input))
        .toEqual({ ok: false, reason: 'forbidden', message: '權限不足' });
      expect(mocks.verifyUserDirectorySelection).not.toHaveBeenCalled();
      expectNoWrites();
    },
  );

  it('owner 保留經理時可以編輯', async () => {
    expect(await submitEditTeam(editInput({
      team: { ...team(), ownerUid: 'owner' },
      viewer: viewer('owner', []),
    }))).toEqual({ ok: true, teamId, roleSyncOk: true });
  });

  it('manage_all 可以轉移經理', async () => {
    const input = editInput({ viewer: viewer('admin', ['team.manage_all']) });
    input.values.captain = { uid: 'nextCap', name: '經理乙' };
    expect(await submitEditTeam(input))
      .toEqual({ ok: true, teamId, roleSyncOk: true });
    expect(editedFields()['captainUid']).toBe('nextCap');
    expect(lineTargets()).toEqual(['nextCap']);
    expect(recalcUids()).toContain('cap');
  });

  it('編輯驗證失敗不寫入', async () => {
    mocks.verifyUserDirectorySelection.mockRejectedValueOnce(new Error('offline'));
    expect(await submitEditTeam(editInput())).toEqual({
      ok: false, reason: 'verify-failed',
      message: '無法確認人員資料，請重新搜尋後再試',
    });
    expectNoWrites();
  });

  it('表單驗證錯誤原文回傳', async () => {
    const input = editInput();
    input.values.sportTag = '';
    expect(await submitEditTeam(input)).toEqual({
      ok: false, reason: 'invalid', message: '請選擇運動類型',
    });
    expectNoWrites();
  });

  it('更新失敗不觸發副作用', async () => {
    mocks.updateDoc.mockRejectedValueOnce(new Error('offline'));
    expect(await submitEditTeam(editInput())).toEqual({
      ok: false, reason: 'write-failed', message: '俱樂部更新失敗，請重試',
    });
    expect(mocks.invalidateTeams).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it('被移除者重算失敗也反映 roleSyncOk=false', async () => {
    const input = editInput();
    input.values.coaches = [];
    mocks.callFn.mockImplementation(async (name: string, args: { targetUid?: string }) => {
      if (name === 'autoPromoteTeamRole' && args.targetUid === 'coach') {
        throw new Error('failed');
      }
      return {};
    });
    expect(await submitEditTeam(input))
      .toEqual({ ok: true, teamId, roleSyncOk: false });
    expect(recalcUids()).toEqual(['cap', 'coach']);
    expect(mocks.deliverInboxMessage).not.toHaveBeenCalled();
    expect(logFields().map(log => log['content'])).toEqual([
      '編輯「測試俱樂部」',
      '移除「教練甲」的「測試俱樂部」教練職位',
    ]);
  });
});
