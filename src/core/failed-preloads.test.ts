import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ALL,
  MAX_FAILED,
  _resetFailedPreloadsForTest,
  allPreloadAssetUrls,
  getFailedPreloads,
  installFailedPreloadRecorder,
  isRefreshableAssetUrl,
} from './failed-preloads';

function addLink(rel: string, href: string): HTMLLinkElement {
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  document.head.appendChild(link);
  return link;
}

afterEach(() => {
  _resetFailedPreloadsForTest();
  document.querySelectorAll('link').forEach((node) => node.remove());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('isRefreshableAssetUrl', () => {
  it('同源 /assets/*.js|css 才算；new URL 失敗回 false', () => {
    expect(isRefreshableAssetUrl(`${location.origin}/assets/app.js`)).toBe(true);
    expect(isRefreshableAssetUrl(`${location.origin}/assets/chunk.abc-1.css`)).toBe(true);
    expect(isRefreshableAssetUrl('/assets/app.js')).toBe(true);
    expect(isRefreshableAssetUrl(`${location.origin}/assets/app.JS`)).toBe(false);
    expect(isRefreshableAssetUrl(`${location.origin}/vendor/app.js`)).toBe(false);
    expect(isRefreshableAssetUrl(`${location.origin}/assets/nested/app.js`)).toBe(false);
    expect(isRefreshableAssetUrl('https://cdn.example.com/assets/app.js')).toBe(false);
    expect(isRefreshableAssetUrl('http://[')).toBe(false);
  });
});

describe('installFailedPreloadRecorder', () => {
  it('link 在 document 上派發不冒泡的 error（capture 收得到）會記到 href', () => {
    installFailedPreloadRecorder();
    const link = addLink('modulepreload', '/assets/app.js');
    let bubbled = false;
    const onBubble = (): void => {
      bubbled = true;
    };
    document.addEventListener('error', onBubble);
    const event = new Event('error', { bubbles: false });
    expect(event.bubbles).toBe(false);
    link.dispatchEvent(event);
    document.removeEventListener('error', onBubble);
    expect(bubbled).toBe(false);
    expect(getFailedPreloads()).toEqual([link.href]);
    // 複本，不清空。
    const copy = getFailedPreloads();
    copy.push('https://example.com/assets/extra.js');
    expect(getFailedPreloads()).toEqual([link.href]);
  });

  it('非 LINK、rel=icon、外站、非 /assets/ 不記；去重；超過 30 只留 30', () => {
    installFailedPreloadRecorder();
    const img = document.createElement('img');
    img.src = `${location.origin}/assets/pic.js`;
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error', { bubbles: false }));
    document.body.dispatchEvent(new Event('error', { bubbles: false }));

    addLink('icon', '/assets/icon.js').dispatchEvent(new Event('error', { bubbles: false }));
    addLink('modulepreload', 'https://cdn.example.com/assets/ext.js').dispatchEvent(new Event('error', { bubbles: false }));
    addLink('preload', '/vendor/app.js').dispatchEvent(new Event('error', { bubbles: false }));
    addLink('stylesheet', '/assets/nested/app.css').dispatchEvent(new Event('error', { bubbles: false }));

    const kept = addLink('stylesheet', '/assets/keep.css');
    kept.dispatchEvent(new Event('error', { bubbles: false }));
    kept.dispatchEvent(new Event('error', { bubbles: false }));
    addLink('stylesheet', '/assets/keep.css').dispatchEvent(new Event('error', { bubbles: false }));

    expect(getFailedPreloads()).toEqual([kept.href]);

    _resetFailedPreloadsForTest();
    installFailedPreloadRecorder();
    const hrefs: string[] = [];
    for (let i = 0; i < MAX_FAILED + 1; i += 1) {
      const link = addLink('modulepreload', `/assets/f${i}.js`);
      link.dispatchEvent(new Event('error', { bubbles: false }));
      hrefs.push(link.href);
    }
    expect(getFailedPreloads()).toEqual(hrefs.slice(0, MAX_FAILED));
    expect(getFailedPreloads()).toHaveLength(MAX_FAILED);
  });

  it('多 token 與大寫 rel 會記到；跨源與跳出 /assets/ 的路徑不記', () => {
    installFailedPreloadRecorder();
    const multi = addLink('preload modulepreload', '/assets/multi.js');
    const upper = addLink('ModulePreload', '/assets/upper.js');
    multi.dispatchEvent(new Event('error', { bubbles: false }));
    upper.dispatchEvent(new Event('error', { bubbles: false }));
    expect(multi.rel).toBe('preload modulepreload');
    expect(upper.rel).toBe('ModulePreload');
    expect(getFailedPreloads()).toEqual([multi.href, upper.href]);

    // new URL 會先正規化再套路徑規則。
    const evil = new URL('//evil.example/assets/x.js', location.href);
    expect(evil.origin).toBe(`${location.protocol}//evil.example`);
    expect(evil.origin).not.toBe(location.origin);
    expect(isRefreshableAssetUrl('//evil.example/assets/x.js')).toBe(false);
    expect(new URL('/assets/../x.js', location.href).pathname).toBe('/x.js');
    expect(isRefreshableAssetUrl('/assets/../x.js')).toBe(false);
    expect(new URL('/assets/%2e%2e/x.js', location.href).pathname).toBe('/x.js');
    expect(isRefreshableAssetUrl('/assets/%2e%2e/x.js')).toBe(false);

    for (const href of ['//evil.example/assets/x.js', '/assets/../x.js', '/assets/%2e%2e/x.js']) {
      addLink('modulepreload', href).dispatchEvent(new Event('error', { bubbles: false }));
    }
    expect(getFailedPreloads()).toEqual([multi.href, upper.href]);
  });

  it('重複 install 不重掛、不重複記錄', () => {
    const add = vi.spyOn(document, 'addEventListener');
    installFailedPreloadRecorder();
    installFailedPreloadRecorder();
    const errorAdds = add.mock.calls.filter((call) => call[0] === 'error');
    expect(errorAdds).toHaveLength(1);
    expect(errorAdds[0]?.[2]).toBe(true);
    add.mockRestore();

    const link = addLink('preload', '/assets/once.js');
    link.dispatchEvent(new Event('error', { bubbles: false }));
    link.dispatchEvent(new Event('error', { bubbles: false }));
    expect(getFailedPreloads()).toEqual([link.href]);
  });
});

describe('allPreloadAssetUrls', () => {
  it('只留 modulepreload／preload／stylesheet 的同源 /assets/，去重', () => {
    const js = addLink('modulepreload', '/assets/app.js').href;
    const css = addLink('stylesheet', '/assets/app.css').href;
    const pre = addLink('preload', '/assets/chunk.js').href;
    addLink('icon', '/assets/icon.js');
    addLink('modulepreload', 'https://cdn.example.com/assets/ext.js');
    addLink('stylesheet', '/vendor/app.css');
    addLink('preload', '/assets/nested/app.js');
    addLink('modulepreload', '/assets/app.js');
    // 後插入優先：最後的重複 app.js 先收下，接著 chunk.js、app.css。
    expect(allPreloadAssetUrls()).toEqual([js, pre, css]);
  });

  it('80 個合格 link 全回；81 個回後插入的 80 個', () => {
    expect(MAX_ALL).toBe(80);
    const hrefs: string[] = [];
    for (let i = 0; i < 80; i += 1) {
      hrefs.push(addLink('stylesheet', `/assets/s${i}.css`).href);
    }
    // 不合格不計入上限。
    addLink('icon', '/assets/icon.js');
    addLink('stylesheet', 'https://cdn.example.com/assets/ext.css');
    expect(allPreloadAssetUrls()).toEqual([...hrefs].reverse());
    expect(allPreloadAssetUrls()).toHaveLength(80);

    const last = addLink('modulepreload', '/assets/overflow.js').href;
    const got = allPreloadAssetUrls();
    expect(got).toHaveLength(80);
    expect(got[0]).toBe(last);
    expect(got).not.toContain(hrefs[0]);
    expect(got).toEqual([last, ...hrefs.slice(1).reverse()]);
  });
});
