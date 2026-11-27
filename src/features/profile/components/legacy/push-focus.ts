// 九宮格存檔後按「開啟通知」帶 ?open=line&focus=push 進個人頁（站長 2026-11-27）：
// 通知面板展開後，等「手機／電腦通知」列（延後載入）真的畫出來再捲到它，最後把 focus 從網址拿掉。
// 只用 replaceState 改網址、沿用原 history.state，不新增歷史紀錄，返回鍵行為不變。找不到就安靜結束，不報錯。

import { QUICK_PANEL_ID } from './ProfileQuickBar';

const ROW = `#${QUICK_PANEL_ID} .wp-block`;
// 推播列程式到之前先放等高空白（WebPushSlot），先捲到空白，列換上時位置不變。
const PLACEHOLDER = `#${QUICK_PANEL_ID} .wp-placeholder`;
/** 等不到推播列（不支援推播的環境、分塊載入失敗）就捲到通知面板本身。 */
export const PUSH_FOCUS_WAIT_MS = 3000;

/** 網址有 focus=push 時回傳 true。 */
export function hasPushFocus(search: string): boolean {
  return new URLSearchParams(search).get('focus') === 'push';
}

function clearFocusParam(): void {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has('focus')) return;
    url.searchParams.delete('focus');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* ignore */
  }
}

function scrollTo(el: Element | null): boolean {
  if (!el) return false;
  try {
    // 'auto'：LINE WebView／舊版 iOS 的平滑捲動會被延後載入的版面變動打斷，直接跳到位較穩。
    el.scrollIntoView?.({ block: 'center', behavior: 'auto' });
  } catch {
    /* ignore */
  }
  return true;
}

/** 開始等推播列並捲過去；回傳取消函式（頁面卸載時呼叫）。 */
export function focusPushRow(): () => void {
  let done = false;
  let onPlaceholder = false;
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const finish = (): void => {
    if (done) return;
    done = true;
    observer?.disconnect();
    if (timer !== null) clearTimeout(timer);
    clearFocusParam();
  };

  const check = (): void => {
    if (done) return;
    if (scrollTo(document.querySelector(ROW))) {
      finish();
      return;
    }
    if (!onPlaceholder && scrollTo(document.querySelector(PLACEHOLDER))) onPlaceholder = true;
  };

  check();
  if (done) return finish;
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  timer = setTimeout(() => {
    if (!onPlaceholder) scrollTo(document.getElementById(QUICK_PANEL_ID));
    finish();
  }, PUSH_FOCUS_WAIT_MS);
  return () => {
    if (done) return;
    done = true;
    observer?.disconnect();
    if (timer !== null) clearTimeout(timer);
  };
}
