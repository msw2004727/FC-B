import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/preact';

import {
  closePmDialog,
  openPmDialog,
  subscribePmDialog,
  usePmDialogTarget,
} from './pm-dialog-store';

function Probe(): preact.JSX.Element {
  const target = usePmDialogTarget();
  return <div data-testid="uid">{target?.uid ?? 'none'}</div>;
}

afterEach(() => {
  cleanup();
  closePmDialog();
});

describe('pm-dialog-store', () => {
  it('開啟與關閉會通知訂閱者', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePmDialog(listener);

    openPmDialog({ uid: 'U1', name: 'Peer' });
    expect(listener).toHaveBeenLastCalledWith({ uid: 'U1', name: 'Peer' });

    closePmDialog();
    expect(listener).toHaveBeenLastCalledWith(null);

    unsubscribe();
  });

  it('usePmDialogTarget 會隨 store 更新', () => {
    render(<Probe />);
    expect(screen.getByTestId('uid').textContent).toBe('none');

    act(() => openPmDialog({ uid: 'U2' }));
    expect(screen.getByTestId('uid').textContent).toBe('U2');

    act(() => closePmDialog());
    expect(screen.getByTestId('uid').textContent).toBe('none');
  });
});
