import './modal.css';
import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useId, useLayoutEffect, useRef } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';
import { pushOverlay } from '@/core/overlay-back';
import { useT } from '@/i18n/i18n';

export interface ModalProps {
  open: boolean;
  title: string;
  children?: ComponentChildren;
  footer?: ComponentChildren;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  /** M-044：送出中鎖定關閉，點 ✕／遮罩／Esc／返回鍵時顯示「資料儲存中，請稍候」 */
  busy?: boolean;
  /** M-044：自訂送出中拒絕關閉的提示文字（預設照 A：「資料儲存中，請稍候」） */
  busyMessage?: string;
  /** M-043：小螢幕（≤640px）下是否全螢幕（如建立活動表單） */
  fullScreenOnMobile?: boolean;
  id?: string;
  class?: string;
  error?: string;
  closeOnOverlay?: boolean;
  closeOnEsc?: boolean;
  onClose: () => void;
}

interface DialogFrameProps extends ModalProps {
  kind: 'modal' | 'bottom-sheet';
}

interface BodyLock {
  count: number;
  value: string;
  priority: string;
}

const bodyLocks = new WeakMap<HTMLElement, BodyLock>();

const DEFAULT_BUSY_MESSAGE = '資料儲存中，請稍候';

function lockBody(body: HTMLElement): () => void {
  let lock = bodyLocks.get(body);

  if (!lock) {
    lock = {
      count: 0,
      value: body.style.getPropertyValue('overflow'),
      priority: body.style.getPropertyPriority('overflow'),
    };
    bodyLocks.set(body, lock);
    body.style.setProperty('overflow', 'hidden');
  }

  lock.count += 1;

  return () => {
    const current = bodyLocks.get(body);
    if (!current) return;

    current.count -= 1;
    if (current.count !== 0) return;

    if (current.value) {
      body.style.setProperty('overflow', current.value, current.priority);
    } else {
      body.style.removeProperty('overflow');
    }
    bodyLocks.delete(body);
  };
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]',
    ),
  ).filter((element) => {
    const style = getComputedStyle(element);
    return (
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      style.display !== 'none' &&
      style.visibility !== 'hidden'
    );
  });
}

/**
 * 共用實作。使用 native showModal() 的 top layer 與背景 inert 行為，
 * 不改寫 app root、documentElement 或背景元素的屬性。
 * open 屬性僅供不實作 showModal() 的 jsdom 等環境降級。
 */
