import { useEffect, useMemo, useState } from 'preact/hooks';
import { getCachedUserNoShowStats } from '@/data/user-roles';
import type { UserRole } from '@/ui/Avatar';
import type { ConfirmedRosterPerson } from '../data/attendance-roster-model';
import { loadNoShowAdjustments } from '../data/noshow-corrections';
import { loadCountedNoShowStats } from '../data/noshow-counted';
import {
  NO_SHOW_FEATURE_ENABLED,
  buildNoShowCountByUid,
  buildEndedRegCountByUid,
  participantNoShowCount,
  type CountedNoShowByUid,
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
  /** 管理名單（編輯模式）開啟；只有此時才讀 userAttendanceStats（站長 11-06 v2），一般瀏覽不讀。 */
  managing?: boolean;
}

const EMPTY_COUNTS: ReadonlyMap<string, number> = new Map();
const EMPTY_ADJUSTMENTS: NoShowAdjustmentsByUid = new Map();
const EMPTY_COUNTED: CountedNoShowByUid = new Map();

/**
 * T-073b：統計只取 T-073a 的角色快取，補正全部成功才顯示。
 * 每次名單載入週期，按登入者／活動／適用 UID 集合查補正，最多 ceil(n/30) 次。
 * 無自動重試；卸載重進、停用後重開或重新授權會重新讀補正。
 * 編輯切換與一般重繪不重讀。未載入、失敗、權限撤回一律回 null，無錯誤 UI。
 * v2（站長 11-06）：managing 時另讀 userAttendanceStats（每 30 個 UID 一塊），有 countedSince 的人用
 * 放鴿子／計入並略過舊補正，沒有的人退回 users 三欄與舊補正；managing 時全部載入成功才回資料。
 * 同一名單載入週期只讀一次，編輯開關來回不重讀。
 */
export function useRosterNoShow({
  viewerUid, eventDocId, people, roles, canViewNoShow, enabled, managing = false,
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

  // counted=null 代表這個 request 讀取失敗（記下來避免失敗後無限重試）。
  const [countedLoaded, setCountedLoaded] = useState<{
    request: NonNullable<typeof request>;
    counted: CountedNoShowByUid | null;
  } | null>(null);
  const needCounted = Boolean(managing && request && uidKey !== '[]' && countedLoaded?.request !== request);

  useEffect(() => {
    if (!needCounted || !request) return;
    const uids = JSON.parse(uidKey) as string[];
    let cancelled = false;
    async function loadCounted(): Promise<void> {
      try {
        const counted = await loadCountedNoShowStats(uids, canViewNoShow);
        if (!cancelled) setCountedLoaded({ request: request!, counted });
      } catch {
        // 不回退 users 三欄、不露錯誤、不接受部分批次結果；本週期不自動重試。
        if (!cancelled) setCountedLoaded({ request: request!, counted: null });
      }
    }
    void loadCounted();
    return () => { cancelled = true; };
  }, [needCounted, request, uidKey, canViewNoShow]);

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
    const counted: CountedNoShowByUid | undefined = uidKey === '[]' ? EMPTY_COUNTED
      : countedLoaded?.request === request ? countedLoaded.counted ?? undefined : undefined;
    // 管理名單要顯示 🕊，v2 資料沒到之前不用 users 三欄頂替。
    if (managing && !counted) return null;
    return {
      counts: buildNoShowCountByUid(stats, adjustments, NO_SHOW_FEATURE_ENABLED, counted),
      endedCounts: buildEndedRegCountByUid(stats, NO_SHOW_FEATURE_ENABLED, counted),
    };
  }, [stats, request, loaded, uidKey, managing, countedLoaded]);
}
