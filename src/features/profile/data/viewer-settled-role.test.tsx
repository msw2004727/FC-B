// 「users 文件已讀到、角色已確定」訊號（顧問 11-20：賽事閘門只等角色確定、不等球隊掃描）。
// 守住：users 文件讀到就有角色、不等球隊掃描；讀取失敗不發；換人、登出清掉；晚到的上一輪丟掉；
// 發出訊號時 useViewer 的快照不變、也不多一次重畫（其他頁面行為完全不變）；讀取次數不變。
import { act, cleanup, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emit } from '@/core/events';
import { getCurrentUser } from '@/data/auth';
import { getFirebase } from '@/data/firebase';
import { getDoc, getDocs } from 'firebase/firestore';
import { getSettledViewerRole, loadViewer, requestViewerRefresh, resetViewerCacheForTest, useSettledViewerRole, useViewer } from './viewer';

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

const U1 = { role: 'super_admin', displayName: '甲', teamIds: ['alpha'] };
const users: Record<string, { role: string; displayName: string; teamIds: string[] }> = {
  u1: U1,
  u2: { role: 'user', displayName: '乙', teamIds: [] },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** users 文件之後的讀取（角色權限、授權、球隊掃描）一律卡住，模擬冷開時球隊掃描很慢。 */
let holdRest: ReturnType<typeof deferred<void>> | null = null;
/** 下一次 users 文件讀取的控制。 */
let userGate: ReturnType<typeof deferred<void>> | null = null;
let userFail = false;
let viewerRenders = 0;

function Probe() {
  const viewer = useViewer();
  viewerRenders += 1;
  const settled = useSettledViewerRole(viewer.uid);
  return (
    <>
      <output data-testid="viewer">{`${viewer.uid ?? 'guest'}|${viewer.role}|${viewer.displayName ?? ''}`}</output>
      <output data-testid="settled">{settled ?? '-'}</output>
    </>
  );
}

const text = (id: string): string => screen.getByTestId(id).textContent ?? '';

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function userReads(): number {
  return vi.mocked(getDoc).mock.calls.filter(([ref]) => (ref as unknown as unknown[])[1] === 'users').length;
}

beforeEach(() => {
  resetViewerCacheForTest();
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  holdRest = deferred<void>();
  userGate = null;
  userFail = false;
  viewerRenders = 0;
  vi.mocked(getFirebase).mockResolvedValue({ db: {} } as Awaited<ReturnType<typeof getFirebase>>);
  vi.mocked(getCurrentUser).mockResolvedValue({ uid: 'u1' } as Awaited<ReturnType<typeof getCurrentUser>>);
  vi.mocked(getDocs).mockImplementation(async () => {
    await holdRest?.promise;
    return { docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>;
  });
  vi.mocked(getDoc).mockImplementation(async (reference) => {
    const parts = reference as unknown as unknown[];
    const name = String(parts[1]);
    const id = String(parts[2]);
    if (name === 'users') {
      const gate = userGate;
      userGate = null;
      if (gate) await gate.promise;
      if (userFail) throw new Error('offline');
      const data = users[id];
      return { exists: () => data !== undefined, data: () => data } as unknown as Awaited<ReturnType<typeof getDoc>>;
    }
    await holdRest?.promise;
    return { exists: () => false, data: () => undefined } as unknown as Awaited<ReturnType<typeof getDoc>>;
  });
});

afterEach(() => {
  holdRest?.resolve();
  cleanup();
  resetViewerCacheForTest();
});

describe('角色已確定訊號', () => {
  it('users 文件讀到就有角色，不等球隊掃描；這時 useViewer 仍是最小 viewer、沒有多重畫', async () => {
    render(<Probe />);
    await settle();
    expect(text('settled')).toBe('super_admin');
    expect(getSettledViewerRole('u1')).toBe('super_admin');
    expect(getSettledViewerRole('u2')).toBeNull();
    // 完整 viewer 還卡在球隊掃描：useViewer 看到的仍是最小 viewer。
    expect(text('viewer')).toBe('u1|user|');
    const rendersBeforeFull = viewerRenders;
    holdRest?.resolve();
    await settle();
    expect(text('viewer')).toBe('u1|super_admin|甲');
    expect(text('settled')).toBe('super_admin');
    expect(viewerRenders).toBeGreaterThan(rendersBeforeFull);
    expect(userReads()).toBe(1);
  });

  it('發出角色訊號不會讓 useViewer 訂閱者重畫（只用 useViewer 的元件重畫次數不變）', async () => {
    let plainRenders = 0;
    function Plain() {
      useViewer();
      plainRenders += 1;
      return null;
    }
    userGate = deferred<void>();
    const gate = userGate;
    render(<Plain />);
    await settle();
    const before = plainRenders;
    gate.resolve();
    await settle();
    expect(getSettledViewerRole('u1')).toBe('super_admin');
    expect(plainRenders).toBe(before);
  });

  it('users 文件讀取失敗：不發角色訊號', async () => {
    userFail = true;
    render(<Probe />);
    await settle();
    expect(text('settled')).toBe('-');
    expect(getSettledViewerRole('u1')).toBeNull();
  });

  it('文件不存在（新用戶）也算確定，角色是 user', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ uid: 'u_new' } as Awaited<ReturnType<typeof getCurrentUser>>);
    render(<Probe />);
    await settle();
    expect(getSettledViewerRole('u_new')).toBe('user');
  });

  it('換人：立刻清掉上一個人的角色，新的人 users 文件讀到才有', async () => {
    render(<Probe />);
    await settle();
    expect(getSettledViewerRole('u1')).toBe('super_admin');
    userGate = deferred<void>();
    const gate = userGate;
    await act(async () => {
      emit('auth:changed', { uid: 'u2' });
    });
    await settle();
    expect(getSettledViewerRole('u1')).toBeNull();
    expect(getSettledViewerRole('u2')).toBeNull();
    expect(text('settled')).toBe('-');
    gate.resolve();
    await settle();
    expect(getSettledViewerRole('u2')).toBe('user');
    expect(text('settled')).toBe('user');
  });

  it('登出：清掉角色', async () => {
    render(<Probe />);
    await settle();
    expect(getSettledViewerRole('u1')).toBe('super_admin');
    await act(async () => {
      emit('auth:changed', { uid: null });
    });
    await settle();
    expect(getSettledViewerRole('u1')).toBeNull();
    expect(text('settled')).toBe('-');
  });

  it('上一個人晚到的 users 文件不寫進角色', async () => {
    userGate = deferred<void>();
    const slowU1 = userGate;
    render(<Probe />);
    await settle();
    await act(async () => {
      emit('auth:changed', { uid: 'u2' });
    });
    await settle();
    expect(getSettledViewerRole('u2')).toBe('user');
    slowU1.resolve();
    await settle();
    expect(getSettledViewerRole('u1')).toBeNull();
    expect(getSettledViewerRole('u2')).toBe('user');
  });

  it('同一人重讀（viewer:refresh）：新的 users 結果覆蓋角色', async () => {
    render(<Probe />);
    await settle();
    holdRest?.resolve();
    await settle();
    U1.role = 'admin';
    try {
      await act(async () => {
        requestViewerRefresh();
      });
      await settle();
      expect(getSettledViewerRole('u1')).toBe('admin');
      expect(userReads()).toBe(2);
    } finally {
      U1.role = 'super_admin';
    }
  });

  it('沒有訂閱者時（離開所有頁面）清掉角色', async () => {
    const view = render(<Probe />);
    await settle();
    expect(getSettledViewerRole('u1')).toBe('super_admin');
    view.unmount();
    expect(getSettledViewerRole('u1')).toBeNull();
  });
});

describe('loadViewer 的 onRole', () => {
  it('onRole 拋錯也不讓完整 viewer 載入失敗（11-20 Opus 審 P3-1）', async () => {
    holdRest?.resolve();
    const viewer = await loadViewer('u1', undefined, () => {
      throw new Error('listener boom');
    });
    expect(viewer.role).toBe('super_admin');
    expect(viewer.displayName).toBe('甲');
  });
});
