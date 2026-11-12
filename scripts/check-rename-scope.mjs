/**
 * check-rename-scope.mjs — 「只改一頁一行」時 assets 改名檔數（UPD-2 核心驗收，設計稿 §5.2）。
 *
 * 做法：固定 FCB_BUILD_ID 建置一次當基準 A；每個探針再建置一次 B（FCB_RENAME_PROBE=<src 相對路徑>，
 * 由 scripts/chunk-groups.ts#renameProbePlugin 在該檔尾端加一行有副作用的程式，等同「改一行」）。
 * 比對 assets/ 下 .js、.css 檔名集合：B 有、A 沒有的就是改名檔（JS 與 CSS 一起算）。
 *
 * 必過探針（改名 ≤ 3，且改名清單必須含該頁自己的 chunk，防探針沒生效的假綠）：
 *   TeamsPage、AdminLogsPage、ActivitiesPage。
 * 參考探針（只印不擋）：EventFormModal、profile/ui/editors、profile/data/viewer、events/legacy/activity.css（CSS 探針加一條規則）。
 *
 * 成本：1＋探針數次 vite build（每次約數十秒）。正式建置不設 FCB_RENAME_PROBE，探針外掛不做事。
 * 用法：node scripts/check-rename-scope.mjs [--hard-only]
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const RENAME_LIMIT = 3;
export const HARD_PROBES = [
  'src/features/clubs/pages/TeamsPage.tsx',
  'src/features/logs/pages/AdminLogsPage.tsx',
  'src/features/events/pages/ActivitiesPage.tsx',
];
export const INFO_PROBES = [
  'src/features/events/components/EventFormModal.tsx',
  'src/features/profile/ui/editors.tsx',
  'src/features/profile/data/viewer.ts',
  // 首屏 CSS 全在 app-shared（終審 P1），改共用 CSS 會讓 app-shared 改名、連帶所有匯入它的檔；量出來供取捨，不擋。
  'src/features/events/legacy/activity.css',
];
const FIXED_BUILD_ID = '202601010000';

/** B 有、A 沒有的檔名（排序）。只看 .js、.css。 */
export function renamedAssets(namesA, namesB) {
  const a = new Set(namesA);
  return [...new Set(namesB)].filter((n) => /\.(?:js|css)$/.test(n) && !a.has(n)).sort();
}

/** 探針檔對應的 chunk 名稱前綴：TeamsPage.tsx → TeamsPage。 */
export function probeStem(probe) {
  return path.posix.basename(String(probe).replace(/\\/g, '/')).replace(/\.[^.]+$/, '');
}

/** 改名清單是否含該檔自己的 chunk（檔名 <stem>-<8 字元雜湊>.js）。 */
export function includesOwnChunk(renamed, probe) {
  const stem = probeStem(probe);
  return renamed.some((n) => n === `${stem}.js` || new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[A-Za-z0-9_-]{8}\\.js$`).test(n));
}

/** 必過探針的判定。回傳 { ok, reason }。 */
export function evaluateHardProbe(probe, renamed, limit = RENAME_LIMIT) {
  if (!includesOwnChunk(renamed, probe)) {
    return { ok: false, reason: `改名清單不含 ${probeStem(probe)} 自己的 chunk（探針沒生效或 chunk 名稱變了）` };
  }
  if (renamed.length > limit) return { ok: false, reason: `改名 ${renamed.length} 個 > 上限 ${limit}` };
  return { ok: true, reason: `改名 ${renamed.length} 個 ≤ ${limit}` };
}

async function listAssets(distDir) {
  try {
    return (await readdir(path.join(distDir, 'assets'))).sort();
  } catch {
    return [];
  }
}

const execFileAsync = promisify(execFile);

function build(root, outDir, probe) {
  // 同 asset-filename-stability.test.mjs：固定建置編號、正式打包、不帶 Pages 與 vitest 變數。
  const env = { ...process.env, FCB_BUILD_ID: FIXED_BUILD_ID, NODE_ENV: 'production' };
  delete env.CF_PAGES;
  delete env.VITEST;
  delete env.FCB_CHUNK_GRAPH;
  if (probe) env.FCB_RENAME_PROBE = probe;
  else delete env.FCB_RENAME_PROBE;
  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  return execFileAsync(process.execPath, [viteBin, 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: root,
    env,
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const hardOnly = process.argv.includes('--hard-only');
  const parent = await mkdtemp(path.join(tmpdir(), 'fcb-rename-'));
  let failed = false;
  try {
    const dirA = path.join(parent, 'base');
    await build(root, dirA, '');
    const namesA = await listAssets(dirA);
    if (namesA.length === 0) throw new Error('基準建置沒有 assets');
    console.log(`基準：assets ${namesA.length} 個檔`);
    const probes = [...HARD_PROBES.map((p) => [p, true]), ...(hardOnly ? [] : INFO_PROBES.map((p) => [p, false]))];
    for (const [probe, hard] of probes) {
      const dirB = path.join(parent, probeStem(probe));
      await build(root, dirB, probe);
      const renamed = renamedAssets(namesA, await listAssets(dirB));
      if (hard) {
        const r = evaluateHardProbe(probe, renamed);
        if (!r.ok) failed = true;
        console.log(`[必過] ${probe}：${r.ok ? '通過' : '失敗'}（${r.reason}）`);
      } else {
        console.log(`[參考] ${probe}：改名 ${renamed.length} 個`);
      }
      for (const n of renamed) console.log(`    ${n}`);
      await rm(dirB, { recursive: true, force: true });
    }
  } catch (err) {
    failed = true;
    console.error(err instanceof Error ? err.message : String(err));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
  process.exitCode = failed ? 1 : 0;
}

function isMainModule() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(path.resolve(argv1)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) await main();
