import type { ComponentChildren, JSX } from 'preact';
import { useGoBack } from '@/core/back-guard';
import { useT } from '@/i18n/i18n';
import '../competitions.css';

function BackIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function MoreIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="5" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="12" cy="19" r="1.2" />
    </svg>
  );
}

export function TrashIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}

export function CpFrame({
  title,
  onBack,
  menu,
  children,
}: {
  title: string;
  onBack?: () => void;
  menu?: ComponentChildren;
  children: ComponentChildren;
}): JSX.Element {
  const t = useT();
  const goBack = useGoBack('/tournaments');
  return (
    <div class="cps-root">
      <header class="cps-top">
        <button type="button" class="cps-iconbtn" aria-label={t('competitions.back')} onClick={onBack ?? goBack}>
          <BackIcon />
        </button>
        <h1>{title}</h1>
        {menu}
      </header>
      <div class="cps-stack">{children}</div>
    </div>
  );
}

export function CpCard({ children, class: className = '' }: { children: ComponentChildren; class?: string }): JSX.Element {
  return <section class={`cps-card ${className}`}>{children}</section>;
}

export function CpRow({ k, children }: { k: string; children: ComponentChildren }): JSX.Element {
  return (
    <div class="cps-row">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}
