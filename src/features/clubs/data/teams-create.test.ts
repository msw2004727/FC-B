import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamFormValues } from './team-form-model';
import type { TeamBasicPatch, TeamCreatePayload } from './teams-create';

vi.mock('@/data/firebase', () => ({ getFirebase: vi.fn() }));
vi.mock('./teams-repo', () => ({ invalidateTeams: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  deleteField: vi.fn(() => ({ __deleteField: true })),
}));

import { getFirebase } from '@/data/firebase';
import { invalidateTeams } from './teams-repo';
import { buildCreateTeamPayload, buildUpdateTeamPatch } from './team-form-model';
import { createTeamDoc, updateTeamBasicDoc } from './teams-create';

const {
  doc: fsDoc,
  setDoc: fsSetDoc,
  updateDoc: fsUpdateDoc,
  serverTimestamp,
  deleteField,
} = await import('firebase/firestore');

const teamId = 'tm_1792700000000_abc123';
const db = {} as Awaited<ReturnType<typeof getFirebase>>['db'];
const ref = { id: teamId } as unknown as ReturnType<typeof fsDoc>;
const timestamp = { __serverTimestamp: true };

function values(): TeamFormValues {
  return {
    type: 'competitive',
    sportTag: 'football',
    name: ' 測試俱樂部 ',
    nameEn: ' Club ',
    nationality: '台灣',
    region: '臺北市',
    founded: '2026',
    contact: ' 聯絡人 ',
    bio: ' 簡介 ',
    eduAccepting: true,
    contactLinksEnabled: false,
    contactLinkDrafts: [],
    captain: { uid: 'cap', name: '經理' },
    leaders: [{ uid: 'lead', name: '領隊' }],
    coaches: [{ uid: 'coach', name: '教練' }],
    unresolvedLeaderNames: [],
    unresolvedCoachNames: [],
    unresolvedCaptainName: '',
  };
}

function payload(): TeamCreatePayload {
  return buildCreateTeamPayload({
    teamId,
    values: values(),
    contactLinks: { enabled: false, links: [] },
    image: 'https://example.test/cover',
    imageVariants: null,
  });
}

function patch(): TeamBasicPatch {
  return buildUpdateTeamPatch({
    values: values(),
    contactLinks: { enabled: false, links: [] },
  });
}

async function expectInvalid(action: () => Promise<void>): Promise<void> {
  await expect(action()).rejects.toThrow('[teams-create]');
  expect(getFirebase).not.toHaveBeenCalled();
  expect(fsDoc).not.toHaveBeenCalled();
  expect(fsSetDoc).not.toHaveBeenCalled();
  expect(fsUpdateDoc).not.toHaveBeenCalled();
  expect(invalidateTeams).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getFirebase).mockResolvedValue(
    { db } as Awaited<ReturnType<typeof getFirebase>>,
  );
  vi.mocked(fsDoc).mockReturnValue(ref);
  vi.mocked(fsSetDoc).mockResolvedValue(undefined);
  vi.mocked(fsUpdateDoc).mockResolvedValue(undefined);
  vi.mocked(serverTimestamp).mockReturnValue(
    timestamp as unknown as ReturnType<typeof serverTimestamp>,
  );
  vi.mocked(deleteField).mockReturnValue(
    { __deleteField: true } as unknown as ReturnType<typeof deleteField>,
  );
});

