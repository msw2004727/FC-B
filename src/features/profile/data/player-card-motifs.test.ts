import { describe, expect, it } from 'vitest';

import {
  MOTIF_PALETTES,
  PLAYER_CARD_MOTIFS,
  PLAYER_CARD_MOTIF_BOX,
  PLAYER_CARD_MOTIF_PETALS,
  playerCardMotifColors,
  playerCardMotifStrokes,
  resolvePlayerCardMotif,
} from './player-card-motifs';
import { buildPlayerCardModel } from './player-card-model';

/** WCAG 相對亮度對比。 */
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('球員卡身分圖案 resolvePlayerCardMotif（角色 × 性別）', () => {
  const roleKeys = [
    ['coach', 'board'],
    ['captain', 'flag'],
    ['venue_owner', 'goal'],
    ['admin', 'shield'],
    ['super_admin', 'laurel'],
  ] as const;

  for (const [role, key] of roleKeys) {
    it(`${role}：男／未填／其他＝金色 ${key}，女＝粉色 ${key}`, () => {
      expect(resolvePlayerCardMotif(role, '男')).toEqual({ key, palette: 'gold' });
      expect(resolvePlayerCardMotif(role, '')).toEqual({ key, palette: 'gold' });
      expect(resolvePlayerCardMotif(role, undefined)).toEqual({ key, palette: 'gold' });
      expect(resolvePlayerCardMotif(role, '其他')).toEqual({ key, palette: 'gold' });
      expect(resolvePlayerCardMotif(role, '女')).toEqual({ key, palette: 'pink' });
      expect(resolvePlayerCardMotif(role, ' 女 ')).toEqual({ key, palette: 'pink' });
    });
  }

  it('一般用戶、team_leader、自訂角色、未知值：女＝櫻花枝（金枝），男／未填／其他＝無圖案', () => {
    for (const role of ['user', 'team_leader', 'custom_role_x', '', null, undefined, 'constructor', 'toString']) {
      expect(resolvePlayerCardMotif(role, '女')).toEqual({ key: 'sakura', palette: 'gold' });
      expect(resolvePlayerCardMotif(role, '男')).toBeNull();
      expect(resolvePlayerCardMotif(role, '')).toBeNull();
      expect(resolvePlayerCardMotif(role, '不透露')).toBeNull();
      expect(resolvePlayerCardMotif(role, null)).toBeNull();
    }
  });

  it('只認「女」字串：female、F、非字串都不算', () => {
    for (const g of ['female', 'F', 'woman', '女性', 1, true, {}]) {
      expect(resolvePlayerCardMotif('coach', g)).toEqual({ key: 'board', palette: 'gold' });
      expect(resolvePlayerCardMotif('user', g)).toBeNull();
    }
  });

  it('model 帶入 role 與 gender（隱身管理員由 resolveEffectiveRole 回 user，這裡收到 user）', () => {
    const base = { name: '林雅婷', avatarUrl: null, summary: null };
    expect(buildPlayerCardModel({ ...base, role: 'coach', gender: '女' }).motif).toEqual({ key: 'board', palette: 'pink' });
    expect(buildPlayerCardModel({ ...base, role: 'user', gender: '女' }).motif).toEqual({ key: 'sakura', palette: 'gold' });
    expect(buildPlayerCardModel({ ...base, role: 'user', gender: '男' }).motif).toBeNull();
    expect(buildPlayerCardModel(base).motif).toBeNull();
  });
});

describe('球員卡身分圖案筆畫與色票', () => {
  it('女性身分圖騰疊 2～3 片花瓣點綴；櫻花枝與男性身分圖騰不疊', () => {
    const petalPieces = PLAYER_CARD_MOTIF_PETALS[0]!.d.match(/M/g)!.length;
    expect(petalPieces).toBeGreaterThanOrEqual(2);
    expect(petalPieces).toBeLessThanOrEqual(3);
    expect(playerCardMotifStrokes({ key: 'board', palette: 'pink' })).toEqual([...PLAYER_CARD_MOTIFS.board, ...PLAYER_CARD_MOTIF_PETALS]);
    expect(playerCardMotifStrokes({ key: 'board', palette: 'gold' })).toBe(PLAYER_CARD_MOTIFS.board);
    expect(playerCardMotifStrokes({ key: 'sakura', palette: 'gold' })).toBe(PLAYER_CARD_MOTIFS.sakura);
  });

  it('所有路徑都是有效 d 字串、沒有 NaN；座標落在方框內（容許描邊外擴 3 以內）', () => {
    const all = [...Object.values(PLAYER_CARD_MOTIFS).flat(), ...PLAYER_CARD_MOTIF_PETALS];
    for (const s of all) {
      expect(s.d).toMatch(/^M/);
      expect(s.d).not.toMatch(/NaN|undefined|Infinity/);
      expect(s.fill || s.stroke).toBeTruthy();
    }
    // 絕對座標指令（M/L/C/Q/S）抽樣檢查範圍
    for (const s of Object.values(PLAYER_CARD_MOTIFS).flat()) {
      const abs = [...s.d.matchAll(/([MLCQS])([^A-Za-z]*)/g)].flatMap((m) => m[2]!.split(/[ ,]+|(?=-)/).filter(Boolean).map(Number));
      for (let i = 0; i + 1 < abs.length; i += 2) {
        expect(abs[i]!).toBeGreaterThanOrEqual(-3);
        expect(abs[i]!).toBeLessThanOrEqual(PLAYER_CARD_MOTIF_BOX.width + 3);
      }
    }
  });

  it('金色系與卡面金色同一組；粉色系淺／深各一組，線條對卡底對比夠（≥3:1，淺色優於金線）', () => {
    expect(MOTIF_PALETTES.gold.light.line).toBe('#BA7517');
    expect(MOTIF_PALETTES.gold.dark.line).toBe('#FAC775');
    expect(MOTIF_PALETTES.gold.light.petal).toBe('#F7BFCB');
    expect(MOTIF_PALETTES.gold.dark.petal).toBe('#F2AFC0');
    const pinkLight = MOTIF_PALETTES.pink.light;
    const pinkDark = MOTIF_PALETTES.pink.dark;
    expect(pinkLight.line).not.toBe(MOTIF_PALETTES.gold.light.line);
    expect(pinkDark.line).not.toBe(MOTIF_PALETTES.gold.dark.line);
    expect(contrast(pinkLight.line, '#FAEEDA')).toBeGreaterThan(contrast('#BA7517', '#FAEEDA'));
    expect(contrast(pinkLight.line, '#FAEEDA')).toBeGreaterThanOrEqual(3);
    expect(contrast(pinkDark.line, '#2C2C2A')).toBeGreaterThanOrEqual(4.5);
    // 粉線與花瓣要分得開
    expect(contrast(pinkLight.line, pinkLight.petal)).toBeGreaterThanOrEqual(2);
    expect(playerCardMotifColors({ key: 'shield', palette: 'pink' }, 'dark')).toBe(pinkDark);
  });
});
