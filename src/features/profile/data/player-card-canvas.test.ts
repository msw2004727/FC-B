import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PLAYER_CARD_FONT_LOAD,
  PLAYER_CARD_IMAGE_TIMEOUT_MS,
  LOGO_BOTTOM_Y,
  LOGO_CENTER_Y,
  LOGO_HEIGHT,
  LOGO_MAX_WIDTH,
  LOGO_TOP_Y,
  INNER_FRAME_INNER_EDGE_Y,
  STAT_COLUMNS,
  QR_QUIET_MODULES,
  browserCreateQrMatrix,
  PLAYER_CARD_PNG_SCALE,
  QR_MODULE_PX,
  STAT_CELL_MAX_WIDTH,
  qrLayout,
  type QrMatrix,
  browserLoadImage,
  drawMotif,
  drawPlayerCard,
  ensurePlayerCardFonts,
  loadSafeAvatar,
  renderPlayerCardPng,
  type CanvasLike,
  type DrawableImage,
  type PlayerCardLabels,
  type PlayerCardRenderDeps,
} from './player-card-canvas';
import {
  buildPlayerCardModel,
  PLAYER_CARD_PALETTES,
  playerCardShineCanvasStops,
  playerCardShineGeometry,
  playerCardShineLayers,
} from './player-card-model';
import { MOTIF_PALETTES, PLAYER_CARD_MOTIFS } from './player-card-motifs';

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
  /** 每次 fillText 當下的字級與量測寬度。 */
  const drawn: Array<{ value: string; size: number; width: number; color: unknown }> = [];
  /** 每次 stroke 當下的 strokeStyle（分隔線等）。 */
  const strokeStyles: unknown[] = [];
  const sizeOf = (font: string): number => Number(/([\d.]+)px/.exec(font)?.[1] ?? 10);
  // 假量測：每字寬＝字級 × 0.6（足以驗證縮字邏輯）
  const measure = (value: string): number => Array.from(value).length * sizeOf(ctx.font) * 0.6;
  const images: Array<{ image: unknown; args: number[] }> = [];
  const fills: FillRecord[] = [];
  const gradients: Array<{ args: number[]; stops: Array<[number, string]> }> = [];
  const rects: Array<{ style: unknown; x: number; y: number; w: number; h: number; seq: number; composite: string }> = [];
  let seq = 0;
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
    globalCompositeOperation: 'source-over',
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    clip: vi.fn(),
    stroke: () => {
      strokeStyles.push(ctx.strokeStyle);
    },
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
    fillRect: (x: number, y: number, w: number, h: number) => {
      rects.push({ style: ctx.fillStyle, x, y, w, h, seq: seq++, composite: ctx.globalCompositeOperation });
    },
    fillText: (value: string) => {
      texts.push(value);
      drawn.push({ value, size: sizeOf(ctx.font), width: measure(value), color: ctx.fillStyle });
    },
    measureText: (value: string) => ({ width: measure(value) }),
    drawImage: (image: unknown, ...args: number[]) => {
      images.push({ image, args });
    },
    createLinearGradient: (...args: number[]) => {
      const g = { args, stops: [] as Array<[number, string]>, addColorStop: (o: number, c: string) => g.stops.push([o, c]) };
      gradients.push(g);
      return g;
    },
    getImageData: () => {
      if (opts.taint) throw new DOMException('tainted', 'SecurityError');
      return { data: new Uint8ClampedArray(4) };
    },
  };
  return { ctx, texts, images, fills, drawn, rects, gradients, strokeStyles };
}

const labels: PlayerCardLabels = {
  title: '球員卡',
  // 測試同步更新（站長 11-06 放鴿子／出席率 v2）：「應到」改「參與」、縮寫 SCH 改 APP。
  scheduled: '參與',
  completed: '完成',
  attend: '出席率',
  clubs: '俱樂部',
};

const avatarImg: DrawableImage = { width: 200, height: 160 };
const logoImg: DrawableImage = { width: 400, height: 80 };

