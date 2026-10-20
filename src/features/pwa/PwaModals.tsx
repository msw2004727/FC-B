// PWA 安裝教學彈窗（M-030、M-031、U-007）：完全照 A `js/modules/pwa-install.js` 的 DOM、id、class 與文字。

import { createPortal } from 'preact/compat';
import { toast } from '@/ui/Toast';
import { copyTextToClipboard, isLineInAppBrowser } from './pwa-install';

export type PwaModalStep = 'none' | 'picker' | 'android' | 'ios';

export interface PwaModalsProps {
  step: PwaModalStep;
  onChangeStep: (next: PwaModalStep) => void;
}

const SITE_URL = 'https://toosterx.com';

async function handleCopySiteUrl(): Promise<void> {
  const ok = await copyTextToClipboard(SITE_URL);
  toast.show({ message: ok ? '網址已複製' : '複製失敗，請手動複製' });
}

export function PwaModals({ step, onChangeStep }: PwaModalsProps): preact.JSX.Element | null {
  if (step === 'none' || typeof document === 'undefined') return null;

  const close = (): void => onChangeStep('none');

  if (step === 'picker') {
    return createPortal(
      <div class="legacy-ui legacy-chrome">
        <div
          id="pwa-system-picker"
          class="pwa-modal-overlay visible"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div class="pwa-picker-panel">
            <div class="pwa-picker-header">
              <span>安裝 ToosterX APP</span>
              <button
                type="button"
                class="pwa-modal-close"
                id="pwa-picker-close"
                onClick={close}
              >
                &times;
              </button>
            </div>
            <div class="pwa-picker-body">
              <p class="pwa-picker-desc">請選擇你的手機系統，我們將引導你完成安裝：</p>
              <div class="pwa-picker-btns">
                <button
                  type="button"
                  class="pwa-picker-btn pwa-picker-android"
                  id="pwa-pick-android"
                  onClick={() => onChangeStep('android')}
                >
                  <span class="pwa-picker-icon">&#x1F4F1;</span>
                  <span class="pwa-picker-label">Android</span>
                  <span class="pwa-picker-sub">使用 Chrome 安裝</span>
                </button>
                <button
                  type="button"
                  class="pwa-picker-btn pwa-picker-ios"
                  id="pwa-pick-ios"
                  onClick={() => onChangeStep('ios')}
                >
                  <span class="pwa-picker-icon">&#x1F34F;</span>
                  <span class="pwa-picker-label">iPhone / iPad</span>
                  <span class="pwa-picker-sub">使用 Safari 安裝</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  if (step === 'android') {
    return createPortal(
      <div class="legacy-ui legacy-chrome">
        <div
          id="pwa-android-modal"
          class="pwa-modal-overlay visible"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div class="pwa-guide-panel">
            <div class="pwa-guide-header">
              <span>Android 安裝教學</span>
              <button
                type="button"
                class="pwa-modal-close"
                id="pwa-android-close"
                onClick={close}
              >
                &times;
              </button>
            </div>
            <div class="pwa-guide-body">
              <div class="pwa-guide-step">
                <div class="pwa-guide-num">1</div>
                <div class="pwa-guide-text">
                  <strong>複製網址</strong>
                  <br />
                  點擊下方按鈕複製本站網址
                </div>
              </div>
              <button
                type="button"
                class="pwa-guide-copy-btn"
                id="pwa-android-copy"
                onClick={() => {
                  handleCopySiteUrl().catch(() => undefined);
                }}
              >
                複製網址
              </button>
              <div class="pwa-guide-url-hint">toosterx.com</div>
              <div class="pwa-guide-divider" />
              <div class="pwa-guide-step">
                <div class="pwa-guide-num">2</div>
                <div class="pwa-guide-text">
                  <strong>用 Chrome 瀏覽器開啟</strong>
                  <br />
                  打開 Chrome，在網址列貼上剛才複製的網址
                </div>
              </div>
              <div class="pwa-guide-divider" />
              <div class="pwa-guide-step">
                <div class="pwa-guide-num">3</div>
                <div class="pwa-guide-text">
                  <strong>點擊右上角選單 ⋮</strong>
                  <br />
                  找到「安裝應用程式」或「加到主畫面」，點擊即完成安裝
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  const isLINE = isLineInAppBrowser();
  return createPortal(
    <div class="legacy-ui legacy-chrome">
      <div
        id="pwa-ios-modal"
        class="pwa-modal-overlay visible"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div class="pwa-guide-panel">
          <div class="pwa-guide-header">
            <span>iPhone / iPad 安裝教學</span>
            <button
              type="button"
              class="pwa-modal-close"
              id="pwa-ios-close"
              onClick={close}
            >
              &times;
            </button>
          </div>
          <div class="pwa-guide-body">
            {isLINE && (
              <>
                <div class="pwa-guide-step pwa-guide-step-highlight">
                  <div class="pwa-guide-num pwa-guide-num-warn">!</div>
                  <div class="pwa-guide-text">
                    <strong>請先回到桌面，用 Safari 開啟本網站</strong>
                    <br />
                    網址：toosterx.com
                  </div>
                </div>
                <div class="pwa-guide-divider" />
              </>
            )}
            <div class="pwa-guide-step">
              <div class="pwa-guide-num">1</div>
              <div class="pwa-guide-text">
                <strong>複製網址</strong>
                <br />
                點擊下方按鈕複製本站網址，再到 Safari 貼上開啟
              </div>
            </div>
            <button
              type="button"
              class="pwa-guide-copy-btn"
              id="pwa-ios-copy"
              onClick={() => {
                handleCopySiteUrl().catch(() => undefined);
              }}
            >
              複製網址
            </button>
            <div class="pwa-guide-url-hint">toosterx.com</div>
            <div class="pwa-guide-divider" />
            <div class="pwa-guide-step">
              <div class="pwa-guide-num">2</div>
              <div class="pwa-guide-text">
                <strong>點擊 Safari 底部的「分享」按鈕</strong>
                <br />
                方框加向上箭頭的圖示
              </div>
            </div>
            <div class="pwa-guide-img-wrap">
              <img class="pwa-guide-img" src="/PWA/PWA01.jpg" alt="步驟2" />
            </div>
            <div class="pwa-guide-divider" />
            <div class="pwa-guide-step">
              <div class="pwa-guide-num">3</div>
              <div class="pwa-guide-text">
                <strong>往下滑，點選「加入主畫面」</strong>
                <br />
                在分享選單列表中找到此選項
              </div>
            </div>
            <div class="pwa-guide-img-wrap">
              <img class="pwa-guide-img" src="/PWA/PWA02.jpg" alt="步驟3" />
            </div>
            <div class="pwa-guide-divider" />
            <div class="pwa-guide-step">
              <div class="pwa-guide-num">4</div>
              <div class="pwa-guide-text">
                <strong>點右上角「加入」完成安裝</strong>
                <br />
                APP 圖示將出現在你的主畫面
              </div>
            </div>
            <div class="pwa-guide-img-wrap">
              <img class="pwa-guide-img" src="/PWA/PWA03.jpg" alt="步驟4" />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
