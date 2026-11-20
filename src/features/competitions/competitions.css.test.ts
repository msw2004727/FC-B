import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('公告文字換行', () => {
  it('公告內文可換行，長網址不撐出窄畫面', () => {
    const css = readFileSync(resolve(__dirname, 'competitions.css'), 'utf8');
    const start = css.indexOf('.cpm-ann__txt {');
    const end = css.indexOf('.cpm-ann__time {');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const block = css.slice(start, end);
    expect(block).toContain('white-space: pre-wrap;');
    expect(block).toContain('overflow-wrap: anywhere;');
  });
});

describe('公告輸入區底列與我的場次對戰列不擠壓（11-20 外框驗收 P2-1、P2-2）', () => {
  it('取消鈕不吃最小寬、已發 n 則可縮並省略', () => {
    const css = readFileSync(resolve(__dirname, 'competitions.css'), 'utf8');
    expect(css).toContain('.cpm-ann__btns .ui-button--ghost { min-inline-size: 0;');
    expect(css).toMatch(/\.cpm-ann__foot \.cpm-meta \{[^}]*min-width: 0;[^}]*text-overflow: ellipsis;/);
  });

  it('我的場次對戰文字可縮並省略', () => {
    const css = readFileSync(resolve(__dirname, 'step4b/step4b.css'), 'utf8');
    expect(css).toMatch(/\.s4b-between > \.s4b-k \{[^}]*flex: 1 1 auto;[^}]*min-width: 0;[^}]*text-overflow: ellipsis;/);
  });
});

describe('使用者取的賽事名稱標題（顧問 §3.460）', () => {
  it('名稱標題最多兩行、超過才省略；共用 .cps-title 與頂列 h1 仍不換行', () => {
    const css = readFileSync(resolve(__dirname, 'competitions.css'), 'utf8');
    expect(css).toMatch(/\.cps-title \{[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.cps-title\.cps-title--user \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*-webkit-line-clamp: 2;[^}]*overflow: hidden;/);
    expect(css).toMatch(/\.cps-top h1 \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
    expect(css).toMatch(/\.cps-top h1\.cps-top__user \{[^}]*white-space: normal;[^}]*-webkit-line-clamp: 2;/);
  });
});

describe('詳情頁隊伍清單標籤（顧問 §3.463）', () => {
  it('「已核准」標籤不縮、不換行，隊名區可縮', () => {
    const css = readFileSync(resolve(__dirname, 'competitions.css'), 'utf8');
    expect(css).toMatch(/\.cps-li > \.cps-li__tag \{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.cps-li__main \{[^}]*min-width: 0;/);
  });
});

describe('名單頁長暱稱（顧問 §3.471 X-02）', () => {
  it('暱稱可縮並省略，位置與標籤仍不縮', () => {
    const css = readFileSync(resolve(__dirname, 'competitions.css'), 'utf8');
    expect(css).toMatch(/\.cps-player__name\.cps-player__name--fit \{[^}]*flex: 0 1 auto;[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
    expect(css).toMatch(/\.cps-player__name, \.cps-player__pos \{[^}]*flex: 0 0 auto;/);
    expect(css).toMatch(/\.cps-player \.ui-badge \{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/);
  });
});

describe('積分榜欄寬（實量覆核 7.3：360 寬隊名只剩一個字）', () => {
  it('固定欄縮窄後，360 寬隊名文字至少放得下 4 個中文字加省略號，且仍單行省略', () => {
    const css = readFileSync(resolve(__dirname, 'competitions.css'), 'utf8');
    const row = css.match(/\.cp3-st__r \{([^}]*)\}/)?.[1] ?? '';
    const cols = row.match(/grid-template-columns: ([^;]+);/)?.[1] ?? '';
    expect(cols).toBe('24px minmax(0, 1fr) 18px 18px 18px 18px 36px 28px 28px');
    const gap = Number(row.match(/column-gap: (\d+)(?:px)?;/)?.[1] ?? NaN);
    const fixed = cols.split(' ').filter((c) => c.endsWith('px')).reduce((sum, c) => sum + Number.parseFloat(c), 0);
    const pad = Number(css.match(/\.cp3-st__r \.t \{[^}]*padding-left: (\d+)px;/)?.[1] ?? NaN);
    // 360 寬正式站：頁面內距 16×2、外框 .app-main 8×2、卡片內距 10×2、卡片邊框 1×2 → 列寬 290；隊徽 20、隊徽與字距 6
    const text = 290 - fixed - gap * 8 - pad - 20 - 6;
    // 正文小字 13px：4 個字 52 加省略號約 13
    expect(text).toBeGreaterThanOrEqual(13 * 4 + 13);
    expect(css).toMatch(/\.cp3-st__r > \* \{[^}]*min-width: 0;[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.cp3-st__r \.t \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
  });
});
