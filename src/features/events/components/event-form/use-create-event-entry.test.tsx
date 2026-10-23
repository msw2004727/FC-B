import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { UserProfile } from '@/features/profile/data/profile-model';
import { useCreateEventEntry } from './use-create-event-entry';
import type { EventFormPreset } from '../EventFormModal';

const mocks = vi.hoisted(() => ({
  load: vi.fn<(uid: string) => Promise<UserProfile | null>>(),
  show: vi.fn(),
  allowed: true,
}));

vi.mock('@/ui/Toast', () => ({ toast: { show: mocks.show } }));
vi.mock('@/core/overlay-back', () => ({ pushOverlay: () => () => undefined }));
vi.mock('../../data/event-create', () => ({
  canCreateEvent: () => mocks.allowed,
}));
vi.mock('../../data/event-create-context', () => ({
  createEventContextFromViewer: (viewer: ViewerView) => viewer.uid ? {} : null,
}));
vi.mock('@/features/profile/data/profile-model', () => ({
  loadUserProfile: mocks.load,
}));
vi.mock('@/features/profile/ui/editors', () => ({
  needsFirstLogin: (profile: UserProfile) =>
    ['gender', 'birthday', 'region'].some(
      (field) => !String(profile[field] ?? '').trim(),
    ),
  FirstLoginEditor: ({ onSaved }: { onSaved(): void }) => (
    <button onClick={onSaved}>儲存個人資料</button>
  ),
}));

// ASSUMPTION: 附件未提供 ViewerView 完整欄位；測試只使用本卡讀取的欄位。
const viewer = { uid: 'u1', role: 'coach', displayName: '主辦人' } as ViewerView;
const complete: UserProfile = {
  uid: 'u1',
  name: '主辦人',
  _docId: 'u1',
  lastActive: null,
  gender: '男',
  birthday: '2000/01/01',
  region: '北部',
};

function Harness({ value = viewer }: { value?: ViewerView }) {
  const entry = useCreateEventEntry(value);
  return (
    <>
      <button
        class={entry.buttonProps.lockedClass}
        aria-disabled={entry.buttonProps['aria-disabled']}
        data-profile-incomplete={entry.buttonProps['data-profile-incomplete']}
        title={entry.buttonProps.title}
        onClick={entry.onClick}
      >
        我要開團
      </button>
      <output>{entry.formOpen ? '表單開啟' : '表單關閉'}</output>
      {entry.overlays}
    </>
  );
}

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.load.mockReset();
  mocks.load.mockResolvedValue(complete);
});

afterEach(() => {
  cleanup();
});

const customPreset: EventFormPreset = {
  teamIds: ['tm_test_1'],
  teamNames: ['測試俱樂部'],
  sportTag: 'badminton',
};

const secondCustomPreset: EventFormPreset = {
  teamIds: ['tm_test_2'],
  teamNames: ['另一俱樂部'],
  sportTag: 'football',
};

function PresetHarness({ value = viewer }: { value?: ViewerView }) {
  const entry = useCreateEventEntry(value);
  return (
    <>
      <button onClick={entry.onClick}>一般入口</button>
      <button onClick={() => entry.onClickCustom(customPreset)}>俱樂部入口</button>
      <button onClick={() => entry.onClickCustom(secondCustomPreset)}>另一俱樂部入口</button>
      <button onClick={entry.closeForm}>關閉表單</button>
      <output data-testid="preset-form-open">{String(entry.formOpen)}</output>
      <output data-testid="entry-preset">{JSON.stringify(entry.preset)}</output>
      {entry.overlays}
    </>
  );
}

