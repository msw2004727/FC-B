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
  playerCardShineCanvasStops,
  playerCardShineGeometry,
  playerCardShineLayers,
  type PlayerCardModel,
  type PlayerCardPalette,
  type PlayerCardTheme,
} from './player-card-model';
import {
  PLAYER_CARD_MOTIF_BOX,
  playerCardMotifColors,
  playerCardMotifStrokes,
  type PlayerCardMotif,
} from './player-card-motifs';

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
 * PNG 的 QR：每模組固定 2 實際像素（卡面 2/3 單位，3 倍輸出時剛好對齊像素格，不糊），
 * 四周 4 模組 quiet zone（QR 標準最小值；取代原本 2 模組，複審 P3）。
 * 位置（站長 11-06 定案，取代原本左下 QR＋logo 中心 298）：中心 x＝三格第二欄「完成 CMP」欄中心（STAT_COLUMNS[1]＝110），
 * 垂直放在「CMP 縮寫字下緣」與「logo 上緣」正中央，上下留白相等；大小依 QR 模組數動態計算（版本 4＝33 模組時整塊 82px、約 27.33 單位）。
 */
export const QR_MODULE_PX = 2;
export const QR_QUIET_MODULES = 4;
/*
 * 以下版面數字照站長核可預覽（flip-sheen-preview.html，卡面 220×324）實測：文字給基線 y、區塊給框；
 * 取代 11-05 先前自訂的字級與位置（字偏小、頭像偏低、計量條較短）。網頁卡面 player-card.css 為同一組 ×1.1。
 */
/** 內框：離卡邊 6、線寬 1.5（drawBackground 與 logo 下緣共用）。內框內緣＝卡高 − 6 − 0.75＝317.25。 */
const INNER_FRAME = { inset: 6, stroke: 1.5 } as const;
export const INNER_FRAME_INNER_EDGE_Y = PLAYER_CARD_SIZE.height - INNER_FRAME.inset - INNER_FRAME.stroke / 2;
/**
 * logo（站長 11-06 定案，取代原本高 18、中心 y 298）：高 12、水平置中 x＝110，下緣離內框內緣只留 1 單位（＝316.25），
 * 中心 y＝310.25、上緣 304.25；寬度照比例，上限 96×12/18＝64。
 */
export const LOGO_HEIGHT = 12;
export const LOGO_BOTTOM_GAP = 1;
export const LOGO_MAX_WIDTH = 64;
export const LOGO_BOTTOM_Y = INNER_FRAME_INNER_EDGE_Y - LOGO_BOTTOM_GAP;
export const LOGO_TOP_Y = LOGO_BOTTOM_Y - LOGO_HEIGHT;
export const LOGO_CENTER_Y = LOGO_BOTTOM_Y - LOGO_HEIGHT / 2;
/** 三格欄中心 x（卡面單位）：三格寬 186（17～203）均分，分隔線在 79／141。 */
export const STAT_COLUMNS = [48, 110, 172] as const;

export interface QrLayout {
  /** quiet zone 外框（卡面單位）。 */
  box: { x: number; y: number; size: number };
  /** 每模組卡面單位。 */
  module: number;
}

export function qrLayout(moduleCount: number, scale: number = PLAYER_CARD_PNG_SCALE): QrLayout {
  const module = QR_MODULE_PX / scale;
  const size = (moduleCount + QR_QUIET_MODULES * 2) * module;
  // 中心 x＝「完成 CMP」欄中心；y＝縮寫字下緣與 logo 上緣的正中央（上下留白相等），
  // 再吸附到輸出像素格（3 倍時最多移 1/6 單位）。
  const x = STAT_COLUMNS[1] - size / 2;
  const y = Math.round(((STATS_ABBR_BOTTOM_Y + LOGO_TOP_Y) / 2 - size / 2) * scale) / scale;
  return { box: { x, y, size }, module };
}

/** 2x～3x：220×324 × 3 ＝ 660×972。 */
export const PLAYER_CARD_PNG_SCALE = 3;

