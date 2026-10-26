import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { TopBar } from '../ui/TopBar';

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

  // 測試同步更新：照 A（M-055）——index.html head 開頁腳本在畫面出現前讀取 sporthub_font_size 套用字級
  it('M-055：開頁腳本讀取 sporthub_font_size 並立即套用 documentElement.style.fontSize', () => {
    expect(html).toContain("localStorage.getItem('sporthub_font_size')");
    expect(html).toContain('document.documentElement.style.fontSize');
  });
});

// T-050：骨架「上次已登入」分支是開頁 script 內 wrap.innerHTML 的字串。這裡把它解析成真正的 DOM，
// 與 TopBar authPending 實際渲染出來的 DOM 比結構（不是在原始碼字串裡搜字，骨架多塞人形 svg 一樣會紅）。
function shellSignedInDom(): HTMLElement {
  const match = html.match(/wrap\.innerHTML = signedIn\s*\?\s*'([^']*)'\s*:\s*'[^']*'/);
  expect(match).not.toBeNull();
  const box = document.createElement('div');
  box.innerHTML = match![1]!;
  return box;
}

interface Shape {
  tag: string;
  id: string | null;
  classes: string[];
  ariaHidden: string | null;
  children: Shape[];
}

function shapeOf(el: Element): Shape {
  return {
    tag: el.tagName.toLowerCase(),
    id: el.getAttribute('id'),
    classes: Array.from(el.classList).sort(),
    ariaHidden: el.getAttribute('aria-hidden'),
    children: Array.from(el.children).map(shapeOf),
  };
}

describe('T-050：骨架「上次已登入」頭像與 TopBar authPending 的實際 DOM', () => {
  afterEach(() => cleanup());

  it('骨架頭像只有一個轉圈圈、沒有人形 svg，且帶 line-avatar-fallback／line-avatar-loading', () => {
    const dom = shellSignedInDom();
    const avatar = dom.querySelector('#line-avatar-topbar');
    expect(avatar).not.toBeNull();
    expect(dom.querySelectorAll('svg').length).toBe(0);
    expect(dom.querySelectorAll('.line-avatar-spinner').length).toBe(1);
    expect(avatar!.children.length).toBe(1);
    expect(avatar!.classList.contains('line-avatar-fallback')).toBe(true);
    expect(avatar!.classList.contains('line-avatar-loading')).toBe(true);
  });

  it('結構（tag、id、class 集合、aria-hidden、子節點）與 TopBar authPending 渲染結果相同', () => {
    const { container } = render(
      h(TopBar, { drawerOpen: false, onMenuClick: () => undefined, onLogin: () => undefined, authPending: true }),
    );
    const live = container.querySelector('#line-user-topbar');
    expect(live).not.toBeNull();
    expect(shapeOf(shellSignedInDom().querySelector('#line-user-topbar')!)).toEqual(shapeOf(live!));
  });
});
