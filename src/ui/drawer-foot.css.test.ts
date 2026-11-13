// 抽屜底部（方案一）版面契約：jsdom 不排版，改讀 CSS 原檔鎖住「點擊區 44px」與「不換行」這兩條防線。
// 實際排版（七語系 × 360／390／1280 × 最大字級不斷行、不超出抽屜、點擊高度）由副機截圖量測驗證（docs/previews/2026-11-13-drawer/final）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/ui/drawer-foot.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** 取出選擇器清單恰好等於 selector（逗號分隔、忽略空白）的規則宣告。 */
function decls(selector: string): Record<string, string> {
  const want = selector.split(',').map((s) => s.trim()).join(',');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const sel = m[1]!.split(',').map((s) => s.trim()).join(',');
    if (sel !== want) continue;
    const out: Record<string, string> = {};
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    return out;
  }
  throw new Error(`drawer-foot.css 找不到規則：${selector}`);
}

const P = '.legacy-ui #side-drawer';

describe('抽屜底部方案一：點擊區 44px', () => {
  it('主題三段鈕 44px 高（比 40px 玻璃片上下各超出 2px）', () => {
    expect(decls(`${P} .drawer-foot-slab`).height).toBe('40px');
    const btn = decls(`${P} .drawer-theme-btn`);
    expect(btn.height).toBe('44px');
    expect(btn.margin).toBe('-2px 0');
  });

  it('語言鈕 44px 高，原生下拉蓋滿整顆', () => {
    expect(decls(`${P} .drawer-lang`).height).toBe('44px');
    const sel = decls(`${P} #lang-select`);
    expect(sel.inset).toBe('0');
    expect(sel.height).toBe('100%');
    expect(sel.opacity).toBe('0');
  });

  it('聲明連結與重設鈕本身 44px 高', () => {
    expect(decls(`${P} .drawer-foot-link, ${P} .drawer-reset-btn`).height).toBe('44px');
    expect(decls(`${P} .drawer-foot-fine`)['min-height']).toBe('44px');
  });
});

describe('抽屜底部方案一：不換行（泰、越文不撐出抽屜）', () => {
  it('語言鈕、小字列、聲明連結、重設鈕、確認框標題都不換行', () => {
    expect(decls(`${P} .drawer-lang`)['white-space']).toBe('nowrap');
    expect(decls(`${P} .drawer-foot-fine`)['white-space']).toBe('nowrap');
    expect(decls(`${P} .drawer-foot-link, ${P} .drawer-reset-btn`)['white-space']).toBe('nowrap');
    expect(decls('.legacy-ui .drawer-reset-confirm-title')['white-space']).toBe('nowrap');
  });

  it('頂部角色標籤不換行，資訊欄最小寬改由角色標籤決定、名字不撐寬', () => {
    expect(decls(`${P} .drawer-role-tag`)['white-space']).toBe('nowrap');
    expect(decls(`${P} .drawer-user-info`)['min-width']).toBe('auto');
    const name = decls(`${P} .drawer-name`);
    expect(name.width).toBe('0');
    expect(name['min-width']).toBe('100%');
  });

  it('確認框說明用 pre-line（中、日文逗號後語意換行），確定鈕紅色', () => {
    expect(decls('.legacy-ui .drawer-reset-confirm-msg')['white-space']).toBe('pre-line');
    expect(decls('.legacy-ui #app-confirm-modal .drawer-reset-confirm .drawer-reset-confirm-ok').background).toBe('#dc2626');
  });
});
