import { useState } from 'preact/hooks';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamDoc } from '@/features/clubs/data/types';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { EventDoc } from '../../data/types';
import type { OperateContext } from '../../data/operate-permissions';
import {
  buildTeamOnlyContext,
  buildTeamOnlyModel,
  canCreateTeamOnlyForSubmit,
  useTeamOnlyPicker,
} from './use-team-only-picker';

const repository = vi.hoisted(() => ({
  loadTeams: vi.fn<() => Promise<TeamDoc[]>>(),
}));

vi.mock('@/features/clubs/data/teams-repo', () => ({
  loadTeams: repository.loadTeams,
}));

type Picker = ReturnType<typeof useTeamOnlyPicker>;
type PickerInput = Parameters<typeof useTeamOnlyPicker>[0];

interface HarnessProps {
  viewer?: PickerInput['viewer'];
  adminUsers?: PickerInput['adminUsers'];
  existing?: EventDoc | null;
  mode?: 'create' | 'edit';
  enabled?: boolean;
  initialIds?: string[];
}

let currentPicker: Picker | null = null;
let replaceSelection: ((ids: string[]) => void) | null = null;

function viewer(overrides: Partial<PickerInput['viewer']> = {}): PickerInput['viewer'] {
  // ASSUMPTION: ViewerContext 未完整附上；使用已提供的 ClubViewer 相容欄位。
  return {
    uid: 'u1',
    role: 'coach',
    teamIds: new Set<string>(),
    hasPermission: () => false,
    displayName: null,
    pictureUrl: null,
    capabilities: [],
    permissionSources: {
      rolePermissions: [],
      userGrants: [],
      customRoles: [],
    },
    ...overrides,
  } as ViewerView;
}

function administrator(): ViewerView {
  return viewer({
    role: 'admin',
    permissionSources: {
      rolePermissions: ['event.edit_all'],
      userGrants: [],
      customRoles: [],
    },
  });
}

const teams: TeamDoc[] = [
  { id: 'a', _docId: 'doc-a', name: '甲俱樂部', captainUid: 'u1' },
  { id: 'b', name: '乙俱樂部', coachUids: ['u1'] },
  { id: 'c', name: '丙俱樂部', captainUid: 'other' },
];

function Harness({
  viewer: suppliedViewer,
  adminUsers,
  existing = null,
  mode = 'create',
  enabled = true,
  initialIds = [],
}: HarnessProps) {
  const [defaultViewer] = useState(() => viewer());
  const currentViewer = suppliedViewer ?? defaultViewer;
  const [selectedIds, onChange] = useState(initialIds);
  replaceSelection = onChange;
  const picker = useTeamOnlyPicker({
    viewer: currentViewer,
    ...(adminUsers === undefined ? {} : { adminUsers }),
    existing,
    mode,
    enabled,
    selectedIds,
    onChange,
  });
  currentPicker = picker;
  return (
    <>
      {picker.picker}
      <output data-testid="selection">{JSON.stringify(selectedIds)}</output>
    </>
  );
}

function picker(): Picker {
  if (!currentPicker) throw new Error('測試元件尚未掛載');
  return currentPicker;
}

function setIds(ids: string[]): void {
  if (!replaceSelection) throw new Error('測試元件尚未掛載');
  act(() => replaceSelection?.(ids));
}

function choice(id: string): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>(
    `#ce-team-list input[data-team-id="${id}"]`,
  );
  if (!element) throw new Error(`找不到測試選項：${id}`);
  return element;
}

async function directorySettled(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelector('#ce-team-picker')?.getAttribute('aria-busy')).toBe('false');
  });
}

async function ready(): Promise<void> {
  // 編輯預設值在目錄載入前就會產生選項，不能只等任意 input 出現。
  await directorySettled();
  await waitFor(() => {
    expect(document.querySelector('#ce-team-list input')).not.toBeNull();
  });
}

