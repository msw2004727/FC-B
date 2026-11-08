/**
 * index.html 的「活動詳情提早匿名 GET」內嵌 script（`<script id="fcb-early-event">`，T-093 批 4）。
 *
 * 與 `fcb-early-banners` 分開兩段、各自條件。代號替換比照 `scripts/early-banners-html.ts`：
 * `__FCB_PROJECT_ID__` → `FIREBASE_CONFIG.projectId`（不在 script 裡另外硬編一份）。
 * emulator 模式（非 PROD 建置且 `VITE_FIREBASE_EMULATOR=1`，同 `data/firebase.ts#shouldUseEmulator`）整段移除：
 * 不能只靠執行期判斷，否則 emulator 建置仍會對正式 Firestore 發請求。
 * script 正上方的說明註解也在這裡刪掉（不隨 HTML 送給每個訪客）。
 *
 * 這段 script 只做一件事：pathname 是 `/events/<PUBLIC_ID>` 且不是本機／區網時，匿名 GET 單筆活動文件，
 * 把原始 JSON 掛在 `window.__fcbEarlyEvent`（Promise；失敗一律 null、不 reject、不寫 console）。
 * 不映射成畫面資料、不寫 storage、不插元素、不 import。映射在 `early-event-shell.ts`，只填載入外殼。
 *
 * 找不到 script 區塊、代號數量不對、值格式不合一律丟錯讓建置失敗。
 */
import type { Plugin } from 'vite';

export const EARLY_EVENT_SCRIPT_ID = 'fcb-early-event';
/** 與橫幅 script 共用同一個專案代號，建置時各自在自己的 script 區塊裡換一次。 */
export const EARLY_EVENT_PROJECT_TOKEN = '__FCB_PROJECT_ID__';

const SCRIPT_BLOCK = new RegExp(`[ \\t]*<script id="${EARLY_EVENT_SCRIPT_ID}">[\\s\\S]*?</script>[ \\t]*\\r?\\n?`);
const LEADING_COMMENT = new RegExp(`[ \\t]*<!--(?:(?!-->)[\\s\\S])*-->[ \\t]*\\r?\\n(?=[ \\t]*<script id="${EARLY_EVENT_SCRIPT_ID}">)`);
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface EarlyEventHtmlOptions {
  projectId: string;
}

function replaceToken(source: string, token: string, value: string): string {
  const parts = source.split(token);
  if (parts.length !== 2) {
    throw new Error(`index.html 的 #${EARLY_EVENT_SCRIPT_ID} 應該恰好有一個 ${token}（實際 ${parts.length - 1} 個）`);
  }
  return parts.join(value);
}

/** 純函式：回傳換好代號（或整段移除）、並刪掉 script 上方說明註解的 HTML。 */
export function transformEarlyEventHtml(
  source: string,
  options: EarlyEventHtmlOptions & { emulator: boolean },
): string {
  const html = source.replace(LEADING_COMMENT, '');
  const block = SCRIPT_BLOCK.exec(html);
  if (!block) throw new Error(`index.html 找不到 <script id="${EARLY_EVENT_SCRIPT_ID}">`);
  if (options.emulator) return html.replace(SCRIPT_BLOCK, '');
  if (!PROJECT_ID_PATTERN.test(options.projectId)) throw new Error('early-event：projectId 格式不合');
  const script = replaceToken(block[0], EARLY_EVENT_PROJECT_TOKEN, options.projectId);
  return html.replace(SCRIPT_BLOCK, () => script);
}

export function earlyEventHtml(options: EarlyEventHtmlOptions): Plugin {
  let emulator = false;
  return {
    name: 'fcb-early-event-html',
    configResolved(config) {
      emulator = !config.isProduction && config.env.VITE_FIREBASE_EMULATOR === '1';
    },
    transformIndexHtml(html) {
      return transformEarlyEventHtml(html, { ...options, emulator });
    },
  };
}