describe('createTeamDoc', () => {
  it('完整 set、不帶 merge，成功後才 invalidate', async () => {
    const input = payload();
    await createTeamDoc(teamId, input);

    expect(fsDoc).toHaveBeenCalledExactlyOnceWith(db, 'teams', teamId);
    expect(fsSetDoc).toHaveBeenCalledExactlyOnceWith(ref, {
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(vi.mocked(fsSetDoc).mock.calls[0]).toHaveLength(2);
    expect(serverTimestamp).toHaveBeenCalledTimes(2);
    expect(fsUpdateDoc).not.toHaveBeenCalled();
    expect(invalidateTeams).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fsSetDoc).mock.invocationCallOrder[0]!)
      .toBeLessThan(vi.mocked(invalidateTeams).mock.invocationCallOrder[0]!);
  });

  it.each([
    'unknown', 'creatorUid', 'ownerUid', 'avatarUrl', 'createdAt', 'updatedAt',
  ])('拒絕 %s', async (key) => {
    await expectInvalid(() => createTeamDoc(teamId, {
      ...payload(),
      [key]: 'forbidden',
    } as TeamCreatePayload));
  });

  it('拒絕 Symbol 鍵', async () => {
    await expectInvalid(() => createTeamDoc(teamId, {
      ...payload(),
      [Symbol('extra')]: true,
    }));
  });

  it.each([
    '', 'tm_test_1', 'tm_123_abc', 'tm_1792700000000_',
    'tm_1792700000000_ABCDEFGHI', 'tm_1792700000000_abcdefghi',
    'tm_1792700000000_A', 'tm_1792700000000_a/b',
    ' tm_1792700000000_abc',
  ])('拒絕錯誤 ID：%s', async (id) => {
    await expectInvalid(() => createTeamDoc(id, { ...payload(), id }));
  });

  it('拒絕文件 id 與 payload.id 不同', async () => {
    await expectInvalid(() => createTeamDoc(teamId, {
      ...payload(),
      id: 'tm_1792700000000_other',
    }));
  });

  it('寫入失敗不 invalidate', async () => {
    vi.mocked(fsSetDoc).mockRejectedValueOnce(new Error('offline'));
    await expect(createTeamDoc(teamId, payload())).rejects.toThrow('offline');
    expect(invalidateTeams).not.toHaveBeenCalled();
  });

  it('寫入尚未完成不 invalidate', async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => { complete = resolve; });
    vi.mocked(fsSetDoc).mockReturnValueOnce(pending);
    const action = createTeamDoc(teamId, payload());
    await vi.waitFor(() => expect(fsSetDoc).toHaveBeenCalledTimes(1));
    expect(invalidateTeams).not.toHaveBeenCalled();
    complete();
    await action;
    expect(invalidateTeams).toHaveBeenCalledTimes(1);
  });
});

describe('updateTeamBasicDoc', () => {
  it('優先 _docId、null 轉 deleteField，成功後 invalidate', async () => {
    const input = patch();
    await updateTeamBasicDoc({ id: teamId, _docId: 'legacy-document' }, input);

    expect(fsDoc).toHaveBeenCalledExactlyOnceWith(db, 'teams', 'legacy-document');
    expect(fsUpdateDoc).toHaveBeenCalledExactlyOnceWith(ref, {
      ...input,
      eduSettings: { __deleteField: true },
      updatedAt: timestamp,
    });
    expect(deleteField).toHaveBeenCalledTimes(1);
    expect(serverTimestamp).toHaveBeenCalledTimes(1);
    expect(fsSetDoc).not.toHaveBeenCalled();
    expect(invalidateTeams).toHaveBeenCalledTimes(1);
    expect(input.eduSettings).toBeNull();
  });

  it('缺少 _docId 時使用 id，教學設定原樣保留', async () => {
    const input: TeamBasicPatch = {
      ...patch(),
      type: 'education',
      teachingEnabled: true,
      eduSettings: { acceptingStudents: false, teachingEnabled: true },
    };
    await updateTeamBasicDoc({ id: teamId }, input);
    expect(fsDoc).toHaveBeenCalledExactlyOnceWith(db, 'teams', teamId);
    expect(fsUpdateDoc).toHaveBeenCalledExactlyOnceWith(ref, {
      ...input,
      updatedAt: timestamp,
    });
    expect(deleteField).not.toHaveBeenCalled();
  });

  it.each([
    'unknown', 'members', 'id', 'creatorUid', 'ownerUid', 'avatarUrl',
    'wins', 'draws', 'losses', 'gf', 'ga', 'history', 'createdAt',
    'updatedAt', 'active', 'pinned', 'pinOrder',
  ])('拒絕 %s', async (key) => {
    await expectInvalid(() => updateTeamBasicDoc({ id: teamId }, {
      ...patch(),
      [key]: 'forbidden',
    } as TeamBasicPatch));
  });

  it('拒絕沒有文件定位', async () => {
    await expectInvalid(() => updateTeamBasicDoc({}, patch()));
  });

  it('拒絕空 patch', async () => {
    await expectInvalid(() => updateTeamBasicDoc(
      { id: teamId },
      {} as TeamBasicPatch,
    ));
  });

  it('寫入失敗不 invalidate', async () => {
    vi.mocked(fsUpdateDoc).mockRejectedValueOnce(new Error('offline'));
    await expect(updateTeamBasicDoc({ id: teamId }, patch()))
      .rejects.toThrow('offline');
    expect(invalidateTeams).not.toHaveBeenCalled();
  });
});
