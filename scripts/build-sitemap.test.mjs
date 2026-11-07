// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildEventEntries, buildSitemapXml, isIndexableEvent } from './build-sitemap.mjs';

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

  it('索引只列靜態與活動子表（俱樂部要登入、B 無賽事詳情頁）', () => {
    const index = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
    const locs = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      'https://toosterx.com/sitemap-static.xml',
      'https://toosterx.com/sitemap-events.xml',
    ]);
  });
});
