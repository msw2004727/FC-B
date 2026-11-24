// 推播開機小模組（設計書 §3.1 boot.ts）：由側邊選單分塊（首屏閒置預載）載入，每頁一次。
// ① 接收 SW 傳來的「點通知」訊息（D1 (B) 頁面端，§6.2）；② 登入者確定後跑靜默同步；
// ③ 訂閱 auth:changed：uid 變成 null 或換人時退訂並清紀錄。
// 另提供 beforeSignOut()：右上角登出與「清除快取」登出前先解除、等瀏覽器退訂完成（顧問 §3.699 Q3 (B)）。
// 不 import env.ts（那支在個人頁分塊，被這裡拉進來會變成共用分塊、改到入口）。
// 流程模組（flows）按需載入：右上角登出也會 import 本檔，本檔的靜態相依越少，首頁主程式裡的相依清單越短。

import { on } from '@/core/events';
import { evaluateReloadSafety } from '@/core/reload-safety';
import { getLastKnownAuthUid } from '@/data/auth';

const loadFlows = (): Promise<typeof import('./flows')> => import('./flows');

export const WEB_PUSH_OPEN_MESSAGE = 'toosterx:webpush-open';
/** 右上角登出等待上限（顧問 §3.699 Q3 (B)：2 秒，逾時照常登出）。 */
export const SIGN_OUT_WAIT_MS = 2000;

/** SW 傳來的站內路徑再驗一次：單一 `/` 開頭、非 `//`、無反斜線與控制字元、同源；不合格當 `/`。 */
export function sanitizeOpenPath(value: unknown, origin: string): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  try {
    return new URL(value, origin).origin === origin ? value : '/';
  } catch {
    return '/';
  }
}

/**
 * 不是 SPA 路由、由靜態檔或 _worker.js 回應的第一段路徑（public/ 頂層的頁面、資料夾、檔案，去掉 .html；加 _routes.json 的 worker 路徑）。
 * 這些路徑站內路由切不過去，點通知時改整頁換（顧問 §3.716 乙）；boot.test.ts 對著 public/ 與 _routes.json 核對，新增靜態頁時測試會紅。
 */
export const STATIC_SITE_SEGMENTS: readonly string[] = [
  'LOGO', 'PWA', '_routes.json', '_worker.js', 'appicon.png', 'assets', 'blog', 'event-share', 'fonts', 'img', 'inventory',
  'llms.txt', 'manual', 'og.png', 'privacy', 'roles', 'runtime-config.json', 'seo', 'sitemap-events.xml', 'sitemap-static.xml',
  'sitemap.xml', 'sw-legacy-compat.js', 'sw-push.js', 'team-share', 'terms',
];

