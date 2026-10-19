import './app-confirm.css';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { Text } from '@/ui/Text';

/**
 * A `app.js#appConfirm`／`appAlert` 的 B 版：畫面正中的小確認框（只有訊息，沒有標題），
 * 按鈕「取消／確定」；`appAlert` 只有「確定」。樣式照 A `css/base.css` 的 `.app-confirm-*`。
 * 呼叫端 `if (!await appConfirm(msg)) return;`，與 A 寫法一致；一次只顯示一個，後到的排隊。
 */

interface ConfirmRequest {
  id: number;
  message: string;
  mode: 'confirm' | 'alert';
  okText?: string;
  resolve: (result: boolean) => void;
}

let nextId = 1;
let queue: ConfirmRequest[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function enqueue(message: string, mode: ConfirmRequest['mode'], okText?: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    queue = [...queue, { id: nextId++, message, mode, okText, resolve }];
    emit();
  });
}

/** 確定 → true，取消／Esc → false。 */
export function appConfirm(message: string): Promise<boolean> {
  return enqueue(message, 'confirm');
}

/** 只有一顆按鈕的提示（A `appAlert`）；按下後 resolve。 */
export async function appAlert(message: string, options: { okText?: string } = {}): Promise<void> {
  await enqueue(message, 'alert', options.okText);
}

function settle(id: number, result: boolean): void {
  const request = queue.find((item) => item.id === id);
  if (!request) return;
  queue = queue.filter((item) => item.id !== id);
  emit();
  request.resolve(result);
}

/** 測試用：清掉排隊中的對話框（全部當作取消）。 */
export function _resetAppConfirmForTest(): void {
  const pending = queue;
  queue = [];
  emit();
  for (const request of pending) request.resolve(false);
}

export function AppConfirmHost() {
  const t = useT();
  const [current, setCurrent] = useState<ConfirmRequest | null>(queue[0] ?? null);
  const okRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const sync = (): void => setCurrent(queue[0] ?? null);
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);

  useLayoutEffect(() => {
    if (!current) return undefined;
    okRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(current.id, current.mode === 'alert');
      }
    };
    document.addEventListener('keydown', onKey);
    const body = document.body;
    body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      body.classList.remove('modal-open');
    };
  }, [current]);

  if (!current || typeof document === 'undefined') return null;

  return createPortal(
    <div class="app-confirm-overlay open">
      <div
        class="app-confirm-box"
        role={current.mode === 'confirm' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-describedby={`app-confirm-msg-${current.id}`}
      >
        <div class="app-confirm-msg" id={`app-confirm-msg-${current.id}`}>
          <Text>{current.message}</Text>
        </div>
        <div class="app-confirm-btns">
          {current.mode === 'confirm' && (
            <button
              type="button"
              class="app-confirm-cancel"
              onClick={() => settle(current.id, false)}
            >
              <Text>{t('common.cancel')}</Text>
            </button>
          )}
          <button
            type="button"
            class="app-confirm-ok"
            ref={okRef}
            onClick={() => settle(current.id, true)}
          >
            <Text>{current.okText ?? t('common.ok')}</Text>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
