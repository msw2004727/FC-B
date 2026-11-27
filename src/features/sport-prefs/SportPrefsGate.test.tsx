import { createElement } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';

const dataMocks = vi.hoisted(() => ({
  isSeenLocal: vi.fn(),
  isSportPrefsEnabled: vi.fn(),
  loadOwnedSports: vi.fn(),
  markSeenLocal: vi.fn(),
  SPORT_PREFS_OFF_KEY: 'fcb:spOff',
}));
const modalLoads = vi.hoisted(() => ({ n: 0 }));
const callableMocks = vi.hoisted(() => ({
  saveSportPrefs: vi.fn(),
}));

vi.mock('./data', () => dataMocks);
vi.mock('./callables', () => callableMocks);
vi.mock('./SportPrefsModal', () => {
  modalLoads.n += 1;
  const M = (props: { owned: readonly string[]; onClose: () => void; onSeen?: (saved: boolean) => void }) => createElement(
    'div',
    { 'data-testid': 'spf-modal', 'data-owned': props.owned.join(',') },
    createElement('button', { 'data-testid': 'm-x', onClick: () => { props.onSeen?.(false); props.onClose(); } }),
    createElement('button', { 'data-testid': 'm-bg', onClick: () => { props.onClose(); } }),
    createElement('button', { 'data-testid': 'm-saved', onClick: () => { props.onSeen?.(true); } }),
  );
  return { default: M, SportPrefsModal: M };
});

