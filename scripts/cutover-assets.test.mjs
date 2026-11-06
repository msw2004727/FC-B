// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// 換站計畫書 B-01／B-02／I-02：舊站公開頁與資產原樣搬進 public/（同路徑），換站後 toosterx.com 這些網址不會落到 SPA 首頁。
const MUST_EXIST = [
  'blog/index.html',
  'blog/seo-article.css',
  'seo/football.html',
  'roles/index.html',
  'inventory/index.html',
  'LOGO/Nocoverimage set.png',
  'img/seo/chaoma-football-field-map-1200.webp',
  'privacy.html',
  'terms.html',
  'llms.txt',
  'appicon.png',
  'og.png',
  'assets/og/default.png',
];

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('換站搬入的公開資產', () => {
  it.each(MUST_EXIST)('public/%s 存在', (path) => {
    expect(existsSync(new URL(`../public/${path}`, import.meta.url))).toBe(true);
  });

  it('搬入的頁面與資產不進 Service Worker 預存', () => {
    const ignores = /globIgnores:\s*\[([^\]]*)\]/.exec(read('vite.config.ts'))?.[1] ?? '';
    for (const glob of ['blog/**', 'seo/**', 'roles/**', 'inventory/**', 'privacy.html', 'terms.html', 'LOGO/**', 'img/seo/**']) {
      expect(ignores).toContain(`'${glob}'`);
    }
  });

  it('正式版 robots 照舊站：全站 Allow、封鎖內部工具、列 sitemap；不放 public/ 以免和內測版衝突', () => {
    const robots = read('scripts/robots-public.txt');
    expect(robots).toMatch(/^User-agent: \*\nAllow: \//m);
    expect(robots).toContain('Disallow: /inventory/');
    expect(robots).toContain('Sitemap: https://toosterx.com/sitemap.xml');
    expect(existsSync(new URL('../public/robots.txt', import.meta.url))).toBe(false);
    expect(read('vite.config.ts')).toContain("./scripts/robots-public.txt");
  });
});