async function validation(
  options?: Parameters<Picker['validateForSubmit']>[0],
): Promise<Awaited<ReturnType<Picker['validateForSubmit']>>> {
  let result: Awaited<ReturnType<Picker['validateForSubmit']>> | undefined;
  await act(async () => {
    result = await picker().validateForSubmit(options);
  });
  if (!result) throw new Error('送出驗證未回傳');
  return result;
}

function context(overrides: Partial<OperateContext> = {}): OperateContext {
  return {
    uid: 'u1',
    role: 'user',
    rolePermissions: [],
    userGrants: { uid: 'u1', enabled: true, permissions: [] },
    capabilities: [],
    customRoles: [],
    ...overrides,
  };
}

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  repository.loadTeams.mockReset();
  repository.loadTeams.mockResolvedValue(teams);
});

afterEach(() => {
  cleanup();
  currentPicker = null;
  replaceSelection = null;
  vi.restoreAllMocks();
});

describe('候選、名稱與權限純函式', () => {
  it('只認 UID、忽略 creator／owner，空 leaderUids 不回退 leaderUid', () => {
    const result = buildTeamOnlyModel({
      teams: [
        { id: 'captain', captainUid: 'u1' },
        { id: 'leader', leaderUids: ['u1'] },
        { id: 'legacy-leader', leaderUid: 'u1' },
        { id: 'coach', coachUids: ['u1'] },
        { id: 'empty-leaders', leaderUids: [], leaderUid: 'u1' },
        { id: 'creator', creatorUid: 'u1' },
        { id: 'owner', ownerUid: 'u1' },
        { id: 'display-name', captain: 'u1' },
        { id: 'inactive', captainUid: 'u1', active: false },
        { id: 'captain', captainUid: 'u1', name: '重複' },
        { _docId: 'document-only', captainUid: 'u1' },
      ],
      uid: 'u1',
      manageAll: false,
      existing: null,
      mode: 'create',
      presetIds: [],
      presetNames: [],
    });
    expect(result.candidates.map(team => team.id).sort()).toEqual([
      'captain', 'coach', 'document-only', 'leader', 'legacy-leader',
    ]);
  });

  it('總管包含他隊，仍排除停用俱樂部及重複 ID', () => {
    const result = buildTeamOnlyModel({
      teams: [...teams, { id: 'a' }, { id: 'off', active: false }],
      uid: 'u1',
      manageAll: true,
      existing: null,
      mode: 'create',
      presetIds: [],
      presetNames: [],
    });
    expect(result.options.map(team => team.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('名稱依提示、俱樂部資料、id 回退，保留不在候選中的既有範圍', () => {
    const result = buildTeamOnlyModel({
      teams,
      uid: 'u1',
      manageAll: false,
      existing: {
        teamOnly: true,
        creatorTeamIds: ['a', 'c', 'missing'],
        creatorTeamId: 'a',
      },
      mode: 'edit',
      presetIds: [' a ', 'c', 'missing', ''],
      presetNames: [' 舊名稱 ', '', '', '忽略'],
    });
    expect(result.preserveExistingScope).toBe(true);
    expect(result.options).toEqual([
      { id: 'a', name: '舊名稱' },
      { id: 'c', name: '丙俱樂部' },
      { id: 'missing', name: 'missing' },
    ]);
  });

  it('範圍比較忽略順序、重複與空白', () => {
    const result = buildTeamOnlyModel({
      teams,
      uid: 'u1',
      manageAll: false,
      existing: { teamOnly: true, creatorTeamIds: ['a', 'b', 'a', ''] },
      mode: 'edit',
      presetIds: [' b ', 'a', 'a'],
      presetNames: [],
    });
    expect(result.preserveExistingScope).toBe(true);
  });

  it('沒有 permissionSources 不以角色預設授權', () => {
    expect(buildTeamOnlyContext(viewer({
      role: 'admin',
      permissionSources: undefined,
    })).role).toBeNull();
  });

  it('保留 rolePermissions 的 null 與空陣列差別', () => {
    expect(buildTeamOnlyContext(viewer()).rolePermissions).toEqual([]);
    expect(buildTeamOnlyContext(viewer({
      permissionSources: {
        rolePermissions: null,
        userGrants: [],
        customRoles: [],
      },
    })).rolePermissions).toBeNull();
  });

  it('一般 user 直接授權路徑要求只有俱樂部 addon 與精確幹部範圍', () => {
    const direct = context({
      userGrants: {
        uid: 'u1',
        enabled: true,
        permissions: ['event.create', 'team.create_event'],
      },
    });
    const input = {
      context: direct,
      mode: 'create' as const,
      selectedIds: ['a'],
      teams,
      hasOnlyTeamScopedAddon: true,
    };
    expect(canCreateTeamOnlyForSubmit(input)).toBe(true);
    expect(canCreateTeamOnlyForSubmit({
      ...input,
      hasOnlyTeamScopedAddon: false,
    })).toBe(false);
    expect(canCreateTeamOnlyForSubmit({
      ...input,
      selectedIds: ['c'],
    })).toBe(false);
    expect(canCreateTeamOnlyForSubmit({
      ...input,
      selectedIds: ['a', 'b'],
    })).toBe(false);
  });

  it('一般 user 能力路徑仍要求 team.create_event 與幹部範圍', () => {
    const capable = context({
      capabilities: ['user.activity.basic_create', 'user.activity.addons_use'],
      userGrants: { uid: 'u1', enabled: true, permissions: ['team.create_event'] },
    });
    const input = {
      context: capable,
      mode: 'create' as const,
      selectedIds: ['a'],
      teams,
      hasOnlyTeamScopedAddon: false,
    };
    expect(canCreateTeamOnlyForSubmit(input)).toBe(true);
    expect(canCreateTeamOnlyForSubmit({
      ...input,
      context: { ...capable, userGrants: null },
    })).toBe(false);
    expect(canCreateTeamOnlyForSubmit({
      ...input,
      context: { ...capable, capabilities: ['user.activity.basic_create'] },
    })).toBe(false);
  });

  it('授權 UID 不符或停用均不生效', () => {
    for (const grant of [
      { uid: 'other', enabled: true, permissions: ['event.create', 'team.create_event'] },
      { uid: 'u1', enabled: false, permissions: ['event.create', 'team.create_event'] },
    ]) {
      expect(canCreateTeamOnlyForSubmit({
        context: context({ userGrants: grant }),
        mode: 'create',
        selectedIds: ['a'],
        teams,
        hasOnlyTeamScopedAddon: true,
      })).toBe(false);
    }
  });

  it('coach+、總管、訪客及編輯分支照 A', () => {
    const base = {
      mode: 'create' as const,
      selectedIds: ['a'],
      teams,
      hasOnlyTeamScopedAddon: false,
    };
    expect(canCreateTeamOnlyForSubmit({
      ...base,
      context: context({ role: 'coach' }),
    })).toBe(true);
    expect(canCreateTeamOnlyForSubmit({
      ...base,
      selectedIds: ['c'],
      context: context({ role: 'coach' }),
    })).toBe(false);
    expect(canCreateTeamOnlyForSubmit({
      ...base,
      selectedIds: ['a', 'c'],
      context: buildTeamOnlyContext(administrator()),
    })).toBe(true);
    expect(canCreateTeamOnlyForSubmit({
      ...base,
      context: context({ uid: null }),
    })).toBe(false);
    expect(canCreateTeamOnlyForSubmit({
      ...base,
      mode: 'edit',
      context: context({ uid: null }),
    })).toBe(true);
  });
});

describe('useTeamOnlyPicker', () => {
  it('總管多選並以 chip 取消選取', async () => {
    render(<Harness viewer={administrator()} />);
    await ready();
    expect(choice('a').type).toBe('checkbox');
    expect(choice('c').type).toBe('checkbox');

    fireEvent.change(choice('a'), { target: { checked: true } });
    fireEvent.change(choice('b'), { target: { checked: true } });
    expect(new Set(picker().resolveSelection().ids)).toEqual(new Set(['a', 'b']));

    fireEvent.click(screen.getByTitle('取消選擇 甲俱樂部'));
    expect(picker().resolveSelection().ids).toEqual(['b']);
    expect(await validation()).toEqual({ ok: true });
  });

  it('一般使用者只有幹部候選，單選且 reset 只保留第一支', async () => {
    render(<Harness />);
    await ready();
    expect(choice('a').type).toBe('radio');
    expect(document.querySelector('[data-team-id="c"]')).toBeNull();

    act(() => picker().reset(['a', 'b'], []));
    expect(picker().resolveSelection().ids).toEqual(['a']);

    fireEvent.change(choice('b'), { target: { checked: true } });
    expect(picker().resolveSelection().ids).toEqual(['b']);
    expect(await validation()).toEqual({ ok: true });
  });

  it('編輯非總管保留多隊範圍並鎖住搜尋、選項與 chips', async () => {
    render(
      <Harness
        mode="edit"
        existing={{ teamOnly: true, creatorTeamIds: ['a', 'c'] }}
        initialIds={['a', 'c']}
      />,
    );
    await ready();
    act(() => picker().reset(['a', 'c'], ['歷史甲', '歷史丙']));

    expect(picker().toggleDisabled).toBe(true);
    expect(choice('a').type).toBe('checkbox');
    expect(choice('a').disabled).toBe(true);
    const search = document.querySelector<HTMLInputElement>('#ce-team-search');
    expect(search?.disabled).toBe(true);

    const chips = screen.getAllByTitle('限定俱樂部不可變更');
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip.getAttribute('aria-disabled')).toBe('true');
      expect((chip as HTMLButtonElement).disabled).toBe(true);
    }

    fireEvent.change(choice('a'), { target: { checked: false } });
    expect(picker().resolveSelection()).toEqual({
      ids: ['a', 'c'],
      names: ['歷史甲', '歷史丙'],
    });
    expect(await validation()).toEqual({ ok: true });
  });

  it('總管編輯不鎖定，須等目錄載入才有非預設選項', async () => {
    let finish: ((value: TeamDoc[]) => void) | undefined;
    repository.loadTeams.mockImplementation(
      () => new Promise(resolve => { finish = resolve; }),
    );
    render(
      <Harness
        viewer={administrator()}
        mode="edit"
        existing={{ teamOnly: true, creatorTeamIds: ['a'] }}
        initialIds={['a']}
      />,
    );
    await waitFor(() => expect(repository.loadTeams).toHaveBeenCalledTimes(1));

    expect(choice('a')).toBeTruthy();
    expect(document.querySelector('#ce-team-picker')?.getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('#ce-team-list [data-team-id="c"]')).toBeNull();

    await act(async () => { finish?.(teams); });
    await ready();

    expect(picker().toggleDisabled).toBe(false);
    expect(choice('c').disabled).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#ce-team-search')?.disabled).toBe(false);
    fireEvent.change(choice('c'), { target: { checked: true } });
    expect(new Set(picker().resolveSelection().ids)).toEqual(new Set(['a', 'c']));
    expect(await validation()).toEqual({ ok: true });
  });

  it('單一候選自動選取，手動取消後不立即自動選回', async () => {
    repository.loadTeams.mockResolvedValue([teams[0]!]);
    render(<Harness />);
    await waitFor(() => expect(picker().resolveSelection().ids).toEqual(['a']));
    fireEvent.click(screen.getByTitle('取消選擇 甲俱樂部'));
    expect(picker().resolveSelection().ids).toEqual([]);
    expect(screen.getByText('尚未選擇俱樂部')).toBeTruthy();
  });

  it('關閉清除選取，重新開啟時恢復單一候選預選', async () => {
    repository.loadTeams.mockResolvedValue([teams[0]!]);
    const currentViewer = viewer();
    const view = render(<Harness viewer={currentViewer} enabled />);
    await waitFor(() => expect(picker().resolveSelection().ids).toEqual(['a']));

    view.rerender(<Harness viewer={currentViewer} enabled={false} />);
    expect(picker().picker).toBeNull();
    expect(screen.getByTestId('selection').textContent).toBe('[]');

    view.rerender(<Harness viewer={currentViewer} enabled />);
    await waitFor(() => expect(picker().resolveSelection().ids).toEqual(['a']));
  });

  it('搜尋與空結果文字照 A，名稱用 JSX 跳脫', async () => {
    repository.loadTeams.mockResolvedValue([
      { id: 'a', name: '<img src=x onerror=alert(1)>', captainUid: 'u1' },
      { id: 'b', name: '乙俱樂部', captainUid: 'u1' },
    ]);
    render(<Harness />);
    await ready();

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(document.querySelector('#ce-team-picker img')).toBeNull();
    const search = document.querySelector<HTMLInputElement>('#ce-team-search');
    if (!search) throw new Error('找不到搜尋框');
    expect(search.placeholder).toBe('搜尋俱樂部名稱');
    expect(search.getAttribute('data-i18n-placeholder')).toBe('搜尋俱樂部名稱');
    expect(document.querySelector('#ce-team-picker')?.className).toBe('ce-team-picker');
    expect(document.querySelector('#ce-team-chips')?.className).toBe('ce-team-chips');
    expect(document.querySelector('#ce-team-list')?.className).toBe('ce-team-list');
    fireEvent.input(search, { target: { value: '不存在' } });
    expect(screen.getByText('找不到符合的俱樂部')).toBeTruthy();
    fireEvent.input(search, { target: { value: '  IMG  ' } });
    expect(choice('a')).toBeTruthy();
    expect(document.querySelector('#ce-team-list [data-team-id="b"]')).toBeNull();
  });

  it('驗證一：沒有所屬俱樂部且空選', async () => {
    render(<Harness />);
    await ready();
    expect(await validation()).toEqual({
      ok: false,
      message: '請選擇限定俱樂部',
    });
  });

  it('驗證二：有所屬俱樂部、清單有選項，但未選任何項目', async () => {
    render(<Harness viewer={viewer({ teamId: 'a', teamName: '甲俱樂部' })} />);
    await ready();
    expect(await validation()).toEqual({
      ok: false,
      message: '請至少選擇 1 支俱樂部',
    });
  });

  it('驗證三：非總管編輯不得改範圍', async () => {
    render(
      <Harness
        mode="edit"
        existing={{ teamOnly: true, creatorTeamIds: ['a', 'b'] }}
        initialIds={['a', 'b']}
      />,
    );
    await ready();
    setIds(['a']);
    expect(await validation()).toEqual({
      ok: false,
      message: '非總管編輯活動時不能變更限定俱樂部',
    });
  });

  it('驗證四：非總管建立不得多選或選非幹部俱樂部', async () => {
    render(<Harness />);
    await ready();

    for (const ids of [['a', 'b'], ['c']]) {
      setIds(ids);
      expect(await validation()).toEqual({
        ok: false,
        message: '非總管建立俱樂部限定活動時，只能選擇 1 支由你管理的俱樂部',
      });
    }
  });

  it('驗證五：範圍有效但建立權限不足', async () => {
    render(<Harness viewer={viewer({ role: 'user' })} />);
    await ready();
    fireEvent.change(choice('a'), { target: { checked: true } });
    expect(await validation()).toEqual({
      ok: false,
      message: '權限不足：無法建立此俱樂部限定活動',
    });
  });

  it('一般 user 的能力加授權路徑可送出', async () => {
    render(
      <Harness
        viewer={viewer({
          role: 'user',
          capabilities: ['user.activity.basic_create', 'user.activity.addons_use'],
          permissionSources: {
            rolePermissions: [],
            userGrants: ['team.create_event'],
            customRoles: [],
          },
        })}
      />,
    );
    await ready();
    fireEvent.change(choice('a'), { target: { checked: true } });
    expect(await validation()).toEqual({ ok: true });
  });

  it('一般 user 直接授權須明確確認沒有其他 addon', async () => {
    render(
      <Harness
        viewer={viewer({
          role: 'user',
          permissionSources: {
            rolePermissions: [],
            userGrants: ['event.create', 'team.create_event'],
            customRoles: [],
          },
        })}
      />,
    );
    await ready();
    fireEvent.change(choice('a'), { target: { checked: true } });

    const denied = {
      ok: false,
      message: '權限不足：無法建立此俱樂部限定活動',
    };
    expect(await validation()).toEqual(denied);
    expect(await validation({})).toEqual(denied);
    expect(await validation({ otherAddonsEnabled: true })).toEqual(denied);
    expect(await validation({ otherAddonsEnabled: false })).toEqual({ ok: true });
  });

  it('開啟其他 addon 時仍可走一般 user 的能力授權路徑', async () => {
    render(
      <Harness
        viewer={viewer({
          role: 'user',
          capabilities: ['user.activity.basic_create', 'user.activity.addons_use'],
          permissionSources: {
            rolePermissions: [],
            userGrants: ['team.create_event'],
            customRoles: [],
          },
        })}
      />,
    );
    await ready();
    fireEvent.change(choice('a'), { target: { checked: true } });
    expect(await validation({ otherAddonsEnabled: true })).toEqual({ ok: true });
  });

  it('creator team 優先取 currentUser.teamId 與 teamName', async () => {
    repository.loadTeams.mockResolvedValue([]);
    render(
      <Harness
        viewer={viewer({
          teamId: 'primary',
          teamName: '主要俱樂部',
          teamIds: new Set(['membership']),
        })}
        adminUsers={[{ uid: 'u1', teamId: 'directory', teamName: '目錄俱樂部' }]}
      />,
    );
    await directorySettled();
    expect(picker().resolveSelection()).toEqual({
      ids: ['primary'],
      names: ['主要俱樂部'],
    });
    expect(picker().label).toBe('已啟用：僅限「主要俱樂部」');
  });

  it('currentUser 缺 teamId 時依 UID 查 adminUsers', async () => {
    repository.loadTeams.mockResolvedValue([]);
    render(
      <Harness
        adminUsers={[
          { uid: 'other', name: '其他使用者', teamId: 'other' },
          { uid: 'u1', teamId: 'directory', teamName: '目錄俱樂部' },
        ]}
      />,
    );
    await directorySettled();
    expect(picker().resolveSelection()).toEqual({
      ids: ['directory'],
      names: ['目錄俱樂部'],
    });
    expect(await validation()).toEqual({
      ok: false,
      message: '非總管建立俱樂部限定活動時，只能選擇 1 支由你管理的俱樂部',
    });
  });

  // 測試同步更新：A 會用名稱比對 adminUsers（違反 R-ID-002），B 只用 UID（刻意改良）。
  it('adminUsers 只用 UID 比對（不以名稱當身分）', async () => {
    repository.loadTeams.mockResolvedValue([]);
    render(
      <Harness
        viewer={viewer({ displayName: '顯示名稱', name: '備用名稱' })}
        adminUsers={[
          { uid: 'other-1', name: '備用名稱', teamId: 'wrong' },
          { uid: 'other-2', name: '顯示名稱', teamId: 'by-name', teamName: '名稱俱樂部' },
          { uid: 'u1', teamId: 'by-uid' },
        ]}
      />,
    );
    await directorySettled();
    expect(picker().resolveSelection()).toEqual({
      ids: ['by-uid'],
      names: ['by-uid'],
    });
  });

  it('只有名稱相符、UID 不符時不採用（R-ID-002）', async () => {
    repository.loadTeams.mockResolvedValue([]);
    render(
      <Harness
        viewer={viewer({ displayName: null, name: '備用名稱' })}
        adminUsers={[{ name: '備用名稱', teamId: 'by-name' }]}
      />,
    );
    await directorySettled();
    expect(picker().resolveSelection()).toEqual({ ids: [], names: [] });
  });

  it('teamIds 不作為 creator team 的替代來源', async () => {
    repository.loadTeams.mockResolvedValue([]);
    render(<Harness viewer={viewer({ teamIds: new Set(['a']) })} />);
    await directorySettled();
    expect(picker().resolveSelection()).toEqual({ ids: [], names: [] });
    expect(picker().label).toBe('已啟用：目前沒有可選俱樂部');
    expect(await validation()).toEqual({
      ok: false,
      message: '請選擇限定俱樂部',
    });
  });

  it('label 隨空選、單選、多選、搜尋、reset 與關閉更新', async () => {
    const currentViewer = administrator();
    const view = render(<Harness viewer={currentViewer} />);
    await ready();
    expect(picker().label).toBe('已啟用：請至少選擇 1 支俱樂部');

    fireEvent.change(choice('a'), { target: { checked: true } });
    expect(picker().label).toBe('已啟用：僅限「甲俱樂部」');

    fireEvent.change(choice('b'), { target: { checked: true } });
    expect(picker().label).toBe('已啟用：已選 2 支俱樂部');

    const search = document.querySelector<HTMLInputElement>('#ce-team-search');
    if (!search) throw new Error('找不到搜尋框');
    fireEvent.input(search, { target: { value: '不存在' } });
    expect(picker().label).toBe('已啟用：已選 2 支俱樂部');

    fireEvent.click(screen.getByTitle('取消選擇 甲俱樂部'));
    expect(picker().label).toBe('已啟用：僅限「乙俱樂部」');

    act(() => picker().reset(['a'], ['歷史甲']));
    expect(picker().label).toBe('已啟用：僅限「歷史甲」');

    view.rerender(<Harness viewer={currentViewer} enabled={false} />);
    expect(picker().label).toBe('');
  });

  it('沒有候選但保留既有多隊範圍時，label 仍顯示選取數量', async () => {
    repository.loadTeams.mockResolvedValue([]);
    render(
      <Harness
        mode="edit"
        existing={{ teamOnly: true, creatorTeamIds: ['a', 'c'] }}
        initialIds={['a', 'c']}
      />,
    );
    await ready();
    expect(picker().label).toBe('已啟用：已選 2 支俱樂部');
    expect(await validation()).toEqual({ ok: true });
  });

  it('單一候選自動選取與取消時同步更新 label', async () => {
    repository.loadTeams.mockResolvedValue([teams[0]!]);
    render(<Harness />);
    await ready();
    await waitFor(() => expect(picker().label).toBe('已啟用：僅限「甲俱樂部」'));
    fireEvent.click(screen.getByTitle('取消選擇 甲俱樂部'));
    expect(picker().label).toBe('已啟用：請至少選擇 1 支俱樂部');
  });

  it('載入持續失敗且無選取時沿用 A 選取分支文案', async () => {
    repository.loadTeams.mockRejectedValue(new Error('測試讀取失敗'));
    render(<Harness />);
    await directorySettled();
    expect(picker().label).toBe('已啟用：目前沒有可選俱樂部');
    expect(await validation()).toEqual({
      ok: false,
      message: '請選擇限定俱樂部',
    });
    expect(repository.loadTeams).toHaveBeenCalledTimes(2);
  });

  it('載入失敗時不因 creator team 回退而授予幹部範圍', async () => {
    repository.loadTeams.mockRejectedValue(new Error('測試讀取失敗'));
    render(<Harness viewer={viewer({ teamId: 'a', teamName: '甲俱樂部' })} />);
    await directorySettled();
    expect(await validation()).toEqual({
      ok: false,
      message: '非總管建立俱樂部限定活動時，只能選擇 1 支由你管理的俱樂部',
    });
  });

  it('載入失敗時仍允許保留非總管既有編輯範圍，禁止變更', async () => {
    repository.loadTeams.mockRejectedValue(new Error('測試讀取失敗'));
    render(
      <Harness
        mode="edit"
        existing={{ teamOnly: true, creatorTeamIds: ['a', 'b'] }}
        initialIds={['a', 'b']}
      />,
    );
    await directorySettled();
    expect(await validation()).toEqual({ ok: true });
    setIds(['a']);
    expect(await validation()).toEqual({
      ok: false,
      message: '非總管編輯活動時不能變更限定俱樂部',
    });
  });

  it('載入失敗時總管仍依 A 權限分支判斷，不一律拒絕送出', async () => {
    repository.loadTeams.mockRejectedValue(new Error('測試讀取失敗'));
    render(<Harness viewer={administrator()} initialIds={['c']} />);
    await directorySettled();
    expect(await validation()).toEqual({ ok: true });
  });

  it('enabled=false 不載入目錄、picker 為 null、驗證直接成功', async () => {
    render(<Harness enabled={false} />);
    expect(picker().picker).toBeNull();
    expect(await validation()).toEqual({ ok: true });
    expect(repository.loadTeams).not.toHaveBeenCalled();
  });

  it('載入失敗後送出會重新讀取，成功後保留選擇', async () => {
    repository.loadTeams
      .mockRejectedValueOnce(new Error('測試讀取失敗'))
      .mockResolvedValueOnce(teams);
    render(<Harness initialIds={['a']} />);
    await waitFor(() => expect(repository.loadTeams).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await validation()).toEqual({ ok: true });
    expect(repository.loadTeams).toHaveBeenCalledTimes(2);
    expect(picker().resolveSelection().ids).toEqual(['a']);
  });

  it('關閉再開啟後，舊請求較晚完成不得覆蓋新目錄', async () => {
    let finishOld: ((value: TeamDoc[]) => void) | undefined;
    let finishNew: ((value: TeamDoc[]) => void) | undefined;
    repository.loadTeams
      .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
    const currentViewer = viewer();
    const view = render(<Harness viewer={currentViewer} />);
    await waitFor(() => expect(repository.loadTeams).toHaveBeenCalledTimes(1));

    view.rerender(<Harness viewer={currentViewer} enabled={false} />);
    view.rerender(<Harness viewer={currentViewer} enabled />);
    await waitFor(() => expect(repository.loadTeams).toHaveBeenCalledTimes(2));

    await act(async () => {
      finishNew?.([{ id: 'new', name: '新目錄', captainUid: 'u1' }]);
    });
    await waitFor(() => expect(picker().resolveSelection().ids).toEqual(['new']));

    await act(async () => {
      finishOld?.([{ id: 'old', name: '過期目錄', captainUid: 'u1' }]);
    });
    expect(document.querySelector('[data-team-id="old"]')).toBeNull();
    expect(picker().resolveSelection().ids).toEqual(['new']);
  });

  it('卸載後完成目錄請求不呼叫 onChange', async () => {
    let finish: ((value: TeamDoc[]) => void) | undefined;
    repository.loadTeams.mockImplementation(
      () => new Promise(resolve => { finish = resolve; }),
    );
    const onChange = vi.fn();
    function UnmountHarness() {
      useTeamOnlyPicker({
        viewer: viewer(),
        existing: null,
        mode: 'create',
        enabled: true,
        selectedIds: [],
        onChange,
      });
      return null;
    }
    const view = render(<UnmountHarness />);
    await waitFor(() => expect(repository.loadTeams).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      finish?.([{ id: 'a', captainUid: 'u1' }]);
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
