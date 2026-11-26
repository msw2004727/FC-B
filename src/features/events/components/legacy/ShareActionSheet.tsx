import { render, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
// 樣式原本在 activity.css；搬來跟著本元件載入，賽事頁（沒載 activity.css）重用同一份選單也有樣式。
import './share-action-sheet.css';

export type ShareChoice = 'line' | 'line-share' | 'copy' | 'cancel';

/** 選單文字。活動分享不傳，維持原本中文；賽事分享傳七語系文案。 */
export interface ShareSheetLabels {
  friends: string;
  friendsSub: string;
  community: string;
  communitySub: string;
  toLine: string;
  copy: string;
  copySub: string;
  cancel: string;
}

const DEFAULT_LABELS: ShareSheetLabels = {
  friends: 'LINE 好友',
  friendsSub: '精美卡片・好友 / 群組',
  community: 'LINE 社群',
  communitySub: '純文字・支援 OpenChat',
  toLine: '分享到 LINE',
  copy: '複製連結',
  copySub: 'toosterx 原域名',
  cancel: '取消',
};

interface Props {
  canPicker: boolean;
  title?: string;
  labels?: ShareSheetLabels;
  onChoice: (choice: ShareChoice) => void;
}

// 照 A _showShareActionSheet。
export function ShareActionSheet({
  canPicker,
  title = '分享活動',
  labels: text = DEFAULT_LABELS,
  onChoice,
}: Props): JSX.Element {
  const [active, setActive] = useState(false);
  const closing = useRef(false);
  const choiceHandler = useRef(onChoice);
  choiceHandler.current = onChoice;

  function close(choice: ShareChoice): void {
    if (closing.current) return;
    closing.current = true;
    setActive(false);
    // 照 A cleanup(choice)：當下同步回報選擇（保留點擊手勢），退場動畫由外層延遲卸載。
    choiceHandler.current(choice);
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => setActive(true));
    const release = pushOverlay(() => {
      close('cancel');
      return true;
    });
    return () => {
      cancelAnimationFrame(frame);
      release();
    };
  }, []);

  return (
    <div
      class={`share-action-sheet${active ? ' active' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) close('cancel');
      }}
    >
      <div
        class="share-action-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div class="share-action-sheet-title">{title}</div>
        <div class="share-action-sheet-grid">
          {canPicker ? (
            <>
              <button
                type="button"
                class="share-action-sheet-btn"
                data-choice="line"
                onClick={() => close('line')}
              >
                <span class="share-action-sheet-btn-icon">💚</span>
                <span class="share-action-sheet-btn-label">
                  {text.friends}
                  <span class="share-action-sheet-btn-sub">{text.friendsSub}</span>
                </span>
              </button>
              <button
                type="button"
                class="share-action-sheet-btn"
                data-choice="line-share"
                onClick={() => close('line-share')}
              >
                <span class="share-action-sheet-btn-icon">💬</span>
                <span class="share-action-sheet-btn-label">
                  {text.community}
                  <span class="share-action-sheet-btn-sub">{text.communitySub}</span>
                </span>
              </button>
            </>
          ) : (
            <button
              type="button"
              class="share-action-sheet-btn"
              data-choice="line-share"
              onClick={() => close('line-share')}
            >
              <span class="share-action-sheet-btn-icon">💬</span>
              <span class="share-action-sheet-btn-label">{text.toLine}</span>
            </button>
          )}
          <button
            type="button"
            class="share-action-sheet-btn"
            data-choice="copy"
            onClick={() => close('copy')}
          >
            <span class="share-action-sheet-btn-icon">📋</span>
            <span class="share-action-sheet-btn-label">
              {text.copy}
              <span class="share-action-sheet-btn-sub">{text.copySub}</span>
            </span>
          </button>
        </div>
        <button
          type="button"
          class="share-action-sheet-cancel"
          data-choice="cancel"
          onClick={() => close('cancel')}
        >
          {text.cancel}
        </button>
      </div>
    </div>
  );
}

export function showShareActionSheet(
  canPicker: boolean,
  signal: AbortSignal,
  title?: string,
  labels?: ShareSheetLabels,
): Promise<ShareChoice> {
  if (signal.aborted) return Promise.resolve('cancel');

  return new Promise((resolve, reject) => {
    const host = document.createElement('div');
    // legacy 樣式限定於 .legacy-ui，body 掛載點也需保留作用域。
    host.className = 'legacy-ui';
    let settled = false;

    const cleanup = (): void => {
      signal.removeEventListener('abort', abort);
      render(null, host);
      host.remove();
    };
    // 照 A：選擇後立即 resolve，overlay 退場 400ms 後才移除；中止時立即移除。
    const finish = (choice: ShareChoice, immediate = false): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      resolve(choice);
      if (immediate) cleanup();
      else setTimeout(cleanup, 400);
    };
    const abort = (): void => finish('cancel', true);

    signal.addEventListener('abort', abort, { once: true });
    try {
      document.body.appendChild(host);
      render(
        <ShareActionSheet canPicker={canPicker} title={title} labels={labels} onChoice={finish} />,
        host,
      );
    } catch (error) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    }
  });
}
