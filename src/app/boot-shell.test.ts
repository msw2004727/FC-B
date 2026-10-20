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
    ['id="sport-picker-btn"', topBar],
    ['id="notif-btn"', topBar],
    ['id="line-login-wrapper"', topBar],
    ['id="line-login-btn"', topBar],
    ['id="line-avatar-topbar"', topBar],
  ])('%s 與元件一致', (needle, componentSource) => {
    expect(shell).toContain(needle);
    expect(componentSource).toContain(needle);
  });

  it.each(['bot-tab-center-wrap', 'bot-tab-qr', 'bot-tab'])('底部導覽 class %s 與元件一致', (cls) => {
    expect(shell).toContain(cls);
    expect(bottomNav).toContain(cls);
  });

  it('外層 class 與 App 一致，且標記 data-boot-shell 供 main.tsx 清除', () => {
    expect(html).toContain('<div class="app-shell ui-app-shell" data-boot-shell');
    expect(read('./App.tsx')).toContain('app-shell');
    expect(read('../main.tsx')).toContain("querySelector('[data-boot-shell]')");
  });

  it('登入線索的 localStorage 鍵與 auth-hint.ts 一致', () => {
    const hint = read('../data/auth-hint.ts').match(/AUTH_HINT_KEY = '([^']+)'/)?.[1];
    expect(hint).toBeTruthy();
    expect(shell).toContain(`localStorage.getItem('${hint}')`);
  });

  it('經驗值顯示關閉時，骨架與 TopBar 都不畫 EXP（src/core/exp-display.ts）', () => {
    const showExp = /SHOW_EXP = true/.test(read('../core/exp-display.ts'));
    expect(shell.includes('id="points-display"')).toBe(showExp);
    expect(topBar).toContain('SHOW_EXP &&');
  });

  it('骨架不可互動（避免開頁時點了沒反應）', () => {
    expect(html).toContain('data-boot-shell style="pointer-events:none"');
  });

  it('logo 檔名與 TopBar 相同（才能共用快取）', () => {
    for (const file of ['/assets/logo-black.webp', '/assets/logo-white.webp']) {
      expect(shell).toContain(file);
      expect(topBar).toContain(file);
    }
  });
});
