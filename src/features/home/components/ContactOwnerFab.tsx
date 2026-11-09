import './contact-owner-fab.css';
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import { useT } from '@/i18n/i18n';

export interface ContactOwnerFabProps {
  onClick: () => void;
}

/** 信封線條（預覽圖示 1）。 */
function EnvelopeIcon(): JSX.Element {
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
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3.5 6.5 12 13l8.5-6.5" />
    </svg>
  );
}

export function ContactOwnerFab({ onClick }: ContactOwnerFabProps): JSX.Element | null {
  const t = useT();
  // 這一次停留裡，提示出現前已點過浮球就不再提示。
  const clicked = useRef(false);
  // 每次回到首頁都提示：浮球只掛在首頁。preact-iso 換頁會卸下首頁，再回來會重新掛載，
  // 所以掛載後約 1 秒下載提示 chunk 即可（泡泡、抖動、CSS、文案都在 chunk；之後由瀏覽器快取）。
  // effect 依賴為空，同一次停留的重繪不重複排程。載入失敗靜默放棄。
  // 下載完成時已卸下、已點浮球或已離開首頁就不顯示。卸下時清計時器、收掉已顯示的提示。
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    const id = setTimeout(() => {
      if (clicked.current || location.pathname !== '/') return;
      import('./contact-fab-hint').then(
        (m) => {
          if (cancelled || clicked.current || location.pathname !== '/') return;
          stop = m.showContactFabHint();
        },
        () => undefined,
      );
    }, 1000);
    return () => {
      cancelled = true;
      clearTimeout(id);
      stop?.();
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <button
      type="button"
      class="contact-owner-fab"
      aria-label={t('home.contactOwner.label')}
      onClick={() => {
        clicked.current = true;
        onClick();
      }}
    >
      <EnvelopeIcon />
    </button>,
    document.body,
  );
}
