import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { useLegacyT } from '@/i18n/i18n';
import { PROFILE_INFO, type ProfileInfoKey } from './profile-info';

/**
 * M-121 前半：卡標題「?」按鈕與說明視窗（照 A `profile-data.js#_showProfileInfo`）。
 * DOM 照 A：`.edu-info-overlay > .edu-info-dialog > title + body + .primary-btn`。
 * 用 createPortal 掛到 body、外包 `.legacy-ui`，開啟時 pushOverlay 讓返回鍵先關說明框。
 */
export function ProfileInfoButton(props: { infoKey: ProfileInfoKey }): JSX.Element {
  const { infoKey } = props;
  const lt = useLegacyT();
  const [open, setOpen] = useState(false);

  // 照 A：返回鍵先關這個說明視窗（callback 放 ref 避免重繪重推歷史）。
  const closeRef = useRef<() => void>(() => setOpen(false));
  closeRef.current = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const release = pushOverlay(() => {
      closeRef.current();
      return true;
    });
    const handleKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      release();
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [open]);

  const info = PROFILE_INFO[infoKey];

  return (
    <>
      <button
        type="button"
        class="edu-info-btn"
        title={lt('說明', '說明')}
        data-i18n-title="說明"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(e) => {
          // 阻止 Enter/Space 冒泡到外層收折標題
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
          }
        }}
      >
        ?
      </button>
      {open && info && createPortal(
        <div class="legacy-ui">
          <div
            class="edu-info-overlay"
            onClick={(ev) => {
              if (ev.target === ev.currentTarget) setOpen(false);
            }}
          >
            <div class="edu-info-dialog">
              <div class="edu-info-dialog-title">{lt(info.title, info.title)}</div>
              <div
                class="edu-info-dialog-body"
                // 內容為程式碼常數（profile-info.ts::PROFILE_INFO），A 原本就是 HTML 字串。
                dangerouslySetInnerHTML={{ __html: info.body }}
              />
              <button
                type="button"
                class="primary-btn"
                style={{ width: '100%', marginTop: '.8rem', flexShrink: 0 }}
                onClick={() => setOpen(false)}
              >
                {lt('了解', '了解')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
