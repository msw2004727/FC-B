// 只在判斷得出是 LINE Mini App 時，首屏之後的閒置時間預先 liff.init。
// 一般瀏覽器與 LINE 內建瀏覽器（UA 有 Line/ 但沒有 LIFF）不進這裡，不會下載 SDK（T-041）。

import { isLikelyMiniAppUserAgent } from './login-redirect';

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function startMiniAppLiffPreinit(userAgent?: string): () => void {
  const ua = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent || '');
  if (!isLikelyMiniAppUserAgent(ua)) return () => undefined;
  if (typeof window === 'undefined') return () => undefined;

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idleId: number | null = null;

  const run = (): void => {
    if (cancelled) return;
    void import('./liff-init')
      .then((mod) => {
        if (cancelled) return undefined;
        return mod.ensureLiffInit();
      })
      .catch(() => undefined);
  };

  const idleWindow = window as IdleWindow;
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleId = idleWindow.requestIdleCallback(run, { timeout: 2000 });
  } else {
    timer = setTimeout(run, 0);
  }

  return () => {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
    if (idleId !== null && typeof idleWindow.cancelIdleCallback === 'function') {
      idleWindow.cancelIdleCallback(idleId);
    }
  };
}
