/**
 * 「無效資料查詢」的純函式：文件轉畫面資料、登入天數分組界線。
 * 欄位與顯示照 A `js/modules/user-admin/user-admin-roles.js`（`_renderInactiveTeams`、`_renderInactiveEvents`、
 * `_renderUserStatusCheck`、`_renderUserStatusRow`）。
 */
import { BASE_ROLES } from '@/ui/drawer-menu';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface InactiveTeam {
  id: string;
  name: string;
  captain: string;
  members: number;
  region: string;
}

export interface InactiveEvent {
  id: string;
  title: string;
  status: 'ended' | 'cancelled';
  date: string;
  location: string;
  creator: string;
  current: number;
  max: number;
}

export interface StatusUser {
  id: string;
  uid: string;
  name: string;
  roleLabel: string;
  pictureUrl: string;
  lastLoginStr: string;
  daysSince: number;
}

type Raw = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function mapInactiveTeam(id: string, data: Raw | undefined): InactiveTeam {
  const d = data ?? {};
  return { id, name: str(d['name']), captain: str(d['captain']), members: num(d['members']), region: str(d['region']) };
}

export function mapInactiveEvent(id: string, data: Raw | undefined): InactiveEvent {
  const d = data ?? {};
  return {
    id,
    title: str(d['title']),
    status: d['status'] === 'ended' ? 'ended' : 'cancelled',
    date: str(d['date']),
    location: str(d['location']),
    creator: str(d['creator']),
    current: num(d['current']),
    max: num(d['max']),
  };
}

/** Firestore Timestamp（或測試替身）轉毫秒；不是時間戳回 null。 */
export function toMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { toMillis?: () => number; seconds?: number };
  if (typeof v.toMillis === 'function') {
    const ms = v.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  return typeof v.seconds === 'number' ? v.seconds * 1000 : null;
}

/**
 * A 的分組：天數＝floor((現在 − 最後登入) / 1 天)；天數 > 90 為「超過 90 天」、> 30 為「30~90 天」，其餘為活躍。
 * 換成時間界線：活躍＝最後登入晚於 now − 31 天；30~90 天＝晚於 now − 91 天且不晚於 now − 31 天；其餘超過 90 天。
 */
export function loginBoundaries(nowMs: number): { activeAfterMs: number; over90AtOrBeforeMs: number } {
  return { activeAfterMs: nowMs - 31 * DAY_MS, over90AtOrBeforeMs: nowMs - 91 * DAY_MS };
}

export function mapStatusUser(id: string, data: Raw | undefined, nowMs: number): StatusUser {
  const d = data ?? {};
  const role = str(d['role']) || 'user';
  const ms = toMillis(d['lastLogin']);
  let lastLoginStr = '從未登入';
  let daysSince = 9999;
  if (ms !== null) {
    const date = new Date(ms);
    lastLoginStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
    daysSince = Math.floor((nowMs - ms) / DAY_MS);
  }
  const uid = str(d['uid']) || id;
  return {
    id,
    uid,
    // 沒有名字顯示「未知」，不把原始 UID 當名字顯示。
    name: str(d['displayName']) || str(d['name']) || '未知',
    roleLabel: BASE_ROLES[role]?.label ?? role,
    pictureUrl: str(d['pictureUrl']),
    lastLoginStr,
    daysSince,
  };
}
