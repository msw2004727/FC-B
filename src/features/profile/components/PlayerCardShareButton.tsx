/**
 * T-092「分享球員卡」：產圖與分享模組不進首屏，掛載後閒置時（或按鈕 pointerdown）預先載入並預載字型，
 * 縮短點擊到 navigator.share 的時間（iOS 使用者手勢有時效）。PNG 與 DOM 卡片用同一份模型。
 * 分享路徑判斷見 data/player-card-share.ts：
 * - LINE 內建瀏覽器：覆蓋層長按存圖。
 * - 系統分享被拒（NotAllowedError 等）：覆蓋層放「分享」「儲存」按鈕，第二次點擊再分享同一張 PNG
 *   （提示不寫「長按」，桌機沒有長按）。
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { resolvePlayerCardTheme, type PlayerCardModel } from '../data/player-card-model';
import type { OverlayState, PlayerCardImageOverlay as OverlayComponent } from './PlayerCardImageOverlay';

type ShareModules = [
  typeof import('../data/player-card-canvas'),
  typeof import('../data/player-card-share'),
];

let modulesPromise: Promise<ShareModules> | null = null;

/**
 * 預先載入產圖與分享模組、qrcode 套件（只載模組不產碼），並預載自架字型；
 * 重複呼叫共用同一次載入，失敗時下次重試。qrcode 載不到不影響（產圖時 QR 失敗就不放）。
 */
export function preloadPlayerCardShare(): Promise<ShareModules> {
  if (!modulesPromise) {
    const pending = Promise.all([
      import('../data/player-card-canvas'),
      import('../data/player-card-share'),
      import('qrcode').catch(() => null),
    ]).then(([canvasMod, shareMod]): ShareModules => {
      const mods: ShareModules = [canvasMod, shareMod];
      const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
      mods[0].ensurePlayerCardFonts(fonts).catch(() => undefined);
      return mods;
    });
    modulesPromise = pending;
    pending.catch(() => {
      if (modulesPromise === pending) modulesPromise = null;
    });
  }
  return modulesPromise;
}

/** 測試用：清掉預載快取。 */
export function _resetPlayerCardPreloadForTest(): void {
  modulesPromise = null;
}

function scheduleIdle(callback: () => void): () => void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 4000 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = setTimeout(callback, 1500);
  return () => clearTimeout(id);
}

function preloadQuietly(): void {
  preloadPlayerCardShare().catch(() => undefined);
}

export function PlayerCardShareButton({
  model,
  qrText = null,
}: {
  model: PlayerCardModel;
  /** PNG 左下 QR 內容（本人個人名片分享網址）；null＝不放 QR。 */
  qrText?: string | null;
}): JSX.Element {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [overlay, setOverlay] = useState<{
    state: OverlayState;
    shareMod: ShareModules[1];
    Component: typeof OverlayComponent;
  } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const cancel = scheduleIdle(preloadQuietly);
    return () => {
      mountedRef.current = false;
      cancel();
    };
  }, []);

  const handleShare = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const [canvasMod, shareMod] = await preloadPlayerCardShare();
      const blob = await canvasMod.renderPlayerCardPng(model, resolvePlayerCardTheme(), {
        title: t('profile.playerCard.title'),
        scheduled: t('profile.playerCard.scheduled'),
        completed: t('profile.playerCard.completed'),
        attend: t('profile.playerCard.attendRate'),
        clubs: t('profile.playerCard.clubs'),
      }, canvasMod.browserRenderDeps, { qrText });
      const outcome = await shareMod.sharePlayerCardBlob(blob, {
        nav: navigator,
        download: shareMod.browserDownload,
      });
      if (outcome === 'overlay' || outcome === 'retry') {
        // 覆蓋層（含 preact/compat）需要時才載入，見 PlayerCardImageOverlay.tsx 檔頭。
        const [overlayMod, src] = await Promise.all([
          import('./PlayerCardImageOverlay'),
          shareMod.blobToDataUrl(blob),
        ]);
        if (mountedRef.current) {
          setOverlay({
            state: { mode: outcome === 'overlay' ? 'line' : 'retry', src, blob },
            shareMod,
            Component: overlayMod.PlayerCardImageOverlay,
          });
        }
      }
    } catch (err) {
      console.warn('[player-card] share failed', err);
      toast.show({ message: t('profile.playerCard.shareFailed') });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        class="player-card-share-btn"
        id="player-card-share-btn"
        disabled={busy}
        aria-busy={busy ? 'true' : undefined}
        onPointerDown={preloadQuietly}
        onClick={() => {
          handleShare().catch(() => {
            /* handleShare 已自行收尾 */
          });
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        {t('profile.playerCard.share')}
      </button>
      {overlay && (
        <overlay.Component
          state={overlay.state}
          shareMod={overlay.shareMod}
          onClose={() => setOverlay(null)}
        />
      )}
    </>
  );
}
