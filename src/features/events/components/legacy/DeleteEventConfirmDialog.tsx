import '@/ui/app-confirm.css';
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { useT } from '@/i18n/i18n';

/**
 * 刪除活動的第二次確認（T-076b，A 只有一次確認，這是 B 新增）：沿用 AppConfirm 的 `.app-confirm-*` 外觀，
 * 多一個勾選框，勾了才能按「刪除」；刪除進行中兩顆按鈕都停用，返回鍵與 Esc 也不關閉。
 */
export interface DeleteEventConfirmDialogProps {
  title: string;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}

export function DeleteEventConfirmDialog({
  title,
  busy,
  onCancel,
  onConfirm,
}: DeleteEventConfirmDialogProps): JSX.Element | null {
  const t = useT();
  const [checked, setChecked] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const cancelCb = useRef(onCancel);
  cancelCb.current = onCancel;

  useLayoutEffect(() => {
    cancelRef.current?.focus();
    const close = (): void => {
      if (!busyRef.current) cancelCb.current();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    const releaseBack = pushOverlay(() => {
      close();
      return true;
    });
    document.addEventListener('keydown', onKey, true);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('modal-open');
      releaseBack();
    };
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div id="delete-event-confirm-modal" class="app-confirm-overlay open">
      <div
        class="app-confirm-box"
        role="alertdialog"
        aria-modal="true"
        aria-describedby="delete-event-confirm-msg"
      >
        <div class="app-confirm-msg" id="delete-event-confirm-msg" style="margin-bottom:.8rem">
          {t('events.manage.delete.confirmFinal', { title: title || t('events.manage.delete.untitled') })}
        </div>
        <label style="display:flex;align-items:center;justify-content:center;gap:.4rem;margin-bottom:1rem;font-size:.85rem;color:var(--text-secondary);cursor:pointer">
          <input
            type="checkbox"
            checked={checked}
            disabled={busy}
            onChange={(ev) => setChecked(ev.currentTarget.checked)}
          />
          <span>{t('events.manage.delete.check')}</span>
        </label>
        <div class="app-confirm-btns">
          <button
            type="button"
            class="app-confirm-cancel"
            ref={cancelRef}
            disabled={busy}
            onClick={() => {
              if (!busy) onCancel();
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            class="app-confirm-ok"
            style={`background:var(--danger)${!checked || busy ? ';opacity:.5;cursor:not-allowed' : ''}`}
            disabled={!checked || busy}
            onClick={() => {
              if (checked && !busy) onConfirm();
            }}
          >
            {busy ? t('events.manage.delete.pending') : t('events.manage.delete.ok')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