export function DialogFrame({
  kind,
  open,
  title,
  children,
  footer,
  size = 'md',
  loading = false,
  busy = false,
  busyMessage = DEFAULT_BUSY_MESSAGE,
  fullScreenOnMobile = false,
  id: modalId,
  class: extraClass = '',
  error,
  closeOnOverlay = true,
  closeOnEsc = true,
  onClose,
}: DialogFrameProps) {
  const t = useT();
  const id = useId();
  const titleId = `${id}-title`;
  const errorId = `${id}-error`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const overlayPointer = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const busyMsgRef = useRef(busyMessage);
  busyMsgRef.current = busyMessage;

  /** M-044：統一處理關閉請求，busy 時阻擋並顯示 A 的提示「資料儲存中，請稍候」 */
  const requestClose = (): boolean => {
    if (busyRef.current) {
      toast.show({ message: busyMsgRef.current });
      return false;
    }
    closeRef.current();
    return true;
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useLayoutEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    const panel = panelRef.current;
    if (!dialog || !panel) return;

    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const unlock = lockBody(document.body);

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    (focusableElements(panel)[0] ?? panel).focus({ preventScroll: true });

    const preventBackgroundTouch = (event: TouchEvent): void => {
      const target = event.target;
      if (!(target instanceof Node) || !bodyRef.current?.contains(target)) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
      }
    };

    dialog.addEventListener('touchmove', preventBackgroundTouch, {
      passive: false,
    });

    // U-011：彈窗開著時，實體返回鍵先關彈窗；送出中（busy）則提示並保持開啟。
    const releaseBack = pushOverlay(() => requestCloseRef.current());

    return () => {
      releaseBack();
      const active = document.activeElement;
      // 外層被提前卸載時，不搶走仍開啟的內層 dialog 的焦點。
      const shouldRestore =
        active === document.body || active === null || dialog.contains(active);

      dialog.removeEventListener('touchmove', preventBackgroundTouch);

      if (typeof dialog.close === 'function' && dialog.open) {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }

      unlock();

      if (shouldRestore && previous?.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const closeLabel = t(
    kind === 'modal' ? 'ui.modal.close' : 'ui.bottomSheet.close',
  );
  const loadingLabel = t(
    kind === 'modal' ? 'ui.modal.loading' : 'ui.bottomSheet.loading',
  );

  const isMobileFullscreen =
    fullScreenOnMobile || modalId === 'create-event-modal';

  return createPortal(
    <dialog
      ref={dialogRef}
      id={modalId}
      class={[
        'ui-modal',
        `ui-modal--${size}`,
        `ui-modal--${kind}`,
        kind === 'bottom-sheet' ? 'ui-bottom-sheet' : '',
        loading ? 'ui-modal--loading' : '',
        busy ? 'ui-modal--busy' : '',
        error ? 'ui-modal--error' : '',
        isMobileFullscreen ? 'ui-modal--mobile-fullscreen' : '',
        extraClass,
      ]
        .filter(Boolean)
        .join(' ')}
      role="dialog"
      aria-modal="true"
      aria-busy={busy || undefined}
      aria-labelledby={titleId}
      aria-describedby={error ? errorId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (busyRef.current) {
          toast.show({ message: busyMsgRef.current });
          return;
        }
        if (closeOnEsc) closeRef.current();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (busyRef.current) {
            toast.show({ message: busyMsgRef.current });
            return;
          }
          if (closeOnEsc) closeRef.current();
          return;
        }

        if (event.key !== 'Tab') return;
        const panel = panelRef.current;
        if (!panel) return;

        const elements = focusableElements(panel);
        const first = elements[0];
        const last = elements[elements.length - 1];
        const active = document.activeElement;

        if (!first || !last) {
          event.preventDefault();
          panel.focus();
        } else if (
          event.shiftKey &&
          (active === first || active === panel || !panel.contains(active))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (active === last || active === panel || !panel.contains(active))
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
      onPointerDown={(event) => {
        overlayPointer.current = event.target === event.currentTarget;
      }}
      onPointerCancel={() => {
        overlayPointer.current = false;
      }}
      onClick={(event) => {
        if (overlayPointer.current && event.target === event.currentTarget) {
          if (busyRef.current) {
            toast.show({ message: busyMsgRef.current });
          } else if (closeOnOverlay) {
            closeRef.current();
          }
        }
        overlayPointer.current = false;
      }}
    >
      <div
        ref={panelRef}
        class="ui-modal__panel modal open"
        tabIndex={-1}
      >
        <header class="ui-modal__header modal-header">
          <h2 id={titleId} class="ui-modal__title" title={title}>
            <Text>{title}</Text>
          </h2>
          <button
            type="button"
            class="ui-modal__close modal-close"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={() => requestCloseRef.current()}
          >
            {/* Icon.tsx 尚無 close；本地 inline SVG，不修改共用 Icon。 */}
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
        </header>

        <div
          ref={bodyRef}
          class="ui-modal__body modal-body"
          aria-busy={loading || busy}
        >
          {error && (
            <div id={errorId} class="ui-modal__error" role="alert">
              <Text>{error}</Text>
            </div>
          )}
          {loading ? (
            <div class="ui-modal__loading" role="status">
              <Text>{loadingLabel}</Text>
              <div class="ui-modal__skeleton" aria-hidden="true" />
              <div class="ui-modal__skeleton" aria-hidden="true" />
            </div>
          ) : (
            children
          )}
        </div>

        {footer && <footer class="ui-modal__footer modal-actions">{footer}</footer>}
      </div>
    </dialog>,
    document.body,
  );
}

export function Modal(props: ModalProps) {
  return <DialogFrame {...props} kind="modal" />;
}
