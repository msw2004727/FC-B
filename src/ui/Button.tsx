import './button.css';
import type { JSX } from 'preact';
import { useCallback, useRef, useState } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { Action, type ActionProps } from './action';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ActionProps, 'children' | 'busy'> {
  children: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** M-053 & U-014：送出中顯示的文字（如「建立中...」、「儲存中...」）；未傳則保留 children 原字 */
  loadingText?: string;
  leading?: JSX.Element;
  trailing?: JSX.Element;
}

export interface UseButtonLoadingOptions {
  /** 送出中顯示的文字（如「建立中...」） */
  loadingText?: string;
  /** 同 A `options.shouldRestore`：回傳 false 時不還原按鈕狀態 */
  shouldRestore?: () => boolean;
}

export interface UseButtonLoadingReturn {
  loading: boolean;
  loadingText?: string;
  /** 包裝非同步寫入函式：防重複點擊、失敗必恢復、保留回傳值與錯誤 rethrow */
  run: <T>(asyncFn: () => Promise<T> | T, overrideLoadingText?: string) => Promise<T | undefined>;
  /** 直接產生綁定給 Button 的 props */
  buttonProps: {
    loading: boolean;
    loadingText?: string;
    'aria-busy'?: boolean;
  };
}

/**
 * M-053 & U-014：照 A `js/core/button-loading.js#_withButtonLoading` 的共用 Hook。
 * - 防連點（同步 ref 鎖定，同一 tick 連點第二次回傳 undefined 不重入）
 * - 送出中換字（loadingText）、半透明（opacity: .6）、disabled + aria-busy
 * - finally 保證失敗也恢復狀態
 */
export function useButtonLoading(
  defaultLoadingText?: string,
  options?: UseButtonLoadingOptions,
): UseButtonLoadingReturn {
  const [loading, setLoading] = useState(false);
  const [activeText, setActiveText] = useState<string | undefined>(
    defaultLoadingText ?? options?.loadingText,
  );
  const inFlightRef = useRef(false);
  const shouldRestoreRef = useRef(options?.shouldRestore);
  shouldRestoreRef.current = options?.shouldRestore;
  const defaultTextRef = useRef(defaultLoadingText ?? options?.loadingText);
  defaultTextRef.current = defaultLoadingText ?? options?.loadingText;

  const run = useCallback(
    async <T,>(
      asyncFn: () => Promise<T> | T,
      overrideLoadingText?: string,
    ): Promise<T | undefined> => {
      if (inFlightRef.current) return undefined;
      inFlightRef.current = true;
      setActiveText(overrideLoadingText ?? defaultTextRef.current);
      setLoading(true);
      try {
        return await asyncFn();
      } finally {
        let restore = true;
        try {
          restore = shouldRestoreRef.current?.() !== false;
        } catch {
          restore = true;
        }
        if (restore) {
          inFlightRef.current = false;
          setLoading(false);
        }
      }
    },
    [],
  );

  return {
    loading,
    loadingText: activeText,
    run,
    buttonProps: {
      loading,
      loadingText: activeText,
      'aria-busy': loading || undefined,
    },
  };
}

/**
 * children 由呼叫端以 t() 提供；leading / trailing 僅放裝飾圖示。
 * M-053 & U-014：loading 時若有傳 loadingText 則替換按鈕文字並套用 A 的半透明（opacity: 0.6），
 * 未傳 loadingText 時保留原名稱與 spinner 以維持向下相容。
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  leading,
  trailing,
  class: className,
  style,
  ...props
}: ButtonProps): JSX.Element {
  const displayLabel = loading && loadingText ? loadingText : children;
  const mergedStyle =
    loading
      ? typeof style === 'string'
        ? `opacity: 0.6; ${style}`
        : { opacity: 0.6, ...(style ?? {}) }
      : style;

  return (
    <Action
      {...props}
      busy={loading}
      style={mergedStyle}
      class={[
        'ui-button',
        `ui-button--${variant}`,
        `ui-button--${size}`,
        loading ? 'ui-button--loading' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
    >
      {loading && !loadingText ? (
        // Icon.tsx 尚無 spinner；使用裝飾性 inline SVG，不修改圖示清單。
        <svg
          class="ui-button__spinner"
          width="18"
          height="18"
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
      ) : !loading && leading ? (
        <span class="ui-button__icon" aria-hidden="true">{leading}</span>
      ) : null}
      <Text class="ui-button__label">{displayLabel}</Text>
      {trailing && (
        <span class="ui-button__icon" aria-hidden="true">{trailing}</span>
      )}
    </Action>
  );
}
