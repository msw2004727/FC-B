import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRELOAD_SUM_LIMIT_BYTES,
  exceedsBudget,
  gzipByteLength,
  inspectHomeBundle,
  listHomeEntryJs,
  listModulePreloadJs,
  listOtherModuleScripts,
  measurePreloadSum,
  parseLimit,
  resolveDistHref,
} from './check-bundle-budget.mjs';

const FIXTURE_HTML = [
  '<!doctype html><html><head>',
  '<script>var inline = 1;</script>',
  '<link rel="modulepreload" crossorigin href="/assets/hooks-xyz.js">',
  '<link rel="stylesheet" crossorigin href="/assets/index-test.css">',
  '<script type="module" src="/assets/vendor-aaa.js"></script>',
  '<script type="module" crossorigin src="/assets/index-Ab12.js?v=1"></script>',
  '</head></html>',
].join('');

// 預設 dist 只有一個 module script（vendor-aaa 在真實 dist 不會是 script，會被 inspectHomeBundle 判失敗）。
// 拿掉懸空的 modulepreload，避免第二條因缺檔失敗；第一條測試仍不把 preload 算進 totalGzip。
const DEFAULT_HTML = FIXTURE_HTML
  .replace('<script type="module" src="/assets/vendor-aaa.js"></script>', '')
  .replace('index-Ab12.js', 'index-test.js')
  .replace('<link rel="modulepreload" crossorigin href="/assets/hooks-xyz.js">', '');

function makeDist(body, html = DEFAULT_HTML) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-budget-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), html);
  if (body) writeFileSync(path.join(dir, 'assets', 'index-test.js'), body);
  return dir;
}

