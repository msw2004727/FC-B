// M-052：新版本更新提示與安全重載（照 A `app.js:1148-1272`）
// - 檢查彈窗開啟、表單輸入編輯中、非安全主頁等狀態
// - 不安全時不自動重載，改顯示 A 的 `#sw-reload-deferred-prompt`（「有新版本可用／現在更新／稍後」）
// - 視覺特效在 update-prompt-fx（動態 import）。載入失敗就維持這份舊外觀，不得讓提示框消失。

import { toast } from '@/ui/Toast';
import { isSubmitting } from './submit-guard';

const SAFE_PATHS = new Set(['/', '/activities', '/teams', '/profile']);

const MODAL_OPEN_SELECTOR = [
  '.modal.open',
  '.modal-overlay.open',
  '#modal-overlay.open',
  '#app-confirm-modal.open',
  '#uid-qr-modal.open',
  '#scan-result-modal.open',
  '#scan-family-modal.open',
  '#mobile-line-login-hint-modal.open',
  '#pwa-android-modal.open',
  '#pwa-ios-modal.open',
  '.pwa-modal-overlay.open',
  '.pwa-modal-overlay.show',
  '.pwa-modal-overlay.visible',
  '#create-event-type-sheet',
  '.edu-session-form-overlay',
  '.edu-cp-form-v2',
  '.ui-modal-backdrop',
  '[role="dialog"][aria-modal="true"]',
].join(',');

export interface ReloadSafetyDecision {
  safe: boolean;
  reason?: string;
}

export interface ReloadSafetyOptions {
  ignoreModalSafety?: boolean;
  ignorePageSafety?: boolean;
  doc?: Document | null;
  currentPath?: string;
}

