import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// T-042 退修 5：橫幅 <img> 的「何時才畫」是 CSS 契約（jsdom 不載入樣式，元件測試看不到），用靜態檢查守住。
// 離線像素對照的連拍序列發現：逾時（timeout）取消壓暗後若圖片又載入失敗，瀏覽器會在尚未換成失敗佔位的那一格
// 畫出破圖圖示；所以圖片在 data-banner-load-state="done"（載入並解碼完成）之前一律不畫，而不是只看「載入中」的 class。
const css = readFileSync(resolve(__dirname, 'banner-img.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('banner-img.css', () => {
  it('<img> 在「載入並解碼完成」（data-banner-load-state="done"）之前一律 visibility:hidden', () => {
    const rule = /\.banner-slide:not\(\[data-banner-load-state="done"\]\)\s*>\s*\.banner-slide-img\s*\{([^}]*)\}/.exec(css);
    expect(rule, '找不到隱藏規則').not.toBeNull();
    expect(rule?.[1]).toMatch(/visibility:\s*hidden/);
  });

  it('不再只看 .banner-slide--loading 才隱藏（逾時取消壓暗不等於已載完）', () => {
    expect(css).not.toMatch(/\.banner-slide--loading\s+\.banner-slide-img/);
  });

  it('點擊與長按都落在 slide 上：<img> 本身 pointer-events:none', () => {
    const rule = /(?:^|\})\s*\.banner-slide-img\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/pointer-events:\s*none/);
  });
});
