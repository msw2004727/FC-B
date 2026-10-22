type PickerMessages = Parameters<
  typeof import('@line/liff').default.shareTargetPicker
>[0];
type FlexMessage = Extract<PickerMessages[number], { type: 'flex' }>;
type Bubble = Extract<FlexMessage['contents'], { type: 'bubble' }>;
type Box = NonNullable<Bubble['body']>;

export interface ShareEvent {
  id?: string;
  title?: string;
  date?: string;
  location?: string;
  type?: string;
  sportTag?: string;
  sport?: string;
  feeEnabled?: boolean;
  fee?: number;
  max?: number;
  current?: number;
  notes?: string;
  externalUrl?: string;
  shareImageUrl?: unknown;
  shareImage?: unknown;
  ogImageUrl?: unknown;
  ogImage?: unknown;
  socialImageUrl?: unknown;
  socialImage?: unknown;
  imageVariants?: { cover?: string };
  coverImage?: unknown;
  cover?: unknown;
  image?: unknown;
  teamSplit?: unknown;
}

export type ShareHeat = 'hot' | 'warm' | 'normal' | 'cold';

export interface ShareRegistration {
  status?: string;
  teamKey?: string;
}

export interface ShareBuilderContext {
  heat?: ShareHeat | null;
  registrations?: readonly ShareRegistration[];
}

const HEAT_LABELS: Record<ShareHeat, string> = {
  hot: '高人氣即將額滿',
  warm: '報名熱烈增加中',
  normal: '穩定開放報名中',
  cold: '潛力場次招募中',
};

// 照 A js/config.js#SPORT_ICON_EMOJI（Flex 訊息用 emoji；PM 依 A 原檔補齊）。
const SPORT_ICON_EMOJI: Readonly<Record<string, string>> = {
  football: '⚽',
  basketball: '🏀',
  escape_room: '🧠',
  esports: '🎮',
  baseball_softball: '⚾',
  volleyball: '🏐',
  table_tennis: '🏓',
  tennis: '🎾',
  badminton: '🏸',
  hiking: '🥾',
  running: '🏃',
  cycling: '🚴',
  motorcycle: '🏍️',
  skateboard: '🛹',
  dance: '💃',
  yoga: '🧘',
  martial_arts: '🥋',
  restaurant: '🍽️',
  pickleball: '🏓',
  dodgeball: '🤾',
  other: '+',
};

const TYPE_COLORS: Readonly<Record<string, string>> = {
  play: '#7c3aed',
  friendly: '#0d9488',
  camp: '#ec4899',
  watch: '#f59e0b',
  course: '#0284c7',
};

const TYPE_LABELS: Readonly<Record<string, string>> = {
  play: 'PLAY',
  friendly: '友誼',
  camp: '教學',
  watch: '觀賽',
  course: '課程',
};

// 照 A js/config.js：MINI_APP_BASE_URL = 'https://miniapp.line.me/' + LINE_CONFIG.MINI_APP_ID。
// 分享連結一律指向 A 的 Mini App（新舊站分享出去的連結必須相同）；公開 client 識別碼，不是秘密（R-CTX-003）。
const MINI_APP_BASE_URL = 'https://miniapp.line.me/2009525300-AuPGQ0sh';

function miniAppBaseUrl(): string {
  return MINI_APP_BASE_URL;
}

export function buildEventLiffUrl(eventId: string): string {
  return miniAppBaseUrl() + '?event=' + encodeURIComponent(String(eventId || '').trim());
  // [備用] 舊 LIFF URL：'https://liff.line.me/' + LINE_CONFIG.LIFF_ID + '?event=' + encodeURIComponent(String(eventId || '').trim());
}

export function buildShareUrl(paramKey: string, paramValue: string): string {
  return miniAppBaseUrl() + '?' + paramKey + '='
    + encodeURIComponent(String(paramValue || '').trim());
}

export function getEventShareVersion(): string {
  return '20260707';
}

export function buildEventShareOgUrl(eventId: string): string {
  const version = encodeURIComponent(String(getEventShareVersion() || '20260707').trim());
  const suffix = version ? '?v=' + version : '';
  return 'https://toosterx.com/event-share/'
    + encodeURIComponent(String(eventId || '').trim()) + suffix;
}

// 照 A _buildEventShareAltText，保留 UTF-16 長度判斷與碼點截斷方式。
function truncateAltText(text: string): string {
  return text.length > 400 ? Array.from(text).slice(0, 397).join('') + '...' : text;
}

export function buildEventShareAltText(
  event: ShareEvent,
  liffUrl: string,
  heat?: ShareHeat | null,
): string {
  const lines = [
    '＜' + (event.title || '') + '＞',
    '日期：' + (event.date || ''),
    '地點：' + (event.location || ''),
  ];
  if (heat) lines.push('熱度：' + HEAT_LABELS[heat]);
  lines.push(liffUrl);
  return truncateAltText(lines.join('\n'));
}

export function sanitizeEventShareImageUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

export function getEventSportShareImageUrl(sportTag: unknown): string {
  const version = getEventShareVersion();
  const images: Readonly<Record<string, string>> = {
    football: 'https://toosterx.com/assets/og/sports/football.jpg?v=' + version,
    basketball: 'https://toosterx.com/assets/og/sports/basketball.jpg?v=' + version,
    pickleball: 'https://toosterx.com/assets/og/sports/pickleball.jpg?v=' + version,
    dodgeball: 'https://toosterx.com/assets/og/sports/dodgeball.jpg?v=' + version,
  };
  return images[String(sportTag || '').trim().toLowerCase()] || '';
}