function model(teamIds: string[] = ['t1', 't2'], name = '王小明') {
  return buildPlayerCardModel({
    name,
    uid: 'U-secret-uid',
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
    for (const value of ['26', '14', '85%', '參與', '完成', '出席率', 'APP', 'CMP', 'ATT',
      '球員卡', 'PLAYER CARD', '俱樂部', '2', '王小明']) {
      expect(fake.texts).toContain(value);
    }
  });

  it('v2 摘要：出席率格畫「完成/計入」，仍保留 ATT 縮寫，沒有 SCH', () => {
    const fake = makeFakeCtx();
    const v2Model = buildPlayerCardModel({
      name: '王小明', uid: 'U-secret-uid', avatarUrl: null, teamIds: [],
      summary: {
        uid: 'U-secret-uid', exists: true, sourceVersion: 1, expectedCount: 26, attendedCount: 22,
        completedCount: 14, attendRate: 85, updatedAt: null,
        v2: { since: '2026-11-06', participatedCount: 9, countedCount: 2, countedCompletedCount: 1, countedNoShowCount: 0 },
      },
    });
    drawPlayerCard(fake.ctx as unknown as CanvasRenderingContext2D, v2Model, 'light', labels, {
      avatar: null, logo: logoImg,
    });
    for (const value of ['9', '1', '1/2', 'ATT', 'APP']) expect(fake.texts).toContain(value);
    expect(fake.texts).not.toContain('SCH');
    expect(fake.texts).not.toContain('85%');
  });

  it('字級照站長核可預覽（卡面 220×324）：大數字 44、ATT 12、球員卡 12、PLAYER CARD 11、名字 17、三格 24／11／11、俱樂部 8／19', () => {
    const fake = makeFakeCtx();
    drawPlayerCard(fake.ctx as unknown as CanvasRenderingContext2D, model(), 'light', labels, {
      avatar: avatarImg,
      logo: logoImg,
    });
    const sizes = (value: string): number[] => fake.drawn.filter((d) => d.value === value).map((d) => d.size);
    expect(sizes('85%')).toEqual([44, 24]);
    expect(sizes('ATT')).toEqual([12, 11]);
    expect(sizes('球員卡')).toEqual([12]);
    expect(sizes('PLAYER CARD')).toEqual([11]);
    expect(sizes('王小明')).toEqual([17]);
    expect(sizes('26')).toEqual([24]);
    expect(sizes('參與')).toEqual([11]);
    expect(sizes('APP')).toEqual([11]);
    expect(sizes('俱樂部')).toEqual([8]);
    expect(sizes('2')).toEqual([19]);
  });

  it('計量條長度＝出席率', () => {
    const fake = makeFakeCtx();
    drawPlayerCard(fake.ctx as unknown as CanvasRenderingContext2D, model(), 'dark', labels, {
      avatar: null,
      logo: logoImg,
    });
    // 照預覽：與三格同寬 186（17～203）、高 7、上緣 185
    const gaugeFills = fake.fills.filter((f) => f.minY === 185 && f.maxY === 192);
    expect(gaugeFills).toHaveLength(2);
    const [track, bar] = gaugeFills;
    expect(track!.minX).toBeCloseTo(17);
    expect(track!.maxX - track!.minX).toBeCloseTo(186);
    expect(bar!.maxX - bar!.minX).toBeCloseTo(186 * 0.85);
    expect(bar!.fillStyle).toBe(PLAYER_CARD_PALETTES.dark.gaugeFill);
    expect(track!.fillStyle).toBe(PLAYER_CARD_PALETTES.dark.gaugeTrack);
  });

  // 測試同步更新（站長 11-06 T-092 顏色照預覽）：PNG 各元素色碼對照 PLAYER_CARD_PALETTES（DOM 同組色碼見 player-card-palette-parity.test.ts）。
  for (const theme of ['light', 'dark'] as const) {
    it(`色碼照預覽（${theme}）：文字、計量條、分隔線、頭像底色、俱樂部方塊都取自色票`, () => {
      const pal = PLAYER_CARD_PALETTES[theme];
      const fake = makeFakeCtx();
      drawPlayerCard(fake.ctx as unknown as CanvasRenderingContext2D, model(), theme, labels, {
        avatar: null,
        logo: logoImg,
      });
      const colorsOf = (value: string): unknown[] => fake.drawn.filter((d) => d.value === value).map((d) => d.color);
      // '85%' 依序：左上大數字、三格第三格數字
      expect(colorsOf('85%')).toEqual([pal.headline, pal.statNumAtt]);
      expect(colorsOf('球員卡')).toEqual([pal.headline]);
      expect(colorsOf('PLAYER CARD')).toEqual([pal.headlineAbbr]);
      // 'ATT'：左上縮寫、三格縮寫
      expect(colorsOf('ATT')).toEqual([pal.headlineAbbr, pal.statAbbr]);
      expect(colorsOf('APP')).toEqual([pal.statAbbr]);
      expect(colorsOf('CMP')).toEqual([pal.statAbbr]);
      for (const label of ['參與', '完成', '出席率']) expect(colorsOf(label)).toEqual([pal.statLabel]);
      expect(colorsOf('26')).toEqual([pal.text]);
      expect(colorsOf('王小明')).toEqual([pal.text]);
      expect(colorsOf('俱樂部')).toEqual([pal.clubText]);
      expect(colorsOf('2')).toEqual([pal.clubText]);
      // 沒頭像：純色圓底（不漸層）＋首字色
      // 舊的頭像底色漸層範圍 (67,54)→(153,140) 不再出現（斜光漸層是另一條）
      expect(fake.gradients.some((g) => g.args.join(',') === '67,54,153,140')).toBe(false);
      expect(fake.fills.some((f) => f.fillStyle === pal.avatarFill)).toBe(true);
      expect(colorsOf('王')).toEqual([pal.avatarInitial]);
      expect(fake.fills.some((f) => f.fillStyle === pal.clubBg)).toBe(true);
      expect(fake.strokeStyles).toContain(pal.divider);
    });
  }

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
    // 頭像 tainted → 主畫布只貼 logo，不貼頭像，改畫姓名首字（與畫面一致）
    expect(main.images.map((i) => i.image)).toEqual([logoImg]);
    expect(main.texts).toContain('王');
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

  it('P2-1：名字等於 UID（身分解析退回 UID）時 PNG 不印出 UID，首字改 ?', () => {
    const fake = makeFakeCtx();
    drawPlayerCard(fake.ctx as unknown as CanvasRenderingContext2D, model(['t1'], ' U-secret-uid '), 'light', labels, {
      avatar: null,
      logo: logoImg,
    });
    expect(fake.texts.join('|')).not.toContain('U-secret-uid');
    expect(fake.texts).toContain('-');
    expect(fake.texts).toContain('?');
  });

  it('沒有頭像時畫姓名首字（與畫面 LegacyAvatar 一致），不貼頭像圖', () => {
    const fake = makeFakeCtx();
    drawPlayerCard(fake.ctx as unknown as CanvasRenderingContext2D, model(), 'dark', labels, {
      avatar: null,
      logo: logoImg,
    });
    expect(fake.texts).toContain('王');
    expect(fake.images.map((i) => i.image)).toEqual([logoImg]);
  });

  it('長標籤（泰文、越南文）自動縮字到欄寬：三格欄寬、俱樂部方塊 36px', () => {
    const fake = makeFakeCtx();
    const thai: PlayerCardLabels = {
      title: 'การ์ดผู้เล่น',
      scheduled: 'ที่ต้องเข้าร่วม',
      completed: 'สำเร็จ',
      attend: 'อัตราการเข้าร่วม',
      clubs: 'Câu lạc bộ',
    };
    drawPlayerCard(fake.ctx as unknown as CanvasRenderingContext2D, model(['t1']), 'light', thai, {
      avatar: avatarImg,
      logo: logoImg,
    });
    const attend = fake.drawn.find((d) => d.value === thai.attend)!;
    expect(attend.size).toBeLessThan(11);
    expect(attend.width).toBeLessThanOrEqual(STAT_CELL_MAX_WIDTH);
    const scheduled = fake.drawn.find((d) => d.value === thai.scheduled)!;
    expect(scheduled.width).toBeLessThanOrEqual(STAT_CELL_MAX_WIDTH);
    const clubs = fake.drawn.find((d) => d.value === thai.clubs)!;
    expect(clubs.width).toBeLessThanOrEqual(36 - 6);
    expect(clubs.size).toBeLessThan(8);
    // 短的中文標籤維持預覽字級（三格中文 11、俱樂部 8）
    const zh = makeFakeCtx();
    drawPlayerCard(zh.ctx as unknown as CanvasRenderingContext2D, model(['t1']), 'light', labels, {
      avatar: avatarImg,
      logo: logoImg,
    });
    expect(zh.drawn.find((d) => d.value === '出席率')!.size).toBe(11);
    expect(zh.drawn.find((d) => d.value === '俱樂部')!.size).toBe(8);
  });

  it('圖片載入約 3 秒逾時視為失敗（頭像改畫首字）', async () => {
    vi.useFakeTimers();
    try {
      const pending = browserLoadImage('https://profile.line-scdn.net/slow', true);
      await vi.advanceTimersByTimeAsync(PLAYER_CARD_IMAGE_TIMEOUT_MS - 1);
      let settled = false;
      pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
    expect(PLAYER_CARD_IMAGE_TIMEOUT_MS).toBe(3000);
  });

  describe('PNG 左下 QR（本人名片分享網址）', () => {
    const PROFILE_URL = 'https://miniapp.line.me/2009525300-AuPGQ0sh?profile='
      + encodeURIComponent('U0123456789abcdef0123456789abcdef');

    async function realMatrix(text: string): Promise<{ matrix: QrMatrix; version: number }> {
      const mod = (await import('qrcode')) as unknown as {
        create: (t: string, o: { errorCorrectionLevel: 'L' }) => { modules: QrMatrix; version: number };
      };
      const created = mod.create(text, { errorCorrectionLevel: 'L' });
      return { matrix: created.modules, version: created.version };
    }

    function renderDeps(main: ReturnType<typeof makeFakeCtx>, qr: PlayerCardRenderDeps['createQrMatrix']) {
      const probe = makeFakeCtx();
      const deps: PlayerCardRenderDeps = {
        createCanvas: (width, height) => ({
          width,
          height,
          getContext: () => (width > 1 ? main.ctx : probe.ctx) as unknown as CanvasRenderingContext2D,
          toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['png'], { type: 'image/png' })),
        }),
        loadImage: async (url: string) => (url.includes('logo') ? logoImg : null),
        ensureFonts: async () => undefined,
        createQrMatrix: qr,
      };
      return deps;
    }

    function darkModules(matrix: QrMatrix): number {
      let count = 0;
      for (let r = 0; r < matrix.size; r++) {
        for (let c = 0; c < matrix.size; c++) {
          if (matrix.get(r, c)) count += 1;
        }
      }
      return count;
    }

    it('個人名片網址以錯誤修正 L 產生版本 4（33 模組），每模組 2px、quiet zone 4 模組', async () => {
      const { matrix, version } = await realMatrix(PROFILE_URL);
      expect(version).toBe(4);
      expect(matrix.size).toBe(33);
      const layout = qrLayout(matrix.size);
      expect(layout.module * PLAYER_CARD_PNG_SCALE).toBeCloseTo(QR_MODULE_PX);
      // 整塊（含 4 模組 quiet zone）41 模組 × 2px ＝ 82px
      expect(QR_QUIET_MODULES).toBe(4);
      expect(Math.round(layout.box.size * PLAYER_CARD_PNG_SCALE)).toBe(82);
      // 測試同步更新（站長 11-06 PNG 版面）：QR 改置中於「完成 CMP」欄，x＝110−size/2；y 為 (256+304.25)/2−size/2 再吸附到像素格
      expect(layout.box.x).toBeCloseTo(110 - 82 / 3 / 2, 6);
      expect(layout.box.y).toBeCloseTo(266.3333, 3);
    });

    it('產圖時以網址呼叫 QR 產生並畫進 PNG（底色／碼色依深淺）', async () => {
      const { matrix } = await realMatrix(PROFILE_URL);
      const dark = darkModules(matrix);
      const main = makeFakeCtx();
      const createQrMatrix = vi.fn(async () => matrix);
      await renderPlayerCardPng(model(), 'light', labels, renderDeps(main, createQrMatrix), { qrText: PROFILE_URL });
      expect(createQrMatrix).toHaveBeenCalledWith(PROFILE_URL);
      expect(main.rects.filter((r) => r.style === '#FFFFFF')).toHaveLength(1);
      expect(main.rects.filter((r) => r.style === '#412402')).toHaveLength(dark);
      // UID 只在 QR 裡，PNG 文字不出現 UID
      expect(main.texts.join('|')).not.toContain('U0123456789abcdef');

      const darkCtx = makeFakeCtx();
      await renderPlayerCardPng(model(), 'dark', labels, renderDeps(darkCtx, async () => matrix), { qrText: PROFILE_URL });
      expect(darkCtx.rects.filter((r) => r.style === '#FAEEDA')).toHaveLength(1);
      expect(darkCtx.rects.filter((r) => r.style === '#2C2C2A')).toHaveLength(dark);
    });

    it('QR 產生失敗仍輸出 PNG、不放 QR；沒給網址時不產生 QR', async () => {
      const main = makeFakeCtx();
      const failing = vi.fn(async (): Promise<QrMatrix | null> => {
        throw new Error('qr failed');
      });
      const blob = await renderPlayerCardPng(model(), 'light', labels, renderDeps(main, failing), { qrText: PROFILE_URL });
      expect(failing).toHaveBeenCalledTimes(1);
      expect(blob.type).toBe('image/png');
      expect(main.rects.filter((r) => r.style === '#FFFFFF')).toHaveLength(0);

      const none = makeFakeCtx();
      const unused = vi.fn(async () => null);
      await renderPlayerCardPng(model(), 'light', labels, renderDeps(none, unused));
      expect(unused).not.toHaveBeenCalled();
    });

    // 測試同步更新（站長 11-06 PNG 版面）：取代原「QR 中心＝應到欄中心 x、logo 中心 y」。
    it('版面：QR 中心 x＝完成欄中心；上下留白相等（縮寫字下緣與 logo 上緣之間）；logo 下緣距內框 1；不重疊', async () => {
      const { matrix } = await realMatrix(PROFILE_URL);
      const { box } = qrLayout(matrix.size);
      const right = box.x + box.size;
      const bottom = box.y + box.size;
      // 內框內緣：框路徑在 324−6＝318、線寬 1.5，內緣 317.25
      expect(INNER_FRAME_INNER_EDGE_Y).toBeCloseTo(317.25, 9);
      expect(STAT_COLUMNS[1]).toBe(110);
      expect(box.x + box.size / 2).toBeCloseTo(STAT_COLUMNS[1], 9);
      // 縮寫字（Bebas Neue 全大寫）下緣＝基線 256；上留白＝QR 上緣 − 256，下留白＝logo 上緣 − QR 下緣，容差 0.5
      const abbrBottom = 256;
      const gapAbove = box.y - abbrBottom;
      const gapBelow = LOGO_TOP_Y - bottom;
      expect(gapAbove).toBeGreaterThan(0);
      expect(gapBelow).toBeGreaterThan(0);
      expect(Math.abs(gapAbove - gapBelow)).toBeLessThanOrEqual(0.5);
      // logo：高 12、下緣離內框內緣 1、中心 y＝下緣 − 6
      expect(LOGO_HEIGHT).toBe(12);
      expect(INNER_FRAME_INNER_EDGE_Y - LOGO_BOTTOM_Y).toBeCloseTo(1, 9);
      expect(LOGO_CENTER_Y).toBeCloseTo(LOGO_BOTTOM_Y - 6, 9);
      expect(LOGO_TOP_Y).toBeCloseTo(304.25, 9);
      expect(LOGO_MAX_WIDTH).toBe(64);
      // 3 倍輸出時落在整數像素
      expect(Math.abs(box.x * 3 - Math.round(box.x * 3))).toBeLessThan(1e-9);
      expect(Math.abs(box.y * 3 - Math.round(box.y * 3))).toBeLessThan(1e-9);
      // 在內框之內（左右內緣 6.75～213.25）
      expect(box.x).toBeGreaterThan(6.75);
      expect(right).toBeLessThan(220 - 6.75);

      // 實際畫出的矩形都在這個方塊內；logo 實際貼圖：置中 x＝110、下緣離內框 1、與 QR 不重疊
      const main = makeFakeCtx();
      await renderPlayerCardPng(model(), 'light', labels, renderDeps(main, async () => matrix), { qrText: PROFILE_URL });
      const qrRects = main.rects.filter((r) => r.style === '#FFFFFF' || r.style === '#412402');
      expect(qrRects.length).toBeGreaterThan(1);
      for (const r of qrRects) {
        expect(r.x).toBeGreaterThanOrEqual(box.x - 1e-9);
        expect(r.y).toBeGreaterThanOrEqual(box.y - 1e-9);
        expect(r.x + r.w).toBeLessThanOrEqual(right + 1e-9);
        expect(r.y + r.h).toBeLessThanOrEqual(bottom + 1e-9);
      }
      const logoDraw = main.images.find((i) => i.image === logoImg)!;
      const [lx, ly, lw, lh] = logoDraw.args as [number, number, number, number];
      expect(lh).toBe(12);
      expect(lw).toBeCloseTo(60, 9); // 400×80 照比例 → 12×5，未超過上限 64
      expect(lx + lw / 2).toBeCloseTo(110, 9);
      expect(ly + lh).toBeCloseTo(INNER_FRAME_INNER_EDGE_Y - 1, 9);
      expect(ly).toBeGreaterThanOrEqual(bottom); // 不與 QR 重疊
    });
  });

  it('browserCreateQrMatrix 用錯誤修正 L：個人名片網址得到 33 模組（M 會是 37）', async () => {
    const url = 'https://miniapp.line.me/2009525300-AuPGQ0sh?profile=U0123456789abcdef0123456789abcdef';
    const matrix = await browserCreateQrMatrix(url);
    expect(matrix?.size).toBe(33);
    const mod = (await import('qrcode')) as unknown as {
      create: (t: string, o: { errorCorrectionLevel: string }) => { modules: { size: number } };
    };
    expect(mod.create(url, { errorCorrectionLevel: 'M' }).modules.size).toBe(37);
  });

  it('QR 在反光之後繪製（反光不蓋住 QR）', async () => {
    const mod = (await import('qrcode')) as unknown as {
      create: (t: string, o: { errorCorrectionLevel: 'L' }) => { modules: QrMatrix };
    };
    const matrix = mod.create('https://miniapp.line.me/x?profile=U1', { errorCorrectionLevel: 'L' }).modules;
    const fake = makeFakeCtx();
    drawPlayerCard(fake.ctx as unknown as CanvasRenderingContext2D, model(), 'light', labels, {
      avatar: null,
      logo: logoImg,
      qr: matrix,
    });
    const shine = fake.rects.filter((r) => typeof r.style === 'object' && r.style !== null);
    expect(shine).toHaveLength(2); // 淺色正面兩層
    const qrRects = fake.rects.filter((r) => r.style === '#FFFFFF' || r.style === '#412402');
    expect(qrRects.length).toBeGreaterThan(1);
    expect(Math.min(...qrRects.map((r) => r.seq))).toBeGreaterThan(Math.max(...shine.map((r) => r.seq)));
    // QR 不受 soft-light 影響
    expect(qrRects.every((r) => r.composite === 'source-over')).toBe(true);
  });

  it('PNG 固定斜光：115deg 漸層線、停點與疊加方式完全取自共用常數（淺深各自），soft-light 畫完還原', () => {
    const g = playerCardShineGeometry(220, 324);
    for (const theme of ['light', 'dark'] as const) {
      const fake = makeFakeCtx();
      drawPlayerCard(fake.ctx as unknown as CanvasRenderingContext2D, model(), theme, labels, { avatar: null, logo: logoImg });
      const layers = playerCardShineLayers(theme, 'front');
      const shineGradients = fake.gradients.filter((gr) => gr.args.join(',') === [g.x0, g.y0, g.x1, g.y1].join(','));
      expect(shineGradients).toHaveLength(layers.length);
      shineGradients.forEach((gr, i) => expect(gr.stops).toEqual(playerCardShineCanvasStops(layers[i]!)));
      const shineRects = fake.rects.filter((r) => typeof r.style === 'object' && r.style !== null);
      expect(shineRects.map((r) => r.style)).toEqual(shineGradients);
      expect(shineRects.map((r) => r.composite)).toEqual(
        layers.map((l) => (l.blend === 'soft-light' ? 'soft-light' : 'source-over')),
      );
      shineRects.forEach((r) => expect([r.x, r.y, r.w, r.h]).toEqual([0, 0, 220, 324]));
      // 畫完還原 composite
      expect(fake.ctx.globalCompositeOperation).toBe('source-over');
    }
    // 淺色有 soft-light 層，深色沒有
    expect(playerCardShineLayers('light', 'front').some((l) => l.blend === 'soft-light')).toBe(true);
    expect(playerCardShineLayers('dark', 'front').some((l) => l.blend === 'soft-light')).toBe(false);
  });
});

