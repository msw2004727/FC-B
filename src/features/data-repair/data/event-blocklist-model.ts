import type { ViewerView } from '@/features/profile/data/viewer';
import type { EventDoc } from '@/features/events/data/types';
import { formatTaipei, parseTaipei } from '@/core/taipei-time';

export const BLOCKLIST_PERMISSION = 'admin.repair.event_blocklist';
export const BLOCKLIST_ENTRY = 'admin.repair.entry';
export type BlocklistViewer = Pick<ViewerView, 'uid' | 'role' | 'hasPermission' | 'displayName' | 'permissionSources'>;
export interface BlocklistLog { uid: string; by: string; action: 'add' | 'remove'; at: string; reason: string }
export interface BlocklistEvent extends EventDoc { courseLinked?: unknown; blockedUidsLog?: unknown }
export interface BlocklistUser { uid: string; name: string; lineUserId: string }

export function canViewEventBlocklist(viewer: BlocklistViewer): boolean {
  return !!viewer.uid && viewer.hasPermission(BLOCKLIST_ENTRY) && viewer.hasPermission(BLOCKLIST_PERMISSION);
}

export function canWriteEventBlocklist(viewer: BlocklistViewer): boolean {
  if (!viewer.uid) return false;
  if (viewer.role === 'super_admin') return true;
  if (!viewer.role || viewer.role === 'user' || viewer.role === 'guest') return false;
  return viewer.permissionSources?.rolePermissions?.includes(BLOCKLIST_PERMISSION) === true;
}

export function isValidBlocklistUid(uid: unknown): uid is string {
  return typeof uid === 'string' && uid.length > 0 && uid.length <= 128
    && uid === uid.trim() && !/[/\x00-\x1f\x7f-\x9f]/.test(uid);
}

export function blockedUsers(event: BlocklistEvent): string[] {
  return Array.isArray(event.blockedUids) ? event.blockedUids.filter((v): v is string => typeof v === 'string') : [];
}

export function lastAddition(event: BlocklistEvent, uid: string): Partial<BlocklistLog> | undefined {
  if (!Array.isArray(event.blockedUidsLog)) return undefined;
  return event.blockedUidsLog.filter((log): log is BlocklistLog =>
    !!log && typeof log === 'object' && log.uid === uid && log.action === 'add').pop();
}

export function existingBlocklists(events: readonly BlocklistEvent[]): BlocklistEvent[] {
  return events.filter(event => blockedUsers(event).length > 0)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

export function searchEvents(events: readonly BlocklistEvent[], query: string): BlocklistEvent[] {
  const term = query.trim().toLowerCase();
  return term ? events.filter(event => [event.title, event.date, event.creator, event.location, event.id]
    .some(value => String(value || '').toLowerCase().includes(term))).slice(0, 20) : [];
}

export function searchUsers(users: readonly BlocklistUser[], query: string): BlocklistUser[] {
  const term = query.trim().toLowerCase();
  return term ? users.filter(user => [user.name, user.uid, user.lineUserId]
    .some(value => value.toLowerCase().includes(term))).slice(0, 20) : [];
}

export function userLabel(users: readonly BlocklistUser[], uid: string): string {
  return users.find(user => user.uid === uid)?.name || (uid.length > 8 ? uid.slice(0, 4) + '…' + uid.slice(-4) : uid);
}

export function additionTime(at: unknown): string {
  const ms = typeof at === 'string' ? parseTaipei(at) : null;
  return ms === null ? '—' : formatTaipei(ms).slice(5);
}
