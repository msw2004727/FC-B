import { describe, expect, it } from 'vitest';
import { applyRouteMeta, NOINDEX_HEADER_PATHS, routeMetaFor } from './route-meta';

const FULL_HEAD = `
  <link rel="canonical" href="https://toosterx.com/">
  <link rel="alternate" hreflang="zh-TW" href="https://toosterx.com/">
  <link rel="alternate" hreflang="x-default" href="https://toosterx.com/">
  <meta property="og:url" content="https://toosterx.com">
  <meta property="og:type" content="website">
`;

function headDoc(html = FULL_HEAD): Document {
  const doc = document.implementation.createHTMLDocument('route-meta');
  doc.head.innerHTML = html;
  return doc;
}

function attr(doc: Document, selector: string, name: string): string | null {
  return doc.head.querySelector(selector)?.getAttribute(name) ?? null;
}

describe('routeMetaFor（I-01 S2）', () => {
  it('靜態路徑對應 canonical 與 og:type', () => {
    expect(routeMetaFor('/')).toEqual({ canonicalPath: '/', ogType: 'website', indexable: true });
    expect(routeMetaFor('/activities')).toEqual({ canonicalPath: '/activities', ogType: 'website', indexable: true });
    expect(routeMetaFor('/teams')).toEqual({ canonicalPath: '/teams', ogType: 'website', indexable: true });
    expect(routeMetaFor('/tournaments')).toEqual({ canonicalPath: '/tournaments', ogType: 'website', indexable: true });
    expect(routeMetaFor('/profile')).toEqual({ canonicalPath: '/profile', ogType: 'profile', indexable: false });
  });

  it('活動 id 經 encodeURIComponent、俱樂部 id 原樣，並去掉查詢字串與尾斜線', () => {
    const id = 'Cup_Final-09';
    expect(routeMetaFor(`/events/${id}`)).toEqual({
      canonicalPath: `/events/${encodeURIComponent(id)}`,
      ogType: 'event',
      indexable: true,
    });
    expect(routeMetaFor(`/events/${id}/?tab=1#roster`)).toEqual({
      canonicalPath: `/events/${encodeURIComponent(id)}`,
      ogType: 'event',
      indexable: true,
    });
    expect(routeMetaFor(`/teams/${id}/`)).toEqual({
      canonicalPath: `/teams/${id}`,
      ogType: 'website',
      indexable: true,
    });
    expect(routeMetaFor(`/teams/${id}?from=share#top`)).toEqual({
      canonicalPath: `/teams/${id}`,
      ogType: 'website',
      indexable: true,
    });
    expect(routeMetaFor('/activities/?sport=football#list')).toEqual({
      canonicalPath: '/activities',
      ogType: 'website',
      indexable: true,
    });
    expect(routeMetaFor('/profile/?tab=1#qr')).toEqual({
      canonicalPath: '/profile',
      ogType: 'profile',
      indexable: false,
    });
    expect(routeMetaFor('/?event=ignored#hash')).toEqual({ canonicalPath: '/', ogType: 'website', indexable: true });
  });

  it('非法 id 指回列表頁', () => {
    const illegal = [
      '/events/a.b',
      '/events/a b',
      '/events/a%2Fb',
      '/events/<script>',
      '/events/..',
      `/events/${'a'.repeat(121)}`,
      '/teams/a.b',
      '/teams/has space',
      `/teams/${'b'.repeat(121)}`,
    ];
    for (const path of illegal) {
      expect(routeMetaFor(path)).toEqual({
        canonicalPath: path.startsWith('/events/') ? '/activities' : '/teams',
        ogType: 'website',
        indexable: false,
      });
    }
    expect(routeMetaFor(`/events/${'a'.repeat(120)}`)?.ogType).toBe('event');
    expect(routeMetaFor(`/events/${'a'.repeat(120)}`)?.indexable).toBe(true);
    expect(routeMetaFor(`/teams/${'b'.repeat(120)}`)?.canonicalPath).toBe(`/teams/${'b'.repeat(120)}`);
    expect(routeMetaFor(`/teams/${'b'.repeat(120)}`)?.indexable).toBe(true);
  });

  it('其他路徑去掉查詢字串、hash 與尾斜線，og:type 為 website', () => {
    expect(routeMetaFor('/profile/U0123abcd')).toEqual({
      canonicalPath: '/profile/U0123abcd',
      ogType: 'website',
      indexable: false,
    });
    expect(routeMetaFor('/profile/qr/?from=card#code')).toEqual({
      canonicalPath: '/profile/qr',
      ogType: 'website',
      indexable: false,
    });
    expect(routeMetaFor('/admin/users/')).toEqual({
      canonicalPath: '/admin/users',
      ogType: 'website',
      indexable: false,
    });
    expect(routeMetaFor('/checkin?from=qr')).toEqual({
      canonicalPath: '/checkin',
      ogType: 'website',
      indexable: false,
    });
    expect(routeMetaFor('/tournaments/cup1/')).toEqual({
      canonicalPath: '/tournaments/cup1',
      ogType: 'website',
      indexable: false,
    });
    expect(routeMetaFor('/events/a/b')).toEqual({
      canonicalPath: '/events/a/b',
      ogType: 'website',
      indexable: false,
    });
  });
});