/** 預覽外圈 100（上緣 47）、金圈 4、白圈 3：半徑 50／46／43，圓心 (110, 97)。 */
const AVATAR = { cx: 110, cy: 97, outer: 50, inner: 46, photo: 43 } as const;
/**
 * PNG 人氣星（與畫面同一條路徑與色）。不畫數字、不移動其他元素。
 * 星盒 17、間距 1、五顆水平置中，壓在金圈下緣（破格）：位置與畫面一致，星盒上緣在金圈下緣上方 10
 * （畫面是 bottom:-22 的「星＋間距＋數字」整塊，扣掉數字 11 與間距 4，星盒上緣落在 -10）。
 */
const POP_STAR = {
  size: 17,
  gap: 1,
  viewBox: 24,
  path: 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z',
  fill: '#f5b82e',
  stroke: '#d89a12',
  empty: { light: '#d9dde5', dark: '#4a5266' },
} as const;
/** 預覽計量條與三格同寬（17～203）、高 7、上緣 185。 */
const GAUGE = { x: 17, y: 185, width: 186, height: 7 } as const;
/** 三格：上緣 197、下緣 261（分隔線全高）；數字／中文／縮寫基線。 */
const STATS = { top: 197, bottom: 261, numY: 216, labelY: 234, abbrY: 256, dividers: [79, 141] } as const;
/**
 * 三格縮寫（APP／CMP／ATT，Bebas Neue 11px 全大寫）字下緣：全大寫沒有下伸部，字形下緣＝基線 abbrY（256）加下伸值 0。
 * 站長 11-06 量 11-05 舊 PNG 得 263.7，那是舊版版位（當時基線在 263.7）；現行版位已上移，以現行基線為準。
 * 若日後換成有下伸的字型，把 ABBR_DESCENT 改成該字型的下伸值即可，QR 會自動重新置中。
 */
const ABBR_DESCENT = 0;
const STATS_ABBR_BOTTOM_Y = STATS.abbrY + ABBR_DESCENT;
const STRIPE_STEP = 9 * Math.SQRT2; // 與 CSS repeating-linear-gradient(45deg) 間距 9 對齊
const STRIPE_WIDTH = 1.5;
/** 三格欄寬 62（分隔線 79／141）左右各留 3。 */
export const STAT_CELL_MAX_WIDTH = 56;
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
  roundRectPath(ctx, INNER_FRAME.inset, INNER_FRAME.inset, W - INNER_FRAME.inset * 2, H - INNER_FRAME.inset * 2, radius - INNER_FRAME.inset);
  ctx.strokeStyle = p.innerFrame;
  ctx.lineWidth = INNER_FRAME.stroke;
  ctx.stroke();
  ctx.restore();
}

/** 左上大數字最寬（"100%" 約 75）；超過才縮字。 */
const ATT_NUM_MAX_WIDTH = 84;

function drawHeader(ctx: Ctx, model: PlayerCardModel, labels: PlayerCardLabels, p: PlayerCardPalette): void {
  // 左上：出席率大數字（44）＋ATT（12、字距 2），與預覽一樣兩行以較寬者置中、左緣 17。
  ctx.font = displayFont(44);
  setLetterSpacing(ctx, 0);
  const numWidth = Math.min(ATT_NUM_MAX_WIDTH, ctx.measureText(model.attendText).width);
  ctx.font = displayFont(12);
  setLetterSpacing(ctx, 2);
  const abbrWidth = ctx.measureText(PLAYER_CARD_ABBR.attend).width;
  setLetterSpacing(ctx, 0);
  const attCenter = 17 + Math.max(numWidth, abbrWidth) / 2;
  text(ctx, model.attendText, attCenter, 48, displayFont, 44, p.headline, 'center', 0, ATT_NUM_MAX_WIDTH);
  text(ctx, PLAYER_CARD_ABBR.attend, attCenter, 68.5, displayFont, 12, p.headlineAbbr, 'center', 2);
  // 右上：球員卡（12、字重 500、字距 2）＋PLAYER CARD（11、字距 2），右緣 203。
  text(ctx, labels.title, 203, 29, (s) => bodyFont(s, 500), 12, p.headline, 'right', 2, HEADER_TITLE_MAX_WIDTH);
  text(ctx, PLAYER_CARD_ABBR.title, 203, 46.8, displayFont, 11, p.headlineAbbr, 'right', 2);
}

