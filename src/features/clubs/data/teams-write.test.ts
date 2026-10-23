/**
 * 欄位對照驗收（A → B）：
 * - 頭像：avatarUrl → avatarUrl。
 * - 封面：image → image；imageVariants.cover/card/square → 同名欄位。
 * - 設定：type → type；teachingEnabled → teachingEnabled；
 *   eduSettings → eduSettings；allowMemberInvite → allowMemberInvite；
 *   themeColor → themeColor；themeOverlayEnabled → themeOverlayEnabled；
 *   detailVisibility → detailVisibility。
 * - 職務：leaderUids → leaderUids；leaders → leaders；
 *   leaderNames → leaderNames；leaderUid → leaderUid；leader → leader；
 *   coachUids → coachUids；coaches → coaches；coachNames → coachNames。
 * - 備註：memberActivityData[uid].notes/updatedAt → 同名欄位；
 *   memberCourseData[uid].notes/updatedAt → 同名欄位。
 * - 文件時間：updatedAt → updatedAt（serverTimestamp）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'firebase/firestore';
import type { MemberRoleUpdates } from '../club-policy';
import type { TeamDoc } from './types';
import type {
  TeamMemberNoteKind,
  TeamSettingsPatch,
  TeamWriteTarget,
} from './teams-write';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  updateDoc: vi.fn(),
  runTransaction: vi.fn(), // 測試同步更新
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  deleteField: vi.fn(() => ({ __deleteField: true })),
  FieldPath: class {
    segments: string[];

    constructor(...segments: string[]) {
      this.segments = segments;
    }
  },
}));

vi.mock('./teams-repo', () => ({
  invalidateTeams: vi.fn(),
}));

import { getFirebase } from '@/data/firebase';
import { invalidateTeams } from './teams-repo';
import {
  saveTeamAvatar,
  saveTeamCover,
  saveTeamMemberNote,
  saveTeamRoleChange, // 測試同步更新
  saveTeamRoleUpdates,
  saveTeamSettingsPatch,
} from './teams-write';

const {
  doc: fsDoc,
  updateDoc: fsUpdateDoc,
  runTransaction: fsRunTransaction,
  serverTimestamp: fsServerTimestamp,
  deleteField: fsDeleteField,
  FieldPath,
} = await import('firebase/firestore');

const db = {} as Awaited<ReturnType<typeof getFirebase>>['db'];
const ref = { id: 'tm_test_1' } as unknown as ReturnType<typeof fsDoc>;
const team: TeamWriteTarget = { _docId: 'tm_test_1', id: 'tm_test_1' };
const timestamp = { __serverTimestamp: true };
const iso = '2026-10-23T01:02:03.000Z';
const note = { notes: '測試備註', updatedAt: iso };

function roles(): MemberRoleUpdates {
  return {
    leaderUids: ['U-test-1'],
    leaders: ['測試領隊'],
    leaderNames: ['測試領隊'],
    leaderUid: 'U-test-1',
    leader: '測試領隊',
    coachUids: ['U-test-1'],
    coaches: ['測試教練'],
    coachNames: ['測試教練'],
  };
}

function expectSuccess(args: unknown[]): void {
  expect(fsDoc).toHaveBeenCalledExactlyOnceWith(db, 'teams', 'tm_test_1');
  expect(fsUpdateDoc).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fsUpdateDoc).mock.calls[0]).toEqual(args);
  expect(fsServerTimestamp).toHaveBeenCalledTimes(1);
  expect(invalidateTeams).toHaveBeenCalledTimes(1);
}

async function expectInvalid(action: () => Promise<void>): Promise<void> {
  await expect(action()).rejects.toThrow(Error);
  expect(fsUpdateDoc).not.toHaveBeenCalled();
  expect(invalidateTeams).not.toHaveBeenCalled();
  expect(getFirebase).not.toHaveBeenCalled();
  expect(fsDoc).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFirebase).mockResolvedValue(
    { db } as Awaited<ReturnType<typeof getFirebase>>,
  );
  vi.mocked(fsDoc).mockReturnValue(ref);
  vi.mocked(fsUpdateDoc).mockReset();
  vi.mocked(fsUpdateDoc).mockResolvedValue(undefined);
});

const actions: Array<{
  name: string;
  run: (target: TeamWriteTarget) => Promise<void>;
}> = [
  {
    name: '頭像',
    run: (target) => saveTeamAvatar(target, 'https://example.test/avatar'),
  },
  {
    name: '封面',
    run: (target) => saveTeamCover(target, { image: 'https://example.test/cover' }),
  },
  {
    name: '設定',
    run: (target) => saveTeamSettingsPatch(target, { type: 'none' }),
  },
  {
    name: '職務',
    run: (target) => saveTeamRoleUpdates(target, roles()),
  },
  {
    name: '活動備註',
    run: (target) => saveTeamMemberNote(target, 'activity', 'U-test-1', note),
  },
  {
    name: '課程備註',
    run: (target) => saveTeamMemberNote(target, 'course', 'U-test-1', note),
  },
];

describe.each(actions)('$name 的共用寫入契約', ({ run }) => {
  it('文件定位優先使用 _docId', async () => {
    await run({ _docId: 'tm_test_1', id: 'U-test-1' });
    expect(fsDoc).toHaveBeenCalledExactlyOnceWith(db, 'teams', 'tm_test_1');
    expect(invalidateTeams).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '', '   '])('_docId 為 %s 時回退使用 id', async (docId) => {
    const target: TeamWriteTarget = { id: 'tm_test_1' };
    if (docId !== undefined) target._docId = docId;
    await run(target);
    expect(fsDoc).toHaveBeenCalledExactlyOnceWith(db, 'teams', 'tm_test_1');
    expect(invalidateTeams).toHaveBeenCalledTimes(1);
  });

  it.each<TeamWriteTarget>([
    {},
    { id: '', _docId: '' },
    { id: '  ', _docId: '  ' },
  ])('文件 id 都空時拋出指定錯誤且不寫入：%j', async (target) => {
    await expect(run(target)).rejects.toThrow('[teams-write] team doc id missing');
    expect(fsUpdateDoc).not.toHaveBeenCalled();
    expect(invalidateTeams).not.toHaveBeenCalled();
    expect(getFirebase).not.toHaveBeenCalled();
  });

  it('寫入拒絕時原樣拋出錯誤且不清除快取，重試成功才清除', async () => {
    const error = new Error('模擬寫入失敗');
    vi.mocked(fsUpdateDoc).mockRejectedValueOnce(error);

    await expect(run(team)).rejects.toBe(error);
    expect(invalidateTeams).not.toHaveBeenCalled();

    await run(team);
    expect(fsUpdateDoc).toHaveBeenCalledTimes(2);
    expect(invalidateTeams).toHaveBeenCalledTimes(1);
  });

  it('寫入完成前不清除快取', async () => {
    let finish: () => void = () => {
      throw new Error('尚未建立寫入等待');
    };
    const pendingWrite = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let started: () => void = () => {
      throw new Error('尚未建立開始通知');
    };
    const startedWrite = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(fsUpdateDoc).mockImplementationOnce(() => {
      started();
      return pendingWrite;
    });

    const saving = run(team);
    await startedWrite;
    expect(invalidateTeams).not.toHaveBeenCalled();
    finish();
    await saving;
    expect(invalidateTeams).toHaveBeenCalledTimes(1);
  });
});

describe('儲存頭像', () => {
  it('修剪網址且只寫 avatarUrl 與文件時間', async () => {
    await saveTeamAvatar(team, '  https://example.test/avatar  ');
    expectSuccess([ref, {
      avatarUrl: 'https://example.test/avatar',
      updatedAt: timestamp,
    }]);
  });

  it.each(['http://example.test/avatar', '', 'data:image/png;base64,test'])(
    '拒絕非 HTTPS 頭像：%s',
    async (url) => {
      await expectInvalid(() => saveTeamAvatar(team, url));
    },
  );
});

describe('儲存封面', () => {
  it('逐欄寫入 image 與三個合法尺寸圖', async () => {
    await saveTeamCover(team, {
      image: ' https://example.test/image ',
      imageVariants: {
        cover: 'https://example.test/cover',
        card: 'https://example.test/card',
        square: 'https://example.test/square',
      },
    });
    expectSuccess([ref, {
      image: 'https://example.test/image',
      imageVariants: {
        cover: 'https://example.test/cover',
        card: 'https://example.test/card',
        square: 'https://example.test/square',
      },
      updatedAt: timestamp,
    }]);
  });

  // 測試同步更新：提供尺寸圖後，任何非法值都拒絕整筆寫入。
  it.each([
    { name: 'null', value: null },
    { name: '字串', value: 'https://example.test/cover' },
    { name: '數字', value: 123 },
    { name: '布林', value: false },
    { name: '陣列', value: [] },
    { name: '未知 key', value: { homeNext: 'https://example.test/next' } },
    { name: '非 HTTPS', value: { card: 'http://example.test/card' } },
    { name: '非字串值', value: { square: 123 } },
    { name: 'undefined 值', value: { cover: undefined } },
    { name: '前導空白', value: { cover: ' https://example.test/cover' } },
    {
      name: '合法與非法混合',
      value: {
        cover: 'https://example.test/cover',
        card: 'http://example.test/card',
      },
    },
  ])('含非法尺寸圖時拋錯：$name', async ({ value }) => {
    const payload = {
      image: 'https://example.test/image',
      imageVariants: value,
    } as unknown as Parameters<typeof saveTeamCover>[1];
    await expectInvalid(() => saveTeamCover(team, payload));
  });

  it('頂層額外欄位仍不寫入', async () => {
    const payload = {
      image: 'https://example.test/image',
      coverUrl: 'https://example.test/legacy',
      members: 5,
      imageVariants: { cover: 'https://example.test/cover' },
    };
    await saveTeamCover(team, payload);
    expectSuccess([ref, {
      image: 'https://example.test/image',
      imageVariants: { cover: 'https://example.test/cover' },
      updatedAt: timestamp,
    }]);
  });

  // 測試同步更新：只有未提供或空物件才省略尺寸圖。
  it.each([
    {},
    { imageVariants: undefined },
    { imageVariants: {} },
  ])('未提供或空尺寸圖時省略 imageVariants：%j', async (extra) => {
    await saveTeamCover(team, { image: 'https://example.test/image', ...extra });
    expectSuccess([ref, {
      image: 'https://example.test/image',
      updatedAt: timestamp,
    }]);
  });

  it.each(['http://example.test/image', '', 'data:image/png;base64,test'])(
    '拒絕非 HTTPS 封面：%s',
    async (image) => {
      await expectInvalid(() => saveTeamCover(team, { image }));
    },
  );
});

describe('儲存設定', () => {
  it('逐欄寫入七個設定並將主題色轉小寫', async () => {
    const eduSettings = {
      acceptingStudents: false,
      teachingEnabled: true as const,
      students: ['U-test-1'],
      extra: { preserved: true },
    };
    await saveTeamSettingsPatch(team, {
      type: 'education',
      teachingEnabled: true,
      eduSettings,
      allowMemberInvite: false,
      themeColor: '#AbC012',
      themeOverlayEnabled: true,
      detailVisibility: {
        events: true,
        courses: false,
        matches: true,
        info: false,
        bio: true,
        record: false,
        members: true,
      },
    });
    expectSuccess([ref, {
      type: 'education',
      teachingEnabled: true,
      eduSettings,
      allowMemberInvite: false,
      themeColor: '#abc012',
      themeOverlayEnabled: true,
      detailVisibility: {
        events: true,
        courses: false,
        matches: true,
        info: false,
        bio: true,
        record: false,
        members: true,
      },
      updatedAt: timestamp,
    }]);
    expect(fsDeleteField).not.toHaveBeenCalled();
  });

  it('類別切換可同時更新三欄且 eduSettings 的 null 轉為刪除', async () => {
    await saveTeamSettingsPatch(team, {
      type: 'none',
      teachingEnabled: false,
      eduSettings: null,
    });
    expectSuccess([ref, {
      type: 'none',
      teachingEnabled: false,
      eduSettings: { __deleteField: true },
      updatedAt: timestamp,
    }]);
    expect(fsDeleteField).toHaveBeenCalledTimes(1);
  });

  it('清除主題色寫入 null 而非刪除欄位', async () => {
    await saveTeamSettingsPatch(team, { themeColor: null });
    expectSuccess([ref, { themeColor: null, updatedAt: timestamp }]);
    expect(fsDeleteField).not.toHaveBeenCalled();
  });

  it.each(['none', 'competitive', 'education', 'leisure'] as const)(
    '允許單獨寫入類別 %s',
    async (type) => {
      await saveTeamSettingsPatch(team, { type });
      expectSuccess([ref, { type, updatedAt: timestamp }]);
    },
  );

  const invalidPatches: Array<{ name: string; patch: unknown }> = [
    { name: '白名單外欄位', patch: { members: 1 } },
    { name: '合法欄位夾帶未知欄位', patch: { type: 'none', captainUid: 'U-test-1' } },
    { name: '空物件', patch: {} },
    { name: '非法類別', patch: { type: 'unknown' } },
    { name: '短主題色', patch: { themeColor: '#abc' } },
    { name: '非法主題色字元', patch: { themeColor: '#gg0000' } },
    { name: '非字串主題色', patch: { themeColor: false } },
    { name: '非法可見性欄位', patch: { detailVisibility: { secret: true } } },
    { name: '非布林可見性', patch: { detailVisibility: { events: 'true' } } },
    { name: '可見性為陣列', patch: { detailVisibility: [] } },
    { name: '非布林教學開關', patch: { teachingEnabled: 1 } },
    { name: '非布林邀請開關', patch: { allowMemberInvite: 'true' } },
    { name: '非布林覆蓋開關', patch: { themeOverlayEnabled: null } },
    { name: '明確傳入未定義值', patch: { type: undefined } },
    { name: '教育設定為陣列', patch: { eduSettings: [] } },
    { name: '教育設定缺少必要欄位', patch: { eduSettings: {} } },
    {
      name: '教育設定教學旗標不是 true',
      patch: { eduSettings: { acceptingStudents: true, teachingEnabled: false } },
    },
    {
      name: '教育設定招生旗標不是布林',
      patch: { eduSettings: { acceptingStudents: 'true', teachingEnabled: true } },
    },
    { name: '空值', patch: null },
  ];

  it.each(invalidPatches)('拒絕 $name', async ({ patch }) => {
    await expectInvalid(() => saveTeamSettingsPatch(team, patch as TeamSettingsPatch));
  });
});

describe('儲存職務', () => {
  it('逐欄寫入八個職務欄位與文件時間', async () => {
    await saveTeamRoleUpdates(team, roles());
    expectSuccess([ref, {
      leaderUids: ['U-test-1'],
      leaders: ['測試領隊'],
      leaderNames: ['測試領隊'],
      leaderUid: 'U-test-1',
      leader: '測試領隊',
      coachUids: ['U-test-1'],
      coaches: ['測試教練'],
      coachNames: ['測試教練'],
      updatedAt: timestamp,
    }]);
  });

  it('保留空陣列、空名稱與 null 領隊 UID', async () => {
    const updates: MemberRoleUpdates = {
      leaderUids: [],
      leaders: [],
      leaderNames: [],
      leaderUid: null,
      leader: '',
      coachUids: [],
      coaches: [],
      coachNames: [],
    };
    await saveTeamRoleUpdates(team, updates);
    expectSuccess([ref, {
      leaderUids: [],
      leaders: [],
      leaderNames: [],
      leaderUid: null,
      leader: '',
      coachUids: [],
      coaches: [],
      coachNames: [],
      updatedAt: timestamp,
    }]);
  });

  it.each(['members', 'captainUid', 'captainName', 'updatedAt'])(
    '拒絕夾帶 %s 欄位',
    async (key) => {
      const updates = { ...roles(), [key]: 'U-test-1' };
      await expectInvalid(() => saveTeamRoleUpdates(team, updates));
    },
  );

  it.each([
    'leaderUids', 'leaders', 'leaderNames', 'coachUids', 'coaches', 'coachNames',
  ])('拒絕 %s 中的非字串元素', async (key) => {
    const updates = { ...roles(), [key]: ['U-test-1', 123] };
    await expectInvalid(() => saveTeamRoleUpdates(
      team,
      updates as unknown as MemberRoleUpdates,
    ));
  });

  it.each([
    { name: '非陣列領隊名單', field: 'leaders', value: '測試領隊' },
    { name: '非字串領隊 UID', field: 'leaderUid', value: 123 },
    { name: '非字串領隊名稱', field: 'leader', value: null },
  ])('拒絕 $name', async ({ field, value }) => {
    const updates = { ...roles(), [field]: value };
    await expectInvalid(() => saveTeamRoleUpdates(
      team,
      updates as unknown as MemberRoleUpdates,
    ));
  });

  it('拒絕缺少必要職務欄位', async () => {
    const updates: Partial<MemberRoleUpdates> = roles();
    delete updates.coachNames;
    await expectInvalid(() => saveTeamRoleUpdates(team, updates as MemberRoleUpdates));
  });
});

describe('交易變更職務', () => {
  // 測試同步更新：交易 mock 保留讀取、計算、提交失敗的獨立驗證點。
  const txGet = vi.fn();
  const txUpdate = vi.fn();
  let freshData: TeamDoc;
  let exists: boolean;

  beforeEach(() => {
    freshData = {
      id: 'business-team',
      captainUid: 'U-cap',
      leaderUids: [],
      leaders: [],
      leaderNames: [],
      // ASSUMPTION: 此共用 fixture 表示沒有領隊，並非驗證 null 輸入拋錯。
      leaderUid: undefined,
      leader: '',
      coachUids: ['U-other'],
      coaches: ['其他教練'],
      coachNames: ['其他教練'],
      members: 10,
    };
    exists = true;
    txGet.mockReset().mockImplementation(async () => ({
      id: 'tm_test_1',
      exists: () => exists,
      data: () => freshData,
    }));
    txUpdate.mockReset();
    vi.mocked(fsRunTransaction).mockReset().mockImplementation(
      async (_db, updateFunction) => updateFunction({
        get: txGet,
        update: txUpdate,
      } as unknown as Transaction),
    );
  });

  it('讀取最新資料、保留他人職務，逐欄寫入且不走 updateDoc', async () => {
    const stale: TeamDoc = { ...team, coachUids: [], coaches: [] };
    const guard = vi.fn((_fresh: TeamDoc) => true);
    const expected: MemberRoleUpdates = {
      leaderUids: [],
      leaders: [],
      leaderNames: [],
      leaderUid: null,
      leader: '',
      coachUids: ['U-other', 'U-new'],
      coaches: ['其他教練', '新教練'],
      coachNames: ['其他教練', '新教練'],
    };

    await expect(saveTeamRoleChange(
      stale, 'U-new', 'coach', '新教練', guard,
    )).resolves.toEqual(expected);

    expect(fsDoc).toHaveBeenCalledExactlyOnceWith(db, 'teams', 'tm_test_1');
    expect(fsRunTransaction).toHaveBeenCalledExactlyOnceWith(db, expect.any(Function));
    expect(txGet).toHaveBeenCalledExactlyOnceWith(ref);
    expect(guard).toHaveBeenCalledExactlyOnceWith({
      ...freshData,
      _docId: 'tm_test_1',
      id: 'business-team',
    });
    expect(txUpdate).toHaveBeenCalledExactlyOnceWith(ref, {
      ...expected,
      updatedAt: timestamp,
    });
    const payload: unknown = txUpdate.mock.calls[0]?.[1];
    expect(payload).not.toHaveProperty('members');
    expect(payload).not.toHaveProperty('captainUid');
    expect(payload).not.toHaveProperty('captainName');
    expect(fsUpdateDoc).not.toHaveBeenCalled();
    expect(invalidateTeams).toHaveBeenCalledTimes(1);
  });

  it('沒有業務 id 時以 snapshot id 建立 fresh', async () => {
    delete freshData.id;
    const guard = vi.fn((_fresh: TeamDoc) => true);
    await saveTeamRoleChange(team, 'U-new', 'coach', '新教練', guard);
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({
      id: 'tm_test_1',
      _docId: 'tm_test_1',
    }));
  });

  it('guard 拒絕時回 null，不寫入或清除快取', async () => {
    const guard = vi.fn((_fresh: TeamDoc) => false);
    await expect(saveTeamRoleChange(
      team, 'U-new', 'coach', '新教練', guard,
    )).resolves.toBeNull();
    expect(guard).toHaveBeenCalledTimes(1);
    expect(txUpdate).not.toHaveBeenCalled();
    expect(fsUpdateDoc).not.toHaveBeenCalled();
    expect(fsServerTimestamp).not.toHaveBeenCalled();
    expect(invalidateTeams).not.toHaveBeenCalled();
  });

  it('政策無法建立更新時回 null 且不寫入', async () => {
    // ASSUMPTION: buildMemberRoleUpdates 對空白 UID 回 null。
    await expect(saveTeamRoleChange(team, '', 'coach', '')).resolves.toBeNull();
    expect(txUpdate).not.toHaveBeenCalled();
    expect(invalidateTeams).not.toHaveBeenCalled();
  });

  it('文件不存在時拋錯且不呼叫 guard 或寫入', async () => {
    exists = false;
    const guard = vi.fn((_fresh: TeamDoc) => true);
    await expect(saveTeamRoleChange(
      team, 'U-new', 'coach', '新教練', guard,
    )).rejects.toThrow('[teams-write] team document not found');
    expect(guard).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();
    expect(invalidateTeams).not.toHaveBeenCalled();
  });

  it('tx.update 拋錯往外傳遞且不清除快取', async () => {
    const error = new Error('交易 update 失敗');
    txUpdate.mockImplementationOnce(() => { throw error; });
    await expect(saveTeamRoleChange(
      team, 'U-new', 'coach', '新教練',
    )).rejects.toBe(error);
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(invalidateTeams).not.toHaveBeenCalled();
  });

  it('交易讀取失敗往外傳遞且不寫入', async () => {
    const error = new Error('交易讀取失敗');
    txGet.mockRejectedValueOnce(error);
    await expect(saveTeamRoleChange(
      team, 'U-new', 'coach', '新教練',
    )).rejects.toBe(error);
    expect(txUpdate).not.toHaveBeenCalled();
    expect(invalidateTeams).not.toHaveBeenCalled();
  });

  it('提交失敗即使已排入 tx.update 仍不得清除快取', async () => {
    const error = new Error('交易提交失敗');
    vi.mocked(fsRunTransaction).mockImplementationOnce(async (_db, updateFunction) => {
      await updateFunction({ get: txGet, update: txUpdate } as unknown as Transaction);
      throw error;
    });
    await expect(saveTeamRoleChange(
      team, 'U-new', 'coach', '新教練',
    )).rejects.toBe(error);
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(fsUpdateDoc).not.toHaveBeenCalled();
    expect(invalidateTeams).not.toHaveBeenCalled();
  });

  it('交易重試重新讀取資料，保留重試前已提交的另一名教練', async () => {
    vi.mocked(fsRunTransaction).mockImplementationOnce(async (_db, updateFunction) => {
      const tx = { get: txGet, update: txUpdate } as unknown as Transaction;
      await updateFunction(tx);
      freshData = {
        ...freshData,
        coachUids: ['U-other', 'U-concurrent'],
        coaches: ['其他教練', '並行教練'],
        coachNames: ['其他教練', '並行教練'],
      };
      return updateFunction(tx);
    });
    const result = await saveTeamRoleChange(team, 'U-new', 'coach', '新教練');
    expect(result?.coachUids).toEqual(['U-other', 'U-concurrent', 'U-new']);
    expect(txGet).toHaveBeenCalledTimes(2);
    expect(txUpdate).toHaveBeenLastCalledWith(ref, expect.objectContaining({
      coachUids: ['U-other', 'U-concurrent', 'U-new'],
    }));
    expect(invalidateTeams).toHaveBeenCalledTimes(1);
  });
});

describe('儲存成員備註', () => {
  it.each([
    { kind: 'activity' as const, field: 'memberActivityData' },
    { kind: 'course' as const, field: 'memberCourseData' },
  // 測試同步更新：只提交兩個葉節點，不重建過期紀錄。
  ])('$kind 對應正確欄位，existingRecord 不影響 payload', async ({ kind, field }) => {
    const existing = {
      notes: '舊備註',
      updatedAt: '2026-10-22T00:00:00.000Z',
      count: 7,
      detail: { retained: true },
    };
    await saveTeamMemberNote(team, kind, ' U-test-1 ', note, existing);

    expectSuccess([
      ref,
      new FieldPath(field, 'U-test-1', 'notes'),
      '測試備註',
      new FieldPath(field, 'U-test-1', 'updatedAt'),
      iso,
      'updatedAt',
      timestamp,
    ]);
    const path: unknown = vi.mocked(fsUpdateDoc).mock.calls[0]?.[1];
    expect(path).toBeInstanceOf(FieldPath);
    expect(path).toHaveProperty('segments', [field, 'U-test-1', 'notes']);
    expect(existing).toEqual({
      notes: '舊備註',
      updatedAt: '2026-10-22T00:00:00.000Z',
      count: 7,
      detail: { retained: true },
    });
  });

  // 測試同步更新
  it.each([undefined, null])('既有紀錄為 %s 時仍只更新葉節點', async (existing) => {
    await saveTeamMemberNote(team, 'activity', 'U-test-1', note, existing);
    expectSuccess([
      ref,
      new FieldPath('memberActivityData', 'U-test-1', 'notes'),
      '測試備註',
      new FieldPath('memberActivityData', 'U-test-1', 'updatedAt'),
      iso,
      'updatedAt',
      timestamp,
    ]);
  });

  it.each(['', '字'.repeat(120)])('接受空備註或恰好 120 字的備註', async (notes) => {
    await saveTeamMemberNote(team, 'course', 'U-test-1', { notes, updatedAt: iso });
    expectSuccess([
      ref,
      // 測試同步更新
      new FieldPath('memberCourseData', 'U-test-1', 'notes'),
      notes,
      new FieldPath('memberCourseData', 'U-test-1', 'updatedAt'),
      iso,
      'updatedAt',
      timestamp,
    ]);
  });

  it.each(['', '   ', '.', '/', '~', '*', '[', ']'])(
    '拒絕空白或含禁止字元的成員 key：%s',
    async (memberKey) => {
      await expectInvalid(() => saveTeamMemberNote(team, 'activity', memberKey, note));
    },
  );

  it('拒絕超過 120 字的備註', async () => {
    await expectInvalid(() => saveTeamMemberNote(team, 'activity', 'U-test-1', {
      notes: '字'.repeat(121),
      updatedAt: iso,
    }));
  });

  it('拒絕非字串備註', async () => {
    const record = { notes: 123, updatedAt: iso } as unknown as typeof note;
    await expectInvalid(() => saveTeamMemberNote(team, 'activity', 'U-test-1', record));
  });

  it.each(['不是時間', '2026-02-30T00:00:00.000Z', '2026-10-23'])(
    '拒絕非 A 標準 ISO 時間：%s',
    async (updatedAt) => {
      await expectInvalid(() => saveTeamMemberNote(team, 'activity', 'U-test-1', {
        notes: '測試備註',
        updatedAt,
      }));
    },
  );

  it('拒絕未知備註種類', async () => {
    await expectInvalid(() => saveTeamMemberNote(
      team,
      'unknown' as TeamMemberNoteKind,
      'U-test-1',
      note,
    ));
  });

  // 測試同步更新：相容參數不再讀取，也不再驗證。
  it('忽略既有紀錄的執行期形狀', async () => {
    await saveTeamMemberNote(
      team,
      'activity',
      'U-test-1',
      note,
      [] as unknown as Record<string, unknown>,
    );
    expectSuccess([
      ref,
      new FieldPath('memberActivityData', 'U-test-1', 'notes'),
      note.notes,
      new FieldPath('memberActivityData', 'U-test-1', 'updatedAt'),
      iso,
      'updatedAt',
      timestamp,
    ]);
  });

  it('不同 memberKey 使用不同的兩個 FieldPath', async () => {
    await saveTeamMemberNote(team, 'activity', 'U-test-1', note);
    await saveTeamMemberNote(team, 'activity', 'U-test-2', note);
    expect(fsUpdateDoc).toHaveBeenNthCalledWith(
      1, ref,
      new FieldPath('memberActivityData', 'U-test-1', 'notes'), note.notes,
      new FieldPath('memberActivityData', 'U-test-1', 'updatedAt'), iso,
      'updatedAt', timestamp,
    );
    expect(fsUpdateDoc).toHaveBeenNthCalledWith(
      2, ref,
      new FieldPath('memberActivityData', 'U-test-2', 'notes'), note.notes,
      new FieldPath('memberActivityData', 'U-test-2', 'updatedAt'), iso,
      'updatedAt', timestamp,
    );
  });
});
