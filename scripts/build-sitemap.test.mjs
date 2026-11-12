// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildEventEntries, buildSitemapXml, fetchAllEvents, isIndexableEvent, OUTPUT_URL, regenerateSitemap } from './build-sitemap.mjs';

const NOW = Date.parse('2026-11-07T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('build-sitemap（I-03）', () => {
  it('篩選條件照 A：私密、俱樂部限定、已結束、隱藏、超過 30 天的活動不收', () => {
    expect(isIndexableEvent({ date: '2026/11/20 10:00' }, NOW)).toBe(true);
    expect(isIndexableEvent({}, NOW)).toBe(true);
    expect(isIndexableEvent({ privateEvent: true }, NOW)).toBe(false);
    expect(isIndexableEvent({ teamOnly: true }, NOW)).toBe(false);
    expect(isIndexableEvent({ status: 'Ended' }, NOW)).toBe(false);
    expect(isIndexableEvent({ hidden: true }, NOW)).toBe(false);
    expect(isIndexableEvent({ startAt: new Date(NOW - 31 * DAY).toISOString() }, NOW)).toBe(false);
    expect(isIndexableEvent({ startAt: new Date(NOW - 29 * DAY).toISOString() }, NOW)).toBe(true);
  });

  it('可見性對齊 R-EVT：已取消／已刪除不收；俱樂部限定即使 isPublic 也保守不收；黑名單不影響（訪客可見，R-EVT-011）', () => {
    expect(isIndexableEvent({ status: 'cancelled' }, NOW)).toBe(false);
    expect(isIndexableEvent({ status: 'deleted' }, NOW)).toBe(false);
    expect(isIndexableEvent({ teamOnly: true, isPublic: true }, NOW)).toBe(false);
    expect(isIndexableEvent({ privateEvent: true, teamOnly: false }, NOW)).toBe(false);
    expect(isIndexableEvent({ status: 'open', blockedUids: ['U_masked'] }, NOW)).toBe(true);
  });

  it('/sitemap*.xml 是 public 靜態檔、不經 worker（_routes.json 只收分享路徑），正式站才會回 XML 而不是 SPA 殼', () => {
    const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8'));
    expect(routes.include.some((p) => p.includes('sitemap'))).toBe(false);
    for (const name of ['sitemap.xml', 'sitemap-static.xml', 'sitemap-events.xml']) {
      const xml = readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    }
  });

  it('不合法或重複的 id 不收，網址指向 toosterx.com/events/{id}', () => {
    const entries = buildEventEntries(
      [{ id: 'ev_001' }, { id: 'ev_001' }, { id: 'a/b' }, { id: 'x' }, { _docId: 'doc-002' }],
      NOW,
    );
    expect(entries.map((e) => e.loc)).toEqual([
      'https://toosterx.com/events/ev_001',
      'https://toosterx.com/events/doc-002',
    ]);
  });

  it('產出合法 urlset，空清單也是合法 XML', () => {
    const xml = buildSitemapXml([{ loc: 'https://toosterx.com/events/ev_001', lastmod: '2026-11-07' }]);
    expect(xml).toContain('<loc>https://toosterx.com/events/ev_001</loc>');
    expect(xml).toContain('<lastmod>2026-11-07</lastmod>');
    expect(buildSitemapXml([])).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n',
    );
  });

  describe('regenerateSitemap（上線步驟，顧問 §3.129；只用假資料，不連正式資料庫）', () => {
    const makeLogger = () => {
      const lines = [];
      return { lines, log: (m) => lines.push(m), warn: (m) => lines.push(m) };
    };
    const withTempDir = async (fn) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'fcb-sitemap-'));
      try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
    };

    it('預設只寫 public/sitemap-events.xml（靜態表與索引不由腳本產生）', () => {
      expect(OUTPUT_URL.pathname.endsWith('/public/sitemap-events.xml')).toBe(true);
      const src = readFileSync(new URL('./build-sitemap.mjs', import.meta.url), 'utf8');
      expect(src.match(/writeFileSync\(/g)).toHaveLength(1);
      expect(src).not.toMatch(/sitemap-static\.xml'|sitemap\.xml'/);
    });

    it('成功：用公開活動重產、只動輸出檔，印「sitemap：重產 N 筆」', async () => {
      await withTempDir(async (dir) => {
        const out = path.join(dir, 'sitemap-events.xml');
        const logger = makeLogger();
        const result = await regenerateSitemap({
          fetchEvents: async () => [
            { id: 'ce_pub_001', date: '2026/11/20 10:00' },
            { id: 'ce_private_01', privateEvent: true },
            { id: 'ce_cancel_01', status: 'cancelled' },
          ],
          outputUrl: pathToFileURL(out),
          nowMs: NOW,
          logger,
        });
        expect(result).toEqual({ status: 'regenerated', count: 1 });
        expect(readdirSync(dir)).toEqual(['sitemap-events.xml']);
        const xml = readFileSync(out, 'utf8');
        expect(xml).toContain('<loc>https://toosterx.com/events/ce_pub_001</loc>');
        expect(xml).not.toContain('ce_private_01');
        expect(xml).not.toContain('ce_cancel_01');
        expect(logger.lines.at(-1)).toBe('sitemap：重產 1 筆');
      });
    });

    it('讀取失敗或讀到 0 筆：保留舊檔、不拋錯，印「sitemap：沿用舊檔」', async () => {
      await withTempDir(async (dir) => {
        const out = path.join(dir, 'sitemap-events.xml');
        writeFileSync(out, 'OLD', 'utf8');
        for (const fetchEvents of [async () => { throw new Error('Firestore events fetch failed (503)'); }, async () => []]) {
          const logger = makeLogger();
          const result = await regenerateSitemap({ fetchEvents, outputUrl: pathToFileURL(out), nowMs: NOW, logger });
          expect(result).toEqual({ status: 'kept', count: null });
          expect(readFileSync(out, 'utf8')).toBe('OLD');
          expect(logger.lines.at(-1)).toBe('sitemap：沿用舊檔');
        }
      });
    });

    it('合格公開活動 0 筆（讀到的文件都不公開）：寫成空 urlset，不視為失敗', async () => {
      await withTempDir(async (dir) => {
        const out = path.join(dir, 'sitemap-events.xml');
        const logger = makeLogger();
        const result = await regenerateSitemap({
          fetchEvents: async () => [{ id: 'ce_private_01', privateEvent: true }],
          outputUrl: pathToFileURL(out), nowMs: NOW, logger,
        });
        expect(result).toEqual({ status: 'regenerated', count: 0 });
        expect(readFileSync(out, 'utf8')).toBe(buildSitemapXml([]));
        expect(logger.lines.at(-1)).toBe('sitemap：重產 0 筆');
      });
    });

    describe('fetchAllEvents（假 fetch，不連網）', () => {
      const page = (n, next) => ({
        status: 200,
        json: async () => ({
          documents: [{ name: `projects/p/databases/(default)/documents/events/ce_page_${n}`, fields: {} }],
          ...(next ? { nextPageToken: `t${n}` } : {}),
        }),
      });

      it('正常分頁到最後一頁', async () => {
        let n = 0;
        const events = await fetchAllEvents({ apiKey: 'k', fetchImpl: async () => { n += 1; return page(n, n < 3); } });
        expect(events.map((e) => e.id)).toEqual(['ce_page_1', 'ce_page_2', 'ce_page_3']);
      });

      it('超過 30 頁丟錯（不寫部分清單），regenerateSitemap 走沿用舊檔（交叉審 P3-2）', async () => {
        let n = 0;
        const fetchImpl = async () => { n += 1; return page(n, true); };
        await expect(fetchAllEvents({ apiKey: 'k', fetchImpl })).rejects.toThrow(/超過 30 頁/);
        expect(n).toBe(30);
        await withTempDir(async (dir) => {
          const out = path.join(dir, 'sitemap-events.xml');
          writeFileSync(out, 'OLD', 'utf8');
          const logger = makeLogger();
          n = 0;
          const result = await regenerateSitemap({
            fetchEvents: () => fetchAllEvents({ apiKey: 'k', fetchImpl }),
            outputUrl: pathToFileURL(out), nowMs: NOW, logger,
          });
          expect(result.status).toBe('kept');
          expect(readFileSync(out, 'utf8')).toBe('OLD');
          expect(logger.lines.at(-1)).toBe('sitemap：沿用舊檔');
        });
      });

      it('總期限 60 秒：時間用完就丟錯，單頁逾時不超過剩餘時間（交叉審 P3-1）', async () => {
        let clock = 0;
        const signals = [];
        const fetchImpl = async (_url, opts) => { signals.push(opts.signal); clock += 25_000; return page(signals.length, true); };
        await expect(fetchAllEvents({ apiKey: 'k', fetchImpl, nowFn: () => clock })).rejects.toThrow(/總期限 60 秒/);
        // 0、25、50 秒各抓一頁，第 4 頁開始前已到 75 秒 > 60 秒
        expect(signals).toHaveLength(3);
        expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
      });
    });

    it('不保留 GitHub Actions 排程（顧問 §3.129 第 1 項）', () => {
      expect(existsSync(new URL('../.github/workflows/build-sitemap.yml', import.meta.url))).toBe(false);
    });
  });

  // 合格公開活動真的是 0 筆時，空 urlset 是正確且合法的 sitemap（讀到 0 筆「文件」才視為異常沿用舊檔），
  // 所以這裡允許 0 筆，避免正式站剛好沒有公開活動時 CI 變紅（交叉審 P3-4）。
  it('現行活動子表：合法 urlset，每筆都是 toosterx.com/events/{合法 id}（允許 0 筆）', () => {
    const xml = readFileSync(new URL('../public/sitemap-events.xml', import.meta.url), 'utf8');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')).toBe(true);
    expect(xml.endsWith('</urlset>\n')).toBe(true);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const loc of locs) expect(loc).toMatch(/^https:\/\/toosterx\.com\/events\/[A-Za-z0-9_-]{3,80}$/);
  });

  it('索引只列靜態與活動子表（俱樂部要登入、B 無賽事詳情頁）', () => {
    const index = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
    // 註解要和實際重產時機一致：不是每日排程，是上線批次 bump-version（交叉審 P3-3）
    expect(index).toContain('每個上線批次 npm run bump-version');
    expect(index).not.toContain('每日');
    const locs = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      'https://toosterx.com/sitemap-static.xml',
      'https://toosterx.com/sitemap-events.xml',
    ]);
  });
});
