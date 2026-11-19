// M-036：手機外部瀏覽器 LINE 登入提示（11-08 改版：主按鈕開 Mini App，次要才走登入頁）。

import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { lt, useT } from '@/i18n/i18n';
import { getMiniAppShareUrl } from '@/ui/mini-app-share-url';
import { isIosStandalone } from '@/data/login-redirect';
import { LOGIN_HANDOFF_ENABLED } from '@/features/login-handoff/flag';
import { isStandalonePwa } from '@/features/pwa/pwa-install';
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
  const openInLine = hintLabel(translate, 'lineLoginHint.openInLine', '在 LINE App 中登入');
  const openInLineNote = hintLabel(translate, 'lineLoginHint.openInLineNote', '之後都在 LINE 裡使用');
  const browserLogin = hintLabel(translate, 'lineLoginHint.browserLogin', '用目前瀏覽器登入');
  const browserLoginNote = hintLabel(translate, 'lineLoginHint.browserLoginNote', 'LINE 確認後回到這個瀏覽器');

  const hideBrowserLogin = !LOGIN_HANDOFF_ENABLED && isIosStandalone(
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
    isStandalonePwa(),
    typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0),
  );

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
          <p
            class="line-login-hint-note line-login-hint-open-note"
            data-i18n="lineLoginHint.openInLineNote"
          >
            {openInLineNote}
          </p>
          {!hideBrowserLogin && (
            <>
              <div class="line-login-hint-or" data-i18n="lineLoginHint.or">
                {lt('lineLoginHint.or', '或')}
              </div>
              <button
                class="line-login-hint-action line-login-hint-login"
                type="button"
                data-i18n="lineLoginHint.browserLogin"
                onClick={onConfirm}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="#fff"
                  stroke-width="1.7"
                  stroke-linecap="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <ellipse cx="12" cy="12" rx="3.8" ry="9" />
                  <path d="M3 12h18" />
                </svg>
                {browserLogin}
              </button>
              <p
                class="line-login-hint-note line-login-hint-browser-note"
                data-i18n="lineLoginHint.browserLoginNote"
              >
                {browserLoginNote}
              </p>
            </>
          )}
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
