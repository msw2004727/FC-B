import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  BASELINE,
  DEFAULT_LIMIT_BYTES,
  DEFAULT_PRELOAD_SUM_LIMIT_BYTES,
  exceedsBudget,
  gzipByteLength,
  inspectHomeBundle,
  listHashedAssetNames,
  normalizeBuildHashes,
  listHomeEntryJs,
  listModulePreloadJs,
  listOtherModuleScripts,
  measurePreloadSum,
  parseLimit,
  renderReport,
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
// 拿掉懸空的 modulepreload，避免合計因缺檔失敗；入口測試仍不把 preload 算進 totalGzip。
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

function pseudoRandom(length, seed = 1) {
  const buf = Buffer.alloc(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    buf[i] = x >>> 24;
  }
  return buf;
}

/** 做出 gzip level 9 長度剛好是 target 的檔身。給新上限的等於／超過一 byte 用。 */
function bufferOfGzipSize(target) {
  const gzipLen = (n, seed) => zlib.gzipSync(pseudoRandom(n, seed), { level: 9 }).length;
  for (let seed = 1; seed <= 24; seed++) {
    let n = Math.max(0, target - 32);
    let len = gzipLen(n, seed);
    for (let hop = 0; hop < 8 && len !== target; hop++) {
      const next = n + (target - len);
      if (next <= 0 || next === n) break;
      n = next;
      len = gzipLen(n, seed);
    }
    if (len === target) return pseudoRandom(n, seed);
    const start = Math.max(0, n - 16);
    for (let k = start; k <= n + 64; k++) {
      if (gzipLen(k, seed) === target) return pseudoRandom(k, seed);
    }
  }
  throw new Error(`找不到 gzip 長度剛好 ${target} 的內容`);
}

