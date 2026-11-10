import './page-spinner.css';
import type { JSX } from 'preact';
import { useT } from '@/i18n/i18n';

/**
 * 後台工具權限尚未到位時的置中轉圈。
 * 外觀與按鈕載入圓圈相同（約 28px）；下方一行小字是站長 2026-11-10 指定的安撫語（common.loadingHint），
 * 取代原本「不放任何可見文字」的設計（R-UI-026 的例外，由站長指定）。
 */
export function PageSpinner(): JSX.Element {
  const t = useT();
  return (
    <div class="ui-page-spinner" role="status" aria-label={t('common.loading')}>
      <svg
        class="ui-page-spinner__ring"
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M12 3a9 9 0 1 1-9 9" />
      </svg>
      <span class="ui-page-spinner__hint">{t('common.loadingHint')}</span>
    </div>
  );
}
