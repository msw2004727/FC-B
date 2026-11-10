/**
 * 執行時的版號、建置編號、commit 短碼。
 *
 * 來源是 index.html 的 meta（打包時寫入），不從 JS 常數或 import.meta.env 讀，
 * 這樣改版號或建置時間不會改掉 chunk 檔名。
 * 找不到或內容是空白時退回明確預設。測試可呼叫 setAppMetaForTest，或直接放 meta。
 */

export const APP_VERSION_META = 'app-version';
export const APP_BUILD_META = 'app-build';
export const APP_SHA_META = 'app-sha';

export const APP_VERSION_FALLBACK = 'dev';
export const APP_BUILD_FALLBACK = '0';
export const APP_SHA_FALLBACK = 'dev';

export interface AppMetaPatch {
  /** 有這個鍵才覆寫；null 當作缺少。 */
  version?: string | null;
  build?: string | null;
  sha?: string | null;
}

let testPatch: AppMetaPatch | null = null;

/** 測試注入。傳 null 恢復只讀 document。 */
export function setAppMetaForTest(patch: AppMetaPatch | null): void {
  testPatch = patch;
}

/** undefined＝沒有這個 meta；字串＝content（可以是空的）。 */
function metaContent(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const el = document.querySelector(`meta[name="${name}"]`);
  if (!el) return undefined;
  return el.getAttribute('content') ?? '';
}

function resolveValue(
  injected: boolean,
  injectedValue: string | null | undefined,
  metaName: string,
  fallback: string,
): string {
  const raw = injected ? injectedValue : metaContent(metaName);
  if (raw == null) return fallback;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function readAppVersion(): string {
  const injected = testPatch != null && 'version' in testPatch;
  return resolveValue(injected, testPatch?.version, APP_VERSION_META, APP_VERSION_FALLBACK);
}

export function readAppBuild(): string {
  const injected = testPatch != null && 'build' in testPatch;
  return resolveValue(injected, testPatch?.build, APP_BUILD_META, APP_BUILD_FALLBACK);
}

/** minBuild 比較用。不是正數就當 0（與舊的 Number(VITE_BUILD_ID) || 0 相同）。 */
export function readAppBuildId(): number {
  const n = Number(readAppBuild());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function readAppSha(): string {
  const injected = testPatch != null && 'sha' in testPatch;
  return resolveValue(injected, testPatch?.sha, APP_SHA_META, APP_SHA_FALLBACK);
}
