import { describe, expect, it } from 'vitest';
import { applyRouteMeta, routeMetaFor } from './route-meta';

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
    expect(routeMetaFor('/')).toEqual({ canonicalPath: '/', ogType: 'website' });
    expect(routeMetaFor('/activities')).toEqual({ canonicalPath: '/activities', ogType: 'website' });
    expect(routeMetaFor('/teams')).toEqual({ canonicalPath: '/teams', ogType: 'website' });
    expect(routeMetaFor('/tournaments')).toEqual({ canonicalPath: '/tournaments', ogType: 'website' });
    expect(routeMetaFor('/profile')).toEqual({ canonicalPath: '/profile', ogType: 'profile' });
  });

  it('活動 id 經 encodeURIComponent、俱樂部 id 原樣，並去掉查詢字串與尾斜線', () => {
    const id = 'Cup_Final-09';
    expect(routeMetaFor(`/events/${id}`)).toEqual({
      canonicalPath: `/events/${encodeURIComponent(id)}`,
      ogType: 'event',
    });
    expect(routeMetaFor(`/events/${id}/?tab=1#roster`)).toEqual({
      canonicalPath: `/events/${encodeURIComponent(id)}`,
      ogType: 'event',
    });
    expect(routeMetaFor(`/teams/${id}/`)).toEqual({
      canonicalPath: `/teams/${id}`,
      ogType: 'website',
    });
    expect(routeMetaFor(`/teams/${id}?from=share#top`)).toEqual({
      canonicalPath: `/teams/${id}`,
      ogType: 'website',
    });
    expect(routeMetaFor('/activities/?sport=football#list')).toEqual({
      canonicalPath: '/activities',
      ogType: 'website',
    });
    expect(routeMetaFor('/profile/?tab=1#qr')).toEqual({
      canonicalPath: '/profile',
      ogType: 'profile',
    });
    expect(routeMetaFor('/?event=ignored#hash')).toEqual({ canonicalPath: '/', ogType: 'website' });
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
      });
    }
    expect(routeMetaFor(`/events/${'a'.repeat(120)}`)?.ogType).toBe('event');
    expect(routeMetaFor(`/teams/${'b'.repeat(120)}`)?.canonicalPath).toBe(`/teams/${'b'.repeat(120)}`);
  });

  it('其他路徑去掉查詢字串、hash 與尾斜線，og:type 為 website', () => {
    expect(routeMetaFor('/profile/U0123abcd')).toEqual({
      canonicalPath: '/profile/U0123abcd',
      ogType: 'website',
    });
    expect(routeMetaFor('/profile/qr/?from=card#code')).toEqual({
      canonicalPath: '/profile/qr',
      ogType: 'website',
    });
    expect(routeMetaFor('/admin/users/')).toEqual({
      canonicalPath: '/admin/users',
      ogType: 'website',
    });
    expect(routeMetaFor('/checkin?from=qr')).toEqual({
      canonicalPath: '/checkin',
      ogType: 'website',
    });
    expect(routeMetaFor('/tournaments/cup1/')).toEqual({
      canonicalPath: '/tournaments/cup1',
      ogType: 'website',
    });
    expect(routeMetaFor('/events/a/b')).toEqual({
      canonicalPath: '/events/a/b',
      ogType: 'website',
    });
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
