import './app-confirm.css';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { Text } from '@/ui/Text';
import { pushOverlay } from '@/core/overlay-back';

/**
 * A `app.js#appConfirm`／`appAlert` 的 B 版：畫面正中的小確認框（只有訊息，沒有標題），
 * 按鈕「取消／確定」；`appAlert` 只有「確定」。樣式照 A `css/base.css` 的 `.app-confirm-*`。
 * 呼叫端 `if (!await appConfirm(msg)) return;`，與 A 寫法一致；一次只顯示一個，後到的排隊。
 */

export interface AppConfirmOptions {
  okText?: string;
  /** U-017：強制指定是否為危險操作（未指定時依訊息關鍵字自動判斷） */
  danger?: boolean;
}

interface ConfirmRequest {
  id: number;
  message: string;
  mode: 'confirm' | 'alert';
  okText?: string;
  danger?: boolean;
  resolve: (result: boolean) => void;
}

let nextId = 1;
let queue: ConfirmRequest[] = [];
const listeners = new Set<() => void>();

/** U-017：刪除、取消、移除、解散、踢出、封鎖、退隊、撤回、清空等危險確認關鍵字 */
const DANGER_KEYWORDS = /刪除|取消|移除|解散|踢出|封鎖|退隊|退出|撤回|清空|作廢|拒絕|駁回|停權|註銷|delete|remove|cancel/i;

export function isDangerConfirmMessage(message: string, explicitDanger?: boolean): boolean {
  if (typeof explicitDanger === 'boolean') return explicitDanger;
  return DANGER_KEYWORDS.test(message);
}

function emit(): void {
  // L-15：快照後逐個呼叫並隔離例外
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (err) {
      console.error('[AppConfirm] listener error:', err);
    }
  }
}

function enqueue(
  message: string,
  mode: ConfirmRequest['mode'],
  options?: AppConfirmOptions,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    queue = [
      ...queue,
      {
        id: nextId++,
        message,
        mode,
        okText: options?.okText,
        danger: options?.danger,
        resolve,
      },
    ];
    emit();
  });
}

/** 確定 → true，取消／Esc／返回鍵 → false。 */
export function appConfirm(
  message: string,
  options?: AppConfirmOptions,
): Promise<boolean> {
  return enqueue(message, 'confirm', options);
}

/** 只有一顆按鈕的提示（A `appAlert`）；按下後 resolve。 */
export async function appAlert(
  message: string,
  options: { okText?: string } = {},
): Promise<void> {
  await enqueue(message, 'alert', { okText: options.okText });
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

/** M-040：若有開啟中的 `<dialog open>`，把確認框掛進最上層 dialog 以免被 native `showModal()` 蓋住 */
function getConfirmPortalTarget(): HTMLElement {
  const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  return (dialogs.length > 0 ? dialogs[dialogs.length - 1] : null) ?? document.body;
}

export function AppConfirmHost() {
  const t = useT();
  const [current, setCurrent] = useState<ConfirmRequest | null>(queue[0] ?? null);
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

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

    // U-017：刪除、取消類危險確認預設焦點放「取消」，一般確認或 alert 放「確定」
    const focusCancel =
      current.mode === 'confirm' &&
      isDangerConfirmMessage(current.message, current.danger);
    if (focusCancel && cancelRef.current) {
      cancelRef.current.focus();
    } else {
      okRef.current?.focus();
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        settle(current.id, current.mode === 'alert');
      }
    };

    // U-011：確認框開著時，實體返回鍵先關閉確認框（視為取消；alert 視為確定）。
    const releaseBack = pushOverlay(() => {
      settle(current.id, current.mode === 'alert');
      return true;
    });

    document.addEventListener('keydown', onKey, true);
    const body = document.body;
    body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey, true);
      body.classList.remove('modal-open');
      releaseBack();
    };
  }, [current]);

  if (!current || typeof document === 'undefined') return null;

  return createPortal(
    <div
      id="app-confirm-modal"
      class="app-confirm-overlay open"
    >
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
              id="app-confirm-cancel"
              class="app-confirm-cancel"
              ref={cancelRef}
              onClick={() => settle(current.id, false)}
            >
              <Text>{t('common.cancel')}</Text>
            </button>
          )}
          <button
            type="button"
            id="app-confirm-ok"
            class="app-confirm-ok"
            ref={okRef}
            onClick={() => settle(current.id, true)}
          >
            <Text>{current.okText ?? t('common.ok')}</Text>
          </button>
        </div>
      </div>
    </div>,
    getConfirmPortalTarget(),
  );
}
