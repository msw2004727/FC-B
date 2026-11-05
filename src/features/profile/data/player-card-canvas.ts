/**
 * T-092 球員卡 PNG：Canvas 2D 手繪（不引入 html-to-image 類套件），與 DOM 卡片共用 player-card-model。
 * 只在按「分享球員卡」時動態載入，不進首屏。
 *
 * 大頭照跨網域：LINE 大頭照（profile.line-scdn.net 等）或 Storage 圖若沒回 CORS 標頭，畫進 canvas 會讓它 tainted、
 * 無法輸出 PNG。這裡一律以 crossOrigin='anonymous' 載入，載入失敗或試畫後 getImageData 丟錯（tainted）
 * 就改畫預設頭像；不為此新增代理或改正式設定（另卡由顧問裁定）。
 * PNG 不含 UID、email、LINE ID：模型本身就沒有這些欄位。
 */
import {
  PLAYER_CARD_ABBR,
  PLAYER_CARD_BODY_FONT,
  PLAYER_CARD_DISPLAY_FONT,
  PLAYER_CARD_PALETTES,
  PLAYER_CARD_SIZE,
  playerCardLogoUrl,
  type PlayerCardModel,
  type PlayerCardPalette,
  type PlayerCardTheme,
} from './player-card-model';

export interface PlayerCardLabels {
  title: string;
  scheduled: string;
  completed: string;
  attend: string;
  clubs: string;
}

export interface DrawableImage {
  width: number;
  height: number;
}

type Ctx = CanvasRenderingContext2D;

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): Ctx | null;
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

export interface PlayerCardRenderDeps {
  createCanvas: (width: number, height: number) => CanvasLike;
  /** 載入失敗回 null；crossOrigin＝true 時以 anonymous 模式載入。 */
  loadImage: (url: string, crossOrigin: boolean) => Promise<DrawableImage | null>;
  ensureFonts: () => Promise<void>;
}

/** 2x～3x：220×324 × 3 ＝ 660×972。 */
export const PLAYER_CARD_PNG_SCALE = 3;

