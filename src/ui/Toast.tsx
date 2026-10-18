import './toast.css';
import { useEffect, useRef } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { useT } from '@/i18n/i18n';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastProps {
  message: string;
  tone?: ToastTone;
  /** 毫秒；0 表示保留到手動關閉。 */
  duration?: number;
  onClose: () => void;
}

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  duration?: number;
}

export interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
  duration: number;
}

let nextId = 0;
let entries: readonly ToastEntry[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly ToastEntry[]): void {
  entries = next;
  for (const listener of listeners) listener();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): readonly ToastEntry[] {
  return entries;
}

function normalizeDuration(duration: number | undefined): number {
  if (duration === undefined || !Number.isFinite(duration)) return 4000;
  return Math.max(0, duration);
}

/**
 * 在應用根節點掛載一個 ToastHost。
 * 未掛載 Host 時暫存最多三則；顯示後才開始計時。
 */
export const toast = {
  show(options: ToastOptions): number {
    const id = ++nextId;
    const entry: ToastEntry = {
      id,
      message: options.message,
      tone: options.tone ?? 'info',
      duration: normalizeDuration(options.duration),
    };
    publish([...entries, entry].slice(-3));
    return id;
  },

  dismiss(id: number): void {
    if (!entries.some((entry) => entry.id === id)) return;
    publish(entries.filter((entry) => entry.id !== id));
  },

  clear(): void {
    publish([]);
  },
};

export function Toast({
  message,
  tone = 'info',
  duration = 4000,
  onClose,
}: ToastProps) {
  const t = useT();
  const closeRef = useRef(onClose);
  const pauseRef = useRef<(reason: 'pointer' | 'focus', paused: boolean) => void>(
    () => undefined,
  );
  closeRef.current = onClose;

  useEffect(() => {
    let remaining = normalizeDuration(duration);
    if (remaining === 0) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let startedAt = 0;
    const reasons = new Set<'pointer' | 'focus'>();

    const stop = (): void => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };

    const start = (): void => {
      if (timer !== undefined || reasons.size > 0) return;
      startedAt = Date.now();
      timer = setTimeout(() => {
        timer = undefined;
        closeRef.current();
      }, remaining);
    };

    pauseRef.current = (reason, paused) => {
      if (paused) {
        reasons.add(reason);
        stop();
      } else {
        reasons.delete(reason);
        start();
      }
    };

    start();

    return () => {
      stop();
      pauseRef.current = () => undefined;
    };
  }, [duration]);

  const closeLabel = t('ui.toast.close');

  return (
    <div
      class={`ui-toast ui-toast--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      onPointerEnter={() => pauseRef.current('pointer', true)}
      onPointerLeave={() => pauseRef.current('pointer', false)}
      onFocusCapture={() => pauseRef.current('focus', true)}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          pauseRef.current('focus', false);
        }
      }}
    >
      <div class="ui-toast__content">
        <Text class="ui-toast__tone">{t(`ui.toast.${tone}`)}</Text>
        <Text class="ui-toast__message">{message}</Text>
      </div>
      <button
        type="button"
        class="ui-toast__close"
        aria-label={closeLabel}
        title={closeLabel}
        onClick={onClose}
      >
        {/* Icon.tsx 尚無 close；使用本地 inline SVG。 */}
        <svg
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
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
