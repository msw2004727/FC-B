import type { EventDoc, RegistrationDoc } from './types';

/**
 * A 原始碼已提供這些唯讀欄位的使用證據。
 * 局部擴充讀取型別，不改 Firestore 格式或既有寫入契約。
 */
export interface DetailEvent extends EventDoc {
  current?: number;
  max?: number;
  waitlist?: number;
  notes?: string;
  fee?: number;
  feeEnabled?: boolean;
  regOpenTime?: string;
}

export interface DetailRegistration extends RegistrationDoc {
  userName?: string;
  companionId?: string;
  companionName?: string;
  registeredAt?: unknown;
  promotionOrder?: number;
}

export function isActiveRegistration(reg: RegistrationDoc): boolean {
  return reg.status === 'confirmed' || reg.status === 'waitlisted';
}

export function registrationId(reg: RegistrationDoc): string {
  // 取消 payload 必須使用實際子文件 ID，不能拿 public id 猜測。
  return reg._docId ?? '';
}

export function registrationOwner(reg: RegistrationDoc): string {
  return reg.userId ?? reg.uid ?? '';
}

export function isCompanion(reg: DetailRegistration): boolean {
  return reg.participantType === 'companion' || Boolean(reg.companionId);
}

export function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function registeredMs(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : Infinity;
  if (typeof raw === 'string') {
    const value = Date.parse(raw);
    return Number.isFinite(value) ? value : Infinity;
  }
  if (raw instanceof Date) return raw.getTime();
  if (raw && typeof raw === 'object' && 'seconds' in raw &&
    typeof raw.seconds === 'number') {
    const nanos = 'nanoseconds' in raw && typeof raw.nanoseconds === 'number'
      ? raw.nanoseconds : 0;
    return raw.seconds * 1000 + nanos / 1_000_000;
  }
  return Infinity;
}

export function sortRegistrations(
  docs: readonly DetailRegistration[],
): DetailRegistration[] {
  return docs.filter(isActiveRegistration).slice().sort((a, b) => {
    const left = registeredMs(a.registeredAt);
    const right = registeredMs(b.registeredAt);
    if (left !== right) return left < right ? -1 : 1;
    return count(a.promotionOrder) - count(b.promotionOrder) ||
      registrationId(a).localeCompare(registrationId(b));
  });
}

export function safeImageUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw, 'https://toosterx.invalid');
    return url.protocol === 'https:' || url.protocol === 'http:' ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** 不把 A 的「日期 + 時段」整串交給 Date.parse。 */
export function eventDateRange(raw: string | undefined):
  { start: string; end: string | null } | null {
  const match = raw?.match(
    /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})(?:\s*[~～]\s*(\d{2}):(\d{2}))?$/,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, endHour, endMinute] = match;
  if (!year || !month || !day || !hour || !minute) return null;
  // ASSUMPTION: A 的無時區活動日期採 Asia/Taipei。
  const start = `${year}-${month}-${day}T${hour}:${minute}:00+08:00`;
  if (!Number.isFinite(Date.parse(start))) return null;
  let end: string | null = null;
  if (endHour && endMinute) {
    const endMs = Date.parse(`${year}-${month}-${day}T${endHour}:${endMinute}:00+08:00`);
    if (Number.isFinite(endMs)) {
      end = new Date(endMs < Date.parse(start) ? endMs + 86_400_000 : endMs).toISOString();
    }
  }
  return { start, end };
}
