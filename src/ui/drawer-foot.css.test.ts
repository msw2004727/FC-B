// 抽屜底部（方案 C）版面契約：jsdom 不排版，改讀 CSS 原檔鎖住「點擊區 44px」與「不換行」這兩條防線。
// 「⋯」小卡字級鎖在 .84rem（站長核可預覽）；小卡左右貼齊抽屜內距，超長文案省略號收尾。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/ui/drawer-foot.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const glass = readFileSync(join(process.cwd(), 'src/ui/drawer-glass.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** 取出選擇器清單恰好等於 selector（逗號分隔、忽略空白）的規則宣告。 */
function declsIn(source: string, selector: string, file: string): Record<string, string> {
  const want = selector.split(',').map((s) => s.trim()).join(',');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const sel = m[1]!.split(',').map((s) => s.trim()).join(',');
    if (sel !== want) continue;
    const out: Record<string, string> = {};
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    return out;
  }
  throw new Error(`${file} 找不到規則：${selector}`);
}

function decls(selector: string): Record<string, string> {
  return declsIn(css, selector, 'drawer-foot.css');
}

const P = '.legacy-ui #side-drawer';

describe('抽屜底部方案 C：點擊區 44px', () => {
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

  it('「⋯」鈕 44×44，小卡每一列 44px 高且字級 .84rem', () => {
    const more = decls(`${P} .dg-more-btn`);
    expect(more.width).toBe('44px');
    expect(more.height).toBe('44px');
    expect(more.margin).toBe('-2px 0');
    const row = decls(`${P} .dg-more-pop a, ${P} .dg-more-pop button`);
    expect(row.height).toBe('44px');
    expect(row['font-size']).toBe('.84rem');
    expect(row.overflow).toBe('hidden');
    expect(row['text-overflow']).toBe('ellipsis');
    const pop = decls(`${P} .dg-more-pop`);
    expect(pop.left).toBe('10px');
    expect(pop.right).toBe('10px');
    expect(pop['overflow-y']).toBe('auto');
    const popRule = css.slice(css.indexOf(`${P} .dg-more-pop {`), css.indexOf(`${P} .dg-more-pop {`) + 800);
    const vh = popRule.indexOf('max-height: calc(100vh - 80px)');
    const dvh = popRule.indexOf('max-height: calc(100dvh - 80px)');
    expect(vh).toBeGreaterThan(-1);
    expect(dvh).toBeGreaterThan(vh);
    const label = decls(`${P} .dg-label`);
    expect(label['min-width']).toBe('0');
    expect(label.flex).toBe('1 1 auto');
    expect(label.overflow).toBe('hidden');
    expect(label['text-overflow']).toBe('ellipsis');
    expect(label['white-space']).toBe('nowrap');
  });

  it('選單列至少 44px 高，圖示不縮', () => {
    const row = declsIn(glass, `${P} .drawer-item`, 'drawer-glass.css');
    expect(row['min-height']).toBe('44px');
    expect(declsIn(glass, `${P} .dg-ico`, 'drawer-glass.css').flex).toBe('0 0 auto');
  });
});

describe('抽屜底部方案 C：不換行（泰、越文不撐出抽屜）', () => {
  it('語言鈕、小卡列、確認框標題都不換行', () => {
    expect(decls(`${P} .drawer-lang`)['white-space']).toBe('nowrap');
    expect(decls(`${P} .drawer-lang`).padding).toBe('0 .5rem 0 .6rem');
    expect(decls(`${P} .dg-more-pop a, ${P} .dg-more-pop button`)['white-space']).toBe('nowrap');
    expect(decls('.legacy-ui .drawer-reset-confirm-title')['white-space']).toBe('nowrap');
    expect(declsIn(glass, `${P} .drawer-item`, 'drawer-glass.css')['white-space']).toBe('nowrap');
  });

  // 測試同步更新（DRAWER-POLISH）：間距與內距再收，最大字級 360 寬時資訊欄留得下「字＋省略號」
  it('頂部角色標籤不換行、放不下才省略號（不撐出抽屜），間距與內距收窄讓省略號看得到', () => {
    const tag = decls(`${P} .drawer-role-tag`);
    expect(tag['white-space']).toBe('nowrap');
    expect(tag['max-width']).toBe('100%');
    expect(tag['text-overflow']).toBe('ellipsis');
    expect(tag.overflow).toBe('hidden');
    expect(tag.padding).toBe('.15rem .4rem');
    expect(decls(`${P} .drawer-user`).gap).toBe('.5rem');
    expect(decls(`${P} .drawer-actions`).gap).toBe('.3rem');
    expect(decls(`${P} .drawer-pwa-btn`).padding).toBe('0 .45rem');
  });

  it('小卡文字用 --text-primary，重設列用 --danger', () => {
    expect(decls(`${P} .dg-more-pop a, ${P} .dg-more-pop button`).color).toBe('var(--text-primary)');
    expect(decls(`${P} .dg-more-pop .dg-danger`).color).toBe('var(--danger)');
  });

  it('確認框說明用 pre-line（中、日文逗號後語意換行），確定鈕紅色', () => {
    expect(decls('.legacy-ui .drawer-reset-confirm-msg')['white-space']).toBe('pre-line');
    expect(decls('.legacy-ui #app-confirm-modal .drawer-reset-confirm .drawer-reset-confirm-ok').background).toBe('#dc2626');
  });

  it('drawer-foot.css、drawer-glass.css 不含 backdrop-filter、color-mix', () => {
    expect(css).not.toMatch(/backdrop-filter|color-mix/);
    expect(glass).not.toMatch(/backdrop-filter|color-mix/);
  });
});
