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
  PLAYER_CARD_SHINE,
  PLAYER_CARD_SIZE,
  playerCardLogoUrl,
  playerCardShineCanvasStops,
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
  /** 本機產 QR 模組矩陣（R-SHARE-013 禁外部服務）；失敗回 null，PNG 照常輸出、不放 QR。 */
  createQrMatrix?: (text: string) => Promise<QrMatrix | null>;
}

/** QR 模組矩陣（qrcode 套件 `create().modules` 的子集）。 */
export interface QrMatrix {
  size: number;
  get: (row: number, col: number) => boolean | number;
}

export interface PlayerCardRenderOptions {
  /** 個人名片分享網址（只有本人的球員卡才給）；null／空＝不放 QR。 */
  qrText?: string | null;
}

/**
 * PNG 左下 QR：每模組固定 2 實際像素（卡面 2/3 單位，3 倍輸出時剛好對齊像素格，不糊），
 * 四周 4 模組 quiet zone（QR 標準最小值；取代原本 2 模組，複審 P3）。
 * 位置（站長定案，取代原本左緣 x=14、底緣對齊 logo 底線）：中心 x＝三格第一欄「應到」欄中心，中心 y＝底部 logo 中心。
 * 版本 4（33 模組，錯誤修正 L）時整塊 41×2＝82px，約卡面 27.3 單位：x 30.33～57.67、y 281.33～308.67（3 倍輸出 91～173、844～926px）。
 */
export const QR_MODULE_PX = 2;
export const QR_QUIET_MODULES = 4;
export const LOGO_CENTER_Y = 295;
export const LOGO_HEIGHT = 14;
/** 三格欄中心 x（卡面單位）：分隔線在 77／143。 */
export const STAT_COLUMNS = [44, 110, 176] as const;

export interface QrLayout {
  /** quiet zone 外框（卡面單位）。 */
  box: { x: number; y: number; size: number };
  /** 每模組卡面單位。 */
  module: number;
}

export function qrLayout(moduleCount: number, scale: number = PLAYER_CARD_PNG_SCALE): QrLayout {
  const module = QR_MODULE_PX / scale;
  const size = (moduleCount + QR_QUIET_MODULES * 2) * module;
  // 中心對齊「應到」欄中心 x 與 logo 中心 y。
  return { box: { x: STAT_COLUMNS[0] - size / 2, y: LOGO_CENTER_Y - size / 2, size }, module };
}

/** 2x～3x：220×324 × 3 ＝ 660×972。 */
export const PLAYER_CARD_PNG_SCALE = 3;

const AVATAR = { cx: 110, cy: 112, outer: 50, inner: 46.5, photo: 43 } as const;
const GAUGE = { x: 44, y: 204, width: 132, height: 4 } as const;
const STRIPE_STEP = 9 * Math.SQRT2; // 與 CSS repeating-linear-gradient(45deg) 間距 9 對齊
const STRIPE_WIDTH = 1.5;
/** 三格欄寬 66（分隔線 77／143）左右各留 3。 */
export const STAT_CELL_MAX_WIDTH = 60;
export const NAME_MAX_WIDTH = 176;
export const HEADER_TITLE_MAX_WIDTH = 100;

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

/** 縮字下限：越南文、泰文等長標籤縮到這裡仍超寬就照畫（不截字）。 */
const MIN_FONT_SIZE = 5;

/**
 * 畫一段文字；給 maxWidth 時用 measureText 由 size 往下縮到放得進欄寬
 * （越南文、泰文的「出席率」「俱樂部」比中文長很多，固定字級會超框）。
 */
