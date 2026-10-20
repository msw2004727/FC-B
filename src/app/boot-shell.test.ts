import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// index.html 的開頁骨架是 TopBar／BottomNav 的靜態副本；元件改結構時要同步，這裡比對關鍵 id 與 class。
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const html = read('../../index.html');
const topBar = read('../ui/TopBar.tsx');
const bottomNav = read('../ui/BottomNav.tsx');

function shellOf(source: string): string {
  const start = source.indexOf('data-boot-shell');
  const end = source.indexOf('<script type="module"');
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, end);
}

describe('index.html 開頁骨架', () => {
  const shell = shellOf(html);

  it.each([
    ['id="top-bar"', topBar],
    ['id="menu-toggle"', topBar],
    ['id="top-logo-img"', topBar],
    ['class="top-bar-right"', topBar],
    ['id="bottom-tabs"', bottomNav],
  ])('%s 與元件一致', (needle, componentSource) => {
    expect(shell).toContain(needle);
    expect(componentSource).toContain(needle);
  });

  it.each(['bot-tab-center-wrap', 'bot-tab-qr', 'bot-tab'])('底部導覽 class %s 與元件一致', (cls) => {
    expect(shell).toContain(cls);
    expect(bottomNav).toContain(cls);
  });

  it('外層 class 與 App 一致，且標記 data-boot-shell 供 main.tsx 清除', () => {
    expect(html).toContain('<div class="app-shell ui-app-shell" data-boot-shell>');
    expect(read('./App.tsx')).toContain('app-shell');
    expect(read('../main.tsx')).toContain("querySelector('[data-boot-shell]')");
  });

  it('logo 檔名與 TopBar 相同（才能共用快取）', () => {
    for (const file of ['/assets/logo-black.webp', '/assets/logo-white.webp']) {
      expect(shell).toContain(file);
      expect(topBar).toContain(file);
    }
  });
});
