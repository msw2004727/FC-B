/**
 * T-092「分享球員卡」：產圖與分享模組不進首屏，掛載後閒置時（或按鈕 pointerdown）預先載入並預載字型，
 * 縮短點擊到 navigator.share 的時間（iOS 使用者手勢有時效）。PNG 與 DOM 卡片用同一份模型。
 * 分享路徑判斷見 data/player-card-share.ts：
 * - LINE 內建瀏覽器：覆蓋層長按存圖。
 * - 系統分享被拒（NotAllowedError 等）：覆蓋層放「分享」「儲存」按鈕，第二次點擊再分享同一張 PNG
 *   （提示不寫「長按」，桌機沒有長按）。
 */
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { resolvePlayerCardTheme, type PlayerCardModel } from '../data/player-card-model';

type ShareModules = [
  typeof import('../data/player-card-canvas'),
  typeof import('../data/player-card-share'),
];

let modulesPromise: Promise<ShareModules> | null = null;
/** 覆蓋層「分享」要在點擊內同步拿到已載入的模組。 */
let loadedModules: ShareModules | null = null;

/** 預先載入產圖與分享模組，並預載自架字型；重複呼叫共用同一次載入，失敗時下次重試。 */
export function preloadPlayerCardShare(): Promise<ShareModules> {
  if (!modulesPromise) {
    const pending = Promise.all([
      import('../data/player-card-canvas'),
      import('../data/player-card-share'),
    ]).then((mods): ShareModules => {
      loadedModules = mods;
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
  loadedModules = null;
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

type OverlayMode = 'line' | 'retry';

interface OverlayState {
  mode: OverlayMode;
  src: string;
  blob: Blob;
}

function PlayerCardImageOverlay({
  state,
  onClose,
}: {
  state: OverlayState;
  onClose: () => void;
}): JSX.Element | null {
  const t = useT();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const releaseRef = useRef<(() => void) | null>(null);
  const firstBtnRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((): void => {
    const release = releaseRef.current;
    releaseRef.current = null;
    release?.();
    onCloseRef.current();
  }, []);

  useEffect(() => {
    releaseRef.current = pushOverlay(() => {
      releaseRef.current = null;
      onCloseRef.current();
      return true;
    });
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    firstBtnRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const release = releaseRef.current;
      releaseRef.current = null;
      release?.();
    };
  }, [close]);

  const shareAgain = (): void => {
    // 不得先 await 任何東西：navigator.share 要在這次點擊內同步呼叫，才吃得到新的使用者手勢。
    const shareMod = loadedModules?.[1];
    if (!shareMod) return;
    const file = shareMod.makePlayerCardFile(state.blob);
    shareMod.retrySharePlayerCardFile(navigator, file).then((outcome) => {
      if (outcome === 'shared') close();
      else if (outcome === 'failed') toast.show({ message: t('profile.playerCard.shareFailed') });
    }, () => undefined);
  };

  const save = (): void => {
    const shareMod = loadedModules?.[1];
    shareMod?.browserDownload(state.blob, shareMod.PLAYER_CARD_FILE_NAME);
  };

  if (typeof document === 'undefined') return null;
  const retry = state.mode === 'retry';
  return createPortal(
    <div class="legacy-ui">
      <div
        class="player-card-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={t('profile.playerCard.share')}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <img src={state.src} alt={t('profile.playerCard.title')} />
        <div class="player-card-overlay-hint">
          {retry ? t('profile.playerCard.shareOrSave') : t('profile.playerCard.longPressSave')}
        </div>
        <div class="player-card-overlay-actions">
          {retry && (
            <button
              ref={firstBtnRef}
              type="button"
              class="player-card-overlay-btn is-primary"
              id="player-card-share-again"
              onClick={shareAgain}
            >
              {t('profile.playerCard.shareAgain')}
            </button>
          )}
          {retry && (
            <button
              type="button"
              class="player-card-overlay-btn"
              id="player-card-save"
              onClick={save}
            >
              {t('profile.playerCard.save')}
            </button>
          )}
          <button
            ref={retry ? undefined : firstBtnRef}
            type="button"
            class="player-card-overlay-btn player-card-overlay-close"
            onClick={close}
          >
            {t('profile.playerCard.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function PlayerCardShareButton({ model }: { model: PlayerCardModel }): JSX.Element {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
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
      });
      const outcome = await shareMod.sharePlayerCardBlob(blob, {
        nav: navigator,
        download: shareMod.browserDownload,
      });
      if (outcome === 'overlay' || outcome === 'retry') {
        const src = await shareMod.blobToDataUrl(blob);
        if (mountedRef.current) {
          setOverlay({ mode: outcome === 'overlay' ? 'line' : 'retry', src, blob });
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
        <PlayerCardImageOverlay state={overlay} onClose={() => setOverlay(null)} />
      )}
    </>
  );
}
