/**
 * 站內信管理三個疊窗（詳情、撰寫、編輯腳本）共用外框，樣式照 A `pages/admin-content.html` 的行內樣式：
 * 遮罩 `rgba(0,0,0,.35)`＋`blur(10px)`、本體 `var(--bg-card)`／`var(--radius-lg)`。
 * 加上 B 慣例：返回鍵／Esc 關閉、鎖背景捲動、焦點還原。
 */
import type { ComponentChildren, JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { lockBody } from '@/ui/Modal';

const OVERLAY_STYLE =
  'display:flex;position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.35);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);align-items:center;justify-content:center';

export interface AdminOverlayProps {
  id: string;
  /** 本體行內樣式（照 A 各疊窗的寬高）。 */
  boxStyle: string;
  /** 點遮罩是否關閉（A：撰寫與編輯腳本會關，詳情不會）。 */
  closeOnBackdrop: boolean;
  /** 送出中不可關閉。 */
  busy?: boolean;
  labelledBy?: string;
  onClose: () => void;
  children: ComponentChildren;
}

export function AdminOverlay(props: AdminOverlayProps): JSX.Element {
  const latest = useRef(props);
  latest.current = props;
  const boxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const previousFocus = document.activeElement;
    const unlock = lockBody(document.body);
    const close = (): boolean => {
      if (latest.current.busy) return false;
      latest.current.onClose();
      return true;
    };
    const release = pushOverlay(close);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    boxRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      release();
      unlock();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(
    <div class="legacy-ui">
      <div
        id={props.id}
        style={OVERLAY_STYLE}
        onClick={(event) => {
          if (event.target === event.currentTarget && latest.current.closeOnBackdrop && !latest.current.busy) {
            latest.current.onClose();
          }
        }}
      >
        <div
          ref={boxRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={props.labelledBy}
          tabIndex={-1}
          // 開窗時焦點移到本體（返回鍵／Tab 起點），不畫焦點框（A 沒有）。
          style={`${props.boxStyle};outline:none`}
        >
          {props.children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
