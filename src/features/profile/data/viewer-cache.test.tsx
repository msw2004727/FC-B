import { act, cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emit } from '@/core/events';
import { getCurrentUser } from '@/data/auth';
import { getFirebase } from '@/data/firebase';
import { getDoc, getDocs } from 'firebase/firestore';
import { requestViewerRefresh, resetViewerCacheForTest, useViewer } from './viewer';

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

const PERM = 'admin.repair.event_blocklist';

const userU1 = { role: 'super_admin', displayName: '甲', teamIds: ['alpha'] };
const userU2 = { role: 'user', displayName: '乙', teamIds: ['beta'] };
const users: Record<string, { role: string; displayName: string; teamIds: string[] }> = {
  u1: userU1,
  u2: userU2,
};

const FULL_U1 = 'u1|甲|super_admin|5|yes|alpha';
const FULL_U1_NEXT = 'u1|甲二|super_admin|5|yes|alpha';
const MIN_U1 = 'u1||user|0|no|';
const MIN_U2 = 'u2||user|0|no|';
const FULL_U2 = 'u2|乙|user|0|no|beta';
const GUEST = 'guest||guest|0|no|';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const holds = new Map<string, Array<ReturnType<typeof deferred<void>>>>();

function holdNext(uid: string): { release: () => void } {
  const gate = deferred<void>();
  const queue = holds.get(uid) ?? [];
  queue.push(gate);
  holds.set(uid, queue);
  return { release: () => gate.resolve() };
}

function Probe({ id }: { id: string }) {
  const viewer = useViewer();
  const teams = [...viewer.teamIds].sort().join(',');
  const perm = viewer.hasPermission(PERM) ? 'yes' : 'no';
  const text = `${viewer.uid ?? 'guest'}|${viewer.displayName ?? ''}|${viewer.role}|${viewer.roleLevel}|${perm}|${teams}`;
  return <output data-testid={id}>{text}</output>;
}

function Pair() {
  return (
    <>
      <Probe id="a" />
      <Probe id="b" />
    </>
  );
}

function textOf(id: string): string {
  return screen.getByTestId(id).textContent ?? '';
}

function userReadIds(): string[] {
  return vi.mocked(getDoc).mock.calls
    .map(([reference]) => reference as unknown as unknown[])
    .filter((parts) => parts[1] === 'users')
    .map((parts) => String(parts[2]));
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  resetViewerCacheForTest();
  holds.clear();
  userU1.displayName = '甲';
  userU2.displayName = '乙';
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {
    /* 預期中的載入失敗 */
  });
  vi.mocked(getFirebase).mockResolvedValue({ db: {} } as Awaited<ReturnType<typeof getFirebase>>);
  vi.mocked(getCurrentUser).mockResolvedValue({ uid: 'u1' } as Awaited<ReturnType<typeof getCurrentUser>>);
  vi.mocked(getDocs).mockResolvedValue({ docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>);
  vi.mocked(getDoc).mockImplementation(async (reference) => {
    const parts = reference as unknown as unknown[];
    const collectionName = String(parts[1]);
    const id = String(parts[2]);
    if (collectionName === 'users') {
      const gate = holds.get(id)?.shift();
      if (gate) await gate.promise;
      const data = users[id];
      return {
        exists: () => data !== undefined,
        data: () => data,
      } as unknown as Awaited<ReturnType<typeof getDoc>>;
    }
    return {
      exists: () => false,
      data: () => undefined,
    } as unknown as Awaited<ReturnType<typeof getDoc>>;
  });
});

afterEach(() => {
  cleanup();
  resetViewerCacheForTest();
  holds.clear();
  vi.restoreAllMocks();
});

