// PmDialogHost：角色由 App routeAccess 以 prop 傳入，本元件不讀 viewer；非管理員掛載時 Firestore 讀取 0、不下載排程執行器。
import { cleanup, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeSdk, resetFakeFirestore, totalReads } from '../admin/fake-firestore.test-helper';
import type { MessageViewer } from '../admin/data/admin-message-model';

const state = vi.hoisted(() => ({ runnerLoaded: 0, runnerViewer: null as unknown, useViewerCalls: 0 }));

const fakeModule = await vi.hoisted(async () => import('../admin/fake-firestore.test-helper'));
vi.mock('firebase/firestore', () => fakeModule.fakeSdk);
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: { __db: true } }) }));
vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: () => {
    state.useViewerCalls += 1;
    return null;
  },
}));
vi.mock('./pm-dialog-store', () => ({ usePmDialogTarget: () => null }));
vi.mock('./PmDialogOverlay', () => ({ default: () => null }));
vi.mock('../admin/ScheduledMessageRunner', () => {
  state.runnerLoaded += 1;
  return {
    default: ({ viewer }: { viewer: MessageViewer }) => {
      state.runnerViewer = viewer;
      return <div data-testid="runner" />;
    },
  };
});

import { PmDialogHost } from './PmDialogHost';

function viewer(role: string): MessageViewer {
  return { uid: 'U1', role, hasPermission: () => true };
}

beforeEach(() => {
  resetFakeFirestore();
  state.useViewerCalls = 0;
  state.runnerViewer = null;
});

afterEach(() => {
  cleanup();
});

describe('PmDialogHost', () => {
  it('非管理員（含沒有 viewer）：不渲染、不讀 viewer、Firestore 讀取 0、不下載排程執行器', async () => {
    for (const v of [viewer('user'), viewer('coach'), null]) {
      const { container } = render(<PmDialogHost viewer={v} />);
      expect(container.innerHTML).toBe('');
    }
    render(<PmDialogHost />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(totalReads()).toBe(0);
    expect(fakeSdk.getDocs).not.toHaveBeenCalled();
    expect(fakeSdk.runTransaction).not.toHaveBeenCalled();
    expect(state.useViewerCalls).toBe(0);
    expect(state.runnerLoaded).toBe(0);
  });

  it('admin：掛排程執行器並把 viewer 傳下去', async () => {
    const admin = viewer('admin');
    const { findByTestId } = render(<PmDialogHost viewer={admin} />);
    await findByTestId('runner');
    await waitFor(() => expect(state.runnerViewer).toBe(admin));
    expect(state.useViewerCalls).toBe(0);
  });
});
