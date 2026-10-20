// M-047：換頁載入提示與逾時（照 A `app.js:1466-1530`、`js/core/navigation.js:88-96`）
// - 超過 220ms 顯示「正在載入…」（最少顯示 280ms）
// - 3.2 秒改為「網路較慢，資料仍在載入中...」
// - 超過 10 秒提示「網路較慢，頁面暫時無法開啟，請稍後再試」（B 不中斷下載，晚到仍顯示）

import {
  ROUTE_ACTIVITIES_TIMEOUT_MSG,
  ROUTE_LOAD_FAILED_MSG,
  ROUTE_TIMEOUT_MSG,
} from './unavailable';

const PATH_TO_PAGE_LABEL: Readonly<Record<string, string>> = {
  '/': '首頁',
  '/activities': '活動列表',
  '/teams': '俱樂部列表',
  '/tournaments': '賽事專區',
  '/profile': '個人資料',
  '/inbox': '我的信箱',
  '/my-activities': '我的活動',
  '/checkin': '掃碼簽到',
  '/profile/qr': 'QR Code',
};

export function getRouteLoadingCopy(pathOrPageId: string): string {
  if (!pathOrPageId) return '資料載入中...';
  const clean = pathOrPageId.split('?')[0]?.split('#')[0] || '/';
  const direct = PATH_TO_PAGE_LABEL[clean];
  if (direct) return `正在載入${direct}...`;
  if (/^\/events\/[^/]+/.test(clean) || /^\/activities\/[^/]+/.test(clean)) {
    return '正在載入活動詳情...';
  }
  if (/^\/teams\/[^/]+/.test(clean)) {
    return '正在載入俱樂部詳情...';
  }
  if (/^\/tournaments\/[^/]+/.test(clean)) {
    return '正在載入賽事詳情...';
  }
  if (/^\/profile\/[^/]+/.test(clean)) {
    return '正在載入用戶資料...';
  }
  return '資料載入中...';
}

export function getRouteFailureToast(pathOrPageId: string, err: unknown = null): string {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
  const isTimeout = code === ROUTE_STEP_TIMEOUT;
  if (isTimeout) {
    if (
      pathOrPageId === 'page-activities' ||
      pathOrPageId === '/activities' ||
      pathOrPageId.startsWith('/activities') ||
      pathOrPageId.startsWith('/events/')
    ) {
      return ROUTE_ACTIVITIES_TIMEOUT_MSG;
    }
    return ROUTE_TIMEOUT_MSG;
  }
  return ROUTE_LOAD_FAILED_MSG;
}

/** A 的換頁逾時錯誤代碼與時間（`js/core/navigation.js`）。 */
export const ROUTE_STEP_TIMEOUT = 'route-step-timeout';
export const ROUTE_TIMEOUT_MS = 10_000;

let routeLoadingSeq = 0;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let slowTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let shownAt = 0;

function ensureStatusHintElement(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  let el = document.getElementById('status-hint');
  if (!el) {
    el = document.createElement('div');
    el.id = 'status-hint';
    el.className = 'status-hint';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-busy', 'true');
    el.style.display = 'none';
    // 照 A index.html #status-hint 的標記。
    el.innerHTML = '<span class="status-hint__spinner" aria-hidden="true"></span><span class="status-hint__text" data-status-hint-text>正在載入資料中..</span>';
    // A 的 .status-hint 樣式限定在 .legacy-ui 內，外面包一層才吃得到。
    const wrapper = document.createElement('div');
    wrapper.className = 'legacy-ui';
    wrapper.appendChild(el);
    document.body.appendChild(wrapper);
  }
  return el;
}

export interface BeginRouteLoadingOptions {
  path?: string;
  immediate?: boolean;
  delayMs?: number;
  minVisibleMs?: number;
  slowMs?: number;
}

/** 照 A `_beginRouteLoading`（`app.js:1474-1522`）。 */
export function beginRouteLoading(options: BeginRouteLoadingOptions = {}): number {
  const {
    path = '',
    immediate = false,
    delayMs = 220,
    minVisibleMs = 280,
    slowMs = 3200,
  } = options;

  const overlay = ensureStatusHintElement();
  if (!overlay) return 0;

  const seq = ++routeLoadingSeq;
  if (showTimer) clearTimeout(showTimer);
  if (slowTimer) clearTimeout(slowTimer);
  if (hideTimer) clearTimeout(hideTimer);
  showTimer = null;
  slowTimer = null;
  hideTimer = null;

  const textEl = overlay.querySelector('[data-status-hint-text]');
  const copy = getRouteLoadingCopy(path);

  const show = (): void => {
    if (seq !== routeLoadingSeq) return;
    if (textEl) textEl.textContent = copy;
    overlay.style.display = 'inline-flex';
    overlay.classList.add('show');
    shownAt = Date.now();
    slowTimer = setTimeout(() => {
      if (seq !== routeLoadingSeq) return;
      if (textEl) textEl.textContent = '網路較慢，資料仍在載入中...';
    }, slowMs);
  };

  const shouldShowImmediately = immediate || overlay.style.display !== 'none';
  if (shouldShowImmediately) {
    show();
  } else {
    showTimer = setTimeout(show, delayMs);
  }

  overlay.dataset.minVisibleMs = String(minVisibleMs);
  return seq;
}

/** 照 A `_endRouteLoading`。 */
export function endRouteLoading(seq?: number): void {
  const targetSeq = seq ?? routeLoadingSeq;
  if (!targetSeq || targetSeq !== routeLoadingSeq) return;
  const overlay = typeof document !== 'undefined' ? document.getElementById('status-hint') : null;
  if (showTimer) clearTimeout(showTimer);
  if (slowTimer) clearTimeout(slowTimer);
  if (hideTimer) clearTimeout(hideTimer);
  showTimer = null;
  slowTimer = null;
  hideTimer = null;

  if (!overlay || overlay.style.display === 'none') return;

  const minVisibleMs = Number(overlay.dataset.minVisibleMs || 280);
  const elapsed = shownAt ? Date.now() - shownAt : minVisibleMs;
  const remaining = Math.max(0, minVisibleMs - elapsed);

  const hide = (): void => {
    if (targetSeq !== routeLoadingSeq) return;
    overlay.classList.remove('show');
    overlay.style.display = 'none';
    shownAt = 0;
  };

  if (remaining > 0) {
    hideTimer = setTimeout(hide, remaining);
  } else {
    hide();
  }
}

export function _resetRouteLoadingForTest(): void {
  routeLoadingSeq = 0;
  if (showTimer) clearTimeout(showTimer);
  if (slowTimer) clearTimeout(slowTimer);
  if (hideTimer) clearTimeout(hideTimer);
  showTimer = null;
  slowTimer = null;
  hideTimer = null;
  shownAt = 0;
  if (typeof document !== 'undefined') {
    document.getElementById('status-hint')?.parentElement?.remove();
  }
}
