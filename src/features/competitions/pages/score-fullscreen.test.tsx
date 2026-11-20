import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { SCORE_FULLSCREEN_CLASS, useScoreFullscreen } from './ScoringPage';

// 11-20 顧問 staging 實測 P1：真實 App 外框下底部導覽列蓋住記分頁「開賽」與「選單」。
function Probe(): null {
  useScoreFullscreen();
  return null;
}

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove(SCORE_FULLSCREEN_CLASS);
});

describe('記分頁全幅', () => {
  it('記分頁掛載時 <html> 加 cp-score-full，卸載（離開記分、返回）時移除', () => {
    const { unmount } = render(<Probe />);
    expect(document.documentElement.classList.contains(SCORE_FULLSCREEN_CLASS)).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains(SCORE_FULLSCREEN_CLASS)).toBe(false);
  });

  it('全幅時不渲染底部導覽、頂欄、搶先試用角標與診斷浮層，主區不留上下空白', () => {
    const css = readFileSync(resolve(__dirname, '../live/score-fullscreen.css'), 'utf8');
    const hide = css.slice(0, css.indexOf('display: none !important;'));
    for (const sel of ['#top-bar', '#bottom-tabs', '.internal-test-badge', '.fcb-diag-loads', '.sync-bar']) {
      expect(hide).toContain(`html.${SCORE_FULLSCREEN_CLASS} ${sel}`);
    }
    expect(css).toMatch(/html\.cp-score-full \.ui-app-shell \.app-main \{\s*padding-top: var\(--qa-banner-h, 0px\);\s*padding-bottom: 0;/);
  });

  it('套用後 jsdom 計算樣式：底部導覽 display:none', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(__dirname, '../live/score-fullscreen.css'), 'utf8');
    document.head.appendChild(style);
    const nav = document.createElement('nav');
    nav.id = 'bottom-tabs';
    document.body.appendChild(nav);
    try {
      expect(getComputedStyle(nav).display).not.toBe('none');
      const { unmount } = render(<Probe />);
      expect(getComputedStyle(nav).display).toBe('none');
      unmount();
      expect(getComputedStyle(nav).display).not.toBe('none');
    } finally {
      nav.remove();
      style.remove();
    }
  });

  it('記分選單貼齊按鈕左緣往右展開（開賽前選單鈕在最左邊，往左展開會出界）', () => {
    const css = readFileSync(resolve(__dirname, '../live/live.css'), 'utf8');
    const start = css.indexOf('.s4-menu {');
    const block = css.slice(start, css.indexOf('}', start)).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toMatch(/left: 0;/);
    expect(block).not.toMatch(/right: 0;/);
  });
});