function signedDelta(delta) {
  if (delta === 0) return '±0';
  return delta > 0 ? `+${delta}` : String(delta);
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
      expect(over.reason).toContain('入口超過上限');
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
      const report = renderReport(noHtml);
      expect(report).toContain('找不到');
      expect(report).toContain('合計未計');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('上限以 1000 bytes 為 1KB，入口預設 60024；合計預設 123823', () => {
    expect(parseLimit('60KB')).toBe(60_000);
    expect(parseLimit('1KB')).toBe(1_000);
    expect(parseLimit(undefined)).toBe(60_024);
    expect(parseLimit(undefined, DEFAULT_PRELOAD_SUM_LIMIT_BYTES)).toBe(123_823);
    expect(DEFAULT_LIMIT_BYTES).toBe(60_024);
    expect(DEFAULT_PRELOAD_SUM_LIMIT_BYTES).toBe(123_823);
    expect(BASELINE).toEqual({ ref: '7514fde4', entryBytes: 59512, sumBytes: 122799 });
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
      expect(over.reason).toContain('合計超過上限');
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
      expect(ok.stdout).toContain('輔助：入口單檔');
      expect(ok.stdout).toContain('主要：入口＋modulepreload');
      expect(ok.stdout).toContain('上限 60024 bytes');
      expect(ok.stdout).toContain('上限 123823 bytes');
      expect(ok.stdout).toContain('與基準相比：');
      expect(ok.stdout).not.toContain('⚠');
      expect(ok.stdout).not.toContain('寬鬆上限');
      const over = spawnSync(process.execPath, [script, dir, '0KB'], { encoding: 'utf8' });
      expect(over.status).toBe(1);
      expect(over.stdout).toContain('入口超過上限');
      expect(over.stdout).toContain('超限：入口');
      const preloadOver = spawnSync(process.execPath, [script, dir, '60KB', '0KB'], { encoding: 'utf8' });
      expect(preloadOver.status).toBe(1);
      expect(preloadOver.stdout).toContain('合計超過上限');
      expect(preloadOver.stdout).toContain('超限：合計');
      expect(preloadOver.stdout).not.toContain('入口超過上限');
      const bad = spawnSync(process.execPath, [script, path.join(dir, 'nope')], { encoding: 'utf8' });
      expect(bad.status).toBe(1);
      const badLimit = spawnSync(process.execPath, [script, dir, 'abc'], { encoding: 'utf8' });
      expect(badLimit.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('新上限：入口 60024 等於通過、60025 失敗；合計 123823 通過、123824 失敗，訊息指出哪一條', () => {
    expect(exceedsBudget(60_024, DEFAULT_LIMIT_BYTES)).toBe(false);
    expect(exceedsBudget(60_025, DEFAULT_LIMIT_BYTES)).toBe(true);
    expect(exceedsBudget(123_823, DEFAULT_PRELOAD_SUM_LIMIT_BYTES)).toBe(false);
    expect(exceedsBudget(123_824, DEFAULT_PRELOAD_SUM_LIMIT_BYTES)).toBe(true);

    const dirPass = makeDist(bufferOfGzipSize(60_024));
    const dirFail = makeDist(bufferOfGzipSize(60_025));
    const dirSumPass = makeDist(bufferOfGzipSize(123_823));
    const dirSumFail = makeDist(bufferOfGzipSize(123_824));
    try {
      const pass = inspectHomeBundle(dirPass, DEFAULT_LIMIT_BYTES, DEFAULT_PRELOAD_SUM_LIMIT_BYTES);
      expect(pass.totalGzip).toBe(60_024);
      expect(pass.ok).toBe(true);
      expect(pass.preload.ok).toBe(true);
      expect(pass.preload.totalGzip).toBe(60_024);

      const fail = inspectHomeBundle(dirFail, DEFAULT_LIMIT_BYTES, DEFAULT_PRELOAD_SUM_LIMIT_BYTES);
      expect(fail.totalGzip).toBe(60_025);
      expect(fail.ok).toBe(false);
      expect(fail.preload.ok).toBe(true);
      expect(fail.reason).toBe('入口超過上限（雜湊正規化後）：60025 > 60024');
      const failText = renderReport(fail);
      expect(failText).toContain('入口超過上限（雜湊正規化後）：60025 > 60024');
      expect(failText).toContain('超限：入口');
      expect(failText).not.toContain('合計超過上限');

      // 入口上限放寬，只讓合計這條碰到 123823／123824。
      const sumPass = inspectHomeBundle(dirSumPass, 200_000, DEFAULT_PRELOAD_SUM_LIMIT_BYTES);
      expect(sumPass.preload.totalGzip).toBe(123_823);
      expect(sumPass.ok).toBe(true);
      expect(sumPass.preload.ok).toBe(true);

      const sumFail = inspectHomeBundle(dirSumFail, 200_000, DEFAULT_PRELOAD_SUM_LIMIT_BYTES);
      expect(sumFail.preload.totalGzip).toBe(123_824);
      expect(sumFail.ok).toBe(true);
      expect(sumFail.preload.ok).toBe(false);
      expect(sumFail.preload.reason).toBe('合計超過上限：123824 > 123823');
      const sumText = renderReport(sumFail);
      expect(sumText).toContain('合計超過上限：123824 > 123823');
      expect(sumText).toContain('超限：合計');
      expect(sumText).not.toContain('入口超過上限');

      const both = inspectHomeBundle(dirSumFail, DEFAULT_LIMIT_BYTES, DEFAULT_PRELOAD_SUM_LIMIT_BYTES);
      expect(both.ok).toBe(false);
      expect(both.preload.ok).toBe(false);
      const bothText = renderReport(both);
      expect(bothText).toContain('入口超過上限');
      expect(bothText).toContain('合計超過上限');
      expect(bothText).toContain('超限：入口、合計');
    } finally {
      rmSync(dirPass, { recursive: true, force: true });
      rmSync(dirFail, { recursive: true, force: true });
      rmSync(dirSumPass, { recursive: true, force: true });
      rmSync(dirSumFail, { recursive: true, force: true });
    }
  }, 30_000);

  it('入口變小且合計變大時報告含警告；入口變大或合計變小則不含', () => {
    const htmlWithPreload = [
      '<link rel="modulepreload" href="/assets/hooks-xyz.js">',
      '<script type="module" src="/assets/index-test.js"></script>',
    ].join('');

    const dirWarn = makeDist(Buffer.from('small-entry'), htmlWithPreload);
    writeFileSync(path.join(dirWarn, 'assets', 'hooks-xyz.js'), pseudoRandom(180_000, 7));
    try {
      // 兩個上限都還夠：示警不改判定。
      const warn = inspectHomeBundle(dirWarn, 500_000, 500_000);
      expect(warn.ok).toBe(true);
      expect(warn.preload.ok).toBe(true);
      expect(warn.totalGzip).toBeLessThan(BASELINE.entryBytes);
      expect(warn.preload.totalGzip).toBeGreaterThan(BASELINE.sumBytes);
      const warnText = renderReport(warn);
      const entryDelta = warn.totalGzip - BASELINE.entryBytes;
      const sumDelta = warn.preload.totalGzip - BASELINE.sumBytes;
      expect(warnText).toContain(`與基準相比：入口 ${signedDelta(entryDelta)} B、合計 ${signedDelta(sumDelta)} B`);
      expect(warnText).toContain('⚠ 入口變小但合計變大：可能只是把入口的程式搬進預載檔，不算瘦身');
      expect(warnText).toContain('結果：通過');

      // 合計超限仍失敗；警告還在，但不另改入口那條。
      const over = inspectHomeBundle(dirWarn, DEFAULT_LIMIT_BYTES, DEFAULT_PRELOAD_SUM_LIMIT_BYTES);
      expect(over.ok).toBe(true);
      expect(over.preload.ok).toBe(false);
      expect(over.preload.reason).toContain('合計超過上限');
      const overText = renderReport(over);
      expect(overText).toContain('⚠ 入口變小但合計變大');
      expect(overText).toContain('超限：合計');
    } finally {
      rmSync(dirWarn, { recursive: true, force: true });
    }

    // 入口變大且合計變大：不含警告。
    const dirBig = makeDist(pseudoRandom(180_000, 9));
    try {
      const big = inspectHomeBundle(dirBig, 500_000, 500_000);
      expect(big.ok).toBe(true);
      expect(big.preload.ok).toBe(true);
      expect(big.totalGzip).toBeGreaterThan(BASELINE.entryBytes);
      expect(big.preload.totalGzip).toBeGreaterThan(BASELINE.sumBytes);
      const bigText = renderReport(big);
      expect(bigText).toContain('與基準相比：入口 +');
      expect(bigText).not.toContain('⚠');
      expect(bigText).not.toContain('入口變小但合計變大');
    } finally {
      rmSync(dirBig, { recursive: true, force: true });
    }

    // 入口變大、合計仍小於基準：不含警告。
    const dirEntryUp = makeDist(pseudoRandom(80_000, 3));
    try {
      const up = inspectHomeBundle(dirEntryUp, 500_000, 500_000);
      expect(up.totalGzip).toBeGreaterThan(BASELINE.entryBytes);
      expect(up.preload.totalGzip).toBeLessThan(BASELINE.sumBytes);
      expect(renderReport(up)).not.toContain('⚠');
    } finally {
      rmSync(dirEntryUp, { recursive: true, force: true });
    }

    // 合計變小（入口也變小）：不含警告。
    const dirSmall = makeDist(Buffer.from('small-entry'));
    try {
      const small = inspectHomeBundle(dirSmall, DEFAULT_LIMIT_BYTES);
      expect(small.ok).toBe(true);
      expect(small.preload.ok).toBe(true);
      expect(small.totalGzip).toBeLessThan(BASELINE.entryBytes);
      expect(small.preload.totalGzip).toBeLessThan(BASELINE.sumBytes);
      const smallText = renderReport(small);
      expect(smallText).toContain('與基準相比：');
      expect(smallText).not.toContain('⚠');
      expect(smallText).not.toContain('入口變小但合計變大');
    } finally {
      rmSync(dirSmall, { recursive: true, force: true });
    }
  });

  it('renderReport 用 measured／exceeded，不比對原因文字', () => {
    const base = {
      ok: true,
      reason: '通過',
      entries: [{ href: '/assets/index-test.js', file: 'x', rawBytes: 1, gzipBytes: BASELINE.entryBytes }],
      totalGzip: BASELINE.entryBytes,
      limitBytes: 500_000,
      preload: {
        ok: true,
        reason: '不比對這段文字',
        files: [{ href: '/assets/index-test.js', file: 'x', rawBytes: 1, gzipBytes: BASELINE.sumBytes + 10, kind: 'entry' }],
        totalGzip: BASELINE.sumBytes + 10,
        limitBytes: 500_000,
        measured: true,
        exceeded: false,
      },
    };
    const text = renderReport(base);
    expect(text).toContain(`與基準相比：入口 ±0 B、合計 ${signedDelta(10)} B`);
    expect(text).not.toContain('⚠');

    const hidden = {
      ...base,
      preload: { ...base.preload, measured: false, exceeded: false, reason: '通過' },
    };
    expect(renderReport(hidden)).not.toContain('與基準相比：');

    const over = {
      ...base,
      preload: { ...base.preload, ok: false, measured: true, exceeded: true, reason: '別的說法' },
    };
    expect(renderReport(over)).toContain('超限：合計');
    expect(renderReport(over)).not.toContain('超限：入口');
  });

  it('入口差異 0 且合計變大不警告；入口變小且合計差異 0 不警告', () => {
    const html = [
      '<link rel="modulepreload" href="/assets/hooks-xyz.js">',
      '<script type="module" src="/assets/index-test.js"></script>',
    ].join('');

    const dirSameEntry = makeDist(bufferOfGzipSize(BASELINE.entryBytes), html);
    writeFileSync(path.join(dirSameEntry, 'assets', 'hooks-xyz.js'), bufferOfGzipSize(BASELINE.sumBytes));
    try {
      const same = inspectHomeBundle(dirSameEntry, 500_000, 500_000);
      expect(same.totalGzip).toBe(BASELINE.entryBytes);
      expect(same.preload.measured).toBe(true);
      expect(same.preload.exceeded).toBe(false);
      expect(same.preload.totalGzip).toBeGreaterThan(BASELINE.sumBytes);
      const sameText = renderReport(same);
      const sumDelta = same.preload.totalGzip - BASELINE.sumBytes;
      expect(sameText).toContain(`與基準相比：入口 ±0 B、合計 ${signedDelta(sumDelta)} B`);
      expect(sameText).not.toContain('⚠');
    } finally {
      rmSync(dirSameEntry, { recursive: true, force: true });
    }

    const entrySmall = Buffer.from('small-entry');
    const entrySmallGzip = zlib.gzipSync(entrySmall, { level: 9 }).length;
    const dirSumExact = makeDist(entrySmall, html);
    writeFileSync(
      path.join(dirSumExact, 'assets', 'hooks-xyz.js'),
      bufferOfGzipSize(BASELINE.sumBytes - entrySmallGzip),
    );
    try {
      const exactSum = inspectHomeBundle(dirSumExact, 500_000, 500_000);
      expect(exactSum.totalGzip).toBe(entrySmallGzip);
      expect(exactSum.totalGzip).toBeLessThan(BASELINE.entryBytes);
      expect(exactSum.preload.measured).toBe(true);
      expect(exactSum.preload.exceeded).toBe(false);
      expect(exactSum.preload.totalGzip).toBe(BASELINE.sumBytes);
      const exactText = renderReport(exactSum);
      expect(exactText).toContain(`與基準相比：入口 ${signedDelta(entrySmallGzip - BASELINE.entryBytes)} B、合計 ±0 B`);
      expect(exactText).not.toContain('⚠');
    } finally {
      rmSync(dirSumExact, { recursive: true, force: true });
    }
  }, 60_000);

  describe('入口以檔名雜湊正規化後的 gzip 判定（站長 11-20 於顧問對話親答（§3.362））', () => {
    function distWithEntry(entryText, chunkNames) {
      const dir = makeDist(Buffer.from(entryText, 'utf8'));
      for (const name of chunkNames) writeFileSync(path.join(dir, 'assets', name), 'x');
      return dir;
    }
    const code = 'const routes={a:()=>import("./boot-%A%.js"),b:()=>import("./auth-%B%.js")};export{routes};'.repeat(40);

    it('只差打包檔名雜湊的兩份入口：判定數字相同（實際 gzip 可以不同）', () => {
      const one = distWithEntry(code.replace(/%A%/g, 'Ab12Cd34').replace(/%B%/g, 'Zz98Yy76'), ['boot-Ab12Cd34.js', 'auth-Zz98Yy76.js']);
      const two = distWithEntry(code.replace(/%A%/g, 'Qq55Rr66').replace(/%B%/g, 'Tt11Uu22'), ['boot-Qq55Rr66.js', 'auth-Tt11Uu22.js']);
      try {
        const a = inspectHomeBundle(one, 1_000_000);
        const b = inspectHomeBundle(two, 1_000_000);
        expect(a.totalGzip).toBe(b.totalGzip);
        expect(a.entries[0].normalizedGzipBytes).toBe(b.entries[0].normalizedGzipBytes);
        expect(typeof a.actualGzip).toBe('number');
      } finally {
        rmSync(one, { recursive: true, force: true });
        rmSync(two, { recursive: true, force: true });
      }
    });

    it('入口真的多程式碼時，判定數字變大', () => {
      const names = ['boot-Ab12Cd34.js', 'auth-Zz98Yy76.js'];
      const base = code.replace(/%A%/g, 'Ab12Cd34').replace(/%B%/g, 'Zz98Yy76');
      const small = distWithEntry(base, names);
      const big = distWithEntry(base + 'function extra(n){let s=0;for(let i=0;i<n;i++){s+=i*7%13;}return s;}export{extra};', names);
      try {
        expect(inspectHomeBundle(big, 1_000_000).totalGzip).toBeGreaterThan(inspectHomeBundle(small, 1_000_000).totalGzip);
      } finally {
        rmSync(small, { recursive: true, force: true });
        rmSync(big, { recursive: true, force: true });
      }
    });

    it('只換路徑引用形式；同名的一般字串、較長字串的一部分都不換（Flash 交叉審 P1）', () => {
      const names = new Map([['boot-Ab12Cd34.js', 'boot-XXXXXXXX.js']]);
      expect(normalizeBuildHashes('import("./boot-Ab12Cd34.js");', names)).toBe('import("./boot-XXXXXXXX.js");');
      expect(normalizeBuildHashes('const s="boot-Ab12Cd34.js";', names)).toBe('const s="boot-Ab12Cd34.js";');
      expect(normalizeBuildHashes('// "boot-Ab12Cd34.js"', names)).toBe('// "boot-Ab12Cd34.js"');
      expect(normalizeBuildHashes('m(["assets/boot-Ab12Cd34.js","x"]);', names)).toBe('m(["assets/boot-XXXXXXXX.js","x"]);');
      expect(normalizeBuildHashes('import(`./boot-Ab12Cd34.js`);', names)).toBe('import(`./boot-XXXXXXXX.js`);');
      expect(normalizeBuildHashes('const s="x-boot-Ab12Cd34.js.bak";', names)).toBe('const s="x-boot-Ab12Cd34.js.bak";');
      expect(normalizeBuildHashes('// see boot-Ab12Cd34.js here', names)).toBe('// see boot-Ab12Cd34.js here');
    });

    it('資料夾不算打包檔名；子資料夾裡的檔案也會列入', () => {
      const dir = makeDist(Buffer.from('x'));
      try {
        mkdirSync(path.join(dir, 'assets', 'fake-Ab12Cd34.js'));
        mkdirSync(path.join(dir, 'assets', 'chunks'));
        writeFileSync(path.join(dir, 'assets', 'chunks', 'deep-Qq55Rr66.js'), 'x');
        const names = listHashedAssetNames(dir);
        expect(names.has('fake-Ab12Cd34.js')).toBe(false);
        expect(names.get('deep-Qq55Rr66.js')).toBe('deep-XXXXXXXX.js');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('報告分開標示：讀不到 dist/assets、沒有打包檔名、有正規化（Flash 交叉審 P3）', () => {
      const noAssets = makeDist(Buffer.from('export{};'));
      const noHash = makeDist(Buffer.from('export{};'));
      try {
        rmSync(path.join(noAssets, 'assets', 'index-test.js'));
        const html = '<script type="module" src="/index-test.js"></script>';
        writeFileSync(path.join(noAssets, 'index.html'), html);
        writeFileSync(path.join(noAssets, 'index-test.js'), 'export{};');
        rmSync(path.join(noAssets, 'assets'), { recursive: true, force: true });
        expect(renderReport(inspectHomeBundle(noAssets, 1_000_000))).toContain('讀不到 dist/assets');
        expect(renderReport(inspectHomeBundle(noHash, 1_000_000))).toContain('沒有帶雜湊的打包檔名');
        // dist/assets 存在但不是資料夾：也算讀不到（Flash 第三輪 P3）。
        writeFileSync(path.join(noAssets, 'assets'), 'x');
        expect(renderReport(inspectHomeBundle(noAssets, 1_000_000))).toContain('讀不到 dist/assets');
      } finally {
        rmSync(noAssets, { recursive: true, force: true });
        rmSync(noHash, { recursive: true, force: true });
      }
    });

    it('只換 dist/assets 裡實際存在的打包檔名，其他字串不動', () => {
      const names = new Map([['boot-Ab12Cd34.js', 'boot-XXXXXXXX.js']]);
      const text = 'import("./boot-Ab12Cd34.js");const s="note-Qq55Rr66.js";';
      expect(normalizeBuildHashes(text, names)).toBe('import("./boot-XXXXXXXX.js");const s="note-Qq55Rr66.js";');
    });
  });
});
