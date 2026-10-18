import { useT } from '@/i18n/i18n';

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

  const title = fixed ? undefined : translated('common.error');
  const retryLabel = fixed ? undefined : translated('common.retry');
  const homeLabel = fixed ? undefined : translated('notFound.home');

  return (
    <section class="error-fallback" role="alert">
      <h1 class="error-fallback__title">{title ?? '載入失敗 / Failed to load'}</h1>
      {onRetry ? (
        <button type="button" class="error-fallback__retry" onClick={onRetry}>
          {retryLabel ?? '重新載入 / Reload'}
        </button>
      ) : null}
      {showHome ? (
        <a class="error-fallback__home" href="/">
          {homeLabel ?? '回首頁 / Home'}
        </a>
      ) : null}
    </section>
  );
}
