// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appBuildMeta,
  assertBuildIdNotPinnedOnPages,
  buildVersionJson,
  injectAppMeta,
  readDeclaredAppVersion,
  resolveBuildId,
  resolveCommitSha,
  taipeiBuildId,
} from './build-meta.mjs';

const temps = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('taipeiBuildId', () => {
  it('UTC 16:00 是台北午夜，12 位且不大於該分鐘', () => {
    const now = new Date('2026-11-10T16:00:00.000Z');
    const id = taipeiBuildId(now);
    expect(id).toBe('202611110000');
    expect(id).toHaveLength(12);
    expect(Number(id)).toBeLessThanOrEqual(Number(taipeiBuildId(now)));
  });

  it('UTC 15:59 是台北前一天 23:59', () => {
    expect(taipeiBuildId(new Date('2026-11-10T15:59:00.000Z'))).toBe('202611102359');
  });
});

describe('FCB_BUILD_ID', () => {
  it('Cloudflare Pages 出現 FCB_BUILD_ID 就失敗', () => {
    expect(() => assertBuildIdNotPinnedOnPages({ CF_PAGES: '1', FCB_BUILD_ID: '202601010101' })).toThrow(/FCB_BUILD_ID/);
    expect(() => resolveBuildId({ CF_PAGES: '1', FCB_BUILD_ID: '202601010101' })).toThrow(/平台端寫死/);
  });

  it('Pages 沒有這個變數就用台北時間', () => {
    const now = new Date('2026-11-10T16:05:00.000Z');
    expect(resolveBuildId({ CF_PAGES: '1' }, now)).toBe('202611110005');
  });

  it('本機可以覆寫，但必須是 12 位數字', () => {
    expect(resolveBuildId({ FCB_BUILD_ID: '202612312359' }, new Date('2020-01-01T00:00:00Z'))).toBe('202612312359');
    expect(() => resolveBuildId({ FCB_BUILD_ID: '2026010101011' })).toThrow(/12 位/);
    expect(() => resolveBuildId({ FCB_BUILD_ID: 'nope' })).toThrow(/12 位/);
  });
});

describe('版號與 version.json', () => {
  it('讀 src/version.ts 的宣告', () => {
    expect(readDeclaredAppVersion("export const APP_VERSION = '0.20261111a';\n")).toBe('0.20261111a');
    expect(() => readDeclaredAppVersion('export const APP_VERSION = "0.20261111a";')).toThrow(/找不到/);
    expect(() => readDeclaredAppVersion("export const APP_VERSION = '1.2.3';")).toThrow(/格式不合/);
  });

  it('version.json 含版號、建置編號、短 SHA', () => {
    const text = buildVersionJson({ version: '0.20261111a', build: '202611111234', sha: 'abc1234' });
    expect(JSON.parse(text)).toEqual({ version: '0.20261111a', build: '202611111234', sha: 'abc1234' });
  });

  it('commit SHA 沿用 7 碼：Pages 優先，否則 git', () => {
    expect(resolveCommitSha({ CF_PAGES_COMMIT_SHA: '0123456789abcdef' }, () => 'ignored')).toBe('0123456');
    expect(resolveCommitSha({}, () => 'deadbee\n')).toBe('deadbee');
    expect(resolveCommitSha({}, () => '47a97938\n')).toBe('47a9793');
    expect(resolveCommitSha({}, () => { throw new Error('no git'); })).toBe('local');
  });
});

describe('injectAppMeta', () => {
  const meta = { version: '0.20261111a', build: '202611111234', sha: 'abc1234' };

  it('插在 charset 後面', () => {
    const html = injectAppMeta('<html><head>\n    <meta charset="UTF-8" />\n  </head></html>', meta);
    expect(html).toContain('<meta name="app-version" content="0.20261111a" />');
    expect(html).toContain('<meta name="app-build" content="202611111234" />');
    expect(html).toContain('<meta name="app-sha" content="abc1234" />');
    expect(html.indexOf('app-version')).toBeGreaterThan(html.indexOf('charset'));
  });

  it('重複轉換不疊兩份', () => {
    const once = injectAppMeta('<html><head><meta charset="UTF-8" /></head></html>', meta);
    const twice = injectAppMeta(once, { version: '0.20260101z', build: '202601010101', sha: 'ffffeee' });
    expect(twice.match(/name="app-version"/g)).toHaveLength(1);
    expect(twice).toContain('content="0.20260101z"');
    expect(twice).not.toContain('0.20261111a');
  });

  it('內容含引號或標籤就失敗', () => {
    expect(() => injectAppMeta('<head></head>', { ...meta, version: '0.1"></script>' })).toThrow(/不允許/);
  });
});

async function generated(plugin) {
  const files = [];
  plugin.configResolved({ command: 'build' });
  plugin.generateBundle.call({ emitFile(file) { files.push(file); } });
  return files[0].source;
}

describe('appBuildMeta 外掛', () => {
  it('Pages 上 config() 就失敗，不會進到 define', () => {
    const plugin = appBuildMeta({ env: { CF_PAGES: '1', FCB_BUILD_ID: '202601010101' } });
    expect(() => plugin.config()).toThrow(/FCB_BUILD_ID/);
    expect(plugin.config.toString()).not.toContain('VITE_BUILD_ID');
  });

  it('FCB_VERSION_FILE 本機改讀暫存版號檔；Pages 上忽略、讀 src/version.ts', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'fcb-meta-'));
    temps.push(dir);
    const versionFile = path.join(dir, 'version.ts');
    await writeFile(versionFile, "export const APP_VERSION = '0.20260101z';\n", 'utf8');
    const now = () => new Date('2020-01-01T00:00:00Z');
    const local = appBuildMeta({ env: { FCB_VERSION_FILE: versionFile }, now });
    local.buildStart();
    expect(JSON.parse(await generated(local)).version).toBe('0.20260101z');
    const pages = appBuildMeta({ env: { CF_PAGES: '1', FCB_VERSION_FILE: versionFile }, now });
    pages.buildStart();
    expect(JSON.parse(await generated(pages)).version).not.toBe('0.20260101z');
  });

  it('建置時寫 meta 與 version.json，且不靠 define', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'fcb-meta-'));
    temps.push(dir);
    const versionFile = path.join(dir, 'version.ts');
    await writeFile(versionFile, "export const APP_VERSION = '0.20260101z';\n", 'utf8');
    const plugin = appBuildMeta({
      env: { FCB_BUILD_ID: '202601010101', CF_PAGES_COMMIT_SHA: 'abcdef1234567890' },
      versionFile,
      now: () => new Date('2020-01-01T00:00:00Z'),
    });
    plugin.config();
    plugin.configResolved({ command: 'build' });
    plugin.buildStart();
    const html = plugin.transformIndexHtml('<!doctype html><html><head><meta charset="UTF-8" /></head></html>');
    expect(html).toContain('content="0.20260101z"');
    expect(html).toContain('content="202601010101"');
    expect(html).toContain('content="abcdef1"');
    const files = [];
    plugin.generateBundle.call({
      emitFile(file) { files.push(file); },
    });
    expect(files).toHaveLength(1);
    expect(files[0].fileName).toBe('version.json');
    expect(JSON.parse(files[0].source)).toEqual({
      version: '0.20260101z',
      build: '202601010101',
      sha: 'abcdef1',
    });
    const configText = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
    expect(configText).not.toMatch(/import\.meta\.env\.VITE_BUILD_ID/);
    expect(configText).not.toMatch(/import\.meta\.env\.VITE_BUILD_SHA/);
  });
});
