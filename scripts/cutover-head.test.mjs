// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// 換站計畫書 I-01：首頁 head 的搜尋與分享預覽標籤照 A；內容頁快取照 A `_headers`。
describe('換站前必修：首頁 head 與內容頁快取', () => {
  const html = read('index.html');

  it('canonical、hreflang、OG、Twitter 指向正式網域與預設 OG 圖', () => {
    expect(html).toContain('<link rel="canonical" href="https://toosterx.com/">');
    expect(html).toContain('hreflang="zh-TW" href="https://toosterx.com/"');
    expect(html).toContain('<meta property="og:image" content="https://toosterx.com/assets/og/default.png?v=20260707">');
    expect(html).toContain('<meta property="og:url" content="https://toosterx.com">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toMatch(/<meta name="description" content="[^"]{20,}">/);
  });

  it('JSON-LD 是合法 JSON', () => {
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(block).toBeTruthy();
    expect(() => JSON.parse(block)).not.toThrow();
  });

  it('只有一個 title、一個 canonical（內測 noindex 仍由建置注入）', () => {
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
  });

  it('blog／seo／privacy／terms／OG 圖照 A 快取一天', () => {
    const config = read('vite.config.ts');
    for (const path of ['/seo/*', '/blog/*', '/privacy', '/privacy.html', '/terms', '/terms.html', '/assets/og/*']) {
      expect(config).toContain(`'${path}'`);
    }
    // OG 圖規則必須在 /assets/* 之後，`! Cache-Control` 才會蓋掉一年 immutable
    expect(config.indexOf("'/assets/og/*'")).toBeGreaterThan(config.indexOf("'/assets/*',"));
    expect(config).toContain("'  Cache-Control: public, max-age=86400'");
  });

  it('搬入頁不再有舊站 hash 連結', () => {
    expect(read('public/seo/football-taichung.html')).not.toContain('/#page-');
  });
});