/** 沒有頭像（或載入失敗、tainted）：與畫面 LegacyAvatar 一致，預覽同款純色圓底＋姓名首字（色見 PlayerCardPalette）。 */
function drawDefaultAvatar(ctx: Ctx, initial: string, p: PlayerCardPalette): void {
  const { cx, cy, photo } = AVATAR;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, photo, 0, Math.PI * 2);
  ctx.fillStyle = p.avatarFill;
  ctx.fill();
  ctx.font = bodyFont(36, 500);
  ctx.fillStyle = p.avatarInitial;
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
    drawDefaultAvatar(ctx, initial, p);
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
  const h = 38;
  // 頭像外圈右側偏中下，破格壓在外圈上（預覽 left 136、top 101、36×38、2px 卡面底色框在方塊內側）。
  const x = AVATAR.cx + 26;
  const y = AVATAR.cy + 4;
  roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, 6);
  ctx.fillStyle = p.clubBg;
  ctx.fill();
  ctx.strokeStyle = p.base; // 外描一圈卡面底色
  ctx.lineWidth = 2;
  ctx.stroke();
  // 方塊內留 3px 邊：標籤與數字都縮到放得進。
  const inner = w - 6;
  text(ctx, labels.clubs, x + w / 2, y + 11.8, (s) => bodyFont(s, 500), 8, p.clubText, 'center', 0, inner);
  text(ctx, String(model.clubCount), x + w / 2, y + 28.2, displayFont, 19, p.clubText, 'center', 0, inner);
}

function drawNameAndGauge(ctx: Ctx, model: PlayerCardModel, p: PlayerCardPalette): void {
  // 名字（17、字重 500、字距 2）過長時縮字，不超出內框。
  text(ctx, model.name, 110, 173, (s) => bodyFont(s, 500), 17, p.text, 'center', 2, NAME_MAX_WIDTH);

  roundRectPath(ctx, GAUGE.x, GAUGE.y, GAUGE.width, GAUGE.height, GAUGE.height / 2);
  ctx.fillStyle = p.gaugeTrack;
  ctx.fill();
  const fillWidth = GAUGE.width * Math.min(1, Math.max(0, model.gaugeRatio));
  if (fillWidth > 0) {
    roundRectPath(ctx, GAUGE.x, GAUGE.y, fillWidth, GAUGE.height, GAUGE.height / 2);
    ctx.fillStyle = p.gaugeFill;
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
    text(ctx, value, x, STATS.numY, displayFont, 24, index === 2 ? p.statNumAtt : p.text, 'center', 0, STAT_CELL_MAX_WIDTH);
    text(ctx, label, x, STATS.labelY, (s) => bodyFont(s, 400), 11, p.statLabel, 'center', 0, STAT_CELL_MAX_WIDTH);
    text(ctx, abbr, x, STATS.abbrY, displayFont, 11, p.statAbbr, 'center', 1.5, STAT_CELL_MAX_WIDTH);
  });
  ctx.strokeStyle = p.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of STATS.dividers) {
    ctx.moveTo(x, STATS.top);
    ctx.lineTo(x, STATS.bottom);
  }
  ctx.stroke();
}

function drawLogo(ctx: Ctx, logo: DrawableImage | null, p: PlayerCardPalette): void {
  const centerY = LOGO_CENTER_Y;
  if (logo && logo.width > 0 && logo.height > 0) {
    const h = LOGO_HEIGHT;
    const w = Math.min(LOGO_MAX_WIDTH, (logo.width / logo.height) * h);
    ctx.drawImage(logo as CanvasImageSource, 110 - w / 2, LOGO_TOP_Y, w, h);
    return;
  }
  // logo 載入失敗時退回文字商標。
  text(ctx, 'ToosterX', 110, centerY + 3.3, displayFont, 9.5, p.text, 'center', 0.7);
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

/**
 * 右下身分圖案：與網頁 <svg class="player-card-motif"> 同一份路徑（Path2D 直接吃 d 字串）與色票，
 * 裁切照設計預覽：方框右下圓角 11.25（上、左延伸出去不裁，路徑本身都在方框內）。
 * 不支援 Path2D 的環境略過，不影響產圖。
 */
export function drawMotif(ctx: Ctx, motif: PlayerCardMotif | null, theme: PlayerCardTheme): void {
  if (!motif || typeof Path2D !== 'function') return;
  const { x, y, width, height, radius } = PLAYER_CARD_MOTIF_BOX;
  const colors = playerCardMotifColors(motif, theme);
  ctx.save();
  roundRectPath(ctx, x - 200, y - 300, width + 200, height + 300, radius);
  ctx.clip();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of playerCardMotifStrokes(motif)) {
    const path = new Path2D(s.d);
    ctx.globalAlpha = s.petal ? colors.petalOpacity : colors.opacity;
    if (s.fill) {
      ctx.fillStyle = colors[s.fill];
      ctx.fill(path);
    }
    if (s.stroke) {
      ctx.setLineDash(s.dash ? [...s.dash] : []);
      ctx.strokeStyle = colors[s.stroke];
      ctx.lineWidth = s.width ?? 1;
      ctx.stroke(path);
    }
  }
  ctx.restore();
}

