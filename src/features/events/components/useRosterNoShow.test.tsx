import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/preact';

const feature = vi.hoisted(() => ({ enabled: true }));
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
import { _resetUserRolesCacheForTest, useUserRoles } from '@/data/user-roles';
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
    const roles = useUserRoles(opts.viewerUid ? opts.roleUids : []);
    const data = useRosterNoShow({ ...opts, roles });
    return { data, roles };
  }, { initialProps: { ...base, ...options } });
}

beforeEach(() => {
  _resetUserRolesCacheForTest();
  feature.enabled = true;
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

  it('補正未完成時撤權或卸載，遲到回應不發布', async () => {
    const pending = deferred<ReturnType<typeof snapshot>>();
    getDocsMock.mockImplementation(async q => {
      const req = request(q);
      return (req.path === 'users' ? snapshot(req.uids) : await pending.promise) as never;
    });
    const view = mount();
    await waitFor(() => expect(callsTo('userCorrections')).toHaveLength(1));
    view.rerender({ ...base, canViewNoShow: false });
    expect(view.result.current.data).toBeNull();
    view.unmount();
    await act(async () => { pending.resolve(snapshot(['u1'], true)); });
    expect(view.result.current.data).toBeNull();
    expect(callsTo('userCorrections')).toHaveLength(1);
  });
});
