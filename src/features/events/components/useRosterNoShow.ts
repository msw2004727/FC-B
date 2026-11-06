import { useEffect, useMemo, useState } from 'preact/hooks';
import { getCachedUserNoShowStats } from '@/data/user-roles';
import type { UserRole } from '@/ui/Avatar';
import type { ConfirmedRosterPerson } from '../data/attendance-roster-model';
import { loadNoShowAdjustments } from '../data/noshow-corrections';
import {
  NO_SHOW_FEATURE_ENABLED,
  buildNoShowCountByUid,
  buildEndedRegCountByUid,
  participantNoShowCount,
  type NoShowAdjustmentsByUid,
  type UserNoShowStatsByUid,
} from '../data/noshow-roster';

export interface RosterNoShowData {
  counts: ReadonlyMap<string, number>;
  endedCounts: ReadonlyMap<string, number>;
}

interface Options {
  viewerUid: string | null;
  eventDocId: string | undefined;
  people: readonly ConfirmedRosterPerson[];
  /** 既有 useUserRoles 完成會更新此快照；本 hook 絕不另讀 users。 */
  roles: Readonly<Record<string, UserRole>>;
  canViewNoShow: boolean;
  enabled: boolean;
}

const EMPTY_COUNTS: ReadonlyMap<string, number> = new Map();
const EMPTY_ADJUSTMENTS: NoShowAdjustmentsByUid = new Map();

/**
 * T-073b：統計只取 T-073a 的角色快取，補正全部成功才顯示。
 * 每次名單載入週期，按登入者／活動／適用 UID 集合查補正，最多 ceil(n/30) 次。
 * 無自動重試；卸載重進、停用後重開或重新授權會重新讀補正。
 * 編輯切換與一般重繪不重讀。未載入、失敗、權限撤回一律回 null，無錯誤 UI。
 */
export function useRosterNoShow({
  viewerUid, eventDocId, people, roles, canViewNoShow, enabled,
}: Options): RosterNoShowData | null {
  const allowed = Boolean(enabled && canViewNoShow && NO_SHOW_FEATURE_ENABLED && viewerUid && eventDocId);
  const uidKey = JSON.stringify([...new Set(people
    .filter(person => participantNoShowCount(person, EMPTY_COUNTS) !== null)
    .map(person => person.uid.trim()))].sort());
  const stats = useMemo<UserNoShowStatsByUid | null>(() => {
    if (!allowed) return null;
    const uids = JSON.parse(uidKey) as string[];
    // roles 還沒載完時不把缺少的統計當 0；讀取失敗也不追加查詢補洞。
    if (uids.some(uid => !Object.prototype.hasOwnProperty.call(roles, uid))) return null;
    const entries = uids.map(uid => [uid, getCachedUserNoShowStats(uid)] as const);
    if (entries.some(([, value]) => value === undefined)) return null;
    return Object.fromEntries(entries) as UserNoShowStatsByUid;
  }, [allowed, uidKey, roles]);

  const requestKey = stats ? JSON.stringify([viewerUid, eventDocId, uidKey]) : '';
  // 使用物件世代，確保權限關閉再開啟也不會短暫顯示前一次補正。
  const request = useMemo(() => requestKey ? { key: requestKey } : null, [requestKey]);
  const [loaded, setLoaded] = useState<{
    request: NonNullable<typeof request>;
    adjustments: NoShowAdjustmentsByUid;
  } | null>(null);

  useEffect(() => {
    if (!request) return;
    const uids = JSON.parse(uidKey) as string[];
    if (uids.length === 0) return;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const adjustments = await loadNoShowAdjustments(uids, canViewNoShow);
        if (!cancelled) setLoaded({ request: request!, adjustments });
      } catch {
        // 不回退 raw、不露補正錯誤、不接受部分批次結果。
        if (!cancelled) setLoaded(null);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [request, uidKey, canViewNoShow]);

  return useMemo(() => {
    if (!stats || !request) return null;
    const adjustments = uidKey === '[]' ? EMPTY_ADJUSTMENTS
      : loaded?.request === request ? loaded.adjustments : null;
    if (!adjustments) return null;
    return {
      counts: buildNoShowCountByUid(stats, adjustments),
      endedCounts: buildEndedRegCountByUid(stats),
    };
  }, [stats, request, loaded, uidKey]);
}