describe('indexable 白名單（I-01 S3）', () => {
  it('白名單逐條 indexable 為 true', () => {
    const pages = ['/', '/activities', '/teams', '/tournaments', '/events/ce_123', '/teams/ab_1'];
    for (const path of pages) {
      expect(routeMetaFor(path).indexable).toBe(true);
    }
    expect(routeMetaFor('/events/ce_123/?tab=1#roster').indexable).toBe(true);
    expect(routeMetaFor('/teams/ab_1/?from=share#top').indexable).toBe(true);
    expect(routeMetaFor(`/events/${'a'.repeat(120)}`).indexable).toBe(true);
    expect(routeMetaFor(`/teams/${'b'.repeat(120)}`).indexable).toBe(true);
  });

  it('私人路徑、/profile/qr、未知路徑與不合法 id 的 indexable 為 false', () => {
    const pages = [
      '/profile',
      '/profile/U0123abcd',
      '/profile/qr',
      '/admin/users',
      '/admin/banners',
      '/inbox',
      '/my-activities',
      '/me/dashboard',
      '/checkin',
      '/team-manage',
      '/qa-login',
      '/games',
      '/leaderboard',
      '/education',
      '/events/a.b',
      '/events/bad id',
      '/teams/a.b',
      `/teams/${'b'.repeat(121)}`,
      '/events/a/b',
      '/tournaments/cup1',
      '/no-such-page',
      '/events',
      '/me',
    ];
    for (const path of pages) {
      expect(routeMetaFor(path).indexable).toBe(false);
    }
  });

  it('NOINDEX_HEADER_PATHS 是 Cloudflare 私人路徑樣式', () => {
    expect(NOINDEX_HEADER_PATHS).toEqual([
      '/profile',
      '/profile/*',
      '/admin/*',
      '/inbox',
      '/my-activities',
      '/me/*',
      '/checkin',
      '/team-manage',
      '/qa-login',
    ]);
  });
});

