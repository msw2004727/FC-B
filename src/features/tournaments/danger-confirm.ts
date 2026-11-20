// 刪除外部賽事的危險確認框（新外觀清-5，第 1a 批規格 3.12）：框、訊息、「取消」照全站的 appConfirm；
// 只在框開著的那段時間在 <html> 掛 class，讓 list-v2.css 把「確定」畫成紅框。
// 與站內賽事那份（competitions/ui/danger-confirm.ts）是同樣幾行：清單頁不能匯入站內賽事的延遲載入檔
// （會多出一支共用模組、功能開關關閉時也會把站內賽事的程式打進來），所以在這裡抄一份。
// class 名稱、計數屬性名稱與兩條樣式的值必須與那份逐字相同；計數記在 <html> 的屬性上，兩份共用同一個計數。
// ASSUMPTION: appConfirm 的每一條關閉路徑都會 resolve，finally 一定會跑；try…finally 是防未來多出 reject 的路徑。

import { appConfirm } from '@/ui/AppConfirm';

export const DANGER_CONFIRM_CLASS = 'cp-danger-confirm';
/** 現在有幾個危險確認還沒關。 */
export const DANGER_CONFIRM_COUNT_ATTR = 'data-cp-danger-confirm';

function openCount(root: HTMLElement): number {
  const n = Number.parseInt(root.getAttribute(DANGER_CONFIRM_COUNT_ATTR) ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function dangerConfirm(message: string): Promise<boolean> {
  const root = document.documentElement;
  // 呼叫 appConfirm 之前就掛上，框第一次畫出來就是危險長相。
  root.setAttribute(DANGER_CONFIRM_COUNT_ATTR, String(openCount(root) + 1));
  root.classList.add(DANGER_CONFIRM_CLASS);
  try {
    return await appConfirm(message);
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
