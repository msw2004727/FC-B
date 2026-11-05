/**
 * T-092 球員卡分享覆蓋層（LINE 長按存圖／系統分享被拒時再分享或儲存）。
 *
 * 獨立成檔、由 PlayerCardShareButton 在需要時才動態載入：本檔用到 preact/compat 的 createPortal，
 * 若留在 LegacyProfileHeader 的靜態 import 鏈上，所有 import LegacyAvatar 的測試（例如 LegacyIdentityCard）
 * 都會載入 compat，@testing-library/preact 偵測到 compat 後會把 fireEvent.change 一律改發 input 事件，
 * 連 file input（compat 本身不轉換）也被改掉，導致既有測試收不到 change。
 * （取代原本寫在 PlayerCardShareButton.tsx 內的覆蓋層。）
 */
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useCallback, useEffect, useRef } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

type ShareModule = typeof import('../data/player-card-share');

export type OverlayMode = 'line' | 'retry';

export interface OverlayState {
  mode: OverlayMode;
  src: string;
  blob: Blob;
}

export function PlayerCardImageOverlay({
  state,
  shareMod,
  onClose,
}: {
  state: OverlayState;
  /** 已載入的分享模組：「分享」要在點擊內同步呼叫 navigator.share，不能再等載入。 */
  shareMod: ShareModule;
  onClose: () => void;
}): JSX.Element | null {
  const t = useT();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const releaseRef = useRef<(() => void) | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

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
    // 開啟時焦點移到右上角 X（取代原本的底部「關閉」按鈕）。
    closeBtnRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const release = releaseRef.current;
      releaseRef.current = null;
      release?.();
    };
  }, [close]);

  const shareAgain = (): void => {
    // 不得先 await 任何東西：navigator.share 要在這次點擊內同步呼叫，才吃得到新的使用者手勢。
    const file = shareMod.makePlayerCardFile(state.blob);
    shareMod.retrySharePlayerCardFile(navigator, file).then((outcome) => {
      if (outcome === 'shared') close();
      else if (outcome === 'failed') toast.show({ message: t('profile.playerCard.shareUnavailable') });
    }, () => undefined);
  };

  const save = (): void => {
    shareMod.browserDownload(state.blob, shareMod.PLAYER_CARD_FILE_NAME);
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
          // 點遮罩空白處（圖片與按鈕以外）關閉；點圖片不關（LINE 要長按圖片存圖）。
          const target = event.target as Element | null;
          if (target && typeof target.closest === 'function' && target.closest('img, button')) return;
          close();
        }}
      >
        <button
          ref={closeBtnRef}
          type="button"
          class="player-card-overlay-x"
          aria-label={t('profile.playerCard.close')}
          onClick={close}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
        <img src={state.src} alt={t('profile.playerCard.title')} />
        <div class="player-card-overlay-hint">
          {retry ? t('profile.playerCard.shareOrSave') : t('profile.playerCard.longPressSave')}
        </div>
        {retry && (
          <div class="player-card-overlay-actions">
            <button
              type="button"
              class="player-card-overlay-btn is-primary"
              id="player-card-share-again"
              onClick={shareAgain}
            >
              {t('profile.playerCard.shareAgain')}
            </button>
            <button
              type="button"
              class="player-card-overlay-btn is-secondary"
              id="player-card-save"
              onClick={save}
            >
              {t('profile.playerCard.save')}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
