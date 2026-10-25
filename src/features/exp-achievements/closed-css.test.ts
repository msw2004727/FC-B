import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

// 退修 1 #2：ACHIEVEMENTS_OPEN 要是「單一開關」——closed.css 的每條規則都必須綁在狀態 class 上，
// 開放時 class 不存在（元件端不加 ach-closed、availability.ts 移除 <html> 的 achievements-closed），規則就不會命中。
const CSS = readFileSync(resolve(process.cwd(), 'src/features/exp-achievements/closed.css'), 'utf8');
const STATE_CLASSES = ['.ach-closed', '.achievements-closed'];

describe('closed.css 的每個選擇器都綁在狀態 class 上', () => {
  const selectors: string[] = [];
  postcss.parse(CSS).walkRules((rule) => {
    for (const selector of rule.selectors) selectors.push(selector.trim());
  });

  it('至少有反灰規則', () => {
    expect(selectors.length).toBeGreaterThanOrEqual(5);
  });

  it.each(selectors.map((selector) => [selector]))('%s', (selector) => {
    expect(STATE_CLASSES.some((cls) => selector.includes(cls))).toBe(true);
  });

  it('他人名片徽章數的反灰由 <html> 狀態 class 控制，不是無條件規則', () => {
    const statSelectors = selectors.filter((selector) => selector.includes('#uc-stat-badges'));
    expect(statSelectors.length).toBeGreaterThan(0);
    for (const selector of statSelectors) expect(selector.startsWith('html.achievements-closed ')).toBe(true);
  });
});

// 他人名片徽章數的 DOM 在 T-037 擁有的 LegacyUserCard.tsx，這裡只讀原始碼確認 CSS 依賴的結構沒變：
// #uc-stat-badges 與「徽章」標籤是同一個 .stat-item 裡的兄弟（closed.css 用一般兄弟選擇器 ~ 反灰標籤）。
describe('他人名片徽章數的結構契約（closed.css 依賴）', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/features/profile/components/legacy/LegacyUserCard.tsx'),
    'utf8',
  );

  it('#uc-stat-badges 與 .stat-label 在同一個 .stat-item 內', () => {
    const match = source.match(
      /<div class="stat-item">\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<span class="stat-num" id="uc-stat-badges">[\s\S]*?<\/span>\s*<span class="stat-label">/,
    );
    expect(match).not.toBeNull();
  });
});
