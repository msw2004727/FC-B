// 首頁「加到主畫面」浮球（延後 chunk）：站長 2026-11-25 看過第三版預覽同意，顧問 §3.733 放行施工。
// 主程式只排程下載本檔（PwaInstallFabLoader），顯示判斷、浮球、安裝提示泡泡都在這裡。
import './pwa-install-fab.css';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { useLocation } from 'preact-iso';
import { t, useT } from '@/i18n/i18n';
import {
  clearDeferredInstallPrompt,
  getDeferredInstallPrompt,
  initPwaInstallListener,
  isStandalonePwa,
} from '@/features/pwa/pwa-install';
import type { PwaModalStep, PwaModalsProps } from '@/features/pwa/PwaModals';

/** 與 profile/web-push/store.ts 的 WEB_PUSH_STORE_KEY 相同（測試釘住）；不 import，避免把推播模組拉進首頁分塊。 */
export const WEB_PUSH_RECORD_KEY = 'fcb:webpush:v1';

/** 聯繫站長提示約在掛載後 1～7 秒；本球掛載約晚 1.5 秒，再等 6 秒出提示就排在它之後。 */
export const PWA_FAB_HINT_DELAY_MS = 6000;

export interface PwaFabEnv {
  standalone: boolean;
  hasPushRecord: boolean;
  mobile: boolean;
  hasInstallEvent: boolean;
}

export type PwaFabDecision = 'show' | 'hide' | 'wait-install-event';

/**
 * 顯示判斷（純函式）：站長 2026-11-26「點了不消失，確認開了推播才隱藏」（取代原本已安裝／點過就收）。
 * - 這個瀏覽器已開推播：不顯示。
 * - 從主畫面 App 開啟（還沒開推播）：顯示，點了帶去「我的」開通知。
 * - 手機（含 LINE 內建瀏覽器）：顯示，點了開教學或原生安裝。
 * - 電腦一般分頁：只有攔到原生安裝事件（一鍵安裝）才顯示；還沒攔到就等事件。
 */
export function decidePwaFab(env: PwaFabEnv): PwaFabDecision {
  if (env.hasPushRecord) return 'hide';
  if (env.standalone || env.mobile || env.hasInstallEvent) return 'show';
  return 'wait-install-event';
}

/** 手機或平板：Android／iPhone／iPad／iPod／Mobile，或觸控的 Macintosh UA（iPad）。 */
export function isMobileUa(ua: string, maxTouchPoints: number): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

function hasPushRecord(): boolean {
  try {
    return Boolean(localStorage.getItem(WEB_PUSH_RECORD_KEY));
  } catch {
    return false;
  }
}

export function readPwaFabEnv(): PwaFabEnv {
  return {
    standalone: isStandalonePwa(),
    hasPushRecord: hasPushRecord(),
    mobile: isMobileUa(navigator.userAgent || '', navigator.maxTouchPoints ?? 0),
    hasInstallEvent: Boolean(getDeferredInstallPrompt()),
  };
}

/** 該顯示時呼叫 onShow（電腦版等到安裝事件才呼叫）；回傳收尾函式。 */
export function whenPwaFabShouldShow(onShow: () => void): () => void {
  const decision = decidePwaFab(readPwaFabEnv());
  if (decision === 'show') onShow();
  if (decision !== 'wait-install-event') return () => undefined;
  initPwaInstallListener();
  const onEvent = (): void => {
    removeEventListener('beforeinstallprompt', onEvent);
    onShow();
  };
  addEventListener('beforeinstallprompt', onEvent);
  return () => removeEventListener('beforeinstallprompt', onEvent);
}

/** 手機加到主畫面圖示：手機外框＋向下箭頭。 */
function InstallIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M12 7.5v7" />
      <path d="m9 11.5 3 3 3-3" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 安裝提示泡泡（同聯繫站長提示）：浮球抖兩輪（減少動態時不抖）、泡泡 6 秒；點泡泡＝點浮球，點其他地方關閉。
 * 聯繫站長泡泡還在就跳過這次，兩個泡泡不同時出現。回傳收尾函式。
 */
export function showPwaFabHint(text = t('home.pwaFab.hint')): (() => void) | undefined {
  const fab = document.querySelector<HTMLElement>('.pwa-install-fab');
  if (!fab?.isConnected || document.querySelector('.contact-owner-fab-hint')) return undefined;
  const bubble = document.createElement('div');
  bubble.className = 'pwa-install-fab-hint';
  bubble.setAttribute('role', 'status');
  bubble.textContent = text;
  const onPointerDown = (e: Event): void => {
    if (!bubble.contains(e.target as Node)) close();
  };
  const stopShake = (): void => fab.classList.remove('is-shaking');
  const timers = [setTimeout(stopShake, 4800), setTimeout(() => close(), 6000)];
  function close(): void {
    timers.forEach(clearTimeout);
    stopShake();
    bubble.remove();
    document.removeEventListener('pointerdown', onPointerDown, true);
  }
  bubble.addEventListener('click', () => {
    close();
    fab.click();
  });
  document.body.appendChild(bubble);
  if (!prefersReducedMotion()) fab.classList.add('is-shaking');
  document.addEventListener('pointerdown', onPointerDown, true);
  return close;
}

