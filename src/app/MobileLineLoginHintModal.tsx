// M-036：手機外部瀏覽器 LINE 登入提示（11-08 改版：主按鈕開 Mini App，次要才走登入頁）。

import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { lt, useT } from '@/i18n/i18n';
import { getMiniAppShareUrl } from '@/ui/mini-app-share-url';
import './MobileLineLoginHintModal.css';

export interface MobileLineLoginHintModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function hintLabel(
  translate: (key: string) => string,
  key: string,
  fallback: string,
): string {
  const value = translate(key);
  return value === key ? fallback : value;
}

export function MobileLineLoginHintModal({
  open,
  onConfirm,
  onCancel,
}: MobileLineLoginHintModalProps): JSX.Element | null {
  const translate = useT();

  useEffect(() => {
    if (!open) return undefined;
    return pushOverlay(() => {
      onCancel();
      return true;
    });
  }, [open, onCancel]);

  if (!open) return null;

  const miniAppUrl = getMiniAppShareUrl();
  const openInLine = hintLabel(translate, 'lineLoginHint.openInLine', '在 LINE App 開啟');
  const newTabNote = hintLabel(translate, 'lineLoginHint.newTabNote', '登入完成會開在新分頁，舊分頁可關閉');

  // A 的 data-no-backdrop-close="1"：點背景不關閉。
  return (
    <div class="legacy-ui">
      <div id="modal-overlay" class="modal-overlay open line-login-hint-overlay" />
      <div
        class="modal open"
        id="mobile-line-login-hint-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-line-login-hint-title"
      >
        <div class="modal-header">
          <h3 id="mobile-line-login-hint-title" data-i18n="lineLoginHint.title">
            {lt('lineLoginHint.title', '用 LINE 登入')}
          </h3>
          <button
            class="modal-close"
            type="button"
            aria-label={lt('common.close', '關閉')}
            data-i18n-aria-label="common.close"
            onClick={onCancel}
          >
            ✕
          </button>
        </div>
        <div class="modal-body line-login-hint-body">
          {/* 不設 target：同分頁開 Mini App，交給系統喚起 LINE App。 */}
          <a
            class="line-login-hint-action line-login-hint-open"
            href={miniAppUrl}
            data-i18n="lineLoginHint.openInLine"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#fff"
                d="M12 3C6.48 3 2 6.58 2 11c0 3.96 3.6 7.27 8.46 7.9.33.07.78.22.89.5.1.26.07.66.03.92l-.14.86c-.04.26-.2 1 .88.55 1.08-.46 5.83-3.43 7.95-5.88C21.53 14.24 22 12.67 22 11c0-4.42-4.48-8-10-8z"
              />
            </svg>
            {openInLine}
          </a>
          <div class="line-login-hint-or" data-i18n="lineLoginHint.or">
            {lt('lineLoginHint.or', '或')}
          </div>
          <button
            class="line-login-hint-action line-login-hint-login"
            type="button"
            data-i18n="lineLoginHint.loginPage"
            onClick={onConfirm}
          >
            {lt('lineLoginHint.loginPage', '前往 LINE 登入頁')}
          </button>
          <p class="line-login-hint-note" data-i18n="lineLoginHint.newTabNote">
            {newTabNote}
          </p>
          <button
            class="line-login-hint-cancel"
            type="button"
            data-i18n="common.cancel"
            onClick={onCancel}
          >
            {lt('common.cancel', '取消')}
          </button>
        </div>
      </div>
    </div>
  );
}
