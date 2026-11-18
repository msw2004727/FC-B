import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 純 JS 建置工具，與 vite.config.ts 使用同一個 scope 外掛。
import { legacyCssScope } from '../../../../scripts/legacy-css-scope.mjs';

// 2026-11-16 PROFILE-GLASS：「我的」頁面與四個彈窗的液態玻璃樣式靜態守住。
// jsdom 不套 CSS；這裡以打包後（legacy-css-scope 改寫後）的選擇器與原文驗證：
// - CSS 只作用在個人頁或四個彈窗；
// - 不用 backdrop-filter、不用 color-mix（註解不計）；
// - 用到的變數都有既有 token 定義（不自創變數）；
// - 權重足以蓋過 A 的 hover／深色；
// - 活動卡光澤與活動頁 timeline-card-extra.css 一字不差；
// - 載入點正確；UidQrModal 的卡面／關閉鈕改由 profile-modal-glass.css 提供。

const PROFILE_DIR = 'src/features/profile/legacy';
const MODAL_DIR = 'src/features/profile/components/legacy';
const ACTIVITY_DIR = 'src/features/events/components/legacy';

interface Flat { selector: string; decls: Record<string, string>; atrule: string | null; order: number }

function scopedAt(dir: string, file: string): Flat[] {
  const path = resolve(process.cwd(), dir, file);
  const root = postcss([legacyCssScope()]).process(readFileSync(path, 'utf8'), { from: path }).sync().root;
  const out: Flat[] = [];
  let order = 0;
  root.walkRules((rule: Rule) => {
    const decls: Record<string, string> = {};
    rule.walkDecls((d) => { decls[d.prop] = d.value; });
    const parent = rule.parent?.type === 'atrule'
      ? `@${(rule.parent as postcss.AtRule).name} ${(rule.parent as postcss.AtRule).params}`
      : null;
    for (const selector of rule.selectors) out.push({ selector, decls, atrule: parent, order: order++ });
  });
  return out;
}
const scoped = (file: string) => scopedAt(PROFILE_DIR, file);
const scopedModal = (file: string) => scopedAt(MODAL_DIR, file);

/** 簡易權重 [id, class/attr/pseudo-class, element]（本檔選擇器不含 :not 等函式）。 */
function specificity(selector: string): [number, number, number] {
  const s = selector.replace(/::[\w-]+/g, '');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) ?? []).length;
  const elements = (s.replace(/\[[^\]]+\]/g, '').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return [ids, classes, elements];
}
const gt = (a: [number, number, number], b: [number, number, number]) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

const readRaw = (dir: string, file: string) => readFileSync(resolve(process.cwd(), dir, file), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('profile-glass.css / profile-modal-glass.css：作用範圍', () => {
  it('個人頁 CSS 每條選擇器都帶 #page-profile', () => {
    const rules = scoped('profile-glass.css');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.filter((r) => !r.selector.includes('#page-profile')).map((r) => r.selector)).toEqual([]);
  });

  it('彈窗 CSS 每條都作用在其中一個彈窗', () => {
    const rules = scopedModal('profile-modal-glass.css');
    expect(rules.length).toBeGreaterThan(0);
    const targets = ['#companion-modal-overlay', '#social-link-modal', '#first-login-modal', '.profile-complete-modal', '#uid-qr-modal'];
    expect(rules.filter((r) => !targets.some((t) => r.selector.includes(t))).map((r) => r.selector)).toEqual([]);
  });
});