/** 聯繫站長泡泡關掉後，隔這麼久再出安裝泡泡，免得兩個泡泡像同時閃。 */
export const PWA_FAB_HINT_GAP_MS = 600;

/**
 * 每次回首頁出一次安裝泡泡，與聯繫站長泡泡錯開（顧問 §3.752：冷載入時聯繫站長提示 chunk 晚到，原本直接跳過這次）。
 * - 聯繫站長泡泡還在：等它關掉，隔 PWA_FAB_HINT_GAP_MS 再出。
 * - 安裝泡泡顯示中聯繫站長泡泡才出現：先收起安裝泡泡，等聯繫站長關掉再補出。
 * 只看 body 直屬子節點的增減（兩個泡泡都直接掛在 body）。回傳收尾函式。
 */
export function showPwaFabHintWhenFree(text?: string): () => void {
  const contactOpen = (): boolean => Boolean(document.querySelector('.contact-owner-fab-hint'));
  let stopHint: (() => void) | undefined;
  let gap: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | undefined;
  const finish = (): void => {
    observer?.disconnect();
    clearTimeout(gap);
  };
  const tryShow = (): void => {
    gap = undefined;
    if (contactOpen()) return;
    stopHint = showPwaFabHint(text);
    if (!stopHint) finish();
  };
  const onChange = (): void => {
    if (contactOpen()) {
      clearTimeout(gap);
      gap = undefined;
      if (document.querySelector('.pwa-install-fab-hint')) {
        stopHint?.();
        stopHint = undefined;
      } else if (stopHint) {
        finish();
      }
      return;
    }
    if (stopHint) {
      if (!document.querySelector('.pwa-install-fab-hint')) finish();
      return;
    }
    if (!gap) gap = setTimeout(tryShow, PWA_FAB_HINT_GAP_MS);
  };
  if (contactOpen()) {
    observer = new MutationObserver(onChange);
    observer.observe(document.body, { childList: true });
  } else {
    stopHint = showPwaFabHint(text);
    if (stopHint) {
      observer = new MutationObserver(onChange);
      observer.observe(document.body, { childList: true });
    }
  }
  return () => {
    finish();
    stopHint?.();
  };
}

type ModalsComponent = (props: PwaModalsProps) => JSX.Element | null;

/** 從主畫面 App 點浮球：到「我的」並直接展開通知區（ProfilePage 讀 ?open=line）。 */
export const PWA_FAB_PUSH_ROUTE = '/profile?open=line';

export function PwaInstallFab(): JSX.Element | null {
  const [step, setStep] = useState<PwaModalStep>('none');
  const [Modals, setModals] = useState<ModalsComponent | null>(null);
  const tr = useT();
  const { route } = useLocation();
  // 已裝好（主畫面 App 開啟，或這個分頁剛收到 appinstalled）：改成「開啟通知」，點了帶去開通知。
  const [standalone, setStandalone] = useState(() => readPwaFabEnv().standalone);

  useEffect(() => {
    let stop: (() => void) | undefined;
    const id = setTimeout(() => {
      stop = showPwaFabHintWhenFree(standalone ? t('home.pwaFab.pushHint') : undefined);
    }, PWA_FAB_HINT_DELAY_MS);
    return () => {
      clearTimeout(id);
      stop?.();
    };
  }, [standalone]);

  useEffect(() => {
    const onInstalled = (): void => setStandalone(true);
    addEventListener('appinstalled', onInstalled);
    return () => removeEventListener('appinstalled', onInstalled);
  }, []);

  if (typeof document === 'undefined') return null;

  const openGuide = async (): Promise<void> => {
    setStep('picker');
    if (Modals) return;
    try {
      const m = await import('@/features/pwa/PwaModals');
      setModals(() => m.PwaModals);
    } catch {
      setStep('none');
    }
  };

  // 點了不消失（站長 2026-11-26）：已安裝 App 帶去開通知；瀏覽器有原生安裝事件就跳原生視窗，否則開教學（電腦也開）。
  const onClick = (): void => {
    if (standalone) {
      route(PWA_FAB_PUSH_ROUTE);
      return;
    }
    const deferred = getDeferredInstallPrompt();
    if (deferred) {
      clearDeferredInstallPrompt();
      deferred.prompt().catch(() => undefined);
      deferred.userChoice.catch(() => undefined);
      return;
    }
    void openGuide();
  };

  return (
    <>
      {createPortal(
        <button
          type="button"
          class="pwa-install-fab"
          aria-label={tr(standalone ? 'home.pwaFab.pushLabel' : 'home.pwaFab.label')}
          onClick={onClick}
        >
          <span class="fab-gloss" aria-hidden="true" />
          <InstallIcon />
        </button>,
        document.body,
      )}
      {Modals ? <Modals step={step} onChangeStep={setStep} /> : null}
    </>
  );
}
