import { describe, expect, it, vi } from 'vitest';

import {
  PLAYER_CARD_FONT_LOAD,
  PLAYER_CARD_PNG_SCALE,
  drawPlayerCard,
  ensurePlayerCardFonts,
  loadSafeAvatar,
  renderPlayerCardPng,
  type CanvasLike,
  type DrawableImage,
  type PlayerCardLabels,
  type PlayerCardRenderDeps,
} from './player-card-canvas';
import { buildPlayerCardModel, PLAYER_CARD_PALETTES } from './player-card-model';

interface FillRecord {
  fillStyle: unknown;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 假 2D context：記錄文字、貼圖與每次 fill 的路徑範圍。 */
function makeFakeCtx(opts: { taint?: boolean } = {}) {
  const texts: string[] = [];
  const images: Array<{ image: unknown; args: number[] }> = [];
  const fills: FillRecord[] = [];
  let points: Array<[number, number]> = [];
  const add = (x: number, y: number): void => {
    points.push([x, y]);
  };
  const ctx = {
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    letterSpacing: '0px',
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    clip: vi.fn(),
    stroke: vi.fn(),
    closePath: vi.fn(),
    beginPath: () => {
      points = [];
    },
    moveTo: add,
    lineTo: add,
    arcTo: (x1: number, y1: number, x2: number, y2: number) => {
      add(x1, y1);
      add(x2, y2);
    },
    arc: (x: number, y: number, r: number) => {
      add(x - r, y - r);
      add(x + r, y + r);
    },
    ellipse: (x: number, y: number, rx: number, ry: number) => {
      add(x - rx, y - ry);
      add(x + rx, y + ry);
    },
    fill: () => {
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      fills.push({
        fillStyle: ctx.fillStyle,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      });
    },
    fillRect: vi.fn(),
    fillText: (value: string) => {
      texts.push(value);
    },
    measureText: (value: string) => ({ width: value.length * 8 }),
    drawImage: (image: unknown, ...args: number[]) => {
      images.push({ image, args });
    },
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    getImageData: () => {
      if (opts.taint) throw new DOMException('tainted', 'SecurityError');
      return { data: new Uint8ClampedArray(4) };
    },
  };
  return { ctx, texts, images, fills };
}

const labels: PlayerCardLabels = {
  title: '球員卡',
  scheduled: '應到',
  completed: '完成',
  attend: '出席率',
  clubs: '俱樂部',
};

const avatarImg: DrawableImage = { width: 200, height: 160 };
const logoImg: DrawableImage = { width: 400, height: 80 };

function model(teamIds: string[] = ['t1', 't2']) {
  return buildPlayerCardModel({
    name: '王小明',
    avatarUrl: 'https://profile.line-scdn.net/abc',
    summary: {
      uid: 'U-secret-uid',
      exists: true,
      sourceVersion: 1,
      expectedCount: 26,
      attendedCount: 22,
      completedCount: 14,
      attendRate: 85,
      updatedAt: null,
    },
    teamIds,
  });
}

describe('T-092 球員卡 Canvas 產圖', () => {
  it('畫出 logo、三格（中文＋縮寫）、球員卡標題、俱樂部數與名字', () => {
    const fake = makeFakeCtx();
    drawPlayerCard(fake.ctx as unknown as CanvasRenderingContext2D, model(), 'light', labels, {
      avatar: avatarImg,
      logo: logoImg,
    });
    expect(fake.images.some((i) => i.image === logoImg)).toBe(true);
    expect(fake.images.some((i) => i.image === avatarImg)).toBe(true);
    for (const value of ['26', '14', '85%', '應到', '完成', '出席率', 'SCH', 'CMP', 'ATT',
      '球員卡', 'PLAYER CARD', '俱樂部', '2', '王小明']) {
      expect(fake.texts).toContain(value);
    }
  });

  it('計量條長度＝出席率', () => {
    const fake = makeFakeCtx();
    drawPlayerCard(fake.ctx as unknown as CanvasRenderingContext2D, model(), 'dark', labels, {
      avatar: null,
      logo: logoImg,
    });
    const gaugeFills = fake.fills.filter((f) => f.minY === 204 && f.maxY === 208);
    expect(gaugeFills).toHaveLength(2);
    const [track, bar] = gaugeFills;
    expect(track!.maxX - track!.minX).toBeCloseTo(132);
    expect(bar!.maxX - bar!.minX).toBeCloseTo(132 * 0.85);
    expect(bar!.fillStyle).toBe(PLAYER_CARD_PALETTES.dark.gold);
  });

  it('PNG 不含 UID；俱樂部數 0 不畫方塊', () => {
    const fake = makeFakeCtx();
    drawPlayerCard(fake.ctx as unknown as CanvasRenderingContext2D, model([]), 'light', labels, {
      avatar: null,
      logo: null,
    });
    expect(fake.texts.join('|')).not.toContain('U-secret-uid');
    expect(fake.texts).not.toContain('俱樂部');
    // logo 載不到時退回文字商標
    expect(fake.texts).toContain('ToosterX');
  });

  it('大頭照 tainted（getImageData 丟錯）時改用預設頭像', async () => {
    const tainted = makeFakeCtx({ taint: true });
    const deps = {
      createCanvas: () => ({ getContext: () => tainted.ctx }) as unknown as CanvasLike,
      loadImage: vi.fn(async () => avatarImg),
    };
    await expect(loadSafeAvatar('https://profile.line-scdn.net/abc', deps)).resolves.toBeNull();
    expect(deps.loadImage).toHaveBeenCalledWith('https://profile.line-scdn.net/abc', true);

    const clean = makeFakeCtx();
    await expect(loadSafeAvatar('https://x.test/a.png', {
      createCanvas: () => ({ getContext: () => clean.ctx }) as unknown as CanvasLike,
      loadImage: async () => avatarImg,
    })).resolves.toBe(avatarImg);

    await expect(loadSafeAvatar('https://x.test/a.png', {
      createCanvas: () => ({ getContext: () => clean.ctx }) as unknown as CanvasLike,
      loadImage: async () => null,
    })).resolves.toBeNull();
    await expect(loadSafeAvatar(null, {
      createCanvas: () => ({ getContext: () => clean.ctx }) as unknown as CanvasLike,
      loadImage: async () => avatarImg,
    })).resolves.toBeNull();
  });

  it('renderPlayerCardPng：先載字型、3 倍尺寸輸出 PNG、logo 依深淺色', async () => {
    const main = makeFakeCtx();
    const probe = makeFakeCtx({ taint: true });
    const sizes: Array<[number, number]> = [];
    let toBlobType: string | undefined;
    const deps: PlayerCardRenderDeps = {
      createCanvas: (width, height) => {
        sizes.push([width, height]);
        const isMain = width > 1;
        return {
          width,
          height,
          getContext: () => (isMain ? main.ctx : probe.ctx) as unknown as CanvasRenderingContext2D,
          toBlob: (cb: (b: Blob | null) => void, type?: string) => {
            toBlobType = type;
            cb(new Blob(['png'], { type: 'image/png' }));
          },
        };
      },
      loadImage: vi.fn(async (url: string) => (url.includes('logo') ? logoImg : avatarImg)),
      ensureFonts: vi.fn(async () => undefined),
    };
    const blob = await renderPlayerCardPng(model(), 'dark', labels, deps);
    expect(blob.type).toBe('image/png');
    expect(toBlobType).toBe('image/png');
    expect(deps.ensureFonts).toHaveBeenCalledTimes(1);
    expect(deps.loadImage).toHaveBeenCalledWith('/assets/logo-white.webp', false);
    expect(sizes).toContainEqual([220 * PLAYER_CARD_PNG_SCALE, 324 * PLAYER_CARD_PNG_SCALE]);
    expect(main.ctx.scale).toHaveBeenCalledWith(PLAYER_CARD_PNG_SCALE, PLAYER_CARD_PNG_SCALE);
    // 頭像 tainted → 主畫布只貼 logo，不貼頭像
    expect(main.images.map((i) => i.image)).toEqual([logoImg]);
  });

  it('產圖前載入自架 Bebas Neue（與 @font-face 同名），失敗或逾時不卡住', async () => {
    const load = vi.fn(async () => []);
    await ensurePlayerCardFonts({ load });
    expect(load).toHaveBeenCalledWith("400 32px 'Bebas Neue'", PLAYER_CARD_FONT_LOAD.text);
    // 取樣字元都在 @font-face 的 unicode-range（英數與 % -）內，才會真的觸發下載
    expect(PLAYER_CARD_FONT_LOAD.text).toMatch(/^[0-9A-Za-z%\-]+$/);

    await expect(ensurePlayerCardFonts({ load: async () => Promise.reject(new Error('404')) })).resolves.toBeUndefined();
    await expect(ensurePlayerCardFonts({ load: () => new Promise(() => {}) }, 10)).resolves.toBeUndefined();
    await expect(ensurePlayerCardFonts(undefined)).resolves.toBeUndefined();
  });
});
