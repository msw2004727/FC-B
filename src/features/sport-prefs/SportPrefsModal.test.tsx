import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';

const mocks = vi.hoisted(() => ({
  saveSportPrefs: vi.fn(),
  routeSpy: vi.fn(),
  toastShow: vi.fn(),
  loadSportRank: vi.fn(async () => [] as string[]),
  devicePushOn: vi.fn(() => false),
}));

vi.mock('./callables', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./callables')>();
  return {
    ...actual,
    saveSportPrefs: (...args: unknown[]) => mocks.saveSportPrefs(...args),
  };
});

vi.mock('./data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./data')>();
  return {
    ...actual,
    loadSportRank: mocks.loadSportRank,
    devicePushOn: mocks.devicePushOn,
  };
});

vi.mock('preact-iso', () => ({
  useLocation: () => ({ route: mocks.routeSpy }),
}));

vi.mock('@/ui/Toast', () => ({
  toast: { show: (...args: unknown[]) => mocks.toastShow(...args) },
}));

import { SportPrefsModal } from './SportPrefsModal';

function renderModal(overrides: { owned?: readonly string[] } = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const utils = render(
    <SportPrefsModal
      uid="u-test"
      owned={overrides.owned ?? []}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return { ...utils, onClose, onSaved };
}

function pickFirstTile(): void {
  const tiles = screen.getAllByRole('checkbox');
  const first = tiles[0];
  expect(first).toBeTruthy();
  fireEvent.click(first!);
}

describe('SportPrefsModal', () => {
  beforeEach(() => {
    mocks.saveSportPrefs.mockReset();
    mocks.routeSpy.mockReset();
    mocks.toastShow.mockReset();
    mocks.loadSportRank.mockReset();
    mocks.loadSportRank.mockResolvedValue([]);
    mocks.devicePushOn.mockReset();
    mocks.devicePushOn.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove('sport-prefs-open');
  });

  it('未勾時確認 disabled', async () => {
    renderModal();
    await screen.findAllByRole('checkbox');
    const confirm = screen.getByRole('button', { name: '確認' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it('勾 1 個後可按、saveSportPrefs 收到 { addSports: [...] }', async () => {
    mocks.saveSportPrefs.mockResolvedValue({ favSports: ['football'], newEventNotify: true });
    renderModal();
    await screen.findAllByRole('checkbox');
    pickFirstTile();
    const confirm = screen.getByRole('button', { name: '確認' });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.saveSportPrefs).toHaveBeenCalledTimes(1));
    const arg = mocks.saveSportPrefs.mock.calls[0]?.[0] as { addSports: string[] };
    expect(Array.isArray(arg.addSports)).toBe(true);
    expect(arg.addSports.length).toBe(1);
    expect(Object.keys(arg)).toEqual(['addSports']);
  });

  it('連按「更多」三次回到第一批、已選保留、全程無重複運動', async () => {
    renderModal();
    await screen.findAllByRole('checkbox');
    pickFirstTile();
    const more = screen.getByRole('button', { name: '更多' });
    const checkNoDup = (): void => {
      const ts = screen.getAllByRole('checkbox');
      const labels = ts.map((t) => t.textContent ?? '').filter((x) => x.length > 0);
      expect(new Set(labels).size).toBe(labels.length);
    };
    checkNoDup();
    fireEvent.click(more);
    checkNoDup();
    fireEvent.click(more);
    checkNoDup();
    fireEvent.click(more);
    checkNoDup();
    const confirm = screen.getByRole('button', { name: '確認' });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it('owned 的格子 aria-disabled=true 且點了不會變', async () => {
    renderModal({ owned: ['football'] });
    await screen.findAllByRole('checkbox');
    const tiles = screen.getAllByRole('checkbox');
    const football = tiles.find((t) => t.textContent?.includes('足球'));
    expect(football).toBeTruthy();
    expect(football!.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(football!);
    const confirm = screen.getByRole('button', { name: '確認' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it('儲存成功：出現 pushBtn，按下呼叫 route 與 onClose', async () => {
    mocks.saveSportPrefs.mockResolvedValue({ favSports: ['football'], newEventNotify: true });
    mocks.devicePushOn.mockReturnValue(false);
    const { onClose } = renderModal();
    await screen.findAllByRole('checkbox');
    pickFirstTile();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await screen.findByText('已儲存');
    const pushBtn = await screen.findByRole('button', { name: '開啟通知' });
    fireEvent.click(pushBtn);
    expect(mocks.routeSpy).toHaveBeenCalledWith('/profile?open=line');
    expect(onClose).toHaveBeenCalled();
  });

  it('devicePushOn=true 時沒有 pushBtn', async () => {
    mocks.saveSportPrefs.mockResolvedValue({ favSports: ['football'], newEventNotify: true });
    mocks.devicePushOn.mockReturnValue(true);
    renderModal();
    await screen.findAllByRole('checkbox');
    pickFirstTile();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await screen.findByText('已儲存');
    expect(screen.queryByRole('button', { name: '開啟通知' })).toBeNull();
  });

  it('儲存失敗：toast 被呼叫且留在選擇畫面', async () => {
    mocks.saveSportPrefs.mockRejectedValue(new Error('boom'));
    renderModal();
    await screen.findAllByRole('checkbox');
    pickFirstTile();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledTimes(1));
    const call = mocks.toastShow.mock.calls[0]?.[0] as { message: string; tone?: string };
    expect(call.tone).toBe('error');
    expect(call.message).toBe('儲存失敗，請稍後再試');
    // 仍在選擇畫面
    expect(screen.getByRole('button', { name: '確認' })).toBeTruthy();
  });

  it('resource-exhausted 用 limit 文字', async () => {
    mocks.saveSportPrefs.mockRejectedValue({ code: 'resource-exhausted' });
    renderModal();
    await screen.findAllByRole('checkbox');
    pickFirstTile();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledTimes(1));
    const call = mocks.toastShow.mock.calls[0]?.[0] as { message: string; tone?: string };
    expect(call.message).toBe('今天的操作次數已達上限，請明天再試');
    expect(call.tone).toBe('error');
  });

  it('卸載後 body 沒有 sport-prefs-open', async () => {
    const { unmount } = renderModal();
    await screen.findAllByRole('checkbox');
    expect(document.body.classList.contains('sport-prefs-open')).toBe(true);
    unmount();
    expect(document.body.classList.contains('sport-prefs-open')).toBe(false);
  });
});
