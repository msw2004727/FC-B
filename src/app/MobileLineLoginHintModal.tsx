// M-036：手機外部瀏覽器 LINE 登入說明框（照 A `pages/modals.html#mobile-line-login-hint-modal`、`js/line-auth.js` 的 `_mobileHintContinue`／`_copyAppUrlForLine`）。

import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { lt } from '@/i18n/i18n';
import { getMiniAppShareUrl } from '@/ui/drawer-menu';
import { toast } from '@/ui/Toast';

export interface MobileLineLoginHintModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 照 A `_copyAppUrlForLine`：複製 Mini App 連結（LINE 內可開，避開 OAuth 跨 App 問題）。 */
async function copyAppUrlForLine(): Promise<void> {
  const url = getMiniAppShareUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast.show({ message: '連結已複製、請貼到 LINE 內開啟' });
  } catch {
    toast.show({ message: '複製失敗、請手動複製：' + url });
  }
}

export function MobileLineLoginHintModal({
  open,
  onConfirm,
  onCancel,
}: MobileLineLoginHintModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return undefined;
    return pushOverlay(() => {
      onCancel();
      return true;
    });
  }, [open, onCancel]);

  if (!open) return null;

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
          <p class="line-login-hint-intro" data-i18n="lineLoginHint.choose">
            {lt('lineLoginHint.choose', '選一種方式即可')}
          </p>
          <button
            class="primary-btn line-login-hint-action line-login-hint-primary"
            type="button"
            data-i18n="lineLoginHint.loginPage"
            onClick={onConfirm}
          >
            {lt('lineLoginHint.loginPage', '前往 LINE 登入頁')}
          </button>
          <p class="line-login-hint-note" data-i18n="lineLoginHint.nextStep">
            {lt('lineLoginHint.nextStep', '下一頁選「使用 LINE 應用程式登入」')}
          </p>
          <div class="line-login-hint-or" data-i18n="lineLoginHint.or">
            {lt('lineLoginHint.or', '或')}
          </div>
          <button
            class="outline-btn line-login-hint-action line-login-hint-secondary"
            type="button"
            data-i18n="lineLoginHint.copy"
            onClick={() => {
              void copyAppUrlForLine();
            }}
          >
            {lt('lineLoginHint.copy', '複製連結')}
          </button>
          <p class="line-login-hint-note" data-i18n="lineLoginHint.copyStep">
            {lt('lineLoginHint.copyStep', '貼到 LINE，點「前往」')}
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