function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  font: (size: number) => string,
  size: number,
  color: string,
  align: CanvasTextAlign = 'center',
  spacing = 0,
  maxWidth?: number,
): void {
  let fitted = size;
  ctx.font = font(fitted);
  setLetterSpacing(ctx, spacing);
  if (maxWidth !== undefined) {
    while (fitted > MIN_FONT_SIZE && ctx.measureText(value).width > maxWidth) {
      fitted = Math.max(MIN_FONT_SIZE, fitted - 0.5);
      ctx.font = font(fitted);
    }
  }
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
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
  text(ctx, model.attendText, 18, 44, displayFont, 32, p.text, 'left', 0, 80);
  text(ctx, PLAYER_CARD_ABBR.attend, 19, 56, displayFont, 10, p.subText, 'left', 1.5);
  // 右上：球員卡＋PLAYER CARD。
  text(ctx, labels.title, 202, 30, bodyFont, 12, p.text, 'right', 1, HEADER_TITLE_MAX_WIDTH);
  text(ctx, PLAYER_CARD_ABBR.title, 202, 42, displayFont, 8, p.subText, 'right', 1.2);
}

/** 沒有頭像（或載入失敗、tainted）：與畫面 LegacyAvatar 一致，金色漸層圓底＋白色姓名首字。 */
function drawDefaultAvatar(ctx: Ctx, initial: string): void {
  const { cx, cy, photo } = AVATAR;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, photo, 0, Math.PI * 2);
  const g = ctx.createLinearGradient(cx - photo, cy - photo, cx + photo, cy + photo);
  g.addColorStop(0, '#EF9F27');
  g.addColorStop(1, '#854F0B');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.font = bodyFont(30, 800);
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initial, cx, cy + 1);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function drawAvatar(ctx: Ctx, avatar: DrawableImage | null, initial: string, p: PlayerCardPalette): void {
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
    drawDefaultAvatar(ctx, initial);
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
  // 方塊內留 3px 邊：標籤與數字都縮到放得進。
  const inner = w - 6;
  text(ctx, labels.clubs, x + w / 2, y + 12, bodyFont, 7.5, p.clubText, 'center', 0, inner);
  text(ctx, String(model.clubCount), x + w / 2, y + 27, displayFont, 15, p.clubText, 'center', 0, inner);
}

function drawNameAndGauge(ctx: Ctx, model: PlayerCardModel, p: PlayerCardPalette): void {
  // 名字過長時縮字，不超出內框。
  text(ctx, model.name, 110, 190, bodyFont, 15, p.text, 'center', 2, NAME_MAX_WIDTH);

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
    text(ctx, value, x, 240, displayFont, 22, p.text, 'center', 0, STAT_CELL_MAX_WIDTH);
    text(ctx, label, x, 254, bodyFont, 8.5, p.text, 'center', 0, STAT_CELL_MAX_WIDTH);
    text(ctx, abbr, x, 264, displayFont, 7.5, p.subText, 'center', 1, STAT_CELL_MAX_WIDTH);
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
  const centerY = LOGO_CENTER_Y;
  if (logo && logo.width > 0 && logo.height > 0) {
    const h = LOGO_HEIGHT;
    const w = Math.min(96, (logo.width / logo.height) * h);
    ctx.drawImage(logo as CanvasImageSource, 110 - w / 2, centerY - h / 2, w, h);
    return;
  }
  // logo 載入失敗時退回文字商標。
  text(ctx, 'ToosterX', 110, centerY + 5, displayFont, 14, p.text, 'center', 1);
}

function drawQr(ctx: Ctx, qr: QrMatrix, p: PlayerCardPalette): void {
  const { box, module } = qrLayout(qr.size);
  ctx.fillStyle = p.qrBg;
  ctx.fillRect(box.x, box.y, box.size, box.size);
  ctx.fillStyle = p.qrFg;
  const origin = QR_QUIET_MODULES * module;
  for (let row = 0; row < qr.size; row++) {
    for (let col = 0; col < qr.size; col++) {
      if (qr.get(row, col)) {
        ctx.fillRect(box.x + origin + col * module, box.y + origin + row * module, module, module);
      }
    }
  }
}