describe('viewer 全站共用快取', () => {
  it('並行掛載同一 uid 合併成一次讀取', async () => {
    const gate = holdNext('u1');
    render(<Pair />);
    await waitFor(() => expect(userReadIds()).toEqual(['u1']));
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
    expect(textOf('a')).toBe(MIN_U1);
    expect(textOf('b')).toBe(MIN_U1);
    expect(vi.mocked(getDocs).mock.calls.length).toBe(0);

    gate.release();
    await waitFor(() => expect(textOf('a')).toBe(FULL_U1));
    expect(textOf('b')).toBe(FULL_U1);
    expect(userReadIds()).toEqual(['u1']);
    expect(vi.mocked(getDocs).mock.calls.length).toBe(4);
  });

  it('已有快取時後掛的訂閱者直接用快照，不再讀 Firestore', async () => {
    render(<Pair />);
    await waitFor(() => expect(textOf('a')).toBe(FULL_U1));
    const reads = userReadIds().length;
    const teamReads = vi.mocked(getDocs).mock.calls.length;

    render(<Probe id="c" />);
    expect(textOf('c')).toBe(FULL_U1);
    expect(textOf('b')).toBe(FULL_U1);
    expect(userReadIds()).toHaveLength(reads);
    expect(vi.mocked(getDocs).mock.calls.length).toBe(teamReads);
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('viewer:refresh 不論幾個訂閱者都只重讀一次', async () => {
    render(<Pair />);
    await waitFor(() => expect(textOf('a')).toBe(FULL_U1));
    render(<Probe id="c" />);
    expect(textOf('c')).toBe(FULL_U1);

    userU1.displayName = '甲二';
    const reads = userReadIds().length;
    act(() => requestViewerRefresh());
    await waitFor(() => expect(textOf('a')).toBe(FULL_U1_NEXT));
    expect(textOf('b')).toBe(FULL_U1_NEXT);
    expect(textOf('c')).toBe(FULL_U1_NEXT);
    expect(userReadIds()).toEqual([...Array(reads).fill('u1'), 'u1']);
    expect(userReadIds()).toHaveLength(reads + 1);
  });

  it('換帳號立刻清掉前一位的權限，過期的完整結果不得覆蓋', async () => {
    render(<Pair />);
    await waitFor(() => expect(textOf('a')).toBe(FULL_U1));
    expect(textOf('a')).toContain('|yes|');

    const staleU1 = holdNext('u1');
    const pendingU2 = holdNext('u2');
    act(() => requestViewerRefresh());
    await waitFor(() => expect(userReadIds()).toEqual(['u1', 'u1']));

    act(() => emit('auth:changed', { uid: 'u2' }));
    expect(textOf('a')).toBe(MIN_U2);
    expect(textOf('b')).toBe(MIN_U2);
    expect(textOf('a')).not.toContain('甲');
    expect(textOf('a')).not.toContain('alpha');
    expect(textOf('a')).not.toContain('super_admin');
    expect(textOf('a')).toContain('|no|');

    staleU1.release();
    await settle();
    expect(textOf('a')).toBe(MIN_U2);
    expect(textOf('b')).toBe(MIN_U2);
    expect(screen.queryByText(/甲/)).toBeNull();
    expect(screen.queryByText(/super_admin/)).toBeNull();

    pendingU2.release();
    await waitFor(() => expect(textOf('a')).toBe(FULL_U2));
    expect(textOf('b')).toBe(FULL_U2);
    expect(textOf('a')).toContain('|no|');
    expect(screen.queryByText(/alpha/)).toBeNull();
    const u2Reads = userReadIds().filter((id) => id === 'u2');
    expect(u2Reads).toEqual(['u2']);
  });

  it('登出立刻變成訪客，飛到一半的舊帳號結果不得把權限寫回來', async () => {
    render(<Pair />);
    await waitFor(() => expect(textOf('a')).toBe(FULL_U1));
    const stale = holdNext('u1');
    act(() => requestViewerRefresh());
    await waitFor(() => expect(userReadIds()).toEqual(['u1', 'u1']));

    act(() => emit('auth:changed', { uid: null }));
    expect(textOf('a')).toBe(GUEST);
    expect(textOf('b')).toBe(GUEST);

    stale.release();
    await settle();
    expect(textOf('a')).toBe(GUEST);
    expect(textOf('b')).toBe(GUEST);
    expect(screen.queryByText(/甲/)).toBeNull();

    act(() => requestViewerRefresh());
    await settle();
    expect(userReadIds()).toEqual(['u1', 'u1']);
    expect(textOf('a')).toBe(GUEST);
  });

  it('載入失敗會清掉 inflight，下一個訂閱者重試一次且成功後大家共用', async () => {
    let firebaseCalls = 0;
    vi.mocked(getFirebase).mockImplementation(async () => {
      firebaseCalls += 1;
      if (firebaseCalls === 1) throw new Error('network');
      return { db: {} } as Awaited<ReturnType<typeof getFirebase>>;
    });

    render(<Pair />);
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(firebaseCalls).toBe(1);
    expect(textOf('a')).toBe(MIN_U1);
    expect(textOf('b')).toBe(MIN_U1);
    expect(userReadIds()).toEqual([]);

    render(<Probe id="c" />);
    await waitFor(() => expect(textOf('c')).toBe(FULL_U1));
    expect(textOf('a')).toBe(FULL_U1);
    expect(textOf('b')).toBe(FULL_U1);
    expect(firebaseCalls).toBe(2);
    expect(userReadIds()).toEqual(['u1']);

    render(<Probe id="d" />);
    expect(textOf('d')).toBe(FULL_U1);
    expect(firebaseCalls).toBe(2);
    expect(userReadIds()).toEqual(['u1']);
  });

  it('同一 uid 重讀失敗保留上一份權限，再刷新會重新讀取', async () => {
    render(<Probe id="a" />);
    await waitFor(() => expect(textOf('a')).toBe(FULL_U1));

    vi.mocked(getFirebase).mockRejectedValueOnce(new Error('boom'));
    act(() => requestViewerRefresh());
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(textOf('a')).toBe(FULL_U1);

    userU1.displayName = '甲二';
    vi.mocked(getFirebase).mockResolvedValue({ db: {} } as Awaited<ReturnType<typeof getFirebase>>);
    act(() => requestViewerRefresh());
    await waitFor(() => expect(textOf('a')).toBe(FULL_U1_NEXT));
  });
});

// L-43：開頁時 uid 為 null 有兩種意思——「登入狀態還沒判定」與「確定是訪客」，頁面要能分辨（authPending）。
describe('viewer 登入狀態判定（authPending）', () => {
  function AuthProbe() {
    const viewer = useViewer();
    return <output data-testid="auth">{`${viewer.uid ?? 'guest'}|${viewer.authPending === true ? 'pending' : 'settled'}`}</output>;
  }

  it('getCurrentUser 還沒回來前是 pending；確定是訪客後才變 settled', async () => {
    const current = deferred<Awaited<ReturnType<typeof getCurrentUser>>>();
    vi.mocked(getCurrentUser).mockReturnValue(current.promise);
    render(<AuthProbe />);
    expect(textOf('auth')).toBe('guest|pending');
    await settle();
    expect(textOf('auth')).toBe('guest|pending');

    current.resolve(null);
    await waitFor(() => expect(textOf('auth')).toBe('guest|settled'));
  });

  it('currentUser 為 null 但 Auth 還在還原：等 authStateReady 之後才判定，還原出 uid 就直接是登入者、不經過訪客', async () => {
    const ready = deferred<void>();
    const auth: { currentUser: { uid: string } | null; authStateReady: () => Promise<void> } = {
      currentUser: null,
      authStateReady: () => ready.promise,
    };
    vi.mocked(getFirebase).mockResolvedValue({ db: {}, auth } as unknown as Awaited<ReturnType<typeof getFirebase>>);
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const seen: string[] = [];
    function Recorder() {
      const viewer = useViewer();
      seen.push(`${viewer.uid ?? 'guest'}|${viewer.authPending === true ? 'pending' : 'settled'}`);
      return null;
    }
    render(<><AuthProbe /><Recorder /></>);
    await settle();
    expect(textOf('auth')).toBe('guest|pending');

    auth.currentUser = { uid: 'u1' };
    await act(async () => {
      ready.resolve();
    });
    await waitFor(() => expect(textOf('auth')).toBe('u1|settled'));
    expect(seen).not.toContain('guest|settled');
  });

  it('還在 pending 時收到 auth:changed(null) 立刻判定為訪客；收到 uid 則直接是登入者', async () => {
    const current = deferred<Awaited<ReturnType<typeof getCurrentUser>>>();
    vi.mocked(getCurrentUser).mockReturnValue(current.promise);
    render(<AuthProbe />);
    expect(textOf('auth')).toBe('guest|pending');

    act(() => emit('auth:changed', { uid: null }));
    expect(textOf('auth')).toBe('guest|settled');

    act(() => emit('auth:changed', { uid: 'u2' }));
    expect(textOf('auth')).toBe('u2|settled');
    // 晚到的初始讀值不得蓋掉較新的 auth:changed。
    current.resolve(null);
    await settle();
    expect(textOf('auth')).toBe('u2|settled');
  });

  it('所有訂閱者卸載後還原成 pending，下次掛載重新判定', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const first = render(<AuthProbe />);
    await waitFor(() => expect(textOf('auth')).toBe('guest|settled'));
    first.unmount();

    const current = deferred<Awaited<ReturnType<typeof getCurrentUser>>>();
    vi.mocked(getCurrentUser).mockReturnValue(current.promise);
    render(<AuthProbe />);
    expect(textOf('auth')).toBe('guest|pending');
    current.resolve(null);
    await waitFor(() => expect(textOf('auth')).toBe('guest|settled'));
  });
});
