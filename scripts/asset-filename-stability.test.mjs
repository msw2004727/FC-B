// @vitest-environment node
/**
 * 同一份原始碼換版號、換建置時間，各打包一次。assets/ 檔名集合必須完全相同。
 * 建置較慢，仍會在 vitest（含 CI）裡真的跑。
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMIT_BYTES, inspectHomeBundle, renderReport } from './check-bundle-budget.mjs';
import { BANNERS_SNAPSHOT_MAX_AGE_MS, HOME_SNAPSHOT_FORMAT_V } from '../src/features/home/data/home-snapshot-ttl.ts';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionFile = path.join(root, 'src', 'version.ts');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

async function listFiles(dir) {
  const out = [];
  async function walk(current, prefix) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), rel);
      else out.push(rel.replace(/\\/g, '/'));
    }
  }
  await walk(dir, '');
  return out.sort();
}

function build(outDir, buildId) {
  // vitest 會把 NODE_ENV=test 傳進來。子行程必須是正式打包，否則沒有壓縮、入口 gzip 會虛高。
  const env = { ...process.env, FCB_BUILD_ID: buildId, NODE_ENV: 'production' };
  delete env.CF_PAGES;
  delete env.VITEST;
  return execFileAsync(process.execPath, [viteBin, 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: root,
    env,
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

describe('換版號與建置時間後 assets 檔名不變', () => {
  it('兩次 vite build 的 assets/ 檔名集合相同，版號只出現在 HTML 與 version.json', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'fcb-upd1-'));
    const dirA = path.join(parent, 'a');
    const dirB = path.join(parent, 'b');
    const original = await readFile(versionFile, 'utf8');
    const declared = original.match(/export const APP_VERSION = '([^']*)';/)?.[1] ?? '';
    const swapped = original.replace(
      /export const APP_VERSION = '[^']*';/,
      "export const APP_VERSION = '0.20260101z';",
    );
    expect(swapped).not.toBe(original);
    try {
      await build(dirA, '202601010101');
      await writeFile(versionFile, swapped, 'utf8');
      await build(dirB, '202612312359');

      const assetsA = await listFiles(path.join(dirA, 'assets'));
      const assetsB = await listFiles(path.join(dirB, 'assets'));
      expect(assetsA.length).toBeGreaterThan(10);
      expect(assetsB).toEqual(assetsA);
      console.log(`assets 檔數 ${assetsA.length}，兩次檔名相同`);

      const htmlA = await readFile(path.join(dirA, 'index.html'), 'utf8');
      const htmlB = await readFile(path.join(dirB, 'index.html'), 'utf8');
      const sourceHtml = await readFile(path.join(root, 'index.html'), 'utf8');
      expect(sourceHtml).toContain('__FCB_BANNER_MAX_AGE_MS__');
      expect(sourceHtml).not.toContain(String(BANNERS_SNAPSHOT_MAX_AGE_MS));
      expect(htmlA).toContain(`A = ${BANNERS_SNAPSHOT_MAX_AGE_MS}`);
      expect(htmlA).toContain('t - s.savedAt <= A');
      expect(htmlA).toContain(`V = ${HOME_SNAPSHOT_FORMAT_V}`);
      expect(htmlB).toContain(`A = ${BANNERS_SNAPSHOT_MAX_AGE_MS}`);
      expect(htmlB).toContain('t - s.savedAt <= A');
      expect(htmlA).toContain(`content="${declared}"`);
      expect(htmlA).toContain('content="202601010101"');
      expect(htmlB).toContain('content="0.20260101z"');
      expect(htmlB).toContain('content="202612312359"');
      expect(htmlA).not.toContain('content="0.20260101z"');

      const headers = await readFile(path.join(dirA, '_headers'), 'utf8');
      expect(headers).toMatch(/\/version\.json\r?\n {2}! Cache-Control\r?\n {2}Cache-Control: no-store/);
      const versionB = JSON.parse(await readFile(path.join(dirB, 'version.json'), 'utf8'));
      expect(versionB.version).toBe('0.20260101z');
      expect(versionB.build).toBe('202612312359');
      expect(versionB.sha).toMatch(/^[0-9a-f]{7}$|^local$/);

      const budgetA = inspectHomeBundle(dirA, DEFAULT_LIMIT_BYTES);
      const budgetB = inspectHomeBundle(dirB, DEFAULT_LIMIT_BYTES);
      expect(budgetA.ok, budgetA.reason).toBe(true);
      expect(budgetB.totalGzip).toBe(budgetA.totalGzip);
      console.log(renderReport(budgetA));
      console.log(renderReport(budgetB));

      const forbidden = ['202601010101', '202612312359', declared, '0.20260101z'];
      for (const dir of [dirA, dirB]) {
        for (const name of (dir === dirA ? assetsA : assetsB).filter((file) => file.endsWith('.js'))) {
          const jsText = await readFile(path.join(dir, 'assets', name), 'utf8');
          for (const token of forbidden) {
            expect(jsText, `${name} 含 ${token}`).not.toContain(token);
          }
        }
      }
    } finally {
      await writeFile(versionFile, original, 'utf8');
      await rm(parent, { recursive: true, force: true });
    }
  }, 600_000);
});
