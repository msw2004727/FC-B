import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { callFn } from '@/data/callables';
import { useLegacyT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

import {
  formatUserAttendanceSummaryTime,
  getFilteredRecords,
  loadUserStats,
  type UserStatsSnapshot,
} from '../../data/activity-records';
import {
  loadUserAttendanceSummary,
  type UserAttendanceSummary,
} from '../../data/attendance-summary';
import { ActivityRecordList } from './ActivityRecordList';
import { ProfileInfoButton } from './ProfileInfoButton';

type Filter = 'all' | 'registered' | 'completed' | 'cancelled';
type Status = 'idle' | 'loading' | 'error' | 'ready';

export interface LegacyActivityRecordsCardProps {
  uid: string;
}

interface FilterTab {
  filter: Filter;
  labelKey: string;
  fallback: string;
}

// 照 A `pages/profile.html#244-249` 的 4 個頁籤（data-i18n key 對照）。
const TABS: FilterTab[] = [
  { filter: 'all', labelKey: 'profilePage.recordAll', fallback: '全部' },
  { filter: 'registered', labelKey: '報名', fallback: '報名' },
  { filter: 'completed', labelKey: '完成', fallback: '完成' },
  { filter: 'cancelled', labelKey: '取消', fallback: '取消' },
];

/**
 * 「報名紀錄」卡（M-129）。
 *
 * 照 A `leaderboard.js#renderActivityRecords`＋`pages/profile.html#240-257` 的 DOM／class／id：
 * - `.info-card > .info-title.profile-collapse-toggle`：標題列（?／報名紀錄／資料更新／重新整理）。
 * - `.tab-bar.compact#record-tabs`：4 個頁籤；預設收起，展開才載入（省流量）。
 * - `.mini-activity-list#my-activity-records`：清單本體。
 * 唯讀（R-STAT-000），不寫入 Firestore。
 */
export function LegacyActivityRecordsCard(
  props: LegacyActivityRecordsCardProps,
): JSX.Element {
  const { uid } = props;
  const lt = useLegacyT();

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<Status>('idle');
  const [stats, setStats] = useState<UserStatsSnapshot | null>(null);
  const [summary, setSummary] = useState<UserAttendanceSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const mountedRef = useRef(true);
  const loadSeqRef = useRef(0);
  // 收合狀態就已讀到的 summary（首次展開不必重讀）；換 uid 或重新整理時重置。
  const summaryLoadedRef = useRef(false);
  const refreshingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 照 A：標題列「資料更新」時間跟著統計走（A 以 onSnapshot 常駐），不必等展開卡片才有。
  // 同一 UID 的並行讀取在 loadUserAttendanceSummary 內合併，和頁首統計不會重複讀。
  useEffect(() => {
    const targetUid = String(uid || '').trim();
    summaryLoadedRef.current = false;
    setSummary(null);
    if (!targetUid) return undefined;
    let active = true;
    loadUserAttendanceSummary(targetUid)
      .then((sum) => {
        if (!active || !mountedRef.current) return;
        summaryLoadedRef.current = sum !== null;
        setSummary(sum);
      })
      .catch(() => { /* 讀取失敗維持 -- */ });
    return () => {
      active = false;
    };
  }, [uid]);

  const loadAll = useCallback(async (reuseSummary = false): Promise<boolean> => {
    const targetUid = String(uid || '').trim();
    if (!targetUid) return false;
    const seq = ++loadSeqRef.current;
    setStatus('loading');
    try {
      const skipSummary = reuseSummary && summaryLoadedRef.current;
      const [snap, sum] = await Promise.all([
        loadUserStats(targetUid),
        skipSummary ? Promise.resolve(undefined) : loadUserAttendanceSummary(targetUid),
      ]);
      if (!mountedRef.current || seq !== loadSeqRef.current) return false;
      setStats(snap);
      if (sum !== undefined) {
        summaryLoadedRef.current = sum !== null;
        setSummary(sum);
      }
      setStatus('ready');
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[LegacyActivityRecordsCard] load failed', err);
      if (!mountedRef.current || seq !== loadSeqRef.current) return false;
      setStatus('error');
      return false;
    }
  }, [uid]);

  const handleToggle = useCallback((): void => {
    if (!open) {
      setOpen(true);
      if (status === 'idle') {
        loadAll(true).catch(() => { /* loadAll 內部已處理錯誤 */ });
      }
    } else {
      setOpen(false);
    }
  }, [open, status, loadAll]);

  const handleHeaderKeyDown = useCallback(
    (ev: KeyboardEvent): void => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        handleToggle();
      }
    },
    [handleToggle],
  );

  const handleRefresh = useCallback(
    (ev: MouseEvent): void => {
      // 照 A：`event.stopPropagation(); App.refreshMyActivityRecords();`
      ev.stopPropagation();
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      setRefreshing(true);
      (async (): Promise<void> => {
        try {
          // A `refreshMyActivityRecords`：先請伺服器依報名補齊／修正 activityRecords 並重算統計，
          // 再重讀（有冷卻時間，太頻繁會被擋）。
          const res = (await callFn('refreshMyActivityRecords', {})) as {
            created?: unknown;
            updated?: unknown;
          } | null;
          const reloaded = await loadAll();
          if (!mountedRef.current) return;
          if (!reloaded) return;
          const changed = Number(res?.created || 0) + Number(res?.updated || 0);
          toast.show({
            message: changed > 0
              ? lt('報名紀錄已更新', '報名紀錄已更新')
              : lt('報名紀錄已是最新', '報名紀錄已是最新'),
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[LegacyActivityRecordsCard] refresh failed', err);
          if (!mountedRef.current) return;
          const e = err as { code?: unknown; details?: { retryAfterSeconds?: unknown } } | null;
          const code = typeof e?.code === 'string' ? e.code.replace(/^functions\//, '') : '';
          if (code === 'resource-exhausted') {
            const seconds = Number(e?.details?.retryAfterSeconds || 0);
            toast.show({
              message: seconds
                ? lt('請 {n} 秒後再刷新', '請 {n} 秒後再刷新', { n: seconds })
                : lt('刷新太頻繁，請稍後再試', '刷新太頻繁，請稍後再試'),
            });
          } else {
            toast.show({ message: lt('報名紀錄刷新失敗', '報名紀錄刷新失敗') });
          }
        } finally {
          refreshingRef.current = false;
          if (mountedRef.current) setRefreshing(false);
        }
      })().catch(() => { /* 內部已處理 */ });
    },
    [loadAll, lt],
  );

  const handleFilterClick = useCallback((next: Filter): void => {
    setFilter(next);
    setPage(1);
  }, []);

  const handlePage = useCallback((next: number): void => {
    setPage(next);
  }, []);

  const items = useMemo(
    () => (stats ? getFilteredRecords(stats, filter, false) : []),
    [stats, filter],
  );

  const updatedValue = summary
    ? formatUserAttendanceSummaryTime(summary.updatedAt)
    : '--';
  const updatedText = lt('資料更新 {value}', '資料更新 {value}', {
    value: updatedValue,
  });

  return (
    <div class="info-card" id="profile-activity-records">
      <div
        class={`info-title profile-collapse-toggle${open ? ' open' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={open ? 'true' : 'false'}
        onClick={handleToggle}
        onKeyDown={handleHeaderKeyDown}
      >
        <span class="profile-record-title-row">
          <span style="display:flex;align-items:center;gap:.35rem">
            <ProfileInfoButton infoKey="records" />
            <span data-i18n="profile.activityRecords">
              {lt('profile.activityRecords', '報名紀錄')}
            </span>
          </span>
          <span class="profile-record-sync-meta">
            <span id="my-records-updated-at" class="profile-record-updated-at">
              {updatedText}
            </span>
            <button
              id="my-records-refresh"
              type="button"
              class={`profile-record-refresh-btn${refreshing ? ' spinning' : ''}`}
              disabled={refreshing}
              onClick={handleRefresh}
              title={lt('重新整理', '重新整理')}
              aria-label={lt('重新整理', '重新整理')}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
                <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
              </svg>
            </button>
          </span>
        </span>
        <span class="profile-collapse-arrow">▶</span>
      </div>

      <div
        class="profile-collapse-content"
        style={open ? undefined : 'display:none'}
      >
        <div class="tab-bar compact" id="record-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.filter}
              type="button"
              class={`tab${filter === tab.filter ? ' active' : ''}`}
              data-filter={tab.filter}
              onClick={() => handleFilterClick(tab.filter)}
            >
              {lt(tab.labelKey, tab.fallback)}
            </button>
          ))}
        </div>
        <div class="mini-activity-list" id="my-activity-records">
          {status === 'ready' ? (
            <ActivityRecordList
              items={items}
              page={page}
              onPage={handlePage}
            />
          ) : status === 'loading' ? (
            <div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">
              {lt('載入紀錄中...', '載入紀錄中...')}
            </div>
          ) : status === 'error' ? (
            <div style="font-size:.82rem;color:var(--danger);padding:.5rem 0">
              {lt('紀錄載入失敗，請按重新整理', '紀錄載入失敗，請按重新整理')}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
