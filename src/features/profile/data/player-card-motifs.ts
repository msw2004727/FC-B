/**
 * 球員卡身分圖案（站長 11-06 定案，設計預覽 FC docs/previews/player-card-motifs-2026-11-06，方案 B＋女性身分圖騰上粉色）。
 * 同一份路徑資料給網頁卡面（PlayerCard.tsx 的 inline <svg>）與 PNG（player-card-canvas.ts 的 Path2D），兩邊不會畫歪。
 * 圖案方框：卡面 (162, 264) 起、寬 51.25、高 53.25，右下圓角 11.25（＝內框內緣）；路徑座標為方框內 0～51.25 × 0～53.25。
 * 身分只吃頁面已算好的有效身分與 profile.gender，0 次額外讀取。
 *
 * 色票集中在本檔（MOTIF_PALETTES）：球員卡是固定金色系的「實體卡」，不隨網站主題 token 變色，
 * 與既有 PLAYER_CARD_PALETTES 同一做法；元件與 Canvas 只引用這裡的常數，不散落 hex。
 */
import type { PlayerCardTheme } from './player-card-model';

export const PLAYER_CARD_MOTIF_BOX = { x: 162, y: 264, width: 51.25, height: 53.25, radius: 11.25 } as const;

export type PlayerCardMotifKey = 'sakura' | 'board' | 'flag' | 'goal' | 'shield' | 'laurel';
export type PlayerCardMotifPaletteName = 'gold' | 'pink';

export interface PlayerCardMotifColors {
  /** 線條與實心小件（星、球網格）。 */
  line: string;
  /** 大面積淡填色。 */
  tint: string;
  petal: string;
  petalEdge: string;
  /** 花心。 */
  core: string;
  /** 線條層透明度。 */
  opacity: number;
  /** 花瓣層透明度。 */
  petalOpacity: number;
}

/** 花瓣兩組色（設計預覽定案）：淺色卡淡粉 #F7BFCB、深色卡 #F2AFC0。 */
const PETAL_LIGHT = { petal: '#F7BFCB', petalEdge: '#D9849A', petalOpacity: 0.95 } as const;
const PETAL_DARK = { petal: '#F2AFC0', petalEdge: '#F9D3DC', petalOpacity: 0.88 } as const;

/**
 * gold＝男性／未填（與卡面金色同一組 #BA7517／#FAC775）；一般用戶・女的櫻花枝也用 gold（金枝、金花心、粉花瓣）。
 * pink＝女性的身分圖騰（教練／領隊／場主／管理員／總管）：
 * - 淺色卡線條 #B94A72（玫瑰粉；對卡底 #FAEEDA 對比約 4.3:1，高於金線 #BA7517 的約 3.2:1）
 * - 深色卡線條 #F28DAA（亮櫻粉；對卡底 #2C2C2A 對比約 6.1:1）
 */
export const MOTIF_PALETTES: Record<PlayerCardMotifPaletteName, Record<PlayerCardTheme, PlayerCardMotifColors>> = {
  gold: {
    light: { line: '#BA7517', tint: 'rgba(186, 117, 23, 0.12)', core: '#BA7517', opacity: 0.8, ...PETAL_LIGHT },
    dark: { line: '#FAC775', tint: 'rgba(250, 199, 117, 0.1)', core: '#FAC775', opacity: 0.72, ...PETAL_DARK },
  },
  pink: {
    light: { line: '#B94A72', tint: 'rgba(185, 74, 114, 0.12)', core: '#B94A72', opacity: 0.85, ...PETAL_LIGHT },
    dark: { line: '#F28DAA', tint: 'rgba(242, 141, 170, 0.12)', core: '#F28DAA', opacity: 0.8, ...PETAL_DARK },
  },
};

type ColorKey = 'line' | 'tint' | 'petal' | 'petalEdge' | 'core';

