import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import type { LateCancelConfirmContent } from '../data/late-cancel';

/** 天數／場數（例「7 天」「3 場」）包成 `.lc-unit` 特殊色（站長 11-23）；數字與單位在同一個標記裡、不斷開。 */
const UNIT_RE = /(\d+ ?[天場])/;
function markUnits(text: string): (string | JSX.Element)[] {
  return text.split(UNIT_RE).map((part, i) => (i % 2 ? <span class="lc-unit" key={i}>{part}</span> : part));
}

/**
 * 取消報名確認框（預覽 ②③④）：外觀沿用 AppConfirm 的 `.app-confirm-*`（全域樣式），多一列紅字警示、
 * 一段次要說明與自訂按鈕文字。放在延後載入的詳情頁 chunk，不動入口的 AppConfirm（入口差值須為 0）。
 * 行為同 AppConfirm：焦點先放「返回／保留名額」、Esc 與實體返回鍵視為取消。
 */
export function LateCancelConfirm({
  content,
  onSettle,
}: {
  content: LateCancelConfirmContent;
  onSettle(ok: boolean): void;
}): JSX.Element | null {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const settleRef = useRef(onSettle);
  settleRef.current = onSettle;

  useLayoutEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      settleRef.current(false);
    };
    const releaseBack = pushOverlay(() => {
      settleRef.current(false);
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
    <div id="late-cancel-confirm" class="app-confirm-overlay open">
      <div class="app-confirm-box" role="alertdialog" aria-modal="true" aria-describedby="late-cancel-confirm-msg">
        {content.warn && <div class="app-confirm-warning">{content.warn}</div>}
        <div class="app-confirm-msg" id="late-cancel-confirm-msg">
          {markUnits(content.message)}
          <span class="late-cancel-confirm-sub">{markUnits(content.sub)}</span>
        </div>
        <div class="app-confirm-btns">
          <button type="button" class="app-confirm-cancel" ref={cancelRef} onClick={() => settleRef.current(false)}>
            {content.cancelText}
          </button>
          <button type="button" class="app-confirm-ok" onClick={() => settleRef.current(true)}>
            {content.okText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
