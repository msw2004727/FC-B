import { render, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';

export type ShareChoice = 'line' | 'line-share' | 'copy' | 'cancel';

interface Props {
  canPicker: boolean;
  title?: string;
  onChoice: (choice: ShareChoice) => void;
}

// 照 A _showShareActionSheet。
export function ShareActionSheet({
  canPicker,
  title = '分享活動',
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
                  LINE 好友
                  <span class="share-action-sheet-btn-sub">精美卡片・好友 / 群組</span>
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
                  LINE 社群
                  <span class="share-action-sheet-btn-sub">純文字・支援 OpenChat</span>
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
              <span class="share-action-sheet-btn-label">分享到 LINE</span>
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
              複製連結
              <span class="share-action-sheet-btn-sub">toosterx 原域名</span>
            </span>
          </button>
        </div>
        <button
          type="button"
          class="share-action-sheet-cancel"
          data-choice="cancel"
          onClick={() => close('cancel')}
        >
          取消
        </button>
      </div>
    </div>
  );
}

export function showShareActionSheet(
  canPicker: boolean,
  signal: AbortSignal,
  title?: string,
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
        <ShareActionSheet canPicker={canPicker} title={title} onChoice={finish} />,
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
