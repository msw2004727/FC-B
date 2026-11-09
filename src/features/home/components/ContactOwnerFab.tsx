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
  // 提示下載前已點過浮球就不再提示。
  const clicked = useRef(false);
  // 首次提示：主程式只判斷「在首頁、未提示過、localStorage 可用」，符合才在 1 秒後下載提示 chunk（泡泡、抖動、CSS、文案都在 chunk）；
  // 載入失敗靜默放棄。卸下時清計時器、收掉已顯示的提示。
  useEffect(() => {
    let stop: (() => void) | undefined;
    const id = setTimeout(() => {
      try {
        // 記錄鍵與 contact-fab-hint.ts 的 CONTACT_FAB_HINT_KEY 同值；這裡寫字面值，主程式不多帶一個匯出（測試核對兩邊一致）。
        if (clicked.current || location.pathname !== '/' || localStorage.getItem('fcb:contact-fab-hinted')) return;
      } catch {
        return;
      }
      import('./contact-fab-hint').then(
        (m) => {
          stop = m.showContactFabHint();
        },
        () => undefined,
      );
    }, 1000);
    return () => {
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
