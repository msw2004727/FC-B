/**
 * build-meta.mjs — 把版號、建置編號、commit 短碼寫進 index.html 的 meta 與 dist/version.json。
 *
 * 不透過 Vite define 塞進 JS。版號只讀 src/version.ts（bump-version.mjs 的唯一來源）。
 * 建置編號是台北時間 YYYYMMDDHHmm。
 * 本機可用 FCB_VERSION_FILE 改讀暫存版號檔（Pages 上忽略）。本機可用 FCB_BUILD_ID 覆寫（檔名穩定測試要換建置時間）；
 * Cloudflare Pages（CF_PAGES=1）出現這個變數就讓建置失敗，避免平台端寫死編號。
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_VERSION_FILE = path.join(ROOT, 'src', 'version.ts');

export const APP_VERSION_META = 'app-version';
export const APP_BUILD_META = 'app-build';
export const APP_SHA_META = 'app-sha';

export function taipeiBuildId(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const pick = (type) => {
    const part = parts.find((item) => item.type === type);
    if (!part) throw new Error(`台北時間缺少 ${type}`);
    return part.value;
  };
  let hour = pick('hour');
  if (hour === '24') hour = '00';
  const id = `${pick('year')}${pick('month')}${pick('day')}${hour}${pick('minute')}`;
  if (!/^\d{12}$/.test(id)) throw new Error(`建置編號不是 12 位數字：${id}`);
  return id;
}

export function isCloudflarePages(env) {
  return env.CF_PAGES === '1';
}

/** Pages 上出現非空白的 FCB_BUILD_ID 就丟錯。本機不擋。 */
export function assertBuildIdNotPinnedOnPages(env) {
  if (!isCloudflarePages(env)) return;
  const raw = env.FCB_BUILD_ID;
  if (raw == null || String(raw).trim() === '') return;
  throw new Error(
    'Cloudflare Pages 建置環境不得設定 FCB_BUILD_ID（建置編號必須由打包當下的台北時間產生，不能從平台端寫死）',
  );
}

export function resolveBuildId(env, now = new Date()) {
  assertBuildIdNotPinnedOnPages(env);
  const raw = env.FCB_BUILD_ID;
  if (raw != null && String(raw).trim() !== '') {
    const id = String(raw).trim();
    if (!/^\d{12}$/.test(id)) {
      throw new Error(`FCB_BUILD_ID 必須是 12 位數字 YYYYMMDDHHmm（實際「${id}」）`);
    }
    return id;
  }
  return taipeiBuildId(now);
}

export function readDeclaredAppVersion(source) {
  const found = String(source).match(/export const APP_VERSION = '([^']*)';/);
  if (!found) throw new Error('src/version.ts 找不到 APP_VERSION');
  if (!/^0\.\d{8}[a-z]*$/.test(found[1])) {
    throw new Error(`src/version.ts 的 APP_VERSION 格式不合：${found[1]}`);
  }
  return found[1];
}

export function resolveCommitSha(env, gitShortSha = defaultGitShortSha) {
  const fromCi = env.CF_PAGES_COMMIT_SHA;
  if (fromCi != null && String(fromCi).trim() !== '') return String(fromCi).trim().slice(0, 7);
  try {
    const sha = String(gitShortSha()).trim();
    return sha || 'local';
  } catch {
    return 'local';
  }
}

function defaultGitShortSha() {
  return execSync('git rev-parse --short HEAD', {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  });
}

export function buildVersionJson(meta) {
  return `${JSON.stringify({ version: meta.version, build: meta.build, sha: meta.sha }, null, 2)}\n`;
}

function escapeAttr(value) {
  const text = String(value);
  if (/["<>&\n]/.test(text)) throw new Error(`版號 meta 含不允許的字元：${text}`);
  return text;
}

/** 去掉已有的三個 meta，再插到 charset 後面（沒有 charset 就放在 <head> 後面）。 */
export function injectAppMeta(html, meta) {
  let out = String(html);
  for (const name of [APP_VERSION_META, APP_BUILD_META, APP_SHA_META]) {
    const re = new RegExp(`\\n?[ \\t]*<meta\\s+name="${name}"\\s+content="[^"]*"\\s*/>`, 'gi');
    out = out.replace(re, '');
  }
  const tags = [
    `<meta name="${APP_VERSION_META}" content="${escapeAttr(meta.version)}" />`,
    `<meta name="${APP_BUILD_META}" content="${escapeAttr(meta.build)}" />`,
    `<meta name="${APP_SHA_META}" content="${escapeAttr(meta.sha)}" />`,
  ].join('\n    ');
  const block = `\n    ${tags}`;
  if (out.includes('<meta charset="UTF-8" />')) {
    return out.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />${block}`);
  }
  if (out.includes('<head>')) return out.replace('<head>', `<head>${block}`);
  throw new Error('index.html 找不到 <head>，無法寫入版號 meta');
}

function readMeta(env, versionFile, now) {
  const file = versionFile ?? DEFAULT_VERSION_FILE;
  const version = readDeclaredAppVersion(readFileSync(file, 'utf8'));
  return {
    version,
    build: resolveBuildId(env, now),
    sha: resolveCommitSha(env),
  };
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, versionFile?: string, now?: () => Date }} [options]
 */
export function appBuildMeta(options = {}) {
  const env = options.env ?? process.env;
  // 本機測試可用 FCB_VERSION_FILE 指向暫存版號檔（檔名穩定測試用，不必改 src/version.ts）；Pages 上忽略。
  const versionFile = options.versionFile ?? (isCloudflarePages(env) ? undefined : env.FCB_VERSION_FILE?.trim() || undefined);
  const now = options.now ?? (() => new Date());
  let isBuild = false;
  /** @type {{ version: string, build: string, sha: string } | null} */
  let cached = null;
  const current = () => {
    if (!cached) cached = readMeta(env, versionFile, now());
    return cached;
  };
  return {
    name: 'fcb-app-build-meta',
    config() {
      assertBuildIdNotPinnedOnPages(env);
    },
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    buildStart() {
      cached = readMeta(env, versionFile, now());
    },
    transformIndexHtml(html) {
      return injectAppMeta(html, current());
    },
    generateBundle() {
      if (!isBuild) return;
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: buildVersionJson(current()),
      });
    },
  };
}
