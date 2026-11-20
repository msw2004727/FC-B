// 開賽閘門快取（顧問 §3.368 P2-1）：同一個 repo 內 cpConfig/launch 與 testers 在 LAUNCH_CACHE_MS 內只讀一次；
// 同時進行中的讀取共用；失敗不留；過期重讀。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAUNCH_CACHE_MS, createCompetitionsRepo, type CpFirestoreSdk } from './cp-repo';

function harness() {
  const docs = new Map<string, Record<string, unknown>>();
  const gets: string[] = [];
  let failNext = 0;
  const sdk: CpFirestoreSdk = {
    doc: (_db, path) => ({ path }),
    collection: (_db, path) => ({ path }),
    query: (col) => col,
    where: () => ({}),
    limit: () => ({}),
    async getDoc(ref) {
      const path = (ref as { path: string }).path;
      gets.push(path);
      if (failNext > 0) {
        failNext -= 1;
        throw new Error('offline');
      }
      const data = docs.get(path);
      return { id: path.split('/').at(-1) ?? '', exists: () => data != null, data: () => data } as never;
    },
    async getDocs() {
      return { docs: [] } as never;
    },
  };
  const repo = createCompetitionsRepo({ getDb: async () => ({}), loadSdk: async () => sdk });
  return {
    repo,
    docs,
    gets,
    failOnce() {
      failNext += 1;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T04:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getLaunch 記憶體快取', () => {
  it('快取時間內只讀一次（含同時進行中的兩次呼叫），過期才重讀', async () => {
    const box = harness();
    box.docs.set('cpConfig/launch', { isPublic: true, bannedWords: [] });
    const [a, b] = await Promise.all([box.repo.getLaunch(), box.repo.getLaunch()]);
    expect(a).toEqual({ isPublic: true, bannedWords: [] });
    expect(b).toEqual(a);
    await box.repo.getLaunch();
    expect(box.gets).toEqual(['cpConfig/launch']);

    vi.setSystemTime(Date.now() + LAUNCH_CACHE_MS - 1);
    await box.repo.getLaunch();
    expect(box.gets).toHaveLength(1);
    vi.setSystemTime(Date.now() + 1);
    await box.repo.getLaunch();
    expect(box.gets).toHaveLength(2);
  });

  it('文件不存在（null）也記住；讀取失敗不記住，下次重讀', async () => {
    const box = harness();
    await expect(box.repo.getLaunch()).resolves.toBeNull();
    await expect(box.repo.getLaunch()).resolves.toBeNull();
    expect(box.gets).toHaveLength(1);

    const other = harness();
    other.docs.set('cpConfig/launch', { isPublic: false });
    other.failOnce();
    await expect(other.repo.getLaunch()).rejects.toThrow('offline');
    await expect(other.repo.getLaunch()).resolves.toEqual({ isPublic: false, bannedWords: [] });
    expect(other.gets).toHaveLength(2);
  });

  it('測試者依 uid 分開記住；非法 uid 不讀', async () => {
    const box = harness();
    box.docs.set('cpConfig/launch/testers/uid_me', { ok: true });
    await expect(box.repo.getLaunchTester('uid_me')).resolves.toBe(true);
    await expect(box.repo.getLaunchTester('uid_me')).resolves.toBe(true);
    await expect(box.repo.getLaunchTester('uid_no')).resolves.toBe(false);
    await expect(box.repo.getLaunchTester('uid_no')).resolves.toBe(false);
    await expect(box.repo.getLaunchTester('a/b')).resolves.toBe(false);
    expect(box.gets).toEqual(['cpConfig/launch/testers/uid_me', 'cpConfig/launch/testers/uid_no']);
  });
});
