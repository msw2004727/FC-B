/**
 * A `event-create.js#_showCeInfo` 的說明視窗（T-013 第 5 批）。
 * 照 A DOM 輸出 `.edu-info-overlay` / `.edu-info-dialog`；用 createPortal 掛到 document.body，
 * 外包 `.legacy-ui`，返回鍵用 pushOverlay 關閉（照 CompanionSelectModal 寫法）。
 */
import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { useLegacyT } from '@/i18n/i18n';
import { CE_INFO, type CeInfoKey } from './ce-info';

export interface CeInfoDialogProps {
  infoKey: CeInfoKey | null;
  onClose(): void;
}

export function CeInfoDialog({ infoKey, onClose }: CeInfoDialogProps): JSX.Element | null {
  const lt = useLegacyT();

  // 照 A：開啟時登記實體返回鍵，返回鍵先關這個說明視窗。
  // 照 CompanionSelectModal：callback 放 ref，避免父層重繪時重複推退歷史紀錄（Gemini 審 P3）。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!infoKey) return;
    const release = pushOverlay(() => {
      onCloseRef.current();
      return true;
    });
    return () => {
      release();
    };
  }, [infoKey]);

  if (!infoKey) return null;
  const info = CE_INFO[infoKey];
  if (!info) return null;

  return createPortal(
    <div class="legacy-ui">
      <div
        class="edu-info-overlay"
        // A CSS 的 .edu-info-overlay z-index 不足以蓋過 #create-event-modal（1110），
        // 這裡用 inline z-index 1300 蓋上去（照 A 的「開啟於最上層」意圖）。
        style={{ zIndex: 1300 }}
        onClick={(ev) => {
          if (ev.target === ev.currentTarget) onClose();
        }}
      >
        <div class="edu-info-dialog">
          <div class="edu-info-dialog-title">{lt(info.title, info.title)}</div>
          <div
            class="edu-info-dialog-body"
            // 內容為程式碼常數（ce-info.ts::CE_INFO），A 原本就是 HTML 字串。
            dangerouslySetInnerHTML={{ __html: info.body }}
          />
          <button
            type="button"
            class="primary-btn"
            style={{ width: '100%', marginTop: '.8rem', flexShrink: 0 }}
            onClick={onClose}
          >
            {lt('了解')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