describe('applyRouteMeta（I-01 S2）', () => {
  it('canonical 網址固定為 https://toosterx.com，不採用目前頁的 origin', () => {
    const doc = headDoc();
    expect(applyRouteMeta('/activities', doc)).toBe(true);
    const href = attr(doc, 'link[rel="canonical"]', 'href');
    expect(href).toBe('https://toosterx.com/activities');
    expect(href?.startsWith('https://toosterx.com')).toBe(true);
    if (location.host) expect(href).not.toContain(location.host);
    expect(routeMetaFor('/events/ce_123')?.canonicalPath).toBe('/events/ce_123');
  });

  it('四個標籤都被更新', () => {
    const doc = headDoc();
    expect(applyRouteMeta('/events/ce_123', doc)).toBe(true);
    const url = 'https://toosterx.com/events/ce_123';
    expect(attr(doc, 'link[rel="canonical"]', 'href')).toBe(url);
    expect(attr(doc, 'link[rel="alternate"][hreflang="zh-TW"]', 'href')).toBe(url);
    expect(attr(doc, 'link[rel="alternate"][hreflang="x-default"]', 'href')).toBe(url);
    expect(attr(doc, 'meta[property="og:url"]', 'content')).toBe(url);
    expect(attr(doc, 'meta[property="og:type"]', 'content')).toBe('event');
    expect(doc.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(doc.head.querySelectorAll('link[rel="alternate"]')).toHaveLength(2);

    expect(applyRouteMeta('/profile', doc)).toBe(true);
    expect(attr(doc, 'meta[property="og:type"]', 'content')).toBe('profile');
    expect(attr(doc, 'meta[property="og:url"]', 'content')).toBe('https://toosterx.com/profile');
  });

  it('元素缺漏不新增、不拋錯', () => {
    const empty = headDoc('');
    expect(() => applyRouteMeta('/activities', empty)).not.toThrow();
    expect(applyRouteMeta('/activities', empty)).toBe(true);
    expect(empty.head.childElementCount).toBe(0);

    const partial = headDoc('<link rel="canonical" href="https://toosterx.com/">');
    expect(applyRouteMeta('/teams/ab_1', partial)).toBe(true);
    expect(attr(partial, 'link[rel="canonical"]', 'href')).toBe('https://toosterx.com/teams/ab_1');
    expect(partial.head.querySelector('meta[property="og:url"]')).toBeNull();
    expect(partial.head.querySelector('meta[property="og:type"]')).toBeNull();
    expect(partial.head.querySelectorAll('link')).toHaveLength(1);
  });

  it('非法 id 改指列表頁、不留上一頁網址；讀取 head 失敗時回 false', () => {
    const doc = headDoc();
    expect(applyRouteMeta('/events/abc', doc)).toBe(true);
    expect(applyRouteMeta('/events/bad id', doc)).toBe(true);
    expect(attr(doc, 'link[rel="canonical"]', 'href')).toBe('https://toosterx.com/activities');
    expect(attr(doc, 'meta[property="og:url"]', 'content')).toBe('https://toosterx.com/activities');
    expect(attr(doc, 'meta[property="og:type"]', 'content')).toBe('website');

    const broken = {
      get head(): never {
        throw new Error('no head');
      },
    } as unknown as Document;
    expect(() => applyRouteMeta('/activities', broken)).not.toThrow();
    expect(applyRouteMeta('/activities', broken)).toBe(false);
  });
});

describe('applyRouteMeta robots（I-01 S3）', () => {
  const INJECTED = '<meta name="robots" content="noindex, nofollow">';

  function injected(doc: Document): Element | null {
    return doc.head.querySelector('meta[name="robots"]:not([data-route-robots])');
  }

  it('從私人頁換到公開頁會移除自己的 meta，再換回只有一個；內測注入的 meta 始終在', () => {
    const doc = headDoc(`${FULL_HEAD}${INJECTED}`);

    expect(applyRouteMeta('/profile/U0123abcd', doc)).toBe(true);
    const added = doc.head.querySelector('meta[name="robots"][data-route-robots]');
    expect(added).not.toBeNull();
    expect(added?.getAttribute('content')).toBe('noindex');
    expect(added?.getAttribute('name')).toBe('robots');
    expect(added?.getAttribute('data-route-robots')).toBe('');
    expect(doc.head.querySelectorAll('meta[data-route-robots]')).toHaveLength(1);
    expect(injected(doc)?.getAttribute('content')).toBe('noindex, nofollow');
    expect(injected(doc)?.hasAttribute('data-route-robots')).toBe(false);

    expect(applyRouteMeta('/activities', doc)).toBe(true);
    expect(doc.head.querySelector('meta[data-route-robots]')).toBeNull();
    expect(injected(doc)?.getAttribute('content')).toBe('noindex, nofollow');
    expect(attr(doc, 'link[rel="canonical"]', 'href')).toBe('https://toosterx.com/activities');
    expect(attr(doc, 'meta[property="og:type"]', 'content')).toBe('website');

    expect(applyRouteMeta('/inbox', doc)).toBe(true);
    expect(doc.head.querySelectorAll('meta[name="robots"][data-route-robots]')).toHaveLength(1);
    expect(doc.head.querySelectorAll('meta[name="robots"]')).toHaveLength(2);
    expect(injected(doc)?.getAttribute('content')).toBe('noindex, nofollow');

    expect(applyRouteMeta('/qa-login', doc)).toBe(true);
    expect(doc.head.querySelectorAll('meta[data-route-robots]')).toHaveLength(1);
    expect(injected(doc)?.getAttribute('content')).toBe('noindex, nofollow');

    expect(applyRouteMeta('/', doc)).toBe(true);
    expect(doc.head.querySelector('meta[data-route-robots]')).toBeNull();
    expect(doc.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
    expect(injected(doc)?.getAttribute('content')).toBe('noindex, nofollow');
  });

  it('元素缺漏不拋錯', () => {
    const empty = headDoc('');
    expect(() => applyRouteMeta('/admin/users', empty)).not.toThrow();
    expect(applyRouteMeta('/checkin', empty)).toBe(true);
    expect(empty.head.querySelectorAll('meta[data-route-robots]')).toHaveLength(1);
    expect(empty.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(empty.head.querySelector('meta[property="og:url"]')).toBeNull();
    expect(empty.head.querySelector('meta[property="og:type"]')).toBeNull();

    const bare = headDoc(INJECTED);
    expect(() => applyRouteMeta('/tournaments', bare)).not.toThrow();
    expect(applyRouteMeta('/', bare)).toBe(true);
    expect(bare.head.querySelector('meta[data-route-robots]')).toBeNull();
    expect(bare.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
    expect(injected(bare)?.getAttribute('content')).toBe('noindex, nofollow');

    const broken = {
      get head(): never {
        throw new Error('no head');
      },
    } as unknown as Document;
    expect(() => applyRouteMeta('/inbox', broken)).not.toThrow();
    expect(applyRouteMeta('/profile', broken)).toBe(false);
  });
});
