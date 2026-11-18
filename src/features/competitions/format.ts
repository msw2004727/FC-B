// 時間以台北（UTC+8，無日光節約）顯示與解析。金額照站長定案：NT$1,500 或「免費」。
// 地圖網址沿用活動詳情的 Google search query 格式。

import type { RosterPositionCode, Venue } from './data/types';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function taipeiMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute) - TAIPEI_OFFSET_MS;
}

interface TaipeiParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function taipeiParts(ms: number): TaipeiParts {
  const date = new Date(ms + TAIPEI_OFFSET_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 2026/12/01 09:00 */
export function formatTaipeiDateTime(ms: number): string {
  const p = taipeiParts(ms);
  return `${p.year}/${pad(p.month)}/${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** 12/01 09:00（報名期間同一年時用） */
export function formatTaipeiShort(ms: number): string {
  const p = taipeiParts(ms);
  return `${pad(p.month)}/${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** 2027/01/09 */
export function formatTaipeiDate(ms: number): string {
  const p = taipeiParts(ms);
  return `${p.year}/${pad(p.month)}/${pad(p.day)}`;
}

/** datetime-local 的值，語意是台北牆鐘。 */
export function toDatetimeLocalValue(ms: number): string {
  const p = taipeiParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function fromDatetimeLocalValue(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return Date.UTC(year, month - 1, day, hour, minute) - TAIPEI_OFFSET_MS;
}

export function fromDateValue(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** 0 或負數當免費。千分位用 zh-TW。 */
export function formatFee(amount: number, freeLabel: string): string {
  const n = Math.trunc(Number.isFinite(amount) ? amount : 0);
  if (n <= 0) return freeLabel;
  return `NT$${n.toLocaleString('zh-TW')}`;
}

/**
 * 活動詳情是 `https://www.google.com/maps/search/?api=1&query=` 加上地點文字。
 * ASSUMPTION: 有成對座標時 query 用「緯度,經度」，否則用場地名稱與地址。
 */
export function venueMapUrl(venue: Venue): string {
  const query = venue.lat != null && venue.lng != null
    ? `${venue.lat},${venue.lng}`
    : [venue.name, venue.address].filter((part) => !!part && part.trim()).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function positionLabel(
  position: RosterPositionCode | null,
  positionText: string | null,
  labels: { none: string; GK: string; DF: string; MF: string; FW: string; custom: string },
): string {
  if (!position) return labels.none;
  if (position === 'custom') {
    const text = positionText?.trim() ?? '';
    return text || labels.custom;
  }
  return labels[position];
}

/**
 * 未滿 18 歲算未成年。生日接受 YYYY-MM-DD 或 YYYY/MM/DD。
 * 比較的是台北日期，基準毫秒換算成台北日曆日。
 */
export function isMinorAt(birthday: string, atMs: number): boolean | null {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(birthday.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const at = taipeiParts(atMs);
  const atDay = Date.UTC(at.year, at.month - 1, at.day);
  const adultDay = Date.UTC(year + 18, month - 1, day);
  return atDay < adultDay;
}
