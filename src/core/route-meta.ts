// I-01 S2：SPA 換頁時更新 canonical／hreflang／og:url／og:type。
// 舊站 A 的 `_updateRouteMetaTags` 遇到不認識的頁會維持上一頁的值；
// 這裡改成每個路徑都算出自己的網址，關掉 noindex 後才不會整站都宣稱是首頁。
// I-01 S3：只有白名單可收錄。其餘路徑加自己的 robots meta（不碰內測注入的那顆）。

const SITE_ORIGIN = 'https://toosterx.com';
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;

export type RouteOgType = 'website' | 'profile' | 'event';

export interface RouteMeta {
  canonicalPath: string;
  ogType: RouteOgType;
  /** 白名單才是 true。不認識的路徑維持 false（fail-closed）。 */
  indexable: boolean;
}

const STATIC_OG: Readonly<Record<string, RouteOgType>> = {
  '/': 'website',
  '/activities': 'website',
  '/teams': 'website',
  '/tournaments': 'website',
  '/profile': 'profile',
};

/** 靜態白名單。合法 id 的 /events/:id、/teams/:id 在 routeMetaFor 另外放行。 */
const INDEXABLE_PATHS: ReadonlySet<string> = new Set(['/', '/activities', '/teams', '/tournaments']);

/**
 * Cloudflare `_headers` 用的私人路徑樣式。
 * 內測與正式建置都輸出 `X-Robots-Tag: noindex`。`/games` 等未列在這裡的路徑只靠前端 meta。
 * 精確路徑另列尾斜線版本：`_headers` 不會把 `/inbox/` 當成 `/inbox`（Opus 審查 P3）。
 */
export const NOINDEX_HEADER_PATHS: readonly string[] = [
  '/profile',
  '/profile/*',
  '/admin/*',
  '/inbox',
  '/inbox/',
  '/my-activities',
  '/my-activities/',
  '/me/*',
  '/checkin',
  '/checkin/',
  '/team-manage',
  '/team-manage/',
  '/qa-login',
  '/qa-login/',
];

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
  if (staticType) {
    return { canonicalPath: pathname, ogType: staticType, indexable: INDEXABLE_PATHS.has(pathname) };
  }

  const eventMatch = matchDetailSegment(pathname, '/events');
  // 不合法的詳情 id 指回列表頁，但不收錄（列表頁本身才在白名單）。
  if (eventMatch.status === 'invalid') {
    return { canonicalPath: '/activities', ogType: 'website', indexable: false };
  }
  if (eventMatch.status === 'ok') {
    return { canonicalPath: `/events/${encodeURIComponent(eventMatch.id)}`, ogType: 'event', indexable: true };
  }

  const teamMatch = matchDetailSegment(pathname, '/teams');
  if (teamMatch.status === 'invalid') {
    return { canonicalPath: '/teams', ogType: 'website', indexable: false };
  }
  if (teamMatch.status === 'ok') {
    return { canonicalPath: `/teams/${teamMatch.id}`, ogType: 'website', indexable: true };
  }

  return { canonicalPath: pathname, ogType: 'website', indexable: false };
}

const HREFLANGS = ['zh-TW', 'x-default'] as const;

/** 只選本功能建立的 robots meta。沒有 data-route-robots 的（內測全站 noindex）不在範圍內。 */
const ROUTE_ROBOTS_SELECTOR = 'meta[name="robots"][data-route-robots]';

function syncRouteRobots(doc: Document, indexable: boolean): void {
  const own = doc.head.querySelectorAll(ROUTE_ROBOTS_SELECTOR);
  if (indexable) {
    for (const node of own) node.remove();
    return;
  }
  if (own.length > 0) return;
  const metaEl = doc.createElement('meta');
  metaEl.setAttribute('name', 'robots');
  metaEl.setAttribute('content', 'noindex');
  metaEl.setAttribute('data-route-robots', '');
  doc.head.appendChild(metaEl);
}

/**
 * 把 canonical、兩條 hreflang、og:url、og:type 改成這個路徑的值。
 * 網址固定 `https://toosterx.com` + canonicalPath，不讀 location.origin。
 * 不可收錄時確保 head 有 `<meta name="robots" content="noindex" data-route-robots="">`（沒有就建立，有就留著）；
 * 可收錄時只移除這顆。沒有 data-route-robots 的 robots meta 不動。
 * 既有 canonical 等元素不存在就跳過，不新增。任何失敗回 false。
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
    syncRouteRobots(doc, meta.indexable);
    return true;
  } catch {
    return false;
  }
}