import { SportPrefsGate } from './SportPrefsGate';

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '';
  dataMocks.isSeenLocal.mockReturnValue(false);
  dataMocks.isSportPrefsEnabled.mockResolvedValue(true);
  dataMocks.markSeenLocal.mockReturnValue(undefined);
  dataMocks.loadOwnedSports.mockResolvedValue([]);
  callableMocks.saveSportPrefs.mockResolvedValue({ favSports: [], newEventNotify: false });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('SportPrefsGate', () => {
  it('已出現過不顯示、不呼叫 callable', async () => {
    dataMocks.isSeenLocal.mockReturnValue(true);
    render(<SportPrefsGate uid="u1" />);
    await waitFor(() => expect(dataMocks.isSeenLocal).toHaveBeenCalledWith('u1'));
    expect(screen.queryByTestId('spf-modal')).toBeNull();
    expect(dataMocks.isSportPrefsEnabled).not.toHaveBeenCalled();
    expect(dataMocks.markSeenLocal).not.toHaveBeenCalled();
    expect(callableMocks.saveSportPrefs).not.toHaveBeenCalled();
  });

  it('開關關不顯示', async () => {
    dataMocks.isSportPrefsEnabled.mockResolvedValue(false);
    render(<SportPrefsGate uid="u1" />);
    await waitFor(() => expect(dataMocks.isSportPrefsEnabled).toHaveBeenCalled());
    expect(screen.queryByTestId('spf-modal')).toBeNull();
    expect(dataMocks.markSeenLocal).not.toHaveBeenCalled();
  });

  it('開關關時記 sessionStorage、不下載彈窗本體（顧問 §3.809）', async () => {
    dataMocks.isSportPrefsEnabled.mockResolvedValue(false);
    render(<SportPrefsGate uid="u1" home />);
    await waitFor(() => expect(sessionStorage.getItem('fcb:spOff')).toBe('1'));
    expect(modalLoads.n).toBe(0);
  });

  it('開關開時清掉 sessionStorage 記號', async () => {
    sessionStorage.setItem('fcb:spOff', '1');
    render(<SportPrefsGate uid="u1" home />);
    await waitFor(() => expect(screen.getByTestId('spf-modal')).toBeTruthy());
    expect(sessionStorage.getItem('fcb:spOff')).toBeNull();
  });

  it('home 且路徑不是 / 不顯示且不 markSeenLocal', async () => {
    window.history.replaceState({}, '', '/activities');
    render(<SportPrefsGate uid="u1" home />);
    await waitFor(() => expect(dataMocks.isSportPrefsEnabled).toHaveBeenCalled());
    expect(screen.queryByTestId('spf-modal')).toBeNull();
    expect(dataMocks.markSeenLocal).not.toHaveBeenCalled();
    expect(callableMocks.saveSportPrefs).not.toHaveBeenCalled();
  });

  it('home 且已有 .modal.open 不顯示且不 markSeenLocal', async () => {
    const blocker = document.createElement('div');
    blocker.className = 'modal open';
    document.body.appendChild(blocker);
    render(<SportPrefsGate uid="u1" home />);
    await waitFor(() => expect(dataMocks.isSportPrefsEnabled).toHaveBeenCalled());
    expect(screen.queryByTestId('spf-modal')).toBeNull();
    expect(dataMocks.markSeenLocal).not.toHaveBeenCalled();
  });

  it('顯示當下不記本機記號、不送 promptSeen', async () => {
    render(<SportPrefsGate uid="u1" />);
    await waitFor(() => expect(screen.getByTestId('spf-modal')).toBeTruthy());
    expect(dataMocks.markSeenLocal).not.toHaveBeenCalled();
    expect(callableMocks.saveSportPrefs).not.toHaveBeenCalled();
  });

  it('按 X：記本機記號並送 promptSeen', async () => {
    render(<SportPrefsGate uid="u1" />);
    await waitFor(() => expect(screen.getByTestId('spf-modal')).toBeTruthy());
    fireEvent.click(screen.getByTestId('m-x'));
    expect(dataMocks.markSeenLocal).toHaveBeenCalledWith('u1');
    expect(callableMocks.saveSportPrefs).toHaveBeenCalledWith({ promptSeen: true });
    await waitFor(() => expect(screen.queryByTestId('spf-modal')).toBeNull());
  });

  it('點背景關閉不記，回首頁重新掛載會再跳', async () => {
    render(<SportPrefsGate uid="u1" home />);
    await waitFor(() => expect(screen.getByTestId('spf-modal')).toBeTruthy());
    fireEvent.click(screen.getByTestId('m-bg'));
    await waitFor(() => expect(screen.queryByTestId('spf-modal')).toBeNull());
    expect(dataMocks.markSeenLocal).not.toHaveBeenCalled();
    expect(callableMocks.saveSportPrefs).not.toHaveBeenCalled();
    cleanup();
    render(<SportPrefsGate uid="u1" home />);
    await waitFor(() => expect(screen.getByTestId('spf-modal')).toBeTruthy());
  });

  it('選 1 個以上存檔成功：只記本機記號，不另送 promptSeen', async () => {
    render(<SportPrefsGate uid="u1" />);
    await waitFor(() => expect(screen.getByTestId('spf-modal')).toBeTruthy());
    fireEvent.click(screen.getByTestId('m-saved'));
    expect(dataMocks.markSeenLocal).toHaveBeenCalledWith('u1');
    expect(callableMocks.saveSportPrefs).not.toHaveBeenCalled();
  });

  it('首頁沒帶 owned：讀本人已選並傳給彈窗', async () => {
    dataMocks.loadOwnedSports.mockResolvedValue(['football', 'tennis']);
    render(<SportPrefsGate uid="u1" home />);
    await waitFor(() => expect(screen.getByTestId('spf-modal')).toBeTruthy());
    expect(dataMocks.loadOwnedSports).toHaveBeenCalledWith('u1');
    expect(screen.getByTestId('spf-modal').getAttribute('data-owned')).toBe('football,tennis');
  });

  it('有帶 owned：不另讀、照傳入值', async () => {
    render(<SportPrefsGate uid="u1" owned={['badminton']} />);
    await waitFor(() => expect(screen.getByTestId('spf-modal')).toBeTruthy());
    expect(dataMocks.loadOwnedSports).not.toHaveBeenCalled();
    expect(screen.getByTestId('spf-modal').getAttribute('data-owned')).toBe('badminton');
  });

  it('開關關時不讀本人已選', async () => {
    dataMocks.isSportPrefsEnabled.mockResolvedValue(false);
    render(<SportPrefsGate uid="u1" home />);
    await waitFor(() => expect(dataMocks.isSportPrefsEnabled).toHaveBeenCalled());
    expect(dataMocks.loadOwnedSports).not.toHaveBeenCalled();
  });

  it('promptSeen 失敗不丟未處理例外、不重試', async () => {
    callableMocks.saveSportPrefs.mockRejectedValue(new Error('boom'));
    render(<SportPrefsGate uid="u1" />);
    await waitFor(() => expect(screen.getByTestId('spf-modal')).toBeTruthy());
    fireEvent.click(screen.getByTestId('m-x'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callableMocks.saveSportPrefs).toHaveBeenCalledTimes(1);
  });
});
