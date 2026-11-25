// PWA 安裝教學彈窗（M-030、M-031、U-007）：DOM、id、class 照 A `js/modules/pwa-install.js`。
// 文字 2026-11-25 依站長同意的核對結果修正（iOS 26「⋯」裡的分享、「打開為網頁 App」開關、390 寬不折行），並改為七語（pwa-guide-i18n）。

import { createPortal } from 'preact/compat';
import { toast } from '@/ui/Toast';
import { copyTextToClipboard, isLineInAppBrowser } from './pwa-install';
import { useGuideT, type GuideT } from './pwa-guide-i18n';

export type PwaModalStep = 'none' | 'picker' | 'android' | 'ios';

export interface PwaModalsProps {
  step: PwaModalStep;
  onChangeStep: (next: PwaModalStep) => void;
}

const SITE_URL = 'https://toosterx.com';

async function handleCopySiteUrl(t: GuideT): Promise<void> {
  const ok = await copyTextToClipboard(SITE_URL);
  toast.show({ message: ok ? t('copied') : t('copyFailed') });
}

export function PwaModals({ step, onChangeStep }: PwaModalsProps): preact.JSX.Element | null {
  const t = useGuideT();
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
              <span>{t('pickerTitle')}</span>
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
              <p class="pwa-picker-desc">{t('pickerDesc')}</p>
              <div class="pwa-picker-btns">
                <button
                  type="button"
                  class="pwa-picker-btn pwa-picker-android"
                  id="pwa-pick-android"
                  onClick={() => onChangeStep('android')}
                >
                  <span class="pwa-picker-icon">&#x1F4F1;</span>
                  <span class="pwa-picker-label">Android</span>
                  <span class="pwa-picker-sub">{t('pickAndroidSub')}</span>
                </button>
                <button
                  type="button"
                  class="pwa-picker-btn pwa-picker-ios"
                  id="pwa-pick-ios"
                  onClick={() => onChangeStep('ios')}
                >
                  <span class="pwa-picker-icon">&#x1F34F;</span>
                  <span class="pwa-picker-label">iPhone / iPad</span>
                  <span class="pwa-picker-sub">{t('pickIosSub')}</span>
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
              <span>{t('androidTitle')}</span>
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
                  <strong>{t('copyStep')}</strong>
                  <br />
                  {t('copyHintAndroid')}
                </div>
              </div>
              <button
                type="button"
                class="pwa-guide-copy-btn"
                id="pwa-android-copy"
                onClick={() => {
                  handleCopySiteUrl(t).catch(() => undefined);
                }}
              >
                {t('copyBtn')}
              </button>
              <div class="pwa-guide-url-hint">toosterx.com</div>
              <div class="pwa-guide-divider" />
              <div class="pwa-guide-step">
                <div class="pwa-guide-num">2</div>
                <div class="pwa-guide-text">
                  <strong>{t('androidOpenStep')}</strong>
                  <br />
                  {t('androidOpenHint')}
                </div>
              </div>
              <div class="pwa-guide-divider" />
              <div class="pwa-guide-step">
                <div class="pwa-guide-num">3</div>
                <div class="pwa-guide-text">
                  <strong>{t('androidMenuStep')}</strong>
                  <br />
                  {t('androidMenuHint1')}
                  <br />
                  {t('androidMenuHint2')}
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
            <span>{t('iosTitle')}</span>
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
                    <strong>{t('lineWarn')}</strong>
                    <br />
                    {t('lineUrl')}
                  </div>
                </div>
                <div class="pwa-guide-divider" />
              </>
            )}
            <div class="pwa-guide-step">
              <div class="pwa-guide-num">1</div>
              <div class="pwa-guide-text">
                <strong>{t('copyStep')}</strong>
                <br />
                {t('copyHintIos')}
              </div>
            </div>
            <button
              type="button"
              class="pwa-guide-copy-btn"
              id="pwa-ios-copy"
              onClick={() => {
                handleCopySiteUrl(t).catch(() => undefined);
              }}
            >
              {t('copyBtn')}
            </button>
            <div class="pwa-guide-url-hint">toosterx.com</div>
            <div class="pwa-guide-divider" />
            <div class="pwa-guide-step">
              <div class="pwa-guide-num">2</div>
              <div class="pwa-guide-text">
                <strong>{t('iosShareStep')}</strong>
                <br />
                {t('iosShareHint')}
              </div>
            </div>
            <div class="pwa-guide-img-wrap">
              <img class="pwa-guide-img" src="/PWA/PWA01.jpg" alt={t('stepAlt', { n: 2 })} />
            </div>
            <div class="pwa-guide-divider" />
            <div class="pwa-guide-step">
              <div class="pwa-guide-num">3</div>
              <div class="pwa-guide-text">
                <strong>{t('iosAddStep')}</strong>
                <br />
                {t('iosAddHint')}
              </div>
            </div>
            <div class="pwa-guide-img-wrap">
              <img class="pwa-guide-img" src="/PWA/PWA02.jpg" alt={t('stepAlt', { n: 3 })} />
            </div>
            <div class="pwa-guide-divider" />
            <div class="pwa-guide-step">
              <div class="pwa-guide-num">4</div>
              <div class="pwa-guide-text">
                <strong>{t('iosWebAppStep')}</strong>
                <br />
                {t('iosWebAppHint')}
              </div>
            </div>
            <div class="pwa-guide-img-wrap">
              <img class="pwa-guide-img" src="/PWA/PWA03.jpg" alt={t('stepAlt', { n: 4 })} />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
