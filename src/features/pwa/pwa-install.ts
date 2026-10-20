// PWA 安裝狀態管理與剪貼簿工具（M-030、M-031、U-007）。
// 照 A `js/modules/pwa-install.js`。

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let listenerBound = false;

function handleBeforeInstallPrompt(e: Event): void {
  e.preventDefault();
  deferredInstallPrompt = e as BeforeInstallPromptEvent;
}

/** 綁定全域 beforeinstallprompt 事件，捕捉 Android Chrome 原生安裝提示。 */
export function initPwaInstallListener(): void {
  if (listenerBound || typeof window === 'undefined') return;
  listenerBound = true;
  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredInstallPrompt;
}

/** 測試用：設定或清除 deferredInstallPrompt。 */
export function _setDeferredInstallPromptForTest(prompt: BeforeInstallPromptEvent | null): void {
  deferredInstallPrompt = prompt;
}

/** U-007：偵測是否已在獨立 APP 模式（standalone）執行。 */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (
      typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches
    ) {
      return true;
    }
    const nav = window.navigator as Navigator & { standalone?: boolean };
    if (nav && nav.standalone === true) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** 偵測是否為 LINE 內建瀏覽器（照 A `/Line\//i.test(navigator.userAgent)`）。 */
export function isLineInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Line\//i.test(navigator.userAgent || '');
}

/** 複製文字到剪貼簿（優先 navigator.clipboard，退回 textarea execCommand）。 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fallback below */
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    document.body.removeChild(ta);
    return Boolean(ok);
  } catch {
    return false;
  }
}
