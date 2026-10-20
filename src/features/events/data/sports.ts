import type { EventDoc } from './types';

export interface SportOption {
  readonly key: string;
  readonly label: string;
  readonly sportTag: string;
  readonly symbol: string;
  readonly customIconType?: 'img' | 'pickleball-svg';
  readonly customIconSrc?: string;
}

export const SPORTS: readonly SportOption[] = [
  {
    key: 'football',
    label: '足球',
    sportTag: 'football',
    symbol: '⚽',
    customIconType: 'img',
    customIconSrc: '/img/Socce.png',
  },
  { key: 'basketball', label: '籃球', sportTag: 'basketball', symbol: '🏀' },
  {
    key: 'pickleball',
    label: '匹克球',
    sportTag: 'pickleball',
    symbol: '🏓',
    customIconType: 'pickleball-svg',
  },
  { key: 'dodgeball', label: '美式躲避球', sportTag: 'dodgeball', symbol: '🤾' },
  { key: 'restaurant', label: '餐廳(觀賽)', sportTag: 'restaurant', symbol: '🍽️' },
  {
    key: 'escape_room',
    label: '密室逃脫',
    sportTag: 'escape_room',
    symbol: '🧠',
    customIconType: 'img',
    customIconSrc: '/img/Artificial-Intelligence-Brain--Streamline-Plump-Gradient.png',
  },
  {
    key: 'esports',
    label: '電玩電競',
    sportTag: 'esports',
    symbol: '🎮',
    customIconType: 'img',
    customIconSrc: '/img/winner.png',
  },
  { key: 'baseball_softball', label: '棒壘球', sportTag: 'baseball_softball', symbol: '⚾' },
  { key: 'volleyball', label: '排球', sportTag: 'volleyball', symbol: '🏐' },
  { key: 'table_tennis', label: '桌球', sportTag: 'table_tennis', symbol: '🏓' },
  { key: 'tennis', label: '網球', sportTag: 'tennis', symbol: '🎾' },
  { key: 'badminton', label: '羽球', sportTag: 'badminton', symbol: '🏸' },
  { key: 'hiking', label: '登山', sportTag: 'hiking', symbol: '🥾' },
  { key: 'running', label: '慢跑', sportTag: 'running', symbol: '🏃' },
  { key: 'cycling', label: '單車', sportTag: 'cycling', symbol: '🚴' },
  { key: 'motorcycle', label: '重機', sportTag: 'motorcycle', symbol: '🏍️' },
  { key: 'skateboard', label: '滑板', sportTag: 'skateboard', symbol: '🛹' },
  { key: 'dance', label: '舞蹈', sportTag: 'dance', symbol: '💃' },
  { key: 'yoga', label: '瑜伽', sportTag: 'yoga', symbol: '🧘' },
  { key: 'martial_arts', label: '武術', sportTag: 'martial_arts', symbol: '🥋' },
  {
    key: 'other',
    label: '其他',
    sportTag: 'other',
    symbol: '+',
    customIconType: 'img',
    customIconSrc: '/img/1more.png',
  },
] as const;

const SPORT_MAP: Readonly<Record<string, SportOption>> = SPORTS.reduce<Record<string, SportOption>>(
  (acc, item) => {
    acc[item.key] = item;
    return acc;
  },
  Object.create(null) as Record<string, SportOption>,
);

export function getSportKeySafe(key: unknown): string {
  const raw = String(key ?? '').trim();
  return SPORT_MAP[raw] ? raw : '';
}

export function getSportOption(key: unknown): SportOption | undefined {
  const safe = getSportKeySafe(key);
  return safe ? SPORT_MAP[safe] : undefined;
}

export function getSportLabelByKey(key: unknown): string {
  const safeKey = getSportKeySafe(key) || 'football';
  return SPORT_MAP[safeKey]?.label ?? '足球';
}

export function eventSportTag(event: EventDoc): string {
  const value: unknown = (event as EventDoc & { sportTag?: unknown }).sportTag;
  return typeof value === 'string' ? value.trim() : '';
}

export function sportKey(tag: string): string {
  return SPORTS.find((sport) => sport.sportTag === tag)?.key ?? 'other';
}

export function sportSymbol(tag: string): string {
  return SPORTS.find((sport) => sport.sportTag === tag)?.symbol ?? '◯';
}
