import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAYER_CARD_PALETTES, type PlayerCardPalette, type PlayerCardTheme } from '../data/player-card-model';

// T-092（站長 11-06 顏色照預覽）：網頁卡面（player-card.css）與分享 PNG（Canvas，取自 PLAYER_CARD_PALETTES）必須同一組色碼。
// jsdom 不套 CSS，這裡把 CSS 規則解析出來，逐項與色票比對；PNG 端的色碼檢查在 player-card-canvas.test.ts。

interface Rule {
  selector: string;
  body: string;
}

const css = readFileSync(resolve(process.cwd(), 'src/features/profile/components/player-card.css'), 'utf8');

function parseRules(source: string): Rule[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
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

const rules = parseRules(css);

/** 同一選擇器多條規則時取最後一個宣告該屬性者。 */
function declaration(selector: string, prop: string): string {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`);
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]!;
    if (rule.selector !== selector) continue;
    const found = re.exec(rule.body);
    if (found) return found[1]!.trim();
  }
  throw new Error(`rule "${selector}" has no ${prop}`);
}

/** 取宣告值裡的色碼（#hex 或 rgba），統一成可比對的字串。 */
function colorIn(value: string): string {
  const found = /(#[0-9A-Fa-f]{3,8}|rgba?\([^)]*\))/.exec(value);
  if (!found) throw new Error(`no color in "${value}"`);
  return canon(found[1]!);
}

function canon(color: string): string {
  if (color.startsWith('#')) return color.toUpperCase();
  const nums = /rgba?\(([^)]*)\)/.exec(color)![1]!.split(',').map((n) => Number(n.trim()));
  return `rgba(${nums.join(',')})`;
}

const themes: PlayerCardTheme[] = ['light', 'dark'];
const scoped = (theme: PlayerCardTheme, selector: string): string => (theme === 'dark' ? `[data-theme="dark"] ${selector}` : selector);

/** [選擇器, 屬性, 色票欄位]；dark 一律是 `[data-theme="dark"] ` + 同一選擇器。 */
const cases: Array<[string, string, keyof PlayerCardPalette]> = [
  ['.player-card', 'background-color', 'base'],
  ['.player-card', 'background-image', 'stripe'],
  ['.player-card', 'color', 'text'],
  ['.player-card-frame', 'border', 'innerFrame'],
  ['.player-card-ring', 'background', 'gold'],
  ['.player-card-ring-inner', 'background', 'avatarInnerRing'],
  ['.legacy-ui .player-card .profile-avatar', 'background', 'avatarFill'],
  ['.legacy-ui .player-card .profile-avatar', 'color', 'avatarInitial'],
  ['.player-card-club', 'background', 'clubBg'],
  ['.player-card-club', 'color', 'clubText'],
  ['.player-card-gauge', 'background', 'gaugeTrack'],
  ['.player-card-gauge-fill', 'background', 'gaugeFill'],
  ['.player-card-att-num', 'color', 'headline'],
  ['.player-card-title-zh', 'color', 'headline'],
  ['.player-card-att .player-card-abbr', 'color', 'headlineAbbr'],
  ['.player-card-title .player-card-abbr', 'color', 'headlineAbbr'],
  ['.player-card-abbr', 'color', 'statAbbr'],
  ['.legacy-ui .player-card .profile-stats .stat-label', 'color', 'statLabel'],
  ['.legacy-ui .player-card .profile-stats .stat-num', 'color', 'text'],
  ['.legacy-ui .player-card .profile-stats .stat-item + .stat-item', 'border-left', 'divider'],
];

describe('T-092 球員卡 DOM 色碼與 PNG 色票一致', () => {
  for (const theme of themes) {
    const palette = PLAYER_CARD_PALETTES[theme];
    for (const [selector, prop, key] of cases) {
      // 框線與分隔線：淺色寫簡寫（border／border-left），深色只覆寫 -color。
      const p = theme === 'dark' && (prop === 'border' || prop === 'border-left') ? `${prop}-color` : prop;
      it(`${theme}：${selector} ${p} ＝ palette.${key}`, () => {
        expect(colorIn(declaration(scoped(theme, selector), p))).toBe(canon(palette[key]));
      });
    }

    it(`${theme}：外框、俱樂部方塊描邊、三格第三格數字`, () => {
      expect(colorIn(declaration(scoped(theme, '.player-card'), theme === 'dark' ? 'border-color' : 'border'))).toBe(canon(palette.outerBorder));
      // 方塊外描一圈卡面底色
      const clubBorder = theme === 'dark'
        ? declaration('[data-theme="dark"] .player-card-club', 'border-color')
        : declaration('.player-card-club', 'border');
      expect(colorIn(clubBorder)).toBe(canon(palette.base));
      if (theme === 'dark') {
        expect(colorIn(declaration('[data-theme="dark"] .legacy-ui .player-card .profile-stats .stat-item:last-child .stat-num', 'color')))
          .toBe(canon(palette.statNumAtt));
      } else {
        // 淺色第三格與其他格同色（沒有另寫規則）
        expect(palette.statNumAtt).toBe(palette.text);
      }
    });
  }
});
