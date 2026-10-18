import { act, cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emit } from '@/core/events';
import { getCurrentUser } from '@/data/auth';
import { getFirebase } from '@/data/firebase';
import { getDoc, getDocs } from 'firebase/firestore';
import {
  createMinimalViewer,
  createViewerLoader,
  requestViewerRefresh,
  useViewer,
  type ViewerView,
} from './viewer';

vi.mock('@/data/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/data/firebase', () => ({ getFirebase: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...parts: unknown[]) => parts),
  doc: vi.fn((...parts: unknown[]) => parts),
  query: vi.fn((...parts: unknown[]) => parts),
  where: vi.fn((...parts: unknown[]) => parts),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function Probe() {
  const viewer = useViewer();
  return <output>{`${viewer.uid ?? 'guest'}:${viewer.displayName ?? ''}`}</output>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFirebase).mockResolvedValue({ db: {} } as Awaited<ReturnType<typeof getFirebase>>);
  vi.mocked(getCurrentUser).mockResolvedValue({ uid: 'u1' } as Awaited<ReturnType<typeof getCurrentUser>>);
  vi.mocked(getDocs).mockResolvedValue({ docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>);
  vi.mocked(getDoc).mockImplementation(async (reference) => {
    const parts = reference as unknown as unknown[];
    const isUser = parts[1] === 'users';
    return {
      exists: () => isUser,
      data: () => isUser ? { displayName: 'Original', role: 'user', teamIds: [] } : undefined,
    } as unknown as Awaited<ReturnType<typeof getDoc>>;
  });
});

afterEach(cleanup);

describe('viewer refresh', () => {
  it('reloads the current uid and unsubscribes on unmount', async () => {
    const view = render(<Probe />);
    await screen.findByText('u1:Original');
    vi.mocked(getDoc).mockImplementation(async (reference) => {
      const parts = reference as unknown as unknown[];
      const isUser = parts[1] === 'users';
      return {
        exists: () => isUser,
        data: () => isUser ? { displayName: 'Updated', role: 'user', teamIds: [] } : undefined,
      } as unknown as Awaited<ReturnType<typeof getDoc>>;
    });
    act(() => requestViewerRefresh());
    await screen.findByText('u1:Updated');
    view.unmount();
    const calls = vi.mocked(getDoc).mock.calls.length;
    act(() => requestViewerRefresh());
    expect(getDoc).toHaveBeenCalledTimes(calls);
  });

  it('uses the latest uid after an auth event', async () => {
    render(<Probe />);
    await screen.findByText('u1:Original');
    act(() => emit('auth:changed', { uid: 'u2' }));
    await screen.findByText('u2:Original');
    vi.mocked(getDoc).mockClear();
    act(() => requestViewerRefresh());
    await waitFor(() => expect(getDoc).toHaveBeenCalled());
    const userReads = vi.mocked(getDoc).mock.calls
      .map(([reference]) => reference as unknown as unknown[])
      .filter((parts) => parts[1] === 'users');
    expect(userReads.map((parts) => parts[2])).toEqual(['u2']);
  });

  it('discards an old initial auth read after logout', async () => {
    const auth = deferred<Awaited<ReturnType<typeof getCurrentUser>>>();
    vi.mocked(getCurrentUser).mockReturnValue(auth.promise);
    render(<Probe />);
    act(() => emit('auth:changed', { uid: null }));
    await act(async () => auth.resolve({ uid: 'u1' } as Awaited<ReturnType<typeof getCurrentUser>>));
    expect(screen.getByText('guest:')).toBeTruthy();
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('protects consecutive refresh requests with the loader sequence', async () => {
    const old = deferred<ViewerView>();
    const recent = deferred<ViewerView>();
    const load = vi.fn<(_: string) => Promise<ViewerView>>()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(recent.promise);
    const onChange = vi.fn();
    const loader = createViewerLoader(load, onChange);

    loader('u1');
    loader('u1');
    recent.resolve({ ...createMinimalViewer('u1'), displayName: 'New' });
    await recent.promise;
    await Promise.resolve();
    old.resolve({ ...createMinimalViewer('u1'), displayName: 'Old' });
    await old.promise;
    await Promise.resolve();

    expect(onChange.mock.calls.at(-1)?.[0].displayName).toBe('New');
    expect(onChange.mock.calls.some(([value]) => value.displayName === 'Old')).toBe(false);
  });
});