export function getEventShareImageUrl(event: ShareEvent): string {
  const explicit = sanitizeEventShareImageUrl(
    event.shareImageUrl || event.shareImage || event.ogImageUrl
    || event.ogImage || event.socialImageUrl || event.socialImage,
  );
  if (explicit) return explicit;
  const sportImage = getEventSportShareImageUrl(event.sportTag || event.sport);
  if (sportImage) return sportImage;
  return sanitizeEventShareImageUrl(
    event.imageVariants?.cover || event.coverImage || event.cover || event.image,
  );
}

export function buildFlexInfoRow(label: string, value: string): Box {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#888888', flex: 2 },
      { type: 'text', text: value, size: 'sm', color: '#333333', flex: 5, wrap: true },
    ],
  };
}

function teamSplitText(
  raw: unknown,
  registrations: readonly ShareRegistration[],
): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const split = raw as Record<string, unknown>;
  if (!split.enabled || !Array.isArray(split.teams)) return null;

  const teams: Array<{ key: string; name: string }> = [];
  for (const value of split.teams as unknown[]) {
    if (!value || typeof value !== 'object') continue;
    const team = value as Record<string, unknown>;
    if (typeof team.key !== 'string') continue;
    teams.push({
      key: team.key,
      name: typeof team.name === 'string' ? team.name : '',
    });
  }
  const validKeys = new Set(teams.map((team) => team.key));
  const counts = new Map<string, number>(teams.map((team) => [team.key, 0]));
  for (const registration of registrations) {
    if (
      registration.status === 'confirmed'
      && registration.teamKey
      && validKeys.has(registration.teamKey)
    ) {
      counts.set(registration.teamKey, (counts.get(registration.teamKey) || 0) + 1);
    }
  }
  return teams.map((team) => `${team.name || team.key} ${counts.get(team.key) || 0}`)
    .join(' vs ');
}

// 照 A _buildEventFlexMessage／_buildExternalEventFlexMessage。
function buildBubble(
  event: ShareEvent,
  url: string,
  external: boolean,
  context: ShareBuilderContext,
): Bubble {
  const sportEmoji = SPORT_ICON_EMOJI[event.sportTag || ''] || '⚽';
  const typeColor = external ? '#6b7280' : TYPE_COLORS[event.type || ''] || '#7c3aed';
  const typeLabel = external ? '外部活動' : TYPE_LABELS[event.type || ''] || 'PLAY';

  const contents: Box['contents'] = [
    {
      type: 'box',
      layout: 'horizontal',
      contents: [{
        type: 'text',
        text: sportEmoji + ' ' + typeLabel,
        size: 'xs',
        color: '#ffffff',
        weight: 'bold',
        align: 'center',
        gravity: 'center',
      }],
      backgroundColor: typeColor,
      cornerRadius: '12px',
      paddingAll: '4px',
      paddingStart: '10px',
      paddingEnd: '10px',
      width: external ? '110px' : '90px',
    },
    {
      type: 'text',
      text: event.title || '活動',
      weight: 'bold',
      size: 'lg',
      wrap: true,
      maxLines: 2,
      margin: 'md',
    },
  ];

  const info: Box['contents'] = [];
  if (event.date) info.push(buildFlexInfoRow('日期', event.date));
  if (event.location) info.push(buildFlexInfoRow('地點', event.location));
  if (!external) {
    if (context.heat) info.push(buildFlexInfoRow('熱度', HEAT_LABELS[context.heat]));
    if (event.feeEnabled && (event.fee || 0) > 0) {
      info.push(buildFlexInfoRow('費用', '$' + event.fee));
    }
    const splitText = teamSplitText(event.teamSplit, context.registrations || []);
    if (splitText !== null) info.push(buildFlexInfoRow('分隊', splitText));
  }
  if (info.length > 0) {
    contents.push({
      type: 'box',
      layout: 'vertical',
      contents: info,
      margin: 'lg',
      spacing: 'sm',
    });
  }

  const bubble: Bubble = {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      contents,
      paddingAll: '16px',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'button',
        style: 'primary',
        color: typeColor,
        action: {
          type: 'uri',
          label: external ? '查看活動' : '立即報名',
          uri: url,
        },
        height: 'sm',
      }],
      paddingAll: '12px',
    },
  };
  const image = getEventShareImageUrl(event);
  if (image) {
    bubble.hero = {
      type: 'image',
      url: image,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    };
  }
  return bubble;
}

export function buildEventFlexMessage(
  event: ShareEvent,
  liffUrl: string,
  context: ShareBuilderContext = {},
): Bubble {
  return buildBubble(event, liffUrl, false, context);
}

export function buildExternalEventShareAltText(
  event: ShareEvent,
  urlOverride?: string,
): string {
  const lines = ['＜' + (event.title || '') + '＞', '日期：' + (event.date || '')];
  if (event.location) lines.push('地點：' + event.location);
  const url = urlOverride
    || (event.id ? miniAppBaseUrl() + '?event=' + event.id : event.externalUrl || '');
  lines.push('連結：' + url);
  return truncateAltText(lines.join('\n'));
}

export function buildExternalEventFlexMessage(event: ShareEvent): Bubble {
  const url = event.id
    ? miniAppBaseUrl() + '?event=' + event.id
    : event.externalUrl || 'https://example.com';
  return buildBubble(event, url, true, {});
}
