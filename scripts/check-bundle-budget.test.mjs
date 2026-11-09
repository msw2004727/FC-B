import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  exceedsBudget,
  gzipByteLength,
  inspectHomeBundle,
  listHomeEntryJs,
  parseLimit,
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

function makeDist(body, html = FIXTURE_HTML.replace('index-Ab12.js', 'index-test.js')) {
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

  it('上限以 1000 bytes 為 1KB，預設 60KB', () => {
    expect(parseLimit('60KB')).toBe(60_000);
    expect(parseLimit('1KB')).toBe(1_000);
    expect(parseLimit(undefined)).toBe(60_000);
  });
});
