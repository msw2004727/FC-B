/**
 * T-092「分享球員卡」：按下才動態載入產圖與分享模組（不進首屏），PNG 與 DOM 卡片用同一份模型。
 * 分享路徑判斷見 data/player-card-share.ts；LINE 內建瀏覽器改開圖片覆蓋層長按存圖。
 */
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { resolvePlayerCardTheme, type PlayerCardModel } from '../data/player-card-model';

function PlayerCardImageOverlay({
  src,
  onClose,
}: {
  src: string;
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
    closeBtnRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const release = releaseRef.current;
      releaseRef.current = null;
      release?.();
    };
  }, [close]);

  if (typeof document === 'undefined') return null;
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
        <img src={src} alt={t('profile.playerCard.title')} />
        <div class="player-card-overlay-hint">{t('profile.playerCard.longPressSave')}</div>
        <button ref={closeBtnRef} type="button" class="player-card-overlay-close" onClick={close}>
          {t('profile.playerCard.close')}
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function PlayerCardShareButton({ model }: { model: PlayerCardModel }): JSX.Element {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [overlaySrc, setOverlaySrc] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleShare = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const [canvasMod, shareMod] = await Promise.all([
        import('../data/player-card-canvas'),
        import('../data/player-card-share'),
      ]);
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
      if (outcome === 'overlay') {
        const src = await shareMod.blobToDataUrl(blob);
        if (mountedRef.current) setOverlaySrc(src);
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
      {overlaySrc && (
        <PlayerCardImageOverlay src={overlaySrc} onClose={() => setOverlaySrc(null)} />
      )}
    </>
  );
}
