// 危險確認框：框、訊息、「取消」照全站的 appConfirm；只在框開著的那段時間在 <html> 掛 class，
// 讓 competitions.css 把「確定」畫成紅框。不改確認流程、不替呼叫端改預設焦點。
// 計數記在 <html> 的屬性上，不用模組變數：清單頁不能匯入這支檔，要在自己檔內抄同樣幾行，
// 兩份共用同一個計數才不會互相提早拿掉 class。class 名稱與屬性名稱兩邊要一致。
// ASSUMPTION: appConfirm 的每一條關閉路徑（確定、取消、Esc、返回鍵、測試重設）都會 resolve，
// 所以 finally 一定會跑；try…finally 是防未來多出 reject 的路徑。

import { appConfirm, type AppConfirmOptions } from '@/ui/AppConfirm';

export const DANGER_CONFIRM_CLASS = 'cp-danger-confirm';
/** 現在有幾個危險確認還沒關。 */
export const DANGER_CONFIRM_COUNT_ATTR = 'data-cp-danger-confirm';

function openCount(root: HTMLElement): number {
  const n = Number.parseInt(root.getAttribute(DANGER_CONFIRM_COUNT_ATTR) ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function dangerConfirm(message: string, options?: AppConfirmOptions): Promise<boolean> {
  const root = document.documentElement;
  // 呼叫 appConfirm 之前就掛上，框第一次畫出來就是危險長相。
  root.setAttribute(DANGER_CONFIRM_COUNT_ATTR, String(openCount(root) + 1));
  root.classList.add(DANGER_CONFIRM_CLASS);
  try {
    return await appConfirm(message, options);
  } finally {
    const left = openCount(root) - 1;
    if (left > 0) {
      root.setAttribute(DANGER_CONFIRM_COUNT_ATTR, String(left));
    } else {
      root.removeAttribute(DANGER_CONFIRM_COUNT_ATTR);
      root.classList.remove(DANGER_CONFIRM_CLASS);
    }
  }
}