const AVATAR = { cx: 110, cy: 112, outer: 50, inner: 46.5, photo: 43 } as const;
const GAUGE = { x: 44, y: 204, width: 132, height: 4 } as const;
const STAT_COLUMNS = [44, 110, 176] as const;
const STRIPE_STEP = 9 * Math.SQRT2; // 與 CSS repeating-linear-gradient(45deg) 間距 9 對齊
const STRIPE_WIDTH = 1.5;

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function setLetterSpacing(ctx: Ctx, px: number): void {
  // 舊版 Safari 沒有 letterSpacing：略過即可，不影響內容。
  if ('letterSpacing' in ctx) {
    (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${px}px`;
  }
}

function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = 'center',
  spacing = 0,
): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  setLetterSpacing(ctx, spacing);
  ctx.fillText(value, x, y);
  setLetterSpacing(ctx, 0);
}

function displayFont(size: number): string {
  return `400 ${size}px ${PLAYER_CARD_DISPLAY_FONT}`;
}

function bodyFont(size: number, weight = 700): string {
  return `${weight} ${size}px ${PLAYER_CARD_BODY_FONT}`;
}

function drawBackground(ctx: Ctx, p: PlayerCardPalette): void {
  const { width: W, height: H, radius } = PLAYER_CARD_SIZE;
  ctx.save();
  roundRectPath(ctx, 0, 0, W, H, radius);
  ctx.fillStyle = p.base;
  ctx.fill();
  ctx.clip();

  // 45 度細斜紋（只有斜紋，不加其他圖騰）。
  ctx.strokeStyle = p.stripe;
  ctx.lineWidth = STRIPE_WIDTH;
  ctx.beginPath();
  for (let d = -H; d < W + H; d += STRIPE_STEP) {
    ctx.moveTo(d, 0);
    ctx.lineTo(d + H, H);
  }
  ctx.stroke();
  ctx.restore();

  // 外緣 1px 框。
  ctx.save();
  roundRectPath(ctx, 0.5, 0.5, W - 1, H - 1, radius - 0.5);
  ctx.strokeStyle = p.outerBorder;
  ctx.lineWidth = 1;
  ctx.stroke();
  // 內框：固定離卡邊 6px、1.5px。
  roundRectPath(ctx, 6, 6, W - 12, H - 12, radius - 6);
  ctx.strokeStyle = p.innerFrame;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawHeader(ctx: Ctx, model: PlayerCardModel, labels: PlayerCardLabels, p: PlayerCardPalette): void {
  // 左上：出席率大數字＋ATT。
  text(ctx, model.attendText, 18, 44, displayFont(32), p.text, 'left');
  text(ctx, PLAYER_CARD_ABBR.attend, 19, 56, displayFont(10), p.subText, 'left', 1.5);
  // 右上：球員卡＋PLAYER CARD。
  text(ctx, labels.title, 202, 30, bodyFont(12), p.text, 'right', 1);
  text(ctx, PLAYER_CARD_ABBR.title, 202, 42, displayFont(8), p.subText, 'right', 1.2);
}

function drawDefaultAvatar(ctx: Ctx, p: PlayerCardPalette): void {
  const { cx, cy, photo } = AVATAR;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, photo, 0, Math.PI * 2);
  ctx.fillStyle = p.gaugeTrack;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = p.gold;
  ctx.beginPath();
  ctx.arc(cx, cy - 8, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy + 30, 27, 21, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAvatar(ctx: Ctx, avatar: DrawableImage | null, p: PlayerCardPalette): void {
  const { cx, cy, outer, inner, photo } = AVATAR;
  // 兩層外圈：外＝主金色，內＝白／深底色。
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.fillStyle = p.gold;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fillStyle = p.avatarInnerRing;
  ctx.fill();

  if (!avatar || !(avatar.width > 0) || !(avatar.height > 0)) {
    drawDefaultAvatar(ctx, p);
    return;
  }
  // object-fit: cover
  const side = Math.min(avatar.width, avatar.height);
  const sx = (avatar.width - side) / 2;
  const sy = (avatar.height - side) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, photo, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(avatar as CanvasImageSource, sx, sy, side, side, cx - photo, cy - photo, photo * 2, photo * 2);
  ctx.restore();
}

function drawClubBadge(ctx: Ctx, model: PlayerCardModel, labels: PlayerCardLabels, p: PlayerCardPalette): void {
  if (!model.showClubBadge) return;
  const w = model.clubBadgeWide ? 44 : 36;
  const h = 32;
  // 頭像外圈右側偏中下，破格壓在外圈上。
  const x = AVATAR.cx + 30;
  const y = AVATAR.cy + 14;
  roundRectPath(ctx, x, y, w, h, 7);
  ctx.fillStyle = p.clubBg;
  ctx.fill();
  ctx.strokeStyle = p.base; // 外描一圈卡面底色
  ctx.lineWidth = 2.5;
  ctx.stroke();
  text(ctx, labels.clubs, x + w / 2, y + 12, bodyFont(7.5), p.clubText, 'center');
  text(ctx, String(model.clubCount), x + w / 2, y + 27, displayFont(15), p.clubText, 'center');
}

function drawNameAndGauge(ctx: Ctx, model: PlayerCardModel, p: PlayerCardPalette): void {
  ctx.save();
  ctx.font = bodyFont(15);
  // 名字過長時縮字，不超出內框。
  let size = 15;
  setLetterSpacing(ctx, 2);
  while (size > 9 && ctx.measureText(model.name).width > 176) {
    size -= 1;
    ctx.font = bodyFont(size);
  }
  setLetterSpacing(ctx, 0);
  ctx.restore();
  text(ctx, model.name, 110, 190, bodyFont(size), p.text, 'center', 2);

  roundRectPath(ctx, GAUGE.x, GAUGE.y, GAUGE.width, GAUGE.height, GAUGE.height / 2);
  ctx.fillStyle = p.gaugeTrack;
  ctx.fill();
  const fillWidth = GAUGE.width * Math.min(1, Math.max(0, model.gaugeRatio));
  if (fillWidth > 0) {
    roundRectPath(ctx, GAUGE.x, GAUGE.y, fillWidth, GAUGE.height, GAUGE.height / 2);
    ctx.fillStyle = p.gold;
    ctx.fill();
  }
}

function drawStats(ctx: Ctx, model: PlayerCardModel, labels: PlayerCardLabels, p: PlayerCardPalette): void {
  const cells: Array<[string, string, string]> = [
    [model.scheduledText, labels.scheduled, PLAYER_CARD_ABBR.scheduled],
    [model.completedText, labels.completed, PLAYER_CARD_ABBR.completed],
    [model.attendText, labels.attend, PLAYER_CARD_ABBR.attend],
  ];
  cells.forEach(([value, label, abbr], index) => {
    const x = STAT_COLUMNS[index] ?? 110;
    text(ctx, value, x, 240, displayFont(22), p.text, 'center');
    text(ctx, label, x, 254, bodyFont(8.5), p.text, 'center');
    text(ctx, abbr, x, 264, displayFont(7.5), p.subText, 'center', 1);
  });
  ctx.strokeStyle = p.stripe;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of [77, 143]) {
    ctx.moveTo(x, 224);
    ctx.lineTo(x, 264);
  }
  ctx.stroke();
}

function drawLogo(ctx: Ctx, logo: DrawableImage | null, p: PlayerCardPalette): void {
  const centerY = 295;
  if (logo && logo.width > 0 && logo.height > 0) {
    const h = 14;
    const w = Math.min(96, (logo.width / logo.height) * h);
    ctx.drawImage(logo as CanvasImageSource, 110 - w / 2, centerY - h / 2, w, h);
    return;
  }
  // logo 載入失敗時退回文字商標。
  text(ctx, 'ToosterX', 110, centerY + 5, displayFont(14), p.text, 'center', 1);
}

function drawShine(ctx: Ctx): void {
  // PNG 只有一道固定淡斜光。
  const { width: W, height: H, radius } = PLAYER_CARD_SIZE;
  ctx.save();
  roundRectPath(ctx, 0, 0, W, H, radius);
  ctx.clip();
  const g = ctx.createLinearGradient(30, 0, 150, H);
  g.addColorStop(0, 'rgba(255, 248, 225, 0)');
  g.addColorStop(0.42, 'rgba(255, 248, 225, 0)');
  g.addColorStop(0.5, 'rgba(255, 248, 225, 0.22)');
  g.addColorStop(0.58, 'rgba(255, 248, 225, 0)');
  g.addColorStop(1, 'rgba(255, 248, 225, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** 同步把整張卡畫到 ctx（已縮放成卡面原始座標）。 */
export function drawPlayerCard(
  ctx: Ctx,
  model: PlayerCardModel,
  theme: PlayerCardTheme,
  labels: PlayerCardLabels,
  assets: { avatar: DrawableImage | null; logo: DrawableImage | null },
): void {
  const p = PLAYER_CARD_PALETTES[theme];
  drawBackground(ctx, p);
  drawHeader(ctx, model, labels, p);
  drawAvatar(ctx, assets.avatar, p);
  drawClubBadge(ctx, model, labels, p);
  drawNameAndGauge(ctx, model, p);
  drawStats(ctx, model, labels, p);
  drawLogo(ctx, assets.logo, p);
  drawShine(ctx);
}

/**
 * 跨網域大頭照：試畫到 1×1 暫存 canvas 再讀像素，丟錯代表 tainted，改用預設頭像。
 */
export async function loadSafeAvatar(
  url: string | null,
  deps: Pick<PlayerCardRenderDeps, 'createCanvas' | 'loadImage'>,
): Promise<DrawableImage | null> {
  if (!url) return null;
  const image = await deps.loadImage(url, true).catch(() => null);
  if (!image) return null;
  try {
    const probe = deps.createCanvas(1, 1);
    const ctx = probe.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image as CanvasImageSource, 0, 0, 1, 1);
    ctx.getImageData(0, 0, 1, 1);
    return image;
  } catch {
    return null;
  }
}

function browserLoadImage(url: string, crossOrigin: boolean): Promise<DrawableImage | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** 產 PNG 前要確認載入的自架字型（player-card.css 的 @font-face 'Bebas Neue'）與卡面會出現的字元。 */
export const PLAYER_CARD_FONT_LOAD = {
  font: "400 32px 'Bebas Neue'",
  text: '0123456789%-ACDELMPRSTYHoserX',
} as const;

export interface FontFaceSetLike {
  load: (font: string, text?: string) => Promise<unknown>;
}

export async function ensurePlayerCardFonts(
  fonts: FontFaceSetLike | undefined,
  timeoutMs = 1500,
): Promise<void> {
  if (!fonts || typeof fonts.load !== 'function') return;
  let load: Promise<void>;
  try {
    load = fonts.load(PLAYER_CARD_FONT_LOAD.font, PLAYER_CARD_FONT_LOAD.text).then(() => undefined, () => undefined);
  } catch {
    return;
  }
  // 字型載不到也不能卡住分享：最多等 1.5 秒，之後用退回字型畫。
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([load, timeout]);
  if (timer !== undefined) clearTimeout(timer);
}

function browserEnsureFonts(): Promise<void> {
  return ensurePlayerCardFonts(typeof document !== 'undefined' ? document.fonts : undefined);
}

export const browserRenderDeps: PlayerCardRenderDeps = {
  createCanvas: (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  loadImage: browserLoadImage,
  ensureFonts: browserEnsureFonts,
};

export async function renderPlayerCardPng(
  model: PlayerCardModel,
  theme: PlayerCardTheme,
  labels: PlayerCardLabels,
  deps: PlayerCardRenderDeps = browserRenderDeps,
): Promise<Blob> {
  const [, avatar, logo] = await Promise.all([
    deps.ensureFonts(),
    loadSafeAvatar(model.avatarUrl, deps),
    deps.loadImage(playerCardLogoUrl(theme), false).catch(() => null),
  ]);
  const scale = PLAYER_CARD_PNG_SCALE;
  const canvas = deps.createCanvas(PLAYER_CARD_SIZE.width * scale, PLAYER_CARD_SIZE.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  ctx.scale(scale, scale);
  drawPlayerCard(ctx, model, theme, labels, { avatar, logo });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas toBlob failed'));
    }, 'image/png');
  });
}