type StarKind = 'full' | 'half' | 'empty';

function popularityStarKinds(score: number): StarKind[] {
  const halves = Math.round(Math.min(5, Math.max(0, score)) * 2);
  const full = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  return Array.from({ length: 5 }, (_, i): StarKind => {
    if (i < full) return 'full';
    if (half && i === full) return 'half';
    return 'empty';
  });
}

/** null＝不碰 ctx（與沒有這功能時的繪圖呼叫序列相同）。不支援 Path2D 時略過，與身分圖案相同。 */
function drawPopularityStars(ctx: Ctx, score: number | null, theme: PlayerCardTheme): void {
  if (score == null || !Number.isFinite(score)) return;
  if (typeof Path2D !== 'function') return;
  const empty = POP_STAR.empty[theme];
  const total = 5 * POP_STAR.size + 4 * POP_STAR.gap;
  const left = AVATAR.cx - total / 2;
  const top = AVATAR.cy + AVATAR.outer - 10;
  const scale = POP_STAR.size / POP_STAR.viewBox;
  const kinds = popularityStarKinds(score);
  for (let i = 0; i < 5; i += 1) {
    const kind = kinds[i] ?? 'empty';
    ctx.save();
    ctx.translate(left + i * (POP_STAR.size + POP_STAR.gap), top);
    ctx.scale(scale, scale);
    const path = new Path2D(POP_STAR.path);
    if (kind === 'half') {
      const g = ctx.createLinearGradient(0, 0, POP_STAR.viewBox, 0);
      g.addColorStop(0, POP_STAR.fill);
      g.addColorStop(0.5, POP_STAR.fill);
      g.addColorStop(0.5, empty);
      g.addColorStop(1, empty);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = kind === 'full' ? POP_STAR.fill : empty;
    }
    ctx.fill(path);
    // 站長核可的預覽：空星沒有描邊，有金色的星（滿星、半星）才描邊。
    if (kind !== 'empty') {
      ctx.strokeStyle = POP_STAR.stroke;
      ctx.lineWidth = 0.8;
      ctx.lineJoin = 'round';
      ctx.stroke(path);
    }
    ctx.restore();
  }
}

function drawShine(ctx: Ctx, theme: PlayerCardTheme): void {
  // PNG 畫正面光層；角度、停點、疊加方式與網頁共用 PLAYER_CARD_SHINE（player-card-model.ts）。
  const { width: W, height: H, radius } = PLAYER_CARD_SIZE;
  const { x0, y0, x1, y1 } = playerCardShineGeometry(W, H);
  ctx.save();
  roundRectPath(ctx, 0, 0, W, H, radius);
  ctx.clip();
  const prevComposite = ctx.globalCompositeOperation;
  for (const layer of playerCardShineLayers(theme, 'front')) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [offset, color] of playerCardShineCanvasStops(layer)) g.addColorStop(offset, color);
    ctx.globalCompositeOperation = layer.blend === 'soft-light' ? 'soft-light' : 'source-over';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = prevComposite;
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
  drawMotif(ctx, model.motif, theme);
  drawShine(ctx, theme);
  // 星星在斜光之上（畫面 z-index 5 > 斜光 3）。null 時這個函式不呼叫 ctx。
  drawPopularityStars(ctx, model.popularityStars, theme);
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
