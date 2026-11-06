// I-01 S2：SPA 換頁時更新 canonical／hreflang／og:url／og:type。
// 舊站 A 的 `_updateRouteMetaTags` 遇到不認識的頁會維持上一頁的值；
// 這裡改成每個路徑都算出自己的網址，關掉 noindex 後才不會整站都宣稱是首頁。

const SITE_ORIGIN = 'https://toosterx.com';
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;

export type RouteOgType = 'website' | 'profile' | 'event';

export interface RouteMeta {
  canonicalPath: string;
  ogType: RouteOgType;
}

const STATIC_OG: Readonly<Record<string, RouteOgType>> = {
  '/': 'website',
  '/activities': 'website',
  '/teams': 'website',
  '/tournaments': 'website',
  '/profile': 'profile',
};

/** 去掉查詢字串、hash 與尾斜線。空路徑與根路徑都是 `/`。 */
function canonicalPathname(path: string): string {
  const raw = typeof path === 'string' ? path.trim() : '';
  const cut = raw.split(/[?#]/)[0] ?? '';
  let pathname = cut.trim();
  if (pathname === '') return '/';
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
  return pathname || '/';
}

type SegmentMatch =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'ok'; id: string };

/** 只認「根路徑下恰好一段」的詳情網址。多出來的段改走其他路徑，不沿用上一頁。 */
function matchDetailSegment(pathname: string, root: '/events' | '/teams'): SegmentMatch {
  const prefix = `${root}/`;
  if (!pathname.startsWith(prefix)) return { status: 'none' };
  const id = pathname.slice(prefix.length);
  if (id.length === 0 || id.includes('/')) return { status: 'none' };
  if (!SAFE_ID.test(id)) return { status: 'invalid' };
  return { status: 'ok', id };
}

export function routeMetaFor(path: string): RouteMeta {
  const pathname = canonicalPathname(path);
  const staticType = STATIC_OG[pathname];
  if (staticType) return { canonicalPath: pathname, ogType: staticType };

  const eventMatch = matchDetailSegment(pathname, '/events');
  // 不合法的詳情 id 指回列表頁，不沿用上一頁的網址。
  if (eventMatch.status === 'invalid') return { canonicalPath: '/activities', ogType: 'website' };
  if (eventMatch.status === 'ok') {
    return { canonicalPath: `/events/${encodeURIComponent(eventMatch.id)}`, ogType: 'event' };
  }

  const teamMatch = matchDetailSegment(pathname, '/teams');
  if (teamMatch.status === 'invalid') return { canonicalPath: '/teams', ogType: 'website' };
  if (teamMatch.status === 'ok') {
    return { canonicalPath: `/teams/${teamMatch.id}`, ogType: 'website' };
  }

  return { canonicalPath: pathname, ogType: 'website' };
}

const HREFLANGS = ['zh-TW', 'x-default'] as const;

/**
 * 把 canonical、兩條 hreflang、og:url、og:type 改成這個路徑的值。
 * 網址固定 `https://toosterx.com` + canonicalPath，不讀 location.origin。
 * 元素不存在就跳過，不新增。任何失敗回 false。
 */
export function applyRouteMeta(path: string, doc: Document = document): boolean {
  try {
    const meta = routeMetaFor(path);
    const head = doc.head;
    if (!head) return false;
    const canonicalUrl = `${SITE_ORIGIN}${meta.canonicalPath}`;
    const canonical = head.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', canonicalUrl);
    for (const lang of HREFLANGS) {
      const alternate = head.querySelector(`link[rel="alternate"][hreflang="${lang}"]`);
      if (alternate) alternate.setAttribute('href', canonicalUrl);
    }
    const ogUrl = head.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute('content', canonicalUrl);
    const ogType = head.querySelector('meta[property="og:type"]');
    if (ogType) ogType.setAttribute('content', meta.ogType);
    return true;
  } catch {
    return false;
  }
}
