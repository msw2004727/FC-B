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
  // 新外觀卡 1b-3：詳情頁的賽事名稱改由頂部板內的 h1（.d2-board__name）擔任，頁首不再畫賽事名稱，
  // 原本鎖 .cps-top h1 與 .cps-top h1.cps-top__user 的兩行拿掉（施工-第1b批 1.4），改鎖板內名稱最多兩行。
  it('名稱標題最多兩行、超過才省略；共用 .cps-title 仍不換行', () => {
    const css = readFileSync(resolve(__dirname, 'competitions.css'), 'utf8');
    expect(css).toMatch(/\.cps-title \{[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.cps-title\.cps-title--user \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*-webkit-line-clamp: 2;[^}]*overflow: hidden;/);
    expect(css).toMatch(/\.d2-board__name \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*-webkit-line-clamp: 2;[^}]*overflow: hidden;/);
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

describe('賽事新外觀色票（第 0 批卡 0-2）', () => {
  const css = readFileSync(resolve(__dirname, 'competitions.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: (m[1] ?? '').trim().replace(/\s+/g, ' '), body: m[2] ?? '' }));
  const varsOf = (body: string) => [...body.matchAll(/(--d2-[\w-]+)\s*:/g)].map((m) => m[1] ?? '');

  it('--d2-* 只宣告在淺色、深色兩條規則裡，每個變數每個主題一次', () => {
    const declaring = rules.filter((r) => varsOf(r.body).length > 0);
    expect(declaring.map((r) => r.sel)).toEqual([
      // 第 2 批卡 2-1 把記分頁根節點 .s4-root 加進兩條（施工-第2批 3.0）；清-2 把賽事清單根節點 .tournaments-root[data-d2] 加進兩條
      '.cps-root, .s4-page, .s4-root, .d2-panel, .tournaments-root[data-d2], .cp-danger-confirm #app-confirm-modal',
      '[data-theme="dark"] .cps-root, [data-theme="dark"] .s4-page, [data-theme="dark"] .s4-root, [data-theme="dark"] .d2-panel, [data-theme="dark"] .tournaments-root[data-d2], [data-theme="dark"].cp-danger-confirm #app-confirm-modal',
    ]);
    const [light = [], dark = []] = declaring.map((r) => varsOf(r.body));
    expect(new Set(light).size).toBe(light.length);
    expect(new Set(dark).size).toBe(dark.length);
    expect(dark.filter((v) => !light.includes(v))).toEqual([]);
  });

  it('賽事樣式不用 !important', () => {
    expect(css).not.toContain('!important');
  });
});

describe('記分板共用元件與窄體數字字型（第 0 批卡 0-6）', () => {
  const css = readFileSync(resolve(__dirname, 'competitions.css'), 'utf8');

  it('字型用新家族名稱、不沿用球員卡的 Bebas Neue，涵蓋數字、冒號、斜線；--d2-num 第一順位是它', () => {
    const face = css.match(/@font-face \{[^}]*\}/)?.[0] ?? '';
    expect(face).toContain("font-family: 'CP Score';");
    expect(face).not.toContain('Bebas Neue');
    expect(face).toContain('U+002D-003A');
    expect(face).toContain('font-display: swap;');
    expect(css).toMatch(/--d2-num: 'CP Score',/);
  });

  it('記分板 class 存在且只用色票變數', () => {
    for (const sel of ['.d2-num {', '.d2-sb {', '.d2-sb--lit {', '.d2-sb__st {', '.d2-cells {', '.d2-cell {', '.d2-cell__k {', '.d2-cell__v {', '.d2-sb--lit .d2-cell--now .d2-num {', '.d2-cells--row {']) {
      expect(css).toContain(sel);
    }
  });
});

describe('積分榜欄寬（實量覆核 7.3；新外觀卡 3-4 改成 <table>，整段取代原本 .cp3-st__r 格線那一條）', () => {
  it('固定欄寬照 3.2，360 寬隊名文字至少放得下 4 個中文字加省略號，且仍單行省略', () => {
    const css = readFileSync(resolve(__dirname, 'competitions.css'), 'utf8');
    const num = (re: RegExp) => Number(css.match(re)?.[1] ?? NaN);
    const fixed = num(/\.cp-tbl--st th:nth-child\(1\) \{ width: (\d+)px; \}/)
      + num(/\.cp-tbl--st th:nth-child\(6\) \{ width: (\d+)px; \}/) * 4
      + num(/\.cp-tbl--st th:nth-child\(7\) \{ width: (\d+)px; \}/)
      + num(/\.cp-tbl--st th:nth-child\(8\) \{ width: (\d+)px; \}/)
      + num(/\.cp-tbl--st th:nth-child\(9\) \{ width: (\d+)px; \}/);
    expect(fixed).toBe(24 + 18 * 4 + 36 + 28 + 44);
    // 360 寬：.app-main 8×2、.cps-root 8×2、表格卡左 10 右 1 → 表格 317；隊名格內距 2＋4、隊徽 24、隊徽與字距 6
    const text = 360 - 16 - 16 - 11 - fixed - 6 - 24 - 6;
    // 13px：4 個字 52 加省略號約 13
    expect(text).toBeGreaterThanOrEqual(13 * 4 + 13);
    expect(css).toMatch(/\.cp-tbl \{[^}]*table-layout: fixed;/);
    expect(css).toMatch(/\.cp-tbl th, \.cp-tbl td \{[^}]*white-space: nowrap;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
    expect(css).toMatch(/\.cp3-tn em \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
    // 名次格不裁：「同分／裁定」往外擴的點擊區不被 overflow 裁掉
    expect(css).toMatch(/\.cp-tbl td\.rk \{[^}]*overflow: visible;/);
  });
});