/** 已清洗的同源路徑（sanitizeOpenPath 的結果）第一段是否屬於靜態檔；`/` 不算。 */
export function isStaticSitePath(path: string): boolean {
  const first = (path.slice(1).split(/[/?#]/, 1)[0] ?? '').replace(/\.html$/, '');
  return first !== '' && STATIC_SITE_SEGMENTS.includes(first);
}

/**
 * 點通知時的安全判斷：evaluateReloadSafety 會把「焦點在 input」一律當輸入中；焦點只是停在 checkbox／radio（例如剛按過開關）
 * 不算在打字，這裡把那兩種排除後再判斷（審查 P3-1；reload-safety.ts 不改）。
 */
export function isSafeToRouteForPush(doc: Document = document): boolean {
  const active = doc.activeElement as HTMLInputElement | null;
  const toggleFocused = !!active && active.tagName === 'INPUT' && (active.type === 'checkbox' || active.type === 'radio');
  if (!toggleFocused) return evaluateReloadSafety({ ignorePageSafety: true, doc }).safe;
  const view = new Proxy(doc, {
    get(target, key) {
      if (key === 'activeElement') return null;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return evaluateReloadSafety({ ignorePageSafety: true, doc: view }).safe;
}

export interface OpenMessageEnv {
  controller: unknown;
  origin: string;
  route: (path: string) => void;
  /** 非 SPA 路徑整頁換（預設 location.assign）。 */
  assign?: (path: string) => void;
  isSafe: () => boolean;
}

/**
 * 處理 SW 的 `{ type: 'toosterx:webpush-open', v: 1, path }`：只收目前 controller 送來、型別與版本對、帶 port 的訊息。
 * 安全（彈窗、輸入中、送出中都沒有）→ 站內路由切過去、回 routed；不安全 → 留在原頁、回 kept（不提示，§11 Q6 (A)）。
 * 安全且是靜態頁路徑（isStaticSitePath）→ 先回 routed 再整頁換；不安全時不分路徑一律 kept。
 * 任何例外都不回覆，讓 SW 逾時後退回 navigate。
 */
export function handleWebPushOpenMessage(event: MessageEvent, env: OpenMessageEnv): void {
  try {
    if (event.source !== env.controller || !env.controller) return;
    const data = event.data as { type?: unknown; v?: unknown; path?: unknown } | null;
    const port = event.ports?.[0];
    if (!data || data.type !== WEB_PUSH_OPEN_MESSAGE || data.v !== 1 || !port) return;
    const path = sanitizeOpenPath(data.path, env.origin);
    if (env.isSafe()) {
      if (isStaticSitePath(path)) {
        port.postMessage({ v: 1, result: 'routed' });
        (env.assign ?? ((p: string) => location.assign(p)))(path);
        return;
      }
      env.route(path);
      port.postMessage({ v: 1, result: 'routed' });
    } else {
      port.postMessage({ v: 1, result: 'kept' });
    }
  } catch (err) {
    console.warn('[webpush] open message failed', err instanceof Error ? err.name : 'error');
  }
}

let started = false;

export interface WebPushBootOptions {
  route: (path: string) => void;
  /** 測試用；預設 import.meta.env.PROD。 */
  isProd?: boolean;
}

export function startWebPushBoot(options: WebPushBootOptions): void {
  if (started) return;
  started = true;

  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (sw) {
    sw.addEventListener('message', (event) => {
      handleWebPushOpenMessage(event, {
        controller: sw.controller,
        origin: location.origin,
        route: options.route,
        isSafe: () => isSafeToRouteForPush(),
      });
    });
    try {
      sw.startMessages();
    } catch {
      /* 舊瀏覽器沒有 startMessages：載入完成後佇列本來就會開 */
    }
  }

  // 開發與測試環境 no-op；沒有 SW 註冊時 flows 內部也不動作。
  if (!(options.isProd ?? import.meta.env.PROD) || !sw) return;

  let lastUid: string | null | undefined;
  const run = (uid: string | null): void => {
    if (uid === lastUid) return;
    const first = lastUid === undefined;
    lastUid = uid;
    const job = async (): Promise<void> => {
      const flows = await loadFlows();
      const deps = flows.webPushDeps();
      // 第一次（登入者剛確定）與換人時跑同步（紀錄不屬於新登入者就退訂並清紀錄，不替新登入者訂閱）；登出時只清。
      if (!first && !uid) {
        await flows.dropForeignSubscription(null, deps);
        return;
      }
      // 使用者流程進行中會回 busy：等它結束、登入者沒再變才補跑一次，前一位的紀錄才不會沒人回收（審查 P3-2）。
      let result = await flows.syncWebPushOnBoot(uid, deps);
      while (result === 'busy') {
        await flows.whenWebPushIdle();
        if (lastUid !== uid) return;
        result = await flows.syncWebPushOnBoot(uid, deps);
      }
    };
    job().catch((err: unknown) => {
      console.warn('[webpush] boot sync failed', err instanceof Error ? err.name : 'error');
    });
  };

  const initial = getLastKnownAuthUid();
  if (initial !== undefined) run(initial);
  on('auth:changed', ({ uid }) => run(uid));
}

/**
 * 登出前：有本機紀錄且屬於目前登入者 → 解除 → 退訂 → 刪紀錄。最多等 limitMs，逾時或失敗都照常回來（不丟錯）。
 */
export async function beforeSignOut(limitMs: number = SIGN_OUT_WAIT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = async (): Promise<void> => {
    const flows = await loadFlows();
    await flows.releaseBeforeSignOut(flows.webPushDeps());
  };
  try {
    await Promise.race([
      release(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, limitMs);
      }),
    ]);
  } catch (err) {
    console.warn('[webpush] before sign-out failed', err instanceof Error ? err.name : 'error');
  } finally {
    clearTimeout(timer);
  }
}

/** 測試用。 */
export function _resetWebPushBootForTest(): void {
  started = false;
}