export interface PlayerCardMotifStroke {
  d: string;
  fill?: ColorKey;
  stroke?: ColorKey;
  width?: number;
  /** 花瓣層（用 petalOpacity）。 */
  petal?: boolean;
  dash?: readonly number[];
}

function f(n: number): number {
  return Math.round(n * 100) / 100;
}
function rot(x: number, y: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}
/** 櫻花瓣（尖端有缺口），朝上畫好再旋轉。 */
function petalPath(cx: number, cy: number, r: number, ang: number): string {
  const pts: Array<[number, number]> = [[0, 0], [-0.6 * r, -0.35 * r], [-0.55 * r, -0.98 * r], [-0.2 * r, -r],
    [0, -0.8 * r], [0.2 * r, -r], [0.55 * r, -0.98 * r], [0.6 * r, -0.35 * r]];
  const p = pts.map(([x, y]) => {
    const t = rot(x, y, ang);
    return `${f(cx + t[0])},${f(cy + t[1])}`;
  });
  return `M${p[0]}C${p[1]} ${p[2]} ${p[3]}L${p[4]}L${p[5]}C${p[6]} ${p[7]} ${p[0]}Z`;
}
function flower(cx: number, cy: number, r: number, base: number): string {
  let d = '';
  for (let i = 0; i < 5; i++) d += petalPath(cx, cy, r, base + (i * Math.PI * 2) / 5);
  return d;
}
function circle(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0Z`;
}
function leaf(cx: number, cy: number, len: number, wid: number, ang: number): string {
  const a = rot(-len / 2, 0, ang);
  const b = rot(len / 2, 0, ang);
  const c1 = rot(0, -wid, ang);
  const c2 = rot(0, wid, ang);
  return `M${f(cx + a[0])} ${f(cy + a[1])}Q${f(cx + c1[0])} ${f(cy + c1[1])} ${f(cx + b[0])} ${f(cy + b[1])}`
    + `Q${f(cx + c2[0])} ${f(cy + c2[1])} ${f(cx + a[0])} ${f(cy + a[1])}Z`;
}
function star(cx: number, cy: number, R: number, r: number): string {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r : R;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    d += `${i ? 'L' : 'M'}${f(cx + rr * Math.cos(a))} ${f(cy + rr * Math.sin(a))}`;
  }
  return `${d}Z`;
}

function laurel(): PlayerCardMotifStroke[] {
  const cx = 28;
  const cy = 29;
  const R = 13.5;
  const pt = (t: number): string => `${f(cx + R * Math.cos(t))} ${f(cy + R * Math.sin(t))}`;
  const stems = `M${pt(1.62)}A${R} ${R} 0 0 1 ${pt(3.75)}M${pt(1.52)}A${R} ${R} 0 0 0 ${pt(-0.61)}`;
  let leaves = '';
  for (const t of [1.95, 2.35, 2.75, 3.15, 3.55]) {
    const px = cx + R * Math.cos(t);
    const py = cy + R * Math.sin(t);
    const tang = t + Math.PI / 2; // 沿弧往上
    const outA = tang + 0.55;
    const inA = tang - 0.55;
    leaves += leaf(px + 3.6 * Math.cos(outA - Math.PI), py + 3.6 * Math.sin(outA - Math.PI), 7.4, 2.2, outA);
    leaves += leaf(px + 3.0 * Math.cos(inA - Math.PI), py + 3.0 * Math.sin(inA - Math.PI), 5.6, 1.7, inA);
    const mt = Math.PI - t;
    const mx = cx + R * Math.cos(mt);
    const my = cy + R * Math.sin(mt);
    const mtang = mt - Math.PI / 2;
    const moA = mtang - 0.55;
    const miA = mtang + 0.55;
    leaves += leaf(mx + 3.6 * Math.cos(moA - Math.PI), my + 3.6 * Math.sin(moA - Math.PI), 7.4, 2.2, moA);
    leaves += leaf(mx + 3.0 * Math.cos(miA - Math.PI), my + 3.0 * Math.sin(miA - Math.PI), 5.6, 1.7, miA);
  }
  return [
    { d: stems, stroke: 'line', width: 1 },
    { d: leaves, fill: 'tint', stroke: 'line', width: 0.7 },
    { d: star(cx, cy - 2, 4.4, 1.9), fill: 'line' },
  ];
}

/** 圖案路徑（模組層算一次）。 */
export const PLAYER_CARD_MOTIFS: Record<PlayerCardMotifKey, readonly PlayerCardMotifStroke[]> = {
  /** 一般用戶・女：櫻花枝。 */
  sakura: [
    { d: 'M54 21C45 24 37 29 31 35S20 46 13 50', stroke: 'line', width: 1.1 },
    { d: 'M37.5 29.5C36 24 33 19.5 28.5 15.5', stroke: 'line', width: 0.9 },
    { d: 'M24 41.5C20.5 39.5 15.5 38.5 10.5 39.5', stroke: 'line', width: 0.8 },
    { d: 'M45.5 24.5C46 28.5 45 32 43 35', stroke: 'line', width: 0.7 },
    { d: flower(26.5, 14, 8, 0.25), fill: 'petal', stroke: 'petalEdge', width: 0.45, petal: true },
    { d: circle(26.5, 14, 1.4), fill: 'core' },
    { d: flower(40, 37.5, 7, -0.3), fill: 'petal', stroke: 'petalEdge', width: 0.45, petal: true },
    { d: circle(40, 37.5, 1.25), fill: 'core' },
    { d: petalPath(10, 39.5, 4.6, -1.35) + petalPath(10, 39.5, 4.6, -1.9), fill: 'petal', stroke: 'petalEdge', width: 0.45, petal: true },
    { d: petalPath(8, 24, 3.6, 0.9), fill: 'petal', stroke: 'petalEdge', width: 0.4, petal: true },
    { d: petalPath(18, 5.5, 3.1, -0.6), fill: 'petal', stroke: 'petalEdge', width: 0.4, petal: true },
  ],
  /** 教練：戰術板。 */
  board: [
    { d: 'M17 13.5h22a3 3 0 0 1 3 3v27a3 3 0 0 1-3 3h-22a3 3 0 0 1-3-3v-27a3 3 0 0 1 3-3Z', fill: 'tint', stroke: 'line', width: 1.1 },
    { d: 'M23.5 10.5h9a1.5 1.5 0 0 1 1.5 1.5v3.5h-12v-3.5a1.5 1.5 0 0 1 1.5-1.5Z', fill: 'tint', stroke: 'line', width: 1 },
    { d: 'M18.5 20.5l5 5M23.5 20.5l-5 5', stroke: 'line', width: 1.1 },
    { d: circle(34, 38.5, 2.8), stroke: 'line', width: 1.1 },
    { d: 'M22 28.5C22 36 26 38.5 30 38.5', stroke: 'line', width: 0.9, dash: [1.6, 1.4] },
    { d: 'M27.8 36.3L30.6 38.6L27.6 40.6', stroke: 'line', width: 0.9 },
    { d: 'M31.5 20.5l4 4M35.5 20.5l-4 4', stroke: 'line', width: 1 },
  ],
  /** 領隊（captain）：三角隊旗加星。 */
  flag: [
    { d: 'M20 47V9.5', stroke: 'line', width: 1.3 },
    { d: circle(20, 8.2, 1.6), fill: 'line' },
    { d: 'M15.5 47h9', stroke: 'line', width: 1.2 },
    { d: 'M20.6 11C27 12 34 11.5 45 17.5C35 21 28 23 20.6 30Z', fill: 'tint', stroke: 'line', width: 1.1 },
    { d: star(29.5, 19, 3.4, 1.45), fill: 'line' },
  ],
  /** 場主：球門網格加足球。 */
  goal: [
    { d: 'M6 43V20.5h31V43', stroke: 'line', width: 1.4 },
    { d: 'M6 20.5l4.5 4.5h22l4.5-4.5M10.5 25V43M32.5 25V43', stroke: 'line', width: 0.8 },
    { d: 'M15 25V43M19.5 25V43M24 25V43M28 25V43M10.5 29.5h22M10.5 34h22M10.5 38.5h22', stroke: 'line', width: 0.45 },
    { d: circle(42, 40, 4.6), fill: 'tint', stroke: 'line', width: 1 },
    { d: 'M42 37.6l2.1 1.5-.8 2.5h-2.6l-.8-2.5ZM42 35.4v2.2M44.1 39.1l2.3-.6M43.3 41.6l1.3 1.9M40.7 41.6l-1.3 1.9M39.9 39.1l-2.3-.6', fill: 'line', stroke: 'line', width: 0.5 },
    { d: 'M2 45h47', stroke: 'line', width: 0.9 },
  ],
  /** 管理員：盾牌加勾。 */
  shield: [
    { d: 'M28 9.5L41.5 14.5V26.5C41.5 35 36 41.5 28 45.5C20 41.5 14.5 35 14.5 26.5V14.5Z', fill: 'tint', stroke: 'line', width: 1.2 },
    { d: 'M28 13.5L38 17.3V26.5C38 33 34 38 28 41.3C22 38 18 33 18 26.5V17.3Z', stroke: 'line', width: 0.6 },
    { d: 'M22.5 27.5L26.5 31.5L34 23', stroke: 'line', width: 1.5 },
  ],
  /** 總管：桂冠加星。 */
  laurel: laurel(),
};

/** 方案 B：女性身分圖騰旁的三片櫻花瓣點綴（左下兩片、右上一片）。 */
export const PLAYER_CARD_MOTIF_PETALS: readonly PlayerCardMotifStroke[] = [
  { d: petalPath(7, 41, 3.6, -1.2) + petalPath(6, 31, 2.9, 0.7) + petalPath(46, 6.5, 3, 2.3), fill: 'petal', stroke: 'petalEdge', width: 0.4, petal: true },
];

const ROLE_MOTIFS: Readonly<Record<string, PlayerCardMotifKey>> = {
  coach: 'board',
  captain: 'flag',
  venue_owner: 'goal',
  admin: 'shield',
  super_admin: 'laurel',
};

export interface PlayerCardMotif {
  key: PlayerCardMotifKey;
  palette: PlayerCardMotifPaletteName;
}

/**
 * 有效身分 × 性別 → 圖案（純函式）。只認 gender.trim()==='女'。
 * - coach／captain／venue_owner／admin／super_admin：身分圖騰；女性用 pink 並加花瓣點綴，其餘 gold。
 * - 其他（user、team_leader、自訂角色、隱身管理員經 resolveEffectiveRole 回 user）：女＝櫻花枝（gold），男／未填／其他＝null 不畫。
 */
export function resolvePlayerCardMotif(role: unknown, gender: unknown): PlayerCardMotif | null {
  const female = typeof gender === 'string' && gender.trim() === '女';
  const key = typeof role === 'string' && Object.prototype.hasOwnProperty.call(ROLE_MOTIFS, role) ? ROLE_MOTIFS[role] : undefined;
  if (key) return { key, palette: female ? 'pink' : 'gold' };
  return female ? { key: 'sakura', palette: 'gold' } : null;
}

/** 要畫的筆畫：身分圖騰本體，女性身分圖騰再疊花瓣點綴。 */
export function playerCardMotifStrokes(motif: PlayerCardMotif): readonly PlayerCardMotifStroke[] {
  const base = PLAYER_CARD_MOTIFS[motif.key];
  return motif.key !== 'sakura' && motif.palette === 'pink' ? [...base, ...PLAYER_CARD_MOTIF_PETALS] : base;
}

export function playerCardMotifColors(motif: PlayerCardMotif, theme: PlayerCardTheme): PlayerCardMotifColors {
  return MOTIF_PALETTES[motif.palette][theme];
}