describe('useCreateEventEntry preset', () => {
  it('一般入口仍先開類型選擇且 preset 為 null', async () => {
    render(<PresetHarness />);
    fireEvent.click(screen.getByText('一般入口'));
    await screen.findByText('選擇活動類型');
    expect(screen.getByTestId('preset-form-open').textContent).toBe('false');
    expect(screen.getByTestId('entry-preset').textContent).toBe('null');
    fireEvent.click(screen.getByText('自訂活動'));
    expect(screen.getByTestId('preset-form-open').textContent).toBe('true');
    expect(screen.getByTestId('entry-preset').textContent).toBe('null');
  });

  it('俱樂部入口直接開表單並保存 preset，不開類型選擇', async () => {
    render(<PresetHarness />);
    fireEvent.click(screen.getByText('俱樂部入口'));
    await waitFor(() => {
      expect(screen.getByTestId('preset-form-open').textContent).toBe('true');
    });
    expect(screen.getByTestId('entry-preset').textContent).toBe(JSON.stringify(customPreset));
    expect(screen.queryByText('選擇活動類型')).toBeNull();
  });

  it('俱樂部入口權限不足時不開表單、不保存 preset', () => {
    mocks.allowed = false;
    render(<PresetHarness />);
    fireEvent.click(screen.getByText('俱樂部入口'));
    expect(mocks.show).toHaveBeenCalledWith({
      message: '權限不足：需要建立活動權限',
    });
    expect(screen.getByTestId('preset-form-open').textContent).toBe('false');
    expect(screen.getByTestId('entry-preset').textContent).toBe('null');
    expect(screen.queryByText('選擇活動類型')).toBeNull();
  });

  it('俱樂部入口資料未完成時沿用首次登入資料卡', async () => {
    mocks.load.mockResolvedValue({ ...complete, region: '' });
    render(<PresetHarness />);
    fireEvent.click(screen.getByText('俱樂部入口'));
    await screen.findByText('儲存個人資料');
    expect(mocks.show).toHaveBeenCalledWith({
      message: '請先完成個人資料，再建立活動。',
    });
    expect(screen.getByTestId('preset-form-open').textContent).toBe('false');
    expect(screen.getByTestId('entry-preset').textContent).toBe('null');
    expect(screen.queryByText('選擇活動類型')).toBeNull();
  });

  it('關閉後清除 preset，再從一般入口開表單不殘留', async () => {
    render(<PresetHarness />);
    fireEvent.click(screen.getByText('俱樂部入口'));
    await waitFor(() => {
      expect(screen.getByTestId('preset-form-open').textContent).toBe('true');
    });
    fireEvent.click(screen.getByText('關閉表單'));
    expect(screen.getByTestId('preset-form-open').textContent).toBe('false');
    expect(screen.getByTestId('entry-preset').textContent).toBe('null');

    fireEvent.click(screen.getByText('一般入口'));
    await screen.findByText('選擇活動類型');
    expect(screen.getByTestId('entry-preset').textContent).toBe('null');
    fireEvent.click(screen.getByText('自訂活動'));
    expect(screen.getByTestId('preset-form-open').textContent).toBe('true');
    expect(screen.getByTestId('entry-preset').textContent).toBe('null');
  });

  it('俱樂部入口連點只處理第一個 preset，並與一般入口共用 clickBusy', async () => {
    let resolve!: (value: UserProfile | null) => void;
    mocks.load.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<PresetHarness />);
    fireEvent.click(screen.getByText('俱樂部入口'));
    fireEvent.click(screen.getByText('另一俱樂部入口'));
    fireEvent.click(screen.getByText('一般入口'));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));

    await act(async () => resolve(complete));
    await waitFor(() => {
      expect(screen.getByTestId('preset-form-open').textContent).toBe('true');
    });
    expect(screen.getByTestId('entry-preset').textContent).toBe(JSON.stringify(customPreset));
    expect(screen.queryByText('選擇活動類型')).toBeNull();
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it('讀 profile 期間失去權限不得開俱樂部表單', async () => {
    let resolve!: (value: UserProfile | null) => void;
    mocks.load.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<PresetHarness />);
    fireEvent.click(screen.getByText('俱樂部入口'));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
    mocks.allowed = false;
    await act(async () => resolve(complete));
    await waitFor(() => {
      expect(mocks.show).toHaveBeenCalledWith({
        message: '權限不足：需要建立活動權限',
      });
    });
    expect(screen.getByTestId('preset-form-open').textContent).toBe('false');
    expect(screen.getByTestId('entry-preset').textContent).toBe('null');
  });

  it('切換 UID 清除已開啟表單的 preset', async () => {
    const view = render(<PresetHarness />);
    fireEvent.click(screen.getByText('俱樂部入口'));
    await waitFor(() => {
      expect(screen.getByTestId('preset-form-open').textContent).toBe('true');
    });
    view.rerender(<PresetHarness value={{ ...viewer, uid: 'u2' }} />);
    expect(screen.getByTestId('preset-form-open').textContent).toBe('false');
    expect(screen.getByTestId('entry-preset').textContent).toBe('null');
  });

  it('切換 UID 後舊俱樂部請求不能套用 preset', async () => {
    let resolveOld!: (value: UserProfile | null) => void;
    mocks.load.mockImplementation((uid) => uid === 'u1'
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve({ ...complete, uid, _docId: uid }));
    const view = render(<PresetHarness />);
    fireEvent.click(screen.getByText('俱樂部入口'));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith('u1'));
    view.rerender(<PresetHarness value={{ ...viewer, uid: 'u2' }} />);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith('u2'));
    await act(async () => resolveOld(complete));
    expect(screen.getByTestId('preset-form-open').textContent).toBe('false');
    expect(screen.getByTestId('entry-preset').textContent).toBe('null');
    expect(screen.queryByText('選擇活動類型')).toBeNull();
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('卸載後俱樂部請求完成不開 overlay、不提示', async () => {
    let resolve!: (value: UserProfile | null) => void;
    mocks.load.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(<PresetHarness />);
    fireEvent.click(screen.getByText('俱樂部入口'));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => resolve(complete));
    expect(screen.queryByText('選擇活動類型')).toBeNull();
    expect(screen.queryByText('儲存個人資料')).toBeNull();
    expect(mocks.show).not.toHaveBeenCalled();
  });
});

