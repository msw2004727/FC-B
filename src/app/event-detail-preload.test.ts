import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  preloadEventDetailChunks,
  shouldPreloadEventDetail,
  shouldPreloadFirestoreSdk,
} from './event-detail-preload';

const read = (rel: string): string => readFileSync(resolve(__dirname, rel), 'utf8');

describe('shouldPreloadEventDetail', () => {
  it('路徑 /events/<id> 才為真，id 形狀與 share-link PUBLIC_ID 相同', () => {
    expect(shouldPreloadEventDetail('/events/x')).toBe(true);
    expect(shouldPreloadEventDetail('/events/abc_DEF-123')).toBe(true);
    expect(shouldPreloadEventDetail(`/events/${'a'.repeat(120)}`)).toBe(true);
    for (const pathname of [
      '/',
      '',
      '/events',
      '/events/',
      '/events/x/',
      '/events/x/edit',
      '/activities',
      '/teams/x',
      '/EVENTS/x',
      '/events/has space',
      '/events/a.b',
      `/events/${'a'.repeat(121)}`,
    ]) {
      expect(shouldPreloadEventDetail(pathname), pathname).toBe(false);
    }
    const share = read('../app/share-link.ts');
    const self = read('./event-detail-preload.ts');
    expect(share).toContain('/^[A-Za-z0-9_-]{1,120}$/');
    expect(self).toContain('/^[A-Za-z0-9_-]{1,120}$/');
  });
});

describe('shouldPreloadFirestoreSdk', () => {
  it('首頁、活動列表與活動詳情才預載 SDK，其他路徑不預載', () => {
    expect(shouldPreloadFirestoreSdk('/')).toBe(true);
    expect(shouldPreloadFirestoreSdk('/activities')).toBe(true);
    expect(shouldPreloadFirestoreSdk('/events/x')).toBe(true);
    expect(shouldPreloadFirestoreSdk('/events/abc_DEF-123')).toBe(true);
    for (const pathname of ['', '/activities/', '/events', '/events/x/edit', '/teams', '/teams/x', '/EVENTS/x']) {
      expect(shouldPreloadFirestoreSdk(pathname), pathname).toBe(false);
    }
  });
});

describe('preloadEventDetailChunks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('/events/x 仍呼叫兩個載入器；首頁與列表只預載 SDK；其他路徑不呼叫', () => {
    const loadPage = vi.fn(() => Promise.resolve('page'));
    const loadFirestore = vi.fn(() => Promise.resolve('fs'));
    preloadEventDetailChunks('/events/x', loadPage, loadFirestore);
    expect(loadPage).toHaveBeenCalledOnce();
    expect(loadFirestore).toHaveBeenCalledOnce();

    loadPage.mockClear();
    loadFirestore.mockClear();
    for (const pathname of ['/', '/activities']) {
      preloadEventDetailChunks(pathname, loadPage, loadFirestore);
    }
    expect(loadPage).not.toHaveBeenCalled();
    expect(loadFirestore).toHaveBeenCalledTimes(2);

    loadPage.mockClear();
    loadFirestore.mockClear();
    for (const pathname of ['/events', '/events/x/edit', '/teams/x']) {
      preloadEventDetailChunks(pathname, loadPage, loadFirestore);
    }
    expect(loadPage).not.toHaveBeenCalled();
    expect(loadFirestore).not.toHaveBeenCalled();
  });

  it('import 失敗不拋，也不留下 unhandledrejection', async () => {
    const reasons: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      reasons.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      expect(() => preloadEventDetailChunks(
        '/events/x',
        () => Promise.reject(new Error('Importing a module script failed')),
        () => Promise.reject(new Error('firestore chunk failed')),
      )).not.toThrow();
      await new Promise((resolvePromise) => {
        setTimeout(resolvePromise, 0);
      });
      expect(reasons).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('首頁的 SDK 預載失敗不拋；不會下載詳情 chunk', async () => {
    const reasons: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      reasons.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    const loadPage = vi.fn(() => Promise.reject(new Error('page should not run')));
    const loadFirestore = vi.fn(() => Promise.reject(new Error('firestore chunk failed')));
    try {
      expect(() => preloadEventDetailChunks('/', loadPage, loadFirestore)).not.toThrow();
      await new Promise((resolvePromise) => {
        setTimeout(resolvePromise, 0);
      });
      expect(loadPage).not.toHaveBeenCalled();
      expect(loadFirestore).toHaveBeenCalledOnce();
      expect(reasons).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('其他路徑的載入器即使會拒絕也不會被呼叫', async () => {
    const loadPage = vi.fn(() => Promise.reject(new Error('should not run')));
    expect(() => preloadEventDetailChunks('/teams/x', loadPage, loadPage)).not.toThrow();
    await Promise.resolve();
    expect(loadPage).not.toHaveBeenCalled();
  });
});

describe('main.tsx 預先 import', () => {
  const main = read('../main.tsx');
  const routes = read('../features/events/index.ts');

  it('靜態 import 路徑與活動路由 load 是同一個 EventDetailPage 模組，並接住 rejection', () => {
    expect(routes).toContain("import('./pages/EventDetailPage')");
    expect(main).toContain("import('./features/events/pages/EventDetailPage')");
    expect(main).toContain("import('firebase/firestore')");
    expect(main).toContain('preloadEventDetailChunks(');
    expect(read('./event-detail-preload.ts')).toContain('.catch(() => {})');
    expect(main).not.toContain('getFirebase');
    expect(main).not.toMatch(/from ['"]@\/data\/firebase['"]/);
    expect(main).not.toMatch(/from ['"]\.\/data\/firebase['"]/);
  });
});