function drawShine(ctx: Ctx, theme: PlayerCardTheme): void {
  // PNG 只有一道固定淡斜光；參數與網頁掃光共用 PLAYER_CARD_SHINE（player-card-model.ts）。
  const { width: W, height: H, radius } = PLAYER_CARD_SIZE;
  const { from, to } = PLAYER_CARD_SHINE;
  ctx.save();
  roundRectPath(ctx, 0, 0, W, H, radius);
  ctx.clip();
  const g = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  for (const [offset, color] of playerCardShineCanvasStops(theme)) g.addColorStop(offset, color);
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
  assets: { avatar: DrawableImage | null; logo: DrawableImage | null; qr?: QrMatrix | null },
): void {
  const p = PLAYER_CARD_PALETTES[theme];
  drawBackground(ctx, p);
  drawHeader(ctx, model, labels, p);
  drawAvatar(ctx, assets.avatar, model.avatarInitial, p);
  drawClubBadge(ctx, model, labels, p);
  drawNameAndGauge(ctx, model, p);
  drawStats(ctx, model, labels, p);
  drawLogo(ctx, assets.logo, p);
  drawShine(ctx, theme);
  // QR 畫在反光之後，避免斜光降低對比影響掃描。
  if (assets.qr && assets.qr.size > 0) drawQr(ctx, assets.qr, p);
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

/** 圖片（頭像、logo）載入逾時：慢網路不能卡住分享，逾時當作載入失敗（頭像改畫首字）。 */
export const PLAYER_CARD_IMAGE_TIMEOUT_MS = 3000;

export function browserLoadImage(
  url: string,
  crossOrigin: boolean,
  timeoutMs: number = PLAYER_CARD_IMAGE_TIMEOUT_MS,
): Promise<DrawableImage | null> {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (value: DrawableImage | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(value);
    };
    const timer = setTimeout(() => {
      finish(null);
      img.removeAttribute('src'); // 停止下載
    }, timeoutMs);
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
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

/** 本機 qrcode 套件（lazy import，與 data/qr.ts 同一套件）；錯誤修正 L 以取得最小版本。 */
export async function browserCreateQrMatrix(text: string): Promise<QrMatrix | null> {
  type CreateFn = (value: string, options: { errorCorrectionLevel: 'L' }) => { modules: QrMatrix };
  const mod = (await import('qrcode')) as unknown as { create?: CreateFn; default?: { create?: CreateFn } };
  const create = mod.create || mod.default?.create;
  if (typeof create !== 'function') return null;
  return create(text, { errorCorrectionLevel: 'L' }).modules;
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
  createQrMatrix: browserCreateQrMatrix,
};

export async function renderPlayerCardPng(
  model: PlayerCardModel,
  theme: PlayerCardTheme,
  labels: PlayerCardLabels,
  deps: PlayerCardRenderDeps = browserRenderDeps,
  options: PlayerCardRenderOptions = {},
): Promise<Blob> {
  const qrText = typeof options.qrText === 'string' ? options.qrText.trim() : '';
  const loadQr = async (): Promise<QrMatrix | null> => {
    if (!qrText || !deps.createQrMatrix) return null;
    try {
      return await deps.createQrMatrix(qrText);
    } catch {
      return null; // QR 失敗不中斷分享
    }
  };
  const [, avatar, logo, qr] = await Promise.all([
    deps.ensureFonts(),
    loadSafeAvatar(model.avatarUrl, deps),
    deps.loadImage(playerCardLogoUrl(theme), false).catch(() => null),
    loadQr(),
  ]);
  const scale = PLAYER_CARD_PNG_SCALE;
  const canvas = deps.createCanvas(PLAYER_CARD_SIZE.width * scale, PLAYER_CARD_SIZE.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  ctx.scale(scale, scale);
  drawPlayerCard(ctx, model, theme, labels, { avatar, logo, qr });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas toBlob failed'));
    }, 'image/png');
  });
}
