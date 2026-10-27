/**
 * 冷啟動 REST 讀取的連線目標守門（T-042c 審查退修 F1）。
 *
 * `banners-rest.ts` 是直接 `fetch` 正式的 `firestore.googleapis.com`，不經過 Firebase SDK 初始化，所以繞過了
 * `data/firebase.ts` 的「本機只能連 emulator」守門（`assertFirebaseTargetAllowed`）。這裡把同一組判斷補上：
 * 使用 emulator（`shouldUseEmulator()`），或網址是本機／區網（`isLocalOrPrivateHostname`，含 localhost、127.0.0.1、
 * 10.x、172.16～31.x、192.168.x、*.local）時一律不發 REST；SDK 路徑照舊（emulator 或被守門擋下）。
 * 兩個函式都來自 `@/data/firebase`（HomePage 本來就靜態 import 它，入口圖沒有新增模組）；不放在 `banners-rest.ts`，
 * 讓 REST 模組維持「只 import firebase-config」。
 */
import { isLocalOrPrivateHostname, shouldUseEmulator } from '@/data/firebase';

export function canUseBannersRest(hostname: string = typeof location === 'undefined' ? '' : location.hostname): boolean {
  return !shouldUseEmulator() && !isLocalOrPrivateHostname(hostname);
}
