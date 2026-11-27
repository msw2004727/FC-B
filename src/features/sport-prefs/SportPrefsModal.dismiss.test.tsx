import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';

const overlay = vi.hoisted(() => ({ back: null as null | (() => boolean) }));

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

vi.mock('@/core/overlay-back', () => ({
  pushOverlay: (fn: () => boolean) => {
    overlay.back = fn;
    return () => undefined;
  },
}));

import { SportPrefsModal } from './SportPrefsModal';

function renderModal(overrides: { owned?: readonly string[] } = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const onSeen = vi.fn();
  const utils = render(
    <SportPrefsModal
      uid="u-test"
      owned={overrides.owned ?? []}
      onClose={onClose}
      onSaved={onSaved}
      onSeen={onSeen}
    />,
  );
  return { ...utils, onClose, onSaved, onSeen };
}

function pickFirstTile(): void {
  const tiles = screen.getAllByRole('checkbox');
  const first = tiles[0];
  expect(first).toBeTruthy();
  fireEvent.click(first!);
}

describe('SportPrefsModal dismiss', () => {
  beforeEach(() => {
    mocks.saveSportPrefs.mockReset();
    mocks.routeSpy.mockReset();
    mocks.toastShow.mockReset();
    mocks.loadSportRank.mockReset();
    mocks.loadSportRank.mockResolvedValue([]);
    mocks.devicePushOn.mockReset();
    mocks.devicePushOn.mockReturnValue(false);
    overlay.back = null;
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove('sport-prefs-open');
  });

  it('按右上 X：onSeen(false) 並關閉', async () => {
    const { onClose, onSeen } = renderModal();
    await screen.findAllByRole('checkbox');
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(onSeen).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalled();
  });

  it('點背景關閉：不呼叫 onSeen', async () => {
    const { onClose, onSeen } = renderModal();
    await screen.findAllByRole('checkbox');
    const bg = document.querySelector('.modal-overlay');
    expect(bg).toBeTruthy();
    fireEvent.click(bg!);
    expect(onClose).toHaveBeenCalled();
    expect(onSeen).not.toHaveBeenCalled();
  });

  it('手機返回鍵關閉：不呼叫 onSeen', async () => {
    const { onClose, onSeen } = renderModal();
    await screen.findAllByRole('checkbox');
    expect(overlay.back).toBeTruthy();
    const handled = overlay.back!();
    expect(handled).toBe(true);
    expect(onClose).toHaveBeenCalled();
    expect(onSeen).not.toHaveBeenCalled();
  });

  it('0 個按確認：不呼叫 saveSportPrefs、不顯示已儲存，onSeen(false) 並關閉', async () => {
    const { onClose, onSeen } = renderModal();
    await screen.findAllByRole('checkbox');
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(mocks.saveSportPrefs).not.toHaveBeenCalled();
    expect(onSeen).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText('已儲存')).toBeNull();
  });

  it('選 1 個確認成功：onSeen(true) 並顯示已儲存', async () => {
    mocks.saveSportPrefs.mockResolvedValue({ favSports: ['football'], newEventNotify: true });
    const { onClose, onSeen } = renderModal();
    await screen.findAllByRole('checkbox');
    pickFirstTile();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await screen.findByText('已儲存');
    const arg = mocks.saveSportPrefs.mock.calls[0]?.[0] as { addSports: string[] };
    expect(Object.keys(arg)).toEqual(['addSports', 'promptSeen']);
    expect(onSeen).toHaveBeenCalledWith(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('存檔失敗：不呼叫 onSeen', async () => {
    mocks.saveSportPrefs.mockRejectedValue(new Error('boom'));
    const { onSeen } = renderModal();
    await screen.findAllByRole('checkbox');
    pickFirstTile();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await waitFor(() => expect(mocks.toastShow).toHaveBeenCalledTimes(1));
    expect(onSeen).not.toHaveBeenCalled();
  });

  it('已儲存畫面再按 X：onSeen 只呼叫一次', async () => {
    mocks.saveSportPrefs.mockResolvedValue({ favSports: ['football'], newEventNotify: true });
    const { onSeen } = renderModal();
    await screen.findAllByRole('checkbox');
    pickFirstTile();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await screen.findByText('已儲存');
    expect(onSeen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(onSeen).toHaveBeenCalledTimes(1);
  });

  it('存檔途中點背景關閉：存檔成功後仍算看過', async () => {
    let resolve!: (v: { favSports: string[]; newEventNotify: boolean }) => void;
    mocks.saveSportPrefs.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { onSeen, unmount } = renderModal();
    await screen.findAllByRole('checkbox');
    pickFirstTile();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    unmount();
    resolve({ favSports: ['football'], newEventNotify: true });
    await waitFor(() => expect(onSeen).toHaveBeenCalledWith(true));
  });
});
