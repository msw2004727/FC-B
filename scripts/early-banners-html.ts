/**
 * index.html 的「冷啟動提早發橫幅 REST」內嵌 script（`<script id="fcb-early-banners">`，T-042d）的設計說明與建置期處理。
 *
 * ## 這段 script 做什麼（只有兩件，沒有第三件）
 * 1. HTML 一到就發匿名 `runQuery`（同 `features/home/data/banners-rest.ts`：無 key／Authorization、`credentials: 'omit'`、4 秒逾時、
 *    256 KB 上限），把「原始回應」（解析後的 JSON 陣列，不映射）掛在 `window.__fcbEarlyBanners`（Promise；失敗一律 null、不 reject、不寫 console）。
 * 2. 第一張候選橫幅的圖網址通過 https＋白名單主機（`firebasestorage.googleapis.com` 或同源）才插一個
 *    `<link rel="preload" as="image" fetchpriority="high">`。
 * 不解析成畫面資料、不寫快照、不 import 任何模組：映射、`toPublicBanners` 白名單與快照寫入守門都在 HomePage
 * （`banners-rest.ts#startBannersRestFetch` 接手這個 Promise）。
 *
 * ## 發不發的條件（`src/app/early-banners.test.ts` 與 `canUseBannersRest()`＋`readBannersSnapshot()` 逐案對照）
 * 本機／區網網址、有效首屏快照（暖啟動）、emulator 一律不發；另外只在首頁網址（路徑 `/` 且無查詢字串）才發，
 * 因為 `/?event=…`、`/?team=…`、LIFF 的 `liff.state` 會被導去別頁，白發請求與預載圖只會搶頻寬。
 *
 * ## 日後若加 CSP
 * 必須放行 `connect-src https://firestore.googleapis.com` 與 `img-src https://firebasestorage.googleapis.com`
 * （測試會掃描 `vite.config.ts`、`index.html`、`public/`，出現 CSP 卻沒放行就會紅）。
 *
 * ## 建置期處理（這個檔案做的事）
 * 內嵌 script 無法 import，所以兩個會變動的常數用代號留在原始碼裡，建置（與 dev server）時由這裡換成真值：
 * - `__FCB_PROJECT_ID__` → `FIREBASE_CONFIG.projectId`（不在 script 裡另外硬編一份）
 * - `__FCB_APP_VERSION__` → `APP_VERSION`（script 要用它判斷首屏快照是否因版本不同而失效，同 `home-snapshot.ts#isFresh`）
 * emulator 模式（非 PROD 建置且 `VITE_FIREBASE_EMULATOR=1`，同 `data/firebase.ts#shouldUseEmulator`）整段移除：
 * REST 會繞過 SDK 的連線目標守門，emulator 下絕不能對正式 Firestore 發請求。
 * script 正上方那段中文說明註解也在這裡刪掉（約 0.6 KB gzip，不需要隨 HTML 送給每個訪客；script 本身不動、不壓縮）。
 *
 * 找不到 script 區塊、代號數量不對、值格式不合一律丟錯讓建置失敗，不靜默發出一個指向錯誤專案的請求。
 */
import type { Plugin } from 'vite';

export const EARLY_BANNERS_SCRIPT_ID = 'fcb-early-banners';
export const EARLY_BANNERS_PROJECT_TOKEN = '__FCB_PROJECT_ID__';
export const EARLY_BANNERS_VERSION_TOKEN = '__FCB_APP_VERSION__';

/** 整個 `<script id="fcb-early-banners">…</script>` 區塊（含前面的縮排與後面的換行）。 */
const SCRIPT_BLOCK = new RegExp(`[ \\t]*<script id="${EARLY_BANNERS_SCRIPT_ID}">[\\s\\S]*?</script>[ \\t]*\\r?\\n?`);
/**
 * script 區塊「正上方緊鄰」的那一則 HTML 註解（含縮排與換行）。註解內文不得含 `-->`（回溯式比對會跨過別的註解，誤刪連線提示等內容），
 * 且後面只能隔空白與換行就是 script，所以只會刪到說明這個 script 的那一則。
 */
const LEADING_COMMENT = new RegExp(`[ \\t]*<!--(?:(?!-->)[\\s\\S])*-->[ \\t]*\\r?\\n(?=[ \\t]*<script id="${EARLY_BANNERS_SCRIPT_ID}">)`);
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

/** 純函式：回傳換好代號（或整段移除）、並刪掉 script 上方說明註解的 HTML。 */
export function transformEarlyBannersHtml(source: string, options: EarlyBannersHtmlOptions & { emulator: boolean }): string {
  const html = source.replace(LEADING_COMMENT, '');
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
