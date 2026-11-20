import type { ComponentChildren, JSX } from 'preact';
import { useGoBack } from '@/core/back-guard';
import { useT } from '@/i18n/i18n';
import { Button } from '@/ui/Button';
import { PageSpinner } from '@/ui/PageSpinner';
import { ctOrKey, useCompetitionsT } from '../i18n';
import '../competitions.css';

/** 賽事字典還沒到。載入與失敗文案走核心字典，不依賴賽事懶載。 */
export function CpI18nPending({ failed, retry }: { failed: boolean; retry: () => void }): JSX.Element {
  const t = useT();
  if (failed) {
    return (
      <div class="cps-root" role="alert">
        <p class="cps-note">{t('common.error')}</p>
        <Button variant="secondary" onClick={retry}>{t('common.retry')}</Button>
      </div>
    );
  }
  return (
    <div class="cps-root">
      <PageSpinner />
    </div>
  );
}

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

/** 「一句話＋回去的鈕」的圖示：鎖頭（不公開）。 */
export function LockIcon(): JSX.Element {
  return (
    <svg class="cps-ico" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** 「一句話＋回去的鈕」的圖示：圓圈 i（讀取失敗）。 */
export function InfoIcon(): JSX.Element {
  return (
    <svg class="cps-ico" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

/** 三角驚嘆號：頁面層級紅色提示、刪除確認框的警告句。不帶任何文字節點。 */
export function AlertIcon(): JSX.Element {
  return (
    <svg class="cps-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4L2.5 20h19z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

export function CpFrame({
  title,
  userTitle = false,
  onBack,
  menu,
  children,
}: {
  title: string;
  /** 標題是使用者取的名稱（賽事名稱）：最多兩行、超過才省略。 */
  userTitle?: boolean;
  onBack?: () => void;
  menu?: ComponentChildren;
  children: ComponentChildren;
}): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const goBack = useGoBack('/tournaments');
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  return (
    <div class="cps-root">
      <header class="cps-top">
        <button type="button" class="cps-iconbtn" aria-label={ct('back')} onClick={onBack ?? goBack}>
          <BackIcon />
        </button>
        <h1 class={userTitle ? 'cps-top__user' : undefined}>{title}</h1>
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
