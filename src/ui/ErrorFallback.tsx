import { useT } from '@/i18n/i18n';
import { ROUTE_LOAD_FAILED_MSG } from '@/core/unavailable';

export interface ErrorFallbackProps {
  onRetry?: () => void;
  showHome?: boolean;
  /** 啟動失敗時強制使用固定雙語文字，不依賴字典內容。 */
  fixed?: boolean;
}

export function ErrorFallback({
  onRetry,
  showHome = false,
  fixed = false,
}: ErrorFallbackProps): preact.JSX.Element {
  const t = useT();

  const translated = (key: string): string | undefined => {
    const value = t(key);
    return value && value !== key ? value : undefined;
  };

  // M-048：非 fixed 時使用 A 的「頁面載入失敗，請稍後再試」與 A 的按鈕結構與樣式（.legacy-ui .outline-btn / .primary-btn）
  const title = fixed ? '載入失敗 / Failed to load' : (translated('common.error') ?? ROUTE_LOAD_FAILED_MSG);
  const retryLabel = fixed ? '重新載入 / Reload' : (translated('common.retry') ?? '重新整理');
  const homeLabel = fixed ? '回首頁 / Home' : (translated('notFound.home') ?? '回首頁');

  return (
    <div class="legacy-ui">
      <section
        class="error-fallback"
        role="alert"
        style={{
          padding: '2.5rem 1.25rem',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <h1
          class="error-fallback__title"
          style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--text-primary, inherit)' }}
        >
          {title}
        </h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          {onRetry ? (
            <button type="button" class="error-fallback__retry primary-btn small" onClick={onRetry}>
              {retryLabel}
            </button>
          ) : null}
          {showHome ? (
            <a class="error-fallback__home outline-btn small" href="/">
              {homeLabel}
            </a>
          ) : null}
        </div>
      </section>
    </div>
  );
}
