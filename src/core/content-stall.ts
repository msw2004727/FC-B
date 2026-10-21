// M-051、U-019：內容卡住提示與逾時重試（照 A `index.html:1732-1783`）
// - 首頁 15 秒、其他頁 6 秒內若頁面內容未就緒，顯示「首頁載入尚未完成／連線暫時不穩定」＋「重試載入首頁／再試一次」
// - U-019：點擊重試時優先只重試當前頁程式與資料，不強制整頁 reload（若無重試 handler 才退回 location.reload）

let stallTimer: ReturnType<typeof setTimeout> | null = null;
let contentReady = false;
let customRetryHandler: (() => void | Promise<void>) | null = null;

export function markContentReady(): void {
  contentReady = true;
  if (stallTimer !== null) {
    clearTimeout(stallTimer);
    stallTimer = null;
  }
  if (typeof document !== 'undefined') {
    document.getElementById('content-stall-hint')?.remove();
  }
}

export function setContentStallRetryHandler(handler: (() => void | Promise<void>) | null): void {
  customRetryHandler = handler;
}

export function showContentStallHint(
  homeRetry = false,
  onRetry?: () => void | Promise<void>,
): void {
  if (typeof document === 'undefined' || !document.body) return;
  const existing = document.getElementById('content-stall-hint');
  if (existing) {
    if (!homeRetry || existing.dataset.homeRetry === 'true') return;
    existing.remove();
  }

  const el = document.createElement('div');
  el.id = 'content-stall-hint';
  if (homeRetry) el.dataset.homeRetry = 'true';
  el.setAttribute('role', 'alert');
  el.setAttribute(
    'style',
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
      'background:rgba(0,0,0,.85);color:#fff;padding:12px 20px;border-radius:12px;' +
      'font-size:14px;z-index:9999;text-align:center;max-width:420px;white-space:nowrap;' +
      'box-shadow:0 4px 20px rgba(0,0,0,.3);',
  );
  el.innerHTML =
    '<div style="margin-bottom:8px">' +
    (homeRetry ? '首頁載入尚未完成' : '連線暫時不穩定') +
    '</div>' +
    '<button id="stall-reload-btn" type="button" style="' +
    'background:#0d9488;color:#fff;border:none;padding:8px 24px;' +
    'border-radius:8px;font-size:14px;font-weight:600;cursor:pointer' +
    '">' +
    (homeRetry ? '重試載入首頁' : '再試一次') +
    '</button>' +
    (homeRetry ? '' : '<div style="margin-top:6px;font-size:11px;opacity:.7">或稍後再開啟 APP</div>');

  document.body.appendChild(el);
  const btn = document.getElementById('stall-reload-btn');
  btn?.addEventListener('click', () => {
    el.remove();
    const handler = onRetry ?? customRetryHandler;
    if (handler) {
      Promise.resolve()
        .then(() => handler())
        .catch((err: unknown) => {
          console.warn('[Stall] retry handler failed:', err);
        });
      return;
    }
    if (typeof location !== 'undefined' && typeof location.reload === 'function') {
      location.reload();
    }
  });
}

function isCurrentRouteContentRendered(): boolean {
  if (contentReady) return true;
  if (typeof document === 'undefined') return true;
  const main = document.querySelector('.app-main');
  if (!main) return false;
  // 若已有實際頁面節點且不在全頁 loading 狀態，視為已就緒
  const activePage = main.querySelector('.page.active, .not-found');
  if (!activePage) return false;
  if (activePage.getAttribute('aria-busy') === 'true') return false;
  return true;
}

export interface StartContentStallCheckOptions {
  path?: string;
  stallMs?: number;
  onRetry?: () => void | Promise<void>;
}

/** 照 A `_startContentStallCheck`（首頁 15000ms，其他頁 6000ms）。 */
export function startContentStallCheck(options: StartContentStallCheckOptions = {}): () => void {
  if (stallTimer !== null) {
    clearTimeout(stallTimer);
    stallTimer = null;
  }
  contentReady = false;
  const path = options.path ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const isHome = path === '/' || path === '';
  const stallMs = options.stallMs ?? (isHome ? 15_000 : 6_000);

  stallTimer = setTimeout(() => {
    stallTimer = null;
    if (isCurrentRouteContentRendered()) return;
    showContentStallHint(isHome, options.onRetry);
  }, stallMs);

  return () => {
    if (stallTimer !== null) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  };
}

export function _resetContentStallForTest(): void {
  if (stallTimer !== null) {
    clearTimeout(stallTimer);
    stallTimer = null;
  }
  contentReady = false;
  customRetryHandler = null;
  if (typeof document !== 'undefined') {
    document.getElementById('content-stall-hint')?.remove();
  }
}
