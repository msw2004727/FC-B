import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/preact';

const feature = vi.hoisted(() => ({ enabled: true }));
const stateUpdates = vi.hoisted(() => vi.fn());
vi.mock('preact/hooks', async (original) => {
  const hooks = await original<typeof import('preact/hooks')>();
  return {
    ...hooks,
    useState: <T,>(initialState: T | (() => T)) => {
      const [value, setValue] = hooks.useState(initialState);
      const trackedSetter = hooks.useCallback((next: Parameters<typeof setValue>[0]) => {
        stateUpdates(next);
        setValue(next);
      }, [setValue]);
      return [value, trackedSetter] as const;
    },
  };
});
vi.mock('../data/noshow-roster', async (original) => ({
  ...(await original<typeof import('../data/noshow-roster')>()),
  get NO_SHOW_FEATURE_ENABLED() { return feature.enabled; },
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  documentId: vi.fn(() => 'documentId'),
  where: vi.fn((field: string, op: string, value: string[]) => ({ field, op, value })),
  query: vi.fn((...parts: unknown[]) => ({ parts })),
  getDocs: vi.fn(),
}));
vi.mock('@/data/firebase', () => ({ getFirebase: vi.fn(async () => ({ db: {} })) }));

import { getDocs } from 'firebase/firestore';
import { _resetUserRolesCacheForTest, getCachedUserNoShowStats, useUserRoles } from '@/data/user-roles';
import { buildConfirmedRoster, type ConfirmedRosterPerson } from '../data/attendance-roster-model';
import { useRosterNoShow } from './useRosterNoShow';