/** 照 A `_canSafelyReloadForSwUpdate`（`app.js:1140-1200`）檢查目前是否可安全重載。 */
export function evaluateReloadSafety(options: ReloadSafetyOptions = {}): ReloadSafetyDecision {
  const doc = options.doc !== undefined
    ? options.doc
    : typeof document !== 'undefined'
      ? document
      : null;

  if (!doc) return { safe: true };

  if (doc.body?.classList?.contains('image-cropper-open')) {
    return { safe: false, reason: 'image-cropper-open' };
  }

  if (!options.ignoreModalSafety) {
    const uidQrModal = doc.getElementById('uid-qr-modal');
    if (uidQrModal && uidQrModal.style?.display && uidQrModal.style.display !== 'none') {
      return { safe: false, reason: 'modal-open' };
    }
    if (doc.querySelector(MODAL_OPEN_SELECTOR)) {
      return { safe: false, reason: 'modal-open' };
    }
  }

  const profileInfoEdit = doc.getElementById('profile-info-edit');
  if (profileInfoEdit && profileInfoEdit.style.display !== 'none') {
    return { safe: false, reason: 'profile-editing' };
  }

  // 焦點正在表單輸入元件且有內容，或頁面標記 dirty 時視為編輯中
  const active = doc.activeElement;
  if (
    active &&
    (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')
  ) {
    return { safe: false, reason: 'form-editing' };
  }

  if (isSubmitting() || doc.querySelector('[data-form-dirty="true"], [data-submitting="true"]')) {
    return { safe: false, reason: 'write-pending' };
  }

  if (!options.ignorePageSafety) {
    const rawPath =
      options.currentPath ??
      (typeof window !== 'undefined' ? window.location.pathname : '/');
    const cleanPath = rawPath.split('?')[0]?.split('#')[0] || '/';
    if (!SAFE_PATHS.has(cleanPath)) {
      return { safe: false, reason: 'unsafe-page' };
    }
  }

  return { safe: true };
}

let promptShown = false;
let pendingReloadFn: (() => void) | null = null;
// 強制提示框顯示期間收到的「SW 有新版等待中」重載函式；強制提示收掉時用它還原一般提示。
let deferredSwReloadFn: (() => void) | null = null;
let promptCleanup: (() => void) | undefined;

export interface SwReloadPromptOptions {
  /** 強制更新：不提供「稍後」。已顯示的一般提示框會被升級，已是強制則維持強制。 */
  forced?: boolean;
}

const PROMPT_CSS = [
  'position:fixed',
  'left:50%',
  'bottom:calc(72px + env(safe-area-inset-bottom, 0px))',
  'transform:translateX(-50%)',
  'z-index:100000',
  'width:min(420px, calc(100vw - 32px))',
  'background:#111827',
  'color:#fff',
  'border:1px solid rgba(255,255,255,.16)',
  'border-radius:12px',
  'box-shadow:0 16px 40px rgba(0,0,0,.28)',
  'padding:12px',
  'display:flex',
  'align-items:center',
  'gap:10px',
  'font-size:14px',
  'line-height:1.35',
  'opacity:0',
].join(';');

const NOW_BUTTON_HTML =
  '<button type="button" data-sw-reload-now style="' +
    'border:0;border-radius:8px;background:#0d9488;color:#fff;' +
    'font-weight:700;padding:8px 10px;cursor:pointer;white-space:nowrap' +
  '">現在更新</button>';

const LATER_BUTTON_HTML =
  '<button type="button" data-sw-reload-later aria-label="稍後" style="' +
    'border:0;border-radius:8px;background:rgba(255,255,255,.12);color:#fff;' +
    'font-weight:700;padding:8px 9px;cursor:pointer' +
  '">稍後</button>';

function detachPrompt(): void {
  const cleanup = promptCleanup;
  promptCleanup = undefined;
  cleanup?.();
  if (typeof document !== 'undefined') {
    document.getElementById('sw-reload-deferred-prompt')?.remove();
  }
  promptShown = false;
  pendingReloadFn = null;
  deferredSwReloadFn = null;
}

/** 收掉強制更新提示框。一般「有新版本」提示（沒有 data-mode=forced）留著。 */
export function dismissForcedUpdatePrompt(): void {
  if (typeof document === 'undefined') return;
  const prompt = document.getElementById('sw-reload-deferred-prompt');
  if (!prompt || prompt.dataset.mode !== 'forced') return;
  const swFn = deferredSwReloadFn;
  detachPrompt();
  // 強制期間若有 SW 新版等待中，收掉強制框後還原成一般提示（含「稍後」）。
  if (swFn) showSwReloadPrompt(swFn);
}

function upgradeToForced(prompt: HTMLElement): void {
  prompt.dataset.mode = 'forced';
  prompt.querySelectorAll('[data-sw-reload-later]').forEach((node) => {
    node.remove();
  });
}

/** 照 A `_showSwReloadPrompt`（`app.js:1203-1264`）顯示底部新版本更新提示框。 */
export function showSwReloadPrompt(
  onReload: () => void,
  reason?: string,
  opts?: SwReloadPromptOptions,
): void {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc || !doc.body) return;
  const wantForced = opts?.forced === true;
  const existing = doc.getElementById('sw-reload-deferred-prompt');
  if (promptShown && existing) {
    if (existing.dataset.mode === 'forced' && !wantForced) {
      // 強制提示框已顯示：一般（SW 等待中）呼叫不得換掉強制路徑的重載函式，記下待還原。
      deferredSwReloadFn = onReload;
      return;
    }
    // 一般提示升級成強制：舊的重載函式留著，強制提示收掉時還原。
    if (wantForced && existing.dataset.mode !== 'forced' && pendingReloadFn) deferredSwReloadFn = pendingReloadFn;
    pendingReloadFn = onReload;
    // 強制優先：後來的一般呼叫不得把「稍後」加回去。
    if (wantForced || existing.dataset.mode === 'forced') upgradeToForced(existing);
    return;
  }
  pendingReloadFn = onReload;
  promptShown = true;

  const prompt = doc.createElement('div');
  prompt.id = 'sw-reload-deferred-prompt';
  prompt.setAttribute('role', 'status');
  prompt.setAttribute('aria-live', 'polite');
  if (reason) prompt.dataset.reason = reason;
  if (wantForced) prompt.dataset.mode = 'forced';
  // 先用舊外觀、opacity 0。特效套上後才淡入；import 失敗則把 opacity 還原，舊外觀留著。
  prompt.style.cssText = PROMPT_CSS;

  prompt.innerHTML =
    '<div style="flex:1;min-width:0">' +
      '<div style="font-weight:700;margin-bottom:2px">有新版本可用</div>' +
      '<div style="opacity:.84">完成目前操作後會自動更新。</div>' +
    '</div>' +
    NOW_BUTTON_HTML +
    (wantForced ? '' : LATER_BUTTON_HTML);

  prompt.querySelector('[data-sw-reload-now]')?.addEventListener('click', () => {
    // 使用者主動點「現在更新」：送出中不重載。
    if (isSubmitting() || doc.querySelector('[data-submitting="true"]')) {
      toast.show({ message: '目前操作尚未完成，稍後再更新', duration: 3000 });
      return;
    }
    const fn = pendingReloadFn ?? (() => location.reload());
    detachPrompt();
    fn();
  });

  prompt.querySelector('[data-sw-reload-later]')?.addEventListener('click', () => {
    detachPrompt();
  });

  doc.body.appendChild(prompt);

  void import('./update-prompt-fx').then(
    (m) => {
      if (!prompt.isConnected) return;
      try {
        promptCleanup = m.applyUpdatePromptFx(prompt);
      } catch {
        prompt.style.opacity = '1';
      }
    },
    () => {
      if (prompt.isConnected) prompt.style.opacity = '1';
    },
  );
}

/** 若目前安全則立即執行 reload，否則顯示「有新版本可用」提示框延後更新。 */
export function requestSafeReload(
  reload: () => void,
  options: ReloadSafetyOptions = {},
): { reloaded: boolean; reason?: string } {
  const decision = evaluateReloadSafety(options);
  if (decision.safe) {
    reload();
    return { reloaded: true };
  }
  showSwReloadPrompt(reload, decision.reason);
  return { reloaded: false, reason: decision.reason };
}

export function _resetReloadSafetyForTest(): void {
  detachPrompt();
  if (typeof document === 'undefined') return;
  document.querySelectorAll('style[data-sw-reload-fx-instance]').forEach((node) => {
    node.remove();
  });
}
