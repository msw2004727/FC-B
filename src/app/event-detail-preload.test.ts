import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RELOAD_AT_KEY } from '@/core/chunk-reload';
import {
  BOOT_PRELOAD_SCRIPT_ID,
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
      '/events/x\n',
    ]) {
      expect(shouldPreloadEventDetail(pathname), pathname).toBe(false);
    }
    const share = read('../app/share-link.ts');
    const self = read('./event-detail-preload.ts');
    expect(share).toContain('/^[A-Za-z0-9_-]{1,120}$/');
    // id 段與 share-link 的 PUBLIC_ID 同一個字元類與長度（合成單一 regex 後，§3.276 入口餘裕）。
    expect(self).toContain(String.raw`/^\/events\/[A-Za-z0-9_-]{1,120}$/`);
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

const MAP = {
  detail: { js: ['/assets/EventDetailPage-aaa.js', '/assets/dep-bbb.js'], css: ['/assets/EventDetailPage-ccc.css'] },
  firestore: { js: ['/assets/index.esm-ddd.js'], css: [] },
};

function setMap(json: string): void {
  const el = document.createElement('script');
  el.type = 'application/json';
  el.id = BOOT_PRELOAD_SCRIPT_ID;
  el.textContent = json;
  document.head.appendChild(el);
}

function links(rel: string): string[] {
  return [...document.head.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`)].map((l) => l.getAttribute('href') ?? '');
}

describe('preloadEventDetailChunks（顧問 §3.255 B′：modulepreload，不用 import()）', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    sessionStorage.clear();
  });

  it('/events/x 插詳情與 SDK 的 modulepreload（crossorigin=""）與詳情 CSS 的 preload（as=style，不插 stylesheet）', () => {
    setMap(JSON.stringify(MAP));
    preloadEventDetailChunks('/events/x');
    expect(links('modulepreload')).toEqual(['/assets/EventDetailPage-aaa.js', '/assets/dep-bbb.js', '/assets/index.esm-ddd.js']);
    expect(links('preload')).toEqual(['/assets/EventDetailPage-ccc.css']);
    expect(links('stylesheet')).toEqual([]);
    expect(document.head.querySelector<HTMLLinkElement>('link[rel="preload"]')?.as).toBe('style'); // jsdom 不把 as 反映到屬性，驗 property
    for (const l of document.head.querySelectorAll('link')) expect(l.getAttribute('crossorigin')).toBe('');
  });

  it('首頁與列表只插 SDK；其他路徑什麼都不插', () => {
    setMap(JSON.stringify(MAP));
    preloadEventDetailChunks('/');
    preloadEventDetailChunks('/activities');
    expect(links('modulepreload')).toEqual(['/assets/index.esm-ddd.js', '/assets/index.esm-ddd.js']);
    expect(links('preload')).toEqual([]);
    document.head.querySelectorAll('link').forEach((l) => l.remove());
    for (const pathname of ['/events', '/events/x/edit', '/teams/x']) preloadEventDetailChunks(pathname);
    expect(document.head.querySelectorAll('link')).toHaveLength(0);
  });

  it('沒有清單（dev）或清單壞掉：不插、不拋', () => {
    expect(() => preloadEventDetailChunks('/events/x')).not.toThrow();
    setMap('{not json');
    expect(() => preloadEventDetailChunks('/events/x')).not.toThrow();
    expect(document.head.querySelectorAll('link')).toHaveLength(0);
  });

  it('只接受同源 /assets/ 的 js／css 檔名，其他項目略過', () => {
    setMap(JSON.stringify({
      detail: { js: ['https://evil.example/x.js', '/assets/../x.js', '/assets/a b.js', 42, '/assets/ok-1.js'], css: ['javascript:x', '/assets/ok.css'] },
      firestore: { js: 'nope' },
    }));
    preloadEventDetailChunks('/events/x');
    expect(links('modulepreload')).toEqual(['/assets/ok-1.js']);
    expect(links('preload')).toEqual(['/assets/ok.css']);
  });



  it('預載失敗：不發 vite:preloadError、不寫 chunk-reload 時間戳、不留 unhandledrejection', async () => {
    const reasons: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      reasons.push(reason);
    };
    let preloadErrors = 0;
    const onPreloadError = (): void => {
      preloadErrors += 1;
    };
    process.on('unhandledRejection', onUnhandled);
    window.addEventListener('vite:preloadError', onPreloadError);
    try {
      setMap(JSON.stringify(MAP));
      preloadEventDetailChunks('/events/x');
      for (const l of document.head.querySelectorAll('link')) l.dispatchEvent(new Event('error'));
      await new Promise((resolvePromise) => {
        setTimeout(resolvePromise, 0);
      });
      expect(preloadErrors).toBe(0);
      expect(sessionStorage.getItem(RELOAD_AT_KEY)).toBeNull();
      expect(reasons).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      window.removeEventListener('vite:preloadError', onPreloadError);
    }
  });
});

describe('main.tsx 開機預載', () => {
  const main = read('../main.tsx');
  const self = read('./event-detail-preload.ts');
  const plugin = read('../../scripts/boot-preload-html.ts');

  it('不再以 import() 預載詳情頁與 SDK；改讀建置注入的清單插 modulepreload', () => {
    expect(main).toContain('preloadEventDetailChunks(location.pathname)');
    expect(main).not.toContain("import('./features/events/pages/EventDetailPage')");
    expect(main).not.toContain("import('firebase/firestore')");
    expect(self).not.toMatch(/\bimport\(\s*['"`]/);
    expect(self).toContain("'modulepreload'");
    expect(main).not.toContain('getFirebase');
    expect(main).not.toMatch(/from ['"]@\/data\/firebase['"]/);
    expect(main).not.toMatch(/from ['"]\.\/data\/firebase['"]/);
  });

  it('清單 id 與建置外掛同值；外掛找的詳情頁就是活動路由 load 的模組', () => {
    expect(plugin).toContain(`BOOT_PRELOAD_SCRIPT_ID = '${BOOT_PRELOAD_SCRIPT_ID}'`);
    expect(read('../features/events/index.ts')).toContain("import('./pages/EventDetailPage')");
    expect(plugin).toContain(String.raw`EventDetailPage\.tsx$/`);
  });
});
