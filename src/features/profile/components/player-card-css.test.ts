import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// T-092 實機回報：卡片沿用 A 的 class，A 的 profile.css 打包時被限定成 `.legacy-ui .x`（權重 0,2,0）且較晚載入，
// 同權重的覆蓋會被蓋掉（三格白底框、綠色數字、頭像縮小留白）。jsdom 不套 CSS，這裡以權重靜態檢查守住。

interface Rule {
  selector: string;
  body: string;
}

function parseRules(css: string): Rule[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments))) {
    for (const sel of m[1]!.split(',')) {
      const selector = sel.trim();
      if (selector) rules.push({ selector, body: m[2]! });
    }
  }
  return rules;
}

/** 簡易權重（不含 :not 等），回傳 [id, class/attr/pseudo-class, element]。 */
function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const elements = (selector.replace(/\[[^\]]+\]/g, '').match(/(^|[\s>+~])([a-z][\w-]*)/gi) ?? []).length;
  return [ids, classes, elements];
}

function greater(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

/** legacy-css-scope：一般選擇器前面加 `.legacy-ui `。 */
function scoped(selector: string): string {
  return `.legacy-ui ${selector}`;
}

const root = process.cwd();
const card = parseRules(readFileSync(resolve(root, 'src/features/profile/components/player-card.css'), 'utf8'));
const legacy = [
  'src/features/profile/legacy/profile.css',
  'src/styles/legacy/layout.css',
].flatMap((file) => parseRules(readFileSync(resolve(root, file), 'utf8')));

function legacyBase(cls: string): Rule {
  const rule = legacy.find((r) => r.selector === `.${cls}`);
  if (!rule) throw new Error(`legacy rule .${cls} not found`);
  return rule;
}

function cardOverride(cls: string, extra?: (r: Rule) => boolean): Rule {
  const rule = card.find((r) => {
    const last = r.selector.split(/\s+/).pop() ?? '';
    return r.selector.includes('.player-card ') && new RegExp(`\\.${cls}(?![\\w-])`).test(last)
      && !r.selector.startsWith('[data-theme') && !last.includes(':') && !r.selector.includes('+')
      && (!extra || extra(r));
  });
  if (!rule) throw new Error(`player-card override for .${cls} not found`);
  return rule;
}

describe('T-092 球員卡 CSS 不被舊個人頁樣式蓋掉', () => {
  const targets = ['profile-avatar', 'profile-title', 'profile-stats', 'stat-item', 'stat-num', 'stat-label'];

  for (const cls of targets) {
    it(`.${cls}：卡片覆蓋權重高於舊站 .legacy-ui .${cls}`, () => {
      const base = specificity(scoped(legacyBase(cls).selector));
      const mine = cardOverride(cls === 'profile-title' ? 'player-card-name' : cls);
      expect(greater(specificity(mine.selector), base), `${mine.selector} vs ${scoped(`.${cls}`)}`).toBe(true);
    });
  }

  it('頭像填滿內圈（100%、cover、無內距），也高於 .profile-avatar-img', () => {
    const avatar = cardOverride('profile-avatar');
    expect(avatar.body).toMatch(/width:\s*100%/);
    expect(avatar.body).toMatch(/height:\s*100%/);
    expect(avatar.body).toMatch(/padding:\s*0/);
    expect(avatar.body).toMatch(/border-radius:\s*50%/);
    expect(greater(specificity(avatar.selector), specificity(scoped(legacyBase('profile-avatar-img').selector)))).toBe(true);
    const img = card.find((r) => /\.player-card \.profile-avatar img$/.test(r.selector))!;
    expect(img.body).toMatch(/object-fit:\s*cover/);
    expect(img.body).toMatch(/width:\s*100%/);
    expect(img.body).toMatch(/height:\s*100%/);
  });

  it('三格直接印在卡面：無底色、無框、無圓角、無陰影；數字 Bebas Neue、卡面色', () => {
    const item = cardOverride('stat-item');
    expect(item.body).toMatch(/background:\s*none/);
    expect(item.body).toMatch(/border:\s*none/);
    expect(item.body).toMatch(/border-radius:\s*0/);
    expect(item.body).toMatch(/box-shadow:\s*none/);
    const num = cardOverride('stat-num');
    expect(num.body).toMatch(/font-family:\s*'Bebas Neue'/);
    expect(num.body).toMatch(/color:\s*#412402/);
    const darkNum = card.find((r) => r.selector.startsWith('[data-theme="dark"]') && /\.stat-num$/.test(r.selector))!;
    expect(darkNum.body).toMatch(/color:\s*#FAEEDA/);
    // 分隔線
    expect(card.some((r) => /\.stat-item \+ \.stat-item$/.test(r.selector) && /border-left:/.test(r.body))).toBe(true);
  });

  it('網頁卡面無動畫：沒有 @keyframes、animation、::after 光帶；顯示倍率與共用常數一致', async () => {
    const raw = readFileSync(resolve(root, 'src/features/profile/components/player-card.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(raw).not.toMatch(/@keyframes/);
    expect(raw).not.toMatch(/animation\s*:/);
    expect(raw).not.toMatch(/\.player-card::after/);
    const { PLAYER_CARD_DOM_SCALE, PLAYER_CARD_SIZE } = await import('../data/player-card-model');
    const base = card.find((r) => r.selector === '.player-card')!;
    expect(base.body).toMatch(new RegExp(`width:\\s*${Math.round(PLAYER_CARD_SIZE.width * PLAYER_CARD_DOM_SCALE)}px`));
    expect(base.body).toMatch(new RegExp(`height:\\s*${Math.round(PLAYER_CARD_SIZE.height * PLAYER_CARD_DOM_SCALE)}px`));
    const shine = card.find((r) => r.selector === '.player-card-shine')!;
    expect(shine.body).toMatch(/position:\s*absolute/);
    expect(shine.body).toMatch(/pointer-events:\s*none/);
  });

  it('撥動翻面：舞台只讓垂直捲動、兩面隱藏背面（含 -webkit-）、背面與正面同底同框；鎖頭權重高於 .legacy-ui button', () => {
    const stage = card.find((r) => r.selector === '.player-card-stage')!;
    expect(stage.body).toMatch(/touch-action:\s*pan-y;\s*touch-action:\s*pan-y pinch-zoom;/);
    expect(stage.body).toMatch(/-webkit-perspective:/);
    const flip = card.find((r) => r.selector === '.player-card-flip')!;
    expect(flip.body).toMatch(/-webkit-transform-style:\s*preserve-3d/);
    expect(flip.body).toMatch(/[^-]transform-style:\s*preserve-3d/);
    for (const face of ['.player-card-flip > .player-card', '.player-card-flip > .player-card-back']) {
      const rules = card.filter((r) => r.selector === face).map((r) => r.body).join('\n');
      expect(rules, face).toMatch(/-webkit-backface-visibility:\s*hidden/);
      expect(rules, face).toMatch(/[^-]backface-visibility:\s*hidden/);
    }
    const base = card.filter((r) => r.selector === '.player-card').map((r) => r.body)[0];
    expect(card.filter((r) => r.selector === '.player-card-back').map((r) => r.body)[0]).toBe(base);
    expect(card.some((r) => r.selector === '[data-theme="dark"] .player-card-back')).toBe(true);
    const lock = card.find((r) => /\.player-card-lock$/.test(r.selector))!;
    expect(greater(specificity(lock.selector), specificity(scoped('button')))).toBe(true);
    // 觸控擴大範圍的 ::before 必須有 content，否則偽元素不會產生
    const hit = card.find((r) => /\.player-card-lock::before$/.test(r.selector))!;
    expect(hit.body).toMatch(/content:\s*'';/);
    expect(hit.body).toMatch(/inset:\s*-7px/);
  });
});

