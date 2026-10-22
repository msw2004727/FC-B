import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { dismissLineNotifyPrompt } from '../../data/line-notify-bind';

export interface LineNotifyPromptProps {
  open: boolean;
  onBind: () => void;
  onClosed: () => void;
}

/**
 * M-083：照 A `event-detail-notify-prompt.js` 的 `_showLineNotifyPrompt` / `_closeLineNotifyPrompt`。
 * - 進場：mount 後下一個 frame 加 `open`
 * - 出場：移除 `open`，`transitionend` 或 400ms 後觸發 `onClosed`
 * - 返回鍵：透過 `pushOverlay` 攔截，等於關閉（不永久 dismiss，照 A「點遮罩」語意）
 * - 遮罩 click（target 是 overlay）→ 關閉
 * - 「請別煩我」→ dismissLineNotifyPrompt() 再關
 * - 「立即綁定」→ 關閉後呼叫 onBind()
 */
export function LineNotifyPrompt({
  open,
  onBind,
  onClosed,
}: LineNotifyPromptProps): JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeCleanupRef = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const closingRef = useRef(false);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  // 照 A：open=true 才掛載；重新開啟時重置關閉狀態
  useEffect(() => {
    if (open && !visible) {
      closingRef.current = false;
      setVisible(true);
    }
  }, [open, visible]);

  // 照 A `requestAnimationFrame(() => overlay.classList.add('open'))`
  useEffect(() => {
    if (!visible) return;
    if (!overlayRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (alive.current) overlayRef.current?.classList.add('open');
    });
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [visible]);

  // 照 A `_closeLineNotifyPrompt`
  const requestClose = useCallback((): void => {
    if (closingRef.current) return;
    closingRef.current = true;
    const el = overlayRef.current;
    if (!el) {
      if (!alive.current) return;
      setVisible(false);
      onClosedRef.current();
      return;
    }
    el.classList.remove('open');
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      el.removeEventListener('transitionend', finish);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (!alive.current) return;
      setVisible(false);
      onClosedRef.current();
    };
    el.addEventListener('transitionend', finish, { once: true });
    timeoutRef.current = setTimeout(finish, 400);
    closeCleanupRef.current = () => {
      el.removeEventListener('transitionend', finish);
    };
  }, []);

  // 照 A：`open` 由 true → false 觸發關閉動畫
  useEffect(() => {
    if (open) return;
    if (!visible) return;
    requestClose();
  }, [open, visible, requestClose]);

  // 照 A：返回鍵＝關閉（`pushOverlay` 的 onBack 回傳 true）
  useEffect(() => {
    if (!visible) return;
    return pushOverlay(() => {
      requestClose();
      return true;
    });
  }, [visible, requestClose]);

  // 卸載：清計時器、rAF、監聽
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      if (closeCleanupRef.current) {
        closeCleanupRef.current();
        closeCleanupRef.current = null;
      }
    };
  }, []);

  if (!visible) return null;

  const handleOverlayClick = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    if (e.target === overlayRef.current) requestClose();
  };

  const handleDismiss = (): void => {
    dismissLineNotifyPrompt();
    requestClose();
  };

  const handleBind = (): void => {
    requestClose();
    onBind();
  };

  return (
    <div
      id="line-notify-prompt-overlay"
      className="ln-prompt-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
    >
      <div className="ln-prompt-card">
        <div className="ln-prompt-icon">🔔</div>
        <h3 className="ln-prompt-title">開啟活動提醒，不再錯過！</h3>
        <p className="ln-prompt-desc">
          綁定 LINE 推播通知，<br />
          活動開場前自動提醒、關注活動秒通知。<br />
          完成綁定還能獲得<br />
          「LINE推播」專屬成就徽章！
        </p>
        <div className="ln-prompt-actions">
          <button
            className="ln-prompt-btn ln-prompt-dismiss"
            id="ln-prompt-dismiss"
            onClick={handleDismiss}
          >
            請別煩我
          </button>
          <button
            className="ln-prompt-btn ln-prompt-bind"
            id="ln-prompt-bind"
            onClick={handleBind}
          >
            <span className="ln-prompt-bind-glow"></span>
            <span className="ln-prompt-bind-text">立即綁定</span>
          </button>
        </div>
      </div>
    </div>
  );
}