const getDocsMock = vi.mocked(getDocs);
function request(q: unknown): { path: string; uids: string[] } {
  const { parts } = q as { parts: [{ path: string }, { value: string[] }] };
  return { path: parts[0].path, uids: parts[1].value };
}
function callsTo(collection: string): string[][] {
  return getDocsMock.mock.calls.map(([q]) => request(q))
    .filter(q => q.path === collection).map(q => q.uids);
}
function snapshot(uids: string[], corrections = false) {
  return { docs: uids.map(id => ({ id, data: () => corrections
    ? { noShow: { adjustment: -1 } }
    : { role: 'user', noShowCount: 2, endedRegCount: 3, lastEventWasNoShow: true },
  })) };
}
function people(uids: string[]): ConfirmedRosterPerson[] {
  return buildConfirmedRoster({}, uids.map(userId => ({
    _docId: userId, userId, userName: userId, participantType: 'self', status: 'confirmed',
  }))).people;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
interface Options {
  viewerUid: string | null;
  eventDocId: string;
  people: ConfirmedRosterPerson[];
  roleUids: string[];
  canViewNoShow: boolean;
  enabled: boolean;
}
const base: Options = {
  viewerUid: 'viewer1', eventDocId: 'event-doc-1', people: people(['u1']),
  roleUids: ['u1'], canViewNoShow: true, enabled: true,
};
function mount(options: Partial<Options> = {}) {
  return renderHook((opts: Options) => {
    const noShowEnabled = Boolean(opts.enabled && opts.canViewNoShow && feature.enabled
      && opts.viewerUid && opts.eventDocId);
    const roles = useUserRoles(opts.viewerUid ? opts.roleUids : [], noShowEnabled);
    const data = useRosterNoShow({ ...opts, roles });
    return { data, roles };
  }, { initialProps: { ...base, ...options } });
}

beforeEach(() => {
  _resetUserRolesCacheForTest();
  feature.enabled = true;
  stateUpdates.mockClear();
  getDocsMock.mockReset();
  getDocsMock.mockImplementation(async q => {
    const { path, uids } = request(q);
    return snapshot(uids, path === 'userCorrections') as never;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('T-073b 共用快取與補正載入', () => {
  it.each([[0, 0], [1, 1], [30, 1], [31, 2], [61, 3]])(
    '%i 位適用 UID：既有 users %i 批；補正同批數，沒有新增 users 查詢', async (n, batches) => {
      const uids = Array.from({ length: n }, (_, i) => 'u' + i);
      const view = mount({ people: people(uids), roleUids: uids });
      await waitFor(() => expect(view.result.current.data).not.toBeNull());
      expect(callsTo('users')).toHaveLength(batches);
      expect(callsTo('userCorrections')).toHaveLength(batches);
      expect(callsTo('userCorrections').flat().sort()).toEqual(uids.slice().sort());
      expect(callsTo('userCorrections').every(batch => batch.length <= 30)).toBe(true);
    },
  );

  it('只讀適用者補正，不讀主辦／候補／僅代報／同行者／空 UID，重繪及換順序不重讀', async () => {
    const member = people(['u1'])[0]!;
    const rows = [member, member,
      { ...member, uid: 'proxy', proxyOnly: true },
      { ...member, uid: 'companion', isCompanion: true },
      { ...member, uid: 'placeholder', isTeamPlaceholder: true },
      { ...member, uid: 'header', isTeamHeader: true },
      { ...member, uid: 'separator', isTeamGeneralSeparator: true },
      { ...member, uid: '' },
    ];
    const opts = { ...base, people: rows, roleUids: ['host', 'waiting', 'proxy', 'u1'] };
    const view = mount(opts);
    await waitFor(() => expect(view.result.current.data?.counts.get('u1')).toBe(1));
    expect(callsTo('users')).toHaveLength(1);
    expect(callsTo('userCorrections')).toEqual([['u1']]);
    view.rerender({ ...opts, people: rows.slice().reverse(), roleUids: opts.roleUids.slice().reverse() });
    await act(async () => {});
    expect(callsTo('users')).toHaveLength(1);
    expect(callsTo('userCorrections')).toHaveLength(1);
  });

  it.each([
    { canViewNoShow: false }, { enabled: false }, { viewerUid: null },
  ])('未授權、未展開／未就緒或未登入都不讀補正：%j', async opts => {
    const view = mount(opts);
    await act(async () => {});
    expect(view.result.current.data).toBeNull();
    expect(callsTo('userCorrections')).toHaveLength(0);
  });

  it('旗標關閉不讀補正', async () => {
    feature.enabled = false;
    const view = mount();
    await waitFor(() => expect(view.result.current.roles.u1).toBe('user'));
    expect(view.result.current.data).toBeNull();
    expect(callsTo('userCorrections')).toHaveLength(0);
  });

  it('登入 UID 延後出現才載入', async () => {
    const view = mount({ viewerUid: null });
    await act(async () => {});
    expect(getDocsMock).not.toHaveBeenCalled();
    view.rerender(base);
    await waitFor(() => expect(view.result.current.data?.counts.get('u1')).toBe(1));
    expect(callsTo('users')).toHaveLength(1);
    expect(callsTo('userCorrections')).toHaveLength(1);
  });

  it('users 失敗不假造零統計、不另讀 users 補洞，也不讀補正', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getDocsMock.mockRejectedValue(new Error('users failed'));
    const view = mount();
    await waitFor(() => expect(view.result.current.roles.u1).toBe('user'));
    expect(view.result.current.data).toBeNull();
    view.rerender({ ...base });
    await act(async () => {});
    expect(callsTo('users')).toHaveLength(1);
    expect(callsTo('userCorrections')).toHaveLength(0);
  });

  it.each([
    { elapsed: 299_999, batches: 1, count: 1, ended: 3, recent: true },
    { elapsed: 300_000, batches: 2, count: 4, ended: 8, recent: false },
    { elapsed: 300_001, batches: 2, count: 4, ended: 8, recent: false },
  ])('角色預載後 $elapsed ms 才展開，相同 UID 集合依 TTL 恢復統計', async ({ elapsed, batches, count, ended, recent }) => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    // 與頁面一致：關閉名單時已載入主辦、候補與參加者的角色。
    const opts = { ...base, roleUids: ['host', 'waiting', 'u1'] };
    const view = mount({ ...opts, enabled: false });
    await waitFor(() => expect(view.result.current.roles.u1).toBe('user'));
    expect(callsTo('users')).toEqual([opts.roleUids]);
    expect(callsTo('userCorrections')).toHaveLength(0);
    expect(view.result.current.data).toBeNull();

    const refresh = deferred<ReturnType<typeof snapshot>>();
    getDocsMock.mockImplementation(async q => {
      const req = request(q);
      return (req.path === 'users' ? await refresh.promise : snapshot(req.uids, true)) as never;
    });
    now.mockReturnValue(1_000 + elapsed);
    expect(getCachedUserNoShowStats('u1') === undefined).toBe(batches === 2);
    view.rerender(opts);
    if (batches === 2) {
      await waitFor(() => expect(callsTo('users')).toHaveLength(2));
      expect(view.result.current.data).toBeNull();
      expect(callsTo('userCorrections')).toHaveLength(0);
      await act(async () => { refresh.resolve({ docs: opts.roleUids.map(id => ({
        id, data: () => ({ role: 'coach', noShowCount: 5, endedRegCount: 8, lastEventWasNoShow: false }),
      })) }); });
    }
    await waitFor(() => expect(view.result.current.data?.counts.get('u1')).toBe(count));
    expect(view.result.current.data?.endedCounts.get('u1')).toBe(ended);
    expect(view.result.current.data?.recentUids.has('u1')).toBe(recent);
    expect(view.result.current.roles.u1).toBe(batches === 2 ? 'coach' : 'user');
    expect(callsTo('users')).toEqual(Array.from({ length: batches }, () => opts.roleUids));
    expect(callsTo('userCorrections')).toEqual([['u1']]);

    view.rerender({ ...opts, roleUids: [...opts.roleUids].reverse(), people: [...opts.people] });
    await act(async () => {});
    expect(callsTo('users')).toHaveLength(batches);
    expect(callsTo('userCorrections')).toHaveLength(1);
  });

  it('跨 TTL 展開時角色重載失敗仍為 null，不讀補正、不因重繪重試；再次展開可恢復', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const view = mount({ enabled: false });
    await waitFor(() => expect(view.result.current.roles.u1).toBe('user'));
    const previousRoles = view.result.current.roles;
    now.mockReturnValue(301_001);
    getDocsMock.mockRejectedValue(new Error('refresh failed'));
    view.rerender(base);
    await waitFor(() => expect(view.result.current.roles).not.toBe(previousRoles));
    expect(getCachedUserNoShowStats('u1')).toBeUndefined();
    expect(view.result.current.data).toBeNull();
    expect(callsTo('users')).toHaveLength(2);
    expect(callsTo('userCorrections')).toHaveLength(0);
    view.rerender({ ...base });
    await act(async () => {});
    expect(callsTo('users')).toHaveLength(2);

    const failedRoles = view.result.current.roles;
    view.rerender({ ...base, enabled: false });
    // 關閉也會重驗過期角色；空的 act 不保證非同步請求已結束。
    // 等失敗快照發布、inflight 清除後再模擬恢復，避免重開沿用失敗中的請求。
    await waitFor(() => expect(view.result.current.roles).not.toBe(failedRoles));
    expect(view.result.current.data).toBeNull();
    expect(getCachedUserNoShowStats('u1')).toBeUndefined();
    expect(callsTo('users')).toHaveLength(3);
    expect(callsTo('userCorrections')).toHaveLength(0);
    getDocsMock.mockImplementation(async q => {
      const req = request(q);
      return snapshot(req.uids, req.path === 'userCorrections') as never;
    });
    view.rerender(base);
    await waitFor(() => expect(view.result.current.data?.counts.get('u1')).toBe(1));
    expect(callsTo('users')).toHaveLength(4);
    expect(callsTo('userCorrections')).toEqual([['u1']]);
  });

  it('補正 pending 無 raw 回退，全部成功後才發布', async () => {
    const pending = deferred<ReturnType<typeof snapshot>>();
    getDocsMock.mockImplementation(async q => {
      const { path, uids } = request(q);
      return (path === 'users' ? snapshot(uids) : await pending.promise) as never;
    });
    const view = mount();
    await waitFor(() => expect(callsTo('userCorrections')).toHaveLength(1));
    expect(view.result.current.data).toBeNull();
    await act(async () => { pending.resolve(snapshot(['u1'], true)); });
    await waitFor(() => expect(view.result.current.data?.counts.get('u1')).toBe(1));
    // 正控制：確認觀測器確實能看到補正發布的 setter 呼叫。
    expect(stateUpdates).toHaveBeenCalledWith(expect.objectContaining({
      adjustments: new Map([['u1', -1]]),
    }));
  });

  it('補正失敗保持 null，不露錯誤、不自動重試；重新展開後可成功', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fail = true;
    getDocsMock.mockImplementation(async q => {
      const { path, uids } = request(q);
      if (path === 'userCorrections' && fail) throw new Error('private correction failure');
      return snapshot(uids, path === 'userCorrections') as never;
    });
    const view = mount();
    await waitFor(() => expect(callsTo('userCorrections')).toHaveLength(1));
    await act(async () => {});
    expect(view.result.current.data).toBeNull();
    view.rerender({ ...base });
    await act(async () => {});
    expect(callsTo('userCorrections')).toHaveLength(1);
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
    view.rerender({ ...base, enabled: false });
    fail = false;
    view.rerender(base);
    await waitFor(() => expect(view.result.current.data?.counts.get('u1')).toBe(1));
    expect(callsTo('users')).toHaveLength(1);
    expect(callsTo('userCorrections')).toHaveLength(2);
  });

  it('第二批補正失敗不發布第一批結果', async () => {
    const uids = Array.from({ length: 31 }, (_, i) => 'u' + i);
    let batches = 0;
    getDocsMock.mockImplementation(async q => {
      const req = request(q);
      if (req.path === 'userCorrections' && ++batches === 2) throw new Error('second batch failed');
      return snapshot(req.uids, req.path === 'userCorrections') as never;
    });
    const view = mount({ people: people(uids), roleUids: uids });
    await waitFor(() => expect(callsTo('userCorrections')).toHaveLength(2));
    await act(async () => {});
    expect(view.result.current.data).toBeNull();
    expect(callsTo('users')).toHaveLength(2);
  });

  it.each([
    { eventDocId: 'event-doc-2' },
    { viewerUid: 'viewer2' },
    { people: people(['u2']), roleUids: ['u2'] },
  ])('活動、登入者或名單改變時拒收舊回應：%j', async change => {
    const old = deferred<ReturnType<typeof snapshot>>();
    let batches = 0;
    getDocsMock.mockImplementation(async q => {
      const req = request(q);
      if (req.path === 'userCorrections' && ++batches === 1) return await old.promise as never;
      return snapshot(req.uids, req.path === 'userCorrections') as never;
    });
    const view = mount();
    await waitFor(() => expect(callsTo('userCorrections')).toHaveLength(1));
    view.rerender({ ...base, ...change });
    expect(view.result.current.data).toBeNull();
    const uid = change.roleUids?.[0] ?? 'u1';
    await waitFor(() => expect(view.result.current.data?.counts.get(uid)).toBe(1));
    await act(async () => { old.resolve({ docs: [{ id: 'u1', data: () => ({ noShow: { adjustment: 90 } }) }] }); });
    expect(view.result.current.data?.counts.get(uid)).toBe(1);
  });

  it('權限撤回即隱藏；再次授權等待新補正，舊成功結果不閃回', async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.data?.counts.get('u1')).toBe(1));
    view.rerender({ ...base, canViewNoShow: false });
    expect(view.result.current.data).toBeNull();
    const next = deferred<ReturnType<typeof snapshot>>();
    getDocsMock.mockImplementation(async () => await next.promise as never);
    view.rerender(base);
    expect(view.result.current.data).toBeNull();
    await waitFor(() => expect(callsTo('userCorrections')).toHaveLength(2));
    await act(async () => { next.resolve(snapshot(['u1'], true)); });
    await waitFor(() => expect(view.result.current.data?.counts.get('u1')).toBe(1));
  });

  it.each(['success', 'failure'])('補正未完成時撤權，晚到 %s 不呼叫 setter；再次授權另讀補正', async outcome => {
    const pending = deferred<ReturnType<typeof snapshot>>();
    getDocsMock.mockImplementation(async q => {
      const req = request(q);
      return (req.path === 'users' ? snapshot(req.uids) : await pending.promise) as never;
    });
    const view = mount();
    await waitFor(() => expect(callsTo('userCorrections')).toHaveLength(1));
    view.rerender({ ...base, canViewNoShow: false });
    await act(async () => {});
    expect(view.result.current.data).toBeNull();
    stateUpdates.mockClear();
    await act(async () => {
      if (outcome === 'success') pending.resolve(snapshot(['u1'], true));
      else pending.reject(new Error('late correction failure'));
    });
    expect(stateUpdates).not.toHaveBeenCalled();
    expect(view.result.current.data).toBeNull();
    expect(callsTo('userCorrections')).toHaveLength(1);

    getDocsMock.mockImplementation(async q => {
      const req = request(q);
      return snapshot(req.uids, req.path === 'userCorrections') as never;
    });
    view.rerender(base);
    await waitFor(() => expect(view.result.current.data?.counts.get('u1')).toBe(1));
    expect(callsTo('userCorrections')).toHaveLength(2);
    expect(stateUpdates).toHaveBeenCalledWith(expect.objectContaining({
      adjustments: new Map([['u1', -1]]),
    }));
  });

  it.each(['success', 'failure'])('保持授權直接卸載，晚到 %s 不呼叫 setter', async outcome => {
    const pending = deferred<ReturnType<typeof snapshot>>();
    getDocsMock.mockImplementation(async q => {
      const req = request(q);
      return (req.path === 'users' ? snapshot(req.uids) : await pending.promise) as never;
    });
    const view = mount();
    await waitFor(() => expect(callsTo('userCorrections')).toHaveLength(1));
    // 不先撤權；單獨驗證卸載清理，不能用卸載後不再更新的 result.current 當證據。
    view.unmount();
    stateUpdates.mockClear();
    await act(async () => {
      if (outcome === 'success') pending.resolve(snapshot(['u1'], true));
      else pending.reject(new Error('late correction failure'));
    });
    expect(stateUpdates).not.toHaveBeenCalled();
    expect(callsTo('userCorrections')).toHaveLength(1);
  });
});
