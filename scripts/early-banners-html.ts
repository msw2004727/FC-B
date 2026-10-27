/**
 * index.html 的「冷啟動提早發橫幅 REST」內嵌 script（`<script id="fcb-early-banners">`，T-042d）的建置期處理。
 *
 * 內嵌 script 無法 import，所以兩個會變動的常數用代號留在原始碼裡，建置（與 dev server）時由這裡換成真值：
 * - `__FCB_PROJECT_ID__` → `FIREBASE_CONFIG.projectId`（不在 script 裡另外硬編一份）
 * - `__FCB_APP_VERSION__` → `APP_VERSION`（script 要用它判斷首屏快照是否因版本不同而失效，同 `home-snapshot.ts#isFresh`）
 * emulator 模式（非 PROD 建置且 `VITE_FIREBASE_EMULATOR=1`，同 `data/firebase.ts#shouldUseEmulator`）整段移除：
 * REST 會繞過 SDK 的連線目標守門，emulator 下絕不能對正式 Firestore 發請求。
 *
 * 找不到 script 區塊、代號數量不對、值格式不合一律丟錯讓建置失敗，不靜默發出一個指向錯誤專案的請求。
 */
import type { Plugin } from 'vite';

export const EARLY_BANNERS_SCRIPT_ID = 'fcb-early-banners';
export const EARLY_BANNERS_PROJECT_TOKEN = '__FCB_PROJECT_ID__';
export const EARLY_BANNERS_VERSION_TOKEN = '__FCB_APP_VERSION__';

/** 整個 `<script id="fcb-early-banners">…</script>` 區塊（含前面的縮排與後面的換行）。 */
const SCRIPT_BLOCK = new RegExp(`[ \\t]*<script id="${EARLY_BANNERS_SCRIPT_ID}">[\\s\\S]*?</script>[ \\t]*\\r?\\n?`);
/** Firebase 專案 ID 與 `APP_VERSION` 的格式：只准字母、數字、`-`、`.`，不可能帶出引號或標籤。 */
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const APP_VERSION_PATTERN = /^[0-9A-Za-z.]{1,40}$/;

export interface EarlyBannersHtmlOptions {
  projectId: string;
  appVersion: string;
}

function replaceToken(source: string, token: string, value: string): string {
  const parts = source.split(token);
  if (parts.length !== 2) throw new Error(`index.html 的 #${EARLY_BANNERS_SCRIPT_ID} 應該恰好有一個 ${token}（實際 ${parts.length - 1} 個）`);
  return parts.join(value);
}

/** 純函式：回傳換好代號（或整段移除）的 HTML。 */
export function transformEarlyBannersHtml(html: string, options: EarlyBannersHtmlOptions & { emulator: boolean }): string {
  const block = SCRIPT_BLOCK.exec(html);
  if (!block) throw new Error(`index.html 找不到 <script id="${EARLY_BANNERS_SCRIPT_ID}">`);
  if (options.emulator) return html.replace(SCRIPT_BLOCK, '');
  if (!PROJECT_ID_PATTERN.test(options.projectId)) throw new Error('early-banners：projectId 格式不合');
  if (!APP_VERSION_PATTERN.test(options.appVersion)) throw new Error('early-banners：appVersion 格式不合');
  let script = replaceToken(block[0], EARLY_BANNERS_PROJECT_TOKEN, options.projectId);
  script = replaceToken(script, EARLY_BANNERS_VERSION_TOKEN, options.appVersion);
  return html.replace(SCRIPT_BLOCK, () => script);
}

export function earlyBannersHtml(options: EarlyBannersHtmlOptions): Plugin {
  let emulator = false;
  return {
    name: 'fcb-early-banners-html',
    configResolved(config) {
      // 與 data/firebase.ts 的 shouldUseEmulator() 同一條件：import.meta.env.PROD 即 config.isProduction。
      emulator = !config.isProduction && config.env.VITE_FIREBASE_EMULATOR === '1';
    },
    transformIndexHtml(html) {
      return transformEarlyBannersHtml(html, { ...options, emulator });
    },
  };
}