describe('球員卡身分圖案（PNG）', () => {
  class FakePath2D {
    constructor(public d: string) {}
  }

  function motifModel(role: string, gender: string) {
    return buildPlayerCardModel({ name: '林雅婷', avatarUrl: null, summary: null, role, gender });
  }

  function instrument() {
    const fake = makeFakeCtx();
    const calls: string[] = [];
    const strokes: Array<{ d: string; style: unknown; alpha: number }> = [];
    const pathFills: Array<{ d: string; style: unknown }> = [];
    const clipRects: Array<[number, number]> = [];
    let lastPoints: Array<[number, number]> = [];
    const c = fake.ctx as Record<string, unknown>;
    const origMove = c['moveTo'] as (x: number, y: number) => void;
    c['moveTo'] = (x: number, y: number) => { lastPoints.push([x, y]); origMove(x, y); };
    const origBegin = c['beginPath'] as () => void;
    c['beginPath'] = () => { lastPoints = []; origBegin(); };
    c['globalAlpha'] = 1;
    c['clip'] = () => { calls.push('clip'); clipRects.push(lastPoints[0] ?? [NaN, NaN]); };
    c['translate'] = (x: number, y: number) => calls.push(`translate:${x},${y}`);
    c['setLineDash'] = vi.fn();
    const origFill = c['fill'] as () => void;
    c['fill'] = (p?: unknown) => {
      if (p instanceof FakePath2D) pathFills.push({ d: p.d, style: c['fillStyle'] });
      else origFill();
    };
    c['stroke'] = (p?: unknown) => {
      if (p instanceof FakePath2D) strokes.push({ d: p.d, style: c['strokeStyle'], alpha: c['globalAlpha'] as number });
    };
    const origGrad = c['createLinearGradient'] as (...a: number[]) => unknown;
    c['createLinearGradient'] = (...a: number[]) => { calls.push('shine'); return origGrad(...a); };
    return { fake, calls, strokes, pathFills, clipRects };
  }

  beforeEach(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('教練・女：drawMotif 在斜光之前、先裁切右下圓角再畫粉色戰術板與花瓣', () => {
    const t = instrument();
    drawPlayerCard(t.fake.ctx as unknown as CanvasRenderingContext2D, motifModel('coach', '女'), 'light', labels, {
      avatar: null,
      logo: logoImg,
    });
    const translateAt = t.calls.indexOf('translate:162,264');
    expect(translateAt).toBeGreaterThan(-1);
    expect(t.calls[translateAt - 1]).toBe('clip');
    // 斜光漸層在圖案之後
    expect(t.calls.lastIndexOf('shine')).toBeGreaterThan(translateAt);
    // 裁切框：(162-200+11.25, 264-300) 起點＝roundRectPath 的 moveTo(x + r, y)
    expect(t.clipRects).toContainEqual([162 - 200 + 11.25, 264 - 300]);
    const strokeColors = t.strokes.map((s) => s.style);
    expect(strokeColors).toContain(MOTIF_PALETTES.pink.light.line);
    expect(strokeColors).toContain(MOTIF_PALETTES.pink.light.petalEdge);
    expect(t.pathFills.map((f) => f.style)).toContain(MOTIF_PALETTES.pink.light.petal);
    expect(t.strokes.length + t.pathFills.length).toBeGreaterThan(PLAYER_CARD_MOTIFS.board.length);
  });

  it('一般用戶・女（深色）：櫻花枝金枝粉花瓣；一般用戶・男不畫', () => {
    const t = instrument();
    drawPlayerCard(t.fake.ctx as unknown as CanvasRenderingContext2D, motifModel('user', '女'), 'dark', labels, { avatar: null, logo: null });
    expect(t.strokes.map((s) => s.style)).toContain(MOTIF_PALETTES.gold.dark.line);
    expect(t.pathFills.map((f) => f.style)).toContain(MOTIF_PALETTES.gold.dark.petal);

    const m = instrument();
    drawPlayerCard(m.fake.ctx as unknown as CanvasRenderingContext2D, motifModel('user', '男'), 'dark', labels, { avatar: null, logo: null });
    expect(m.calls.some((c) => c.startsWith('translate:'))).toBe(false);
    expect(m.strokes).toHaveLength(0);
  });

  it('不支援 Path2D 的環境略過圖案、照常產圖', () => {
    vi.stubGlobal('Path2D', undefined);
    const t = instrument();
    expect(() => drawMotif(t.fake.ctx as unknown as CanvasRenderingContext2D, { key: 'laurel', palette: 'gold' }, 'light')).not.toThrow();
    expect(t.calls).toHaveLength(0);
  });
});
