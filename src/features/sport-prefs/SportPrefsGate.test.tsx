import { createElement } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/preact';

const dataMocks = vi.hoisted(() => ({
  isSeenLocal: vi.fn(),
  isSportPrefsEnabled: vi.fn(),
  markSeenLocal: vi.fn(),
}));
const callableMocks = vi.hoisted(() => ({
  saveSportPrefs: vi.fn(),
}));

vi.mock('./data', () => dataMocks);
vi.mock('./callables', () => callableMocks);
vi.mock('./SportPrefsModal', () => ({
  default: () => createElement('div', { 'data-testid': 'spf-modal' }),
}));

import { SportPrefsGate } from './SportPrefsGate';

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '';
  dataMocks.isSeenLocal.mockReturnValue(false);
  dataMocks.isSportPrefsEnabled.mockResolvedValue(true);
  dataMocks.markSeenLocal.mockReturnValue(undefined);
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

  it('通過顯示、markSeenLocal 被呼叫、saveSportPrefs 帶 promptSeen', async () => {
    render(<SportPrefsGate uid="u1" />);
    await waitFor(() => expect(screen.getByTestId('spf-modal')).toBeTruthy());
    expect(dataMocks.markSeenLocal).toHaveBeenCalledWith('u1');
    expect(callableMocks.saveSportPrefs).toHaveBeenCalledWith({ promptSeen: true });
  });

  it('saveSportPrefs reject 不丟未處理例外', async () => {
    callableMocks.saveSportPrefs.mockRejectedValue(new Error('boom'));
    render(<SportPrefsGate uid="u1" />);
    await waitFor(() => expect(screen.getByTestId('spf-modal')).toBeTruthy());
    await waitFor(() => expect(callableMocks.saveSportPrefs).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('spf-modal')).toBeTruthy();
  });
});
