import './contact-owner-fab.css';
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useT } from '@/i18n/i18n';
import { useContactFabHint } from './use-contact-fab-hint';

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
  const [hint, shaking, dismiss] = useContactFabHint();
  if (typeof document === 'undefined') return null;
  const open = (): void => {
    dismiss();
    onClick();
  };
  return createPortal(
    <>
      <button
        type="button"
        class={`contact-owner-fab${shaking ? ' is-shaking' : ''}`}
        aria-label={t('home.contactOwner.label')}
        onClick={open}
      >
        <EnvelopeIcon />
      </button>
      {hint ? (
        <div class="contact-owner-fab-hint" role="status" onClick={open}>
          {t('home.contactOwner.hint')}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