describe('profile-glass.css / profile-modal-glass.css：相容寫法與變數', () => {
  const raws = [
    readRaw(PROFILE_DIR, 'profile-glass.css'),
    readRaw(MODAL_DIR, 'profile-modal-glass.css'),
  ];

  it('不用 backdrop-filter、不用 color-mix（註解不計）', () => {
    for (const raw of raws) {
      const css = stripComments(raw);
      expect(css).not.toContain('backdrop-filter');
      expect(css).not.toContain('color-mix(');
    }
  });

  it('用到的 CSS 變數都有既有 token 定義（不得自創變數）', () => {
    const tokens = [
      readRaw('src/styles', 'tokens.css'),
      readRaw('src/styles', 'legacy-vars.css'),
    ].join('\n');
    const defined = new Set(Array.from(tokens.matchAll(/(--[\w-]+)\s*:/g), (m) => m[1]));
    for (const raw of raws) {
      const used = new Set(Array.from(stripComments(raw).matchAll(/var\(\s*(--[\w-]+)/g), (m) => m[1]));
      for (const v of used) expect(defined.has(v), v).toBe(true);
    }
  });
});

describe('PROFILE-GLASS：權重', () => {
  // 先確認比較的選擇器真的在打包後的 CSS 裡（審查 P3-1：只比字串常數，選擇器被改弱也抓不到）
  it('比較用的選擇器確實存在於打包後的 CSS', () => {
    const page = scoped('profile-glass.css').map((r) => r.selector);
    const modal = scopedModal('profile-modal-glass.css').map((r) => r.selector);
    expect(page).toContain('.legacy-ui #page-profile .page-header .back-btn');
    expect(modal).toContain('.legacy-ui #first-login-modal.modal.profile-complete-modal');
    expect(modal).toContain('.legacy-ui #companion-modal-overlay .modal');
  });

  it('個人頁返回鈕規則高於 A 的 .page-header .back-btn:hover', () => {
    expect(gt(
      specificity('.legacy-ui #page-profile .page-header .back-btn'),
      specificity('.legacy-ui .page-header .back-btn:hover'),
    )).toBe(true);
  });

  it('完善個人資料彈窗的複合選擇器高於 [data-theme="dark"] 個人頁規則', () => {
    expect(gt(
      specificity('.legacy-ui #first-login-modal.modal.profile-complete-modal'),
      specificity('[data-theme="dark"] .legacy-ui #first-login-modal'),
    )).toBe(true);
  });
});

describe('PROFILE-GLASS：頁籤（方案 A）', () => {
  const rules = scoped('profile-glass.css');
  const find = (selector: string): Flat => {
    const hit = rules.find((r) => r.selector === selector);
    if (!hit) throw new Error(`找不到 ${selector}`);
    return hit;
  };

  it('頁籤整片玻璃、選中填底都用 roster-slab token', () => {
    expect(find('.legacy-ui #page-profile .profile-quick-bar-in').decls.background)
      .toBe('var(--color-roster-slab-bg)');
    expect(find('.legacy-ui #page-profile .profile-quick-btn[aria-expanded="true"]::after').decls.background)
      .toBe('var(--color-roster-slab-knob-bg)');
  });

  it('頁籤文字（.profile-quick-lb）用 white-space: nowrap 不斷行', () => {
    expect(find('.legacy-ui #page-profile .profile-quick-lb').decls['white-space']).toBe('nowrap');
  });
});

describe('PROFILE-GLASS：活動卡光澤與活動頁一致', () => {
  const activity = scopedAt(ACTIVITY_DIR, 'timeline-card-extra.css');
  const profile = scoped('profile-glass.css');
  // 10 種類型 × 淺／深色 = 20 條
  const ACT_TARGET = /#page-activities \.tl-event-row(\.tl-type-[\w-]+)?$/;

  it('activity 的 20 條光澤規則，在 profile 都有同選擇器且 background/box-shadow 逐字相同', () => {
    const targets = activity.filter((r) => ACT_TARGET.test(r.selector));
    expect(targets.length).toBe(20);
    for (const r of targets) {
      const want = r.selector.replace('#page-activities', '#page-profile');
      const hit = profile.find((p) => p.selector === want);
      expect(hit, want).toBeDefined();
      expect(hit!.decls.background, want).toBe(r.decls.background);
      expect(hit!.decls['box-shadow'], want).toBe(r.decls['box-shadow']);
    }
  });
});

describe('PROFILE-GLASS：載入點', () => {
  it('ProfilePage.tsx 在 profile.css 之後才載入 profile-glass.css', () => {
    const src = readRaw('src/features/profile/pages', 'ProfilePage.tsx');
    const iBase = src.indexOf("import '../legacy/profile.css';");
    const iGlass = src.indexOf("import '../legacy/profile-glass.css';");
    expect(iBase).toBeGreaterThanOrEqual(0);
    expect(iGlass).toBeGreaterThanOrEqual(0);
    expect(iGlass).toBeGreaterThan(iBase);
  });

  it('四個彈窗都自己載入 profile-modal-glass.css', () => {
    for (const f of ['UidQrModal.tsx', 'CompanionModal.tsx', 'LegacySocialLinkModal.tsx', 'LegacyFirstLoginModal.tsx']) {
      expect(readRaw(MODAL_DIR, f), f).toContain("import './profile-modal-glass.css';");
    }
  });
});

describe('UidQrModal：卡面與關閉鈕改由 CSS 提供', () => {
  const src = readRaw(MODAL_DIR, 'UidQrModal.tsx');

  it('卡面加上 .uid-qr-card、關閉鈕加上 .uid-qr-close', () => {
    expect(src).toContain('class="uid-qr-card"');
    expect(src).toContain('class="uid-qr-close"');
  });

  it('同行者彈窗的定位與圓角不再寫在行內（亮線要貼卡片上緣）', () => {
    const companion = readRaw(MODAL_DIR, 'CompanionModal.tsx');
    expect(companion).toContain('max-width:340px;position:relative;transform:none');
    expect(companion).not.toContain('border-radius:var(--radius)');
    const rule = scopedModal('profile-modal-glass.css').filter((r) => r.selector === '.legacy-ui #companion-modal-overlay .modal');
    expect(rule.some((r) => r.decls['border-radius'] === '20px')).toBe(true);
    // 寬螢幕 A 會給 .modal left:50%；relative 後必須歸零，否則彈窗被推出畫面（終審 P1）
    expect(rule.some((r) => r.decls.left === 'auto' && r.decls.right === 'auto')).toBe(true);
  });

  it('已設定的社群鈕不被壓成灰色（只壓 :not(.active)）', () => {
    const rules = scoped('profile-glass.css');
    const colored = rules.filter((r) => /\.social-btn(?![\w-])/.test(r.selector) && 'color' in r.decls && !r.selector.includes(':hover'));
    expect(colored.length).toBeGreaterThan(0);
    expect(colored.every((r) => r.selector.includes(':not(.active)'))).toBe(true);
  });

  it('不再硬寫卡面底色與關閉鈕字級/顏色', () => {
    expect(src).not.toContain('background:var(--bg-card);border-radius:var(--radius-lg)');
    expect(src).not.toContain('font-size:1.2rem;cursor:pointer;color:var(--text-muted)');
  });
});