describe('check-bundle-budget', () => {
  it('HTML 只取出入口 index-*.js，略過 inline、modulepreload、CSS 與其他 module', () => {
    expect(listHomeEntryJs(FIXTURE_HTML)).toEqual(['/assets/index-Ab12.js']);
  });

  it('剛好等於上限通過，超過上限失敗', () => {
    expect(exceedsBudget(60_000, 60_000)).toBe(false);
    expect(exceedsBudget(60_001, 60_000)).toBe(true);
    expect(exceedsBudget(Number.NaN, 60_000)).toBe(true);

    const body = Buffer.from('budget-fixture-v1');
    const expected = zlib.gzipSync(body, { level: 9 }).length;
    expect(gzipByteLength(body)).toBe(expected);
    const dir = makeDist(body);
    try {
      const exact = inspectHomeBundle(dir, expected);
      expect(exact.ok).toBe(true);
      expect(exact.totalGzip).toBe(expected);
      expect(exact.entries).toHaveLength(1);
      const over = inspectHomeBundle(dir, expected - 1);
      expect(over.ok).toBe(false);
      expect(over.reason).toContain('超過上限');
      expect(over.totalGzip).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('找不到入口檔時失敗', () => {
    const dir = makeDist(null);
    try {
      const missing = inspectHomeBundle(dir, 60_000);
      expect(missing.ok).toBe(false);
      expect(missing.reason).toContain('找不到入口檔');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const empty = mkdtempSync(path.join(tmpdir(), 'bb-budget-'));
    try {
      const noHtml = inspectHomeBundle(empty, 60_000);
      expect(noHtml.ok).toBe(false);
      expect(noHtml.reason).toContain('找不到');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('上限以 1000 bytes 為 1KB，預設 60KB；第二條省略時用 250KB', () => {
    expect(parseLimit('60KB')).toBe(60_000);
    expect(parseLimit('1KB')).toBe(1_000);
    expect(parseLimit(undefined)).toBe(60_000);
    expect(parseLimit(undefined, DEFAULT_PRELOAD_SUM_LIMIT_BYTES)).toBe(250_000);
    expect(DEFAULT_PRELOAD_SUM_LIMIT_BYTES).toBe(250_000);
  });

  it('不把 data-src 當成入口，也拒絕協定相對網址與跳出 dist 的路徑', () => {
    expect(listHomeEntryJs('<script type="module" data-src="/assets/index-fake.js"></script>')).toEqual([]);
    expect(listHomeEntryJs("<script type='module' src='/assets/index-a1.js'></script>")).toEqual(['/assets/index-a1.js']);
    expect(resolveDistHref('dist', '//cdn.example/assets/index-x.js')).toBeNull();
    expect(resolveDistHref('dist', 'https://cdn.example/assets/index-x.js')).toBeNull();
    expect(resolveDistHref('dist', '/assets/../../etc/passwd')).toBeNull();
    expect(resolveDistHref('dist', '/assets/index-x.js')).not.toBeNull();
  });

  it('入口多於一個時失敗', () => {
    const html = '<script type="module" src="/assets/index-a.js"></script><script type="module" src="/assets/index-b.js"></script>';
    const dir = makeDist(Buffer.from('x'), html);
    try {
      const r = inspectHomeBundle(dir, 60_000);
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('剛好一個');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('出現不認得的 module script 時失敗，不靜默忽略；上限格式錯誤丟錯', () => {
    expect(listOtherModuleScripts(FIXTURE_HTML)).toEqual(['/assets/vendor-aaa.js']);
    const dir = makeDist(Buffer.from('x'), FIXTURE_HTML.replace('index-Ab12.js', 'index-test.js'));
    try {
      const r = inspectHomeBundle(dir, 60_000);
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('不認得的 module script');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const onlyOther = makeDist(Buffer.from('x'), '<script type="module" src="/assets/main-zz.js"></script>');
    try {
      expect(inspectHomeBundle(onlyOther, 60_000).ok).toBe(false);
    } finally {
      rmSync(onlyOther, { recursive: true, force: true });
    }
    expect(() => parseLimit('abc')).toThrow();
    expect(() => parseLimit('-5KB')).toThrow();
  });

  it('第二條只加總 modulepreload 的 js，略過 css；同一檔不重複；第一條 totalGzip 仍只算入口', () => {
    const html = [
      '<link rel="modulepreload" href="/assets/hooks-xyz.js">',
      '<link rel="modulepreload" href="/assets/index-test.js">',
      '<link rel="modulepreload" href="/assets/skip.css">',
      '<link rel="stylesheet" href="/assets/index-test.css">',
      '<script type="module" src="/assets/index-test.js"></script>',
    ].join('');
    expect(listModulePreloadJs(html)).toEqual([
      '/assets/hooks-xyz.js',
      '/assets/index-test.js',
      '/assets/skip.css',
    ].filter((href) => href.endsWith('.js')));
    expect(listHomeEntryJs(html)).toEqual(['/assets/index-test.js']);

    const dir = makeDist(Buffer.from('entry-body'), html);
    const preloadBody = Buffer.from('preload-body-distinct');
    writeFileSync(path.join(dir, 'assets', 'hooks-xyz.js'), preloadBody);
    try {
      const entryGzip = zlib.gzipSync(Buffer.from('entry-body'), { level: 9 }).length;
      const preloadGzip = zlib.gzipSync(preloadBody, { level: 9 }).length;
      const result = inspectHomeBundle(dir, 60_000, 250_000);
      expect(result.ok).toBe(true);
      expect(result.totalGzip).toBe(entryGzip);
      expect(result.preload.ok).toBe(true);
      expect(result.preload.totalGzip).toBe(entryGzip + preloadGzip);
      expect(result.preload.files.map((item) => item.kind)).toEqual(['entry', 'preload']);

      const exact = measurePreloadSum(
        dir,
        html,
        '/assets/index-test.js',
        path.join(dir, 'assets', 'index-test.js'),
        Buffer.from('entry-body'),
        entryGzip + preloadGzip,
      );
      expect(exact.ok).toBe(true);
      const over = measurePreloadSum(
        dir,
        html,
        '/assets/index-test.js',
        path.join(dir, 'assets', 'index-test.js'),
        Buffer.from('entry-body'),
        entryGzip + preloadGzip - 1,
      );
      expect(over.ok).toBe(false);
      expect(over.reason).toContain('第二條超過寬鬆上限');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('第二條：preload 缺檔或路徑跳出 dist 時失敗，且不改第一條', () => {
    const missingHtml = [
      '<link rel="modulepreload" href="/assets/missing-chunk.js">',
      '<script type="module" src="/assets/index-test.js"></script>',
    ].join('');
    const dir = makeDist(Buffer.from('entry-only'), missingHtml);
    try {
      const missing = inspectHomeBundle(dir, 60_000, 250_000);
      expect(missing.ok).toBe(true);
      expect(missing.preload.ok).toBe(false);
      expect(missing.preload.reason).toContain('找不到 modulepreload');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const escapeHtml = [
      '<link rel="modulepreload" href="/assets/../../secret.js">',
      '<script type="module" src="/assets/index-test.js"></script>',
    ].join('');
    const dir2 = makeDist(Buffer.from('entry-only'), escapeHtml);
    try {
      const escaped = inspectHomeBundle(dir2, 60_000);
      expect(escaped.ok).toBe(true);
      expect(escaped.preload.ok).toBe(false);
      expect(escaped.preload.reason).toContain('不在 dist');
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('CLI 真的執行 main：通過 exit 0、超標與缺檔 exit 1（不得靜默通過）', () => {
    // vitest 的 import.meta.url 不一定是 file: 協定，改以專案根（vitest 的 cwd）定位。
    const script = path.resolve(process.cwd(), 'scripts/check-bundle-budget.mjs');
    const dir = makeDist(Buffer.from('cli-fixture'));
    try {
      const ok = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain('結果：通過');
      expect(ok.stdout).toContain('第二條：入口＋modulepreload');
      expect(ok.stdout).toContain('寬鬆上限 250000 bytes');
      const over = spawnSync(process.execPath, [script, dir, '0KB'], { encoding: 'utf8' });
      expect(over.status).toBe(1);
      expect(over.stdout).toContain('超過上限');
      const preloadOver = spawnSync(process.execPath, [script, dir, '60KB', '0KB'], { encoding: 'utf8' });
      expect(preloadOver.status).toBe(1);
      expect(preloadOver.stdout).toContain('第二條超過寬鬆上限');
      const bad = spawnSync(process.execPath, [script, path.join(dir, 'nope')], { encoding: 'utf8' });
      expect(bad.status).toBe(1);
      const badLimit = spawnSync(process.execPath, [script, dir, 'abc'], { encoding: 'utf8' });
      expect(badLimit.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
