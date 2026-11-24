// 推播列的環境判斷（純函式）。個人頁展開推播頁籤時同步呼叫，不等網路。
// iOS 判斷與 `src/data/login-redirect.ts` 的 isIosStandalone 同一套 UA 規則；
// LINE 判斷同 `src/features/pwa/pwa-install.ts` 的 isLineInAppBrowser（/Line\//i）。
// 本檔只給個人頁（WebPushSlot）用；推播列與開機模組不得 import（會讓個人頁分塊多出匯出或拆出共用分塊，改到入口）。

export type WebPushEnv = 'line-android' | 'line-ios' | 'ios-home' | 'unsupported' | 'capable';

export interface WebPushEnvInput {
  ua: string;
  standalone: boolean;
  maxTouchPoints: number;
  hasNotification: boolean;
  hasPushManager: boolean;
  hasServiceWorker: boolean;
}

/**
 * iPhone／iPad／iPod，或觸控的 Macintosh UA（iPad）。與 login-redirect.ts 的 isIosStandalone 同一條規則（env.test.ts 鎖住兩者一致）；
 * 不直接 import：會改變個人頁分塊的相依順序，首頁主程式多 3 B。
 */
export function isIosUa(ua: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

/** iOS 主版號與次版號；讀不到回 null。iPhone 用「OS 17_2」，iPad 觸控 Mac UA 用「Version/17.2」。 */
export function iosVersionOf(ua: string): [number, number] | null {
  const m = /\bOS (\d+)[_.](\d+)/.exec(ua) ?? /\bVersion\/(\d+)\.(\d+)/.exec(ua);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function iosAtLeast164(ua: string): boolean {
  const v = iosVersionOf(ua);
  return !!v && (v[0] > 16 || (v[0] === 16 && v[1] >= 4));
}

export function detectWebPushEnv(input: WebPushEnvInput): WebPushEnv {
  const ios = isIosUa(input.ua, input.maxTouchPoints);
  // 設計書 §4.1 由上往下：iOS < 16.4 屬 H（含 LINE 內），先判斷。
  if (ios && !iosAtLeast164(input.ua)) return 'unsupported';
  if (/Line\//i.test(input.ua)) return ios ? 'line-ios' : 'line-android';
  if (ios && !input.standalone) return 'ios-home';
  if (!input.hasNotification || !input.hasPushManager || !input.hasServiceWorker) return 'unsupported';
  return 'capable';
}

/** 讀目前瀏覽器；任何例外都當不支援。 */
export function readWebPushEnvInput(): WebPushEnvInput | null {
  try {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return null;
    const nav = navigator as Navigator & { standalone?: boolean };
    let standalone = nav.standalone === true;
    if (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) standalone = true;
    return {
      ua: nav.userAgent || '',
      standalone,
      maxTouchPoints: nav.maxTouchPoints ?? 0,
      hasNotification: 'Notification' in window,
      hasPushManager: 'PushManager' in window,
      hasServiceWorker: 'serviceWorker' in nav,
    };
  } catch {
    return null;
  }
}

/** iPhone／iPad 主畫面 App：封鎖時顯示 iPhone 設定步驟。 */
export function isIosStandaloneEnv(input: WebPushEnvInput | null): boolean {
  return !!input && input.standalone && isIosUa(input.ua, input.maxTouchPoints);
}
