import './toast.css';
import { useEffect, useRef } from 'preact/hooks';
import { Text } from '@/ui/Text';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastProps {
  message: string;
  tone?: ToastTone;
  /** 毫秒；未傳則照 A 規則依字數／換行計算（2500 / 3500 / 4000），0 表示保留到手動關閉。 */
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

/** U-012：相同訊息 2 秒內去重（記住上次顯示的訊息與時間戳） */
const DEDUPE_WINDOW_MS = 2000;
let lastShownMessage: string | null = null;
let lastShownAt = 0;
let lastShownId = 0;

function publish(next: readonly ToastEntry[]): void {
  entries = next;
  // L-15：快照後逐個呼叫並隔離例外
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (err) {
      console.error('[Toast] listener error:', err);
    }
  }
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

/**
 * M-041：照 A `app.js#showToast` 計算預設時長：
 * - 有傳正數 duration → 直接使用
 * - 傳 0 → 0（保留至關閉）
 * - 未傳：含 `\n` → 4000ms；去空白字元數 > 24 → 3500ms；否則 → 2500ms
 */
export function computeToastDuration(
  message: string,
  duration?: number,
): number {
  if (duration !== undefined && Number.isFinite(duration)) {
    return Math.max(0, duration);
  }
  const msg = String(message ?? '');
  if (msg.includes('\n')) return 4000;
  const textLen = Array.from(msg.replace(/\s/g, '')).length;
  return textLen > 24 ? 3500 : 2500;
}

/**
 * M-041：單顆膠囊，新的取代舊的。
 * U-012：相同訊息 2 秒內不重複觸發閃爍（若當前仍在場上則直接沿用）。
 */
export const toast = {
  show(options: ToastOptions | string): number {
    const normalized: ToastOptions =
      typeof options === 'string' ? { message: options } : options;
    const now = Date.now();
    if (
      lastShownMessage === normalized.message &&
      now - lastShownAt < DEDUPE_WINDOW_MS &&
      entries.length > 0
    ) {
      return lastShownId;
    }

    const id = ++nextId;
    const entry: ToastEntry = {
      id,
      message: normalized.message,
      tone: normalized.tone ?? 'info',
      duration: computeToastDuration(normalized.message, normalized.duration),
    };
    lastShownMessage = normalized.message;
    lastShownAt = now;
    lastShownId = id;
    // M-041：單顆膠囊，新的取代舊的
    publish([entry]);
    return id;
  },

  dismiss(id: number): void {
    if (!entries.some((entry) => entry.id === id)) return;
    publish(entries.filter((entry) => entry.id !== id));
  },

  clear(): void {
    lastShownMessage = null;
    lastShownAt = 0;
    publish([]);
  },
};

export function Toast({
  message,
  tone = 'info',
  duration,
  onClose,
}: ToastProps) {
  const closeRef = useRef(onClose);
  const pauseRef = useRef<(reason: 'pointer' | 'focus', paused: boolean) => void>(
    () => undefined,
  );
  closeRef.current = onClose;

  const effectiveDuration = computeToastDuration(message, duration);

  useEffect(() => {
    let remaining = effectiveDuration;
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
  }, [effectiveDuration, message]);

  return (
    <div
      id="toast"
      class={`toast show ui-toast ui-toast--${tone}`}
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
        <Text class="ui-toast__message">{message}</Text>
      </div>
    </div>
  );
}