describe('useCreateEventEntry', () => {
  it.each(['gender', 'birthday', 'region'])('%s 空白會鎖定並開資料卡', async (field) => {
    mocks.load.mockResolvedValue({ ...complete, [field]: '   ' });
    render(<Harness />);
    const button = screen.getByText('我要開團');
    await waitFor(() => {
      expect(button.getAttribute('aria-disabled')).toBe('true');
    });
    expect(button.className).toBe('activity-create-profile-locked');
    expect(button.getAttribute('data-profile-incomplete')).toBe('1');
    expect(button.getAttribute('title')).toBe('請先完成個人資料，再建立活動');
    fireEvent.click(button);
    await screen.findByText('儲存個人資料');
    expect(mocks.show).toHaveBeenCalledWith({
      message: '請先完成個人資料，再建立活動。',
    });
    expect(screen.queryByText('選擇活動類型')).toBeNull();
  });

  it('完整資料先開 sheet，選自訂活動才開表單', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('我要開團'));
    await screen.findByText('選擇活動類型');
    expect(screen.getByText('表單關閉')).toBeTruthy();
    fireEvent.click(screen.getByText('自訂活動'));
    expect(screen.getByText('表單開啟')).toBeTruthy();
    expect(screen.queryByText('選擇活動類型')).toBeNull();
  });

  it('讀取前不鎖；按下等待同一請求，再依結果守門', async () => {
    let resolve!: (value: UserProfile | null) => void;
    mocks.load.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<Harness />);
    const button = screen.getByText('我要開團');
    expect(button.getAttribute('aria-disabled')).toBe('false'); // 測試同步更新：照 A（M-070）未鎖定為 'false'
    fireEvent.click(button);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('選擇活動類型')).toBeNull();

    await act(async () => {
      resolve({ ...complete, region: '' });
    });
    await screen.findByText('儲存個人資料');
    expect(screen.queryByText('選擇活動類型')).toBeNull();
  });

  it('資料卡成功後重讀解鎖，不自動開表單', async () => {
    mocks.load.mockResolvedValueOnce({ ...complete, gender: '' });
    render(<Harness />);
    fireEvent.click(screen.getByText('我要開團'));
    fireEvent.click(await screen.findByText('儲存個人資料'));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByText('我要開團').getAttribute('aria-disabled')).toBe('false'); // 測試同步更新：照 A（M-070）
    });
    expect(screen.queryByText('選擇活動類型')).toBeNull();
    expect(screen.getByText('表單關閉')).toBeTruthy();
  });

  it('UID 快速切換時，舊請求不能打開新使用者的資料卡', async () => {
    let resolveOld!: (value: UserProfile | null) => void;
    mocks.load.mockImplementation((uid) => uid === 'u1'
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve({ ...complete, uid, _docId: uid }));
    const view = render(<Harness />);
    fireEvent.click(screen.getByText('我要開團'));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith('u1'));

    view.rerender(<Harness value={{ ...viewer, uid: 'u2' }} />);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith('u2'));
    await act(async () => resolveOld({ ...complete, gender: '' }));
    expect(screen.queryByText('儲存個人資料')).toBeNull();
    expect(mocks.show).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('我要開團'));
    await screen.findByText('選擇活動類型');
  });

  it('預讀失敗後按下會重試', async () => {
    mocks.load.mockRejectedValueOnce(new Error('offline'));
    render(<Harness />);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByText('我要開團'));
    await screen.findByText('選擇活動類型');
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  it('卸載後讀取完成不開資料卡、不提示', async () => {
    let resolve!: (value: UserProfile | null) => void;
    mocks.load.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(<Harness />);
    fireEvent.click(screen.getByText('我要開團'));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => resolve({ ...complete, region: '' }));
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('handler 使用同一權限 helper 拒絕無權限入口', () => {
    mocks.allowed = false;
    render(<Harness />);
    fireEvent.click(screen.getByText('我要開團'));
    expect(mocks.show).toHaveBeenCalledWith({
      message: '權限不足：需要建立活動權限',
    });
    expect(screen.queryByText('選擇活動類型')).toBeNull();
  });
});
