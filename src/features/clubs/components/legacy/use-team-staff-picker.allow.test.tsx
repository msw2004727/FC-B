// @vitest-environment jsdom
// T-090：自建俱樂部只能從現有成員選領隊／教練（allowUids）。
// 修正前應失敗的理由：修正前 picker 沒有 allowUids，任何目錄使用者都會出現在建議並可被選取。
import { act, cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getUserDirectory,
  loadUserDirectory,
  searchUserDirectory,
  verifyUserDirectorySelection,
} from '@/features/events/data/user-directory';
import type { DirectoryUser } from '@/features/events/data/user-directory';
import { useScopedStaffPicker, useStaffDirectory } from './use-team-staff-picker';
import type { StaffPickerApi } from './use-team-staff-picker';

vi.mock('@/features/events/data/user-directory', () => ({
  getUserDirectory: vi.fn(),
  loadUserDirectory: vi.fn(),
  searchUserDirectory: vi.fn(),
  verifyUserDirectorySelection: vi.fn(),
}));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));

function user(uid: string): DirectoryUser {
  return { uid, name: `name-${uid}`, displayName: `name-${uid}`, pictureUrl: '', role: 'user' };
}

let api: StaffPickerApi;
function Harness(props: { allowUids: readonly string[] | null }) {
  const scope = useStaffDirectory(true, 'allow-test');
  api = useScopedStaffPicker({ enabled: true, excludeUids: [], allowUids: props.allowUids }, scope);
  return null;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getUserDirectory).mockReturnValue([user('member'), user('stranger')]);
  vi.mocked(loadUserDirectory).mockResolvedValue(true);
  vi.mocked(searchUserDirectory).mockImplementation((users, _query, excluded) =>
    users.filter(item => !excluded.includes(item.uid)).slice(0, 5));
  vi.mocked(verifyUserDirectorySelection).mockImplementation(async uids => ({
    ok: true, users: uids.map(uid => user(uid)), missingUids: [], reason: '',
  }));
});
afterEach(cleanup);

describe('useScopedStaffPicker allowUids（T-090）', () => {
  it('只建議允許名單內的使用者；名單外的 UID 選不到', async () => {
    render(<Harness allowUids={['member']} />);
    await flush();
    act(() => api.setQuery('name'));
    expect(api.suggestions.map(item => item.uid)).toEqual(['member']);
    let picked: Awaited<ReturnType<StaffPickerApi['pick']>> = null;
    await act(async () => {
      picked = await api.pick('stranger');
    });
    expect(picked).toBeNull();
    expect(verifyUserDirectorySelection).not.toHaveBeenCalled();
  });

  it('空名單（成員未載入）不給任何建議', async () => {
    render(<Harness allowUids={[]} />);
    await flush();
    act(() => api.setQuery('name'));
    expect(api.suggestions).toEqual([]);
  });

  it('未給名單（既有俱樂部）行為不變', async () => {
    render(<Harness allowUids={null} />);
    await flush();
    act(() => api.setQuery('name'));
    expect(api.suggestions.map(item => item.uid)).toEqual(['member', 'stranger']);
  });
});
