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
import { useSummarySequencer } from '../../data/summary-sequencer';
import { ActivityRecordList } from './ActivityRecordList';
import { ProfileInfoButton } from './ProfileInfoButton';

type Filter = 'all' | 'registered' | 'completed' | 'cancelled';
type Status = 'idle' | 'loading' | 'error' | 'ready';
// 'stale'＝這次請求已被取代（換 uid、卸載或有更新的請求），結果被丟棄，不寫畫面也不提示。
type LoadResult = 'ok' | 'error' | 'stale';
interface LoadOutcome {
  result: LoadResult;
  /** 這次載入讀到的 summary（沒讀 summary 或讀取失敗為 null）。 */
  summary: UserAttendanceSummary | null;
  /** 這次有要求 summary 但讀取失敗（loadUserAttendanceSummary 回 null）；沒要求 summary 的載入為 false。 */
  summaryFailed: boolean;
}

// 掛載時讀到的 summary 超過這個年齡，第一次展開就重讀（避免卡片內的清單比統計新很多）。
const SUMMARY_REUSE_MS = 60_000;

export interface LegacyActivityRecordsCardProps {
  uid: string;
  /**
   * 使用者按「重新整理」且 Callable 與重讀都成功後，把剛讀到的新 summary 交給父層
   * （A 刷新後頁首應到／完成／出席率會一起更新；頁首由父層持有，卡片不直接改它）。
   * 沒傳時只更新卡片自己的「資料更新」。
   */
  onSummaryRefreshed?: (summary: UserAttendanceSummary) => void;
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
 *
 * 載入唯讀（R-STAT-000）：本元件不直接寫入任何 Firestore 欄位、不在前端重算統計。
 * 唯一的寫入是使用者按「重新整理」時觸發的 Callable `refreshMyActivityRecords`（照 A）：
 * 由伺服器依報名補齊／修正 activityRecords、重算 userAttendanceStats、記錄冷卻時間；
 * 前端只負責呼叫並重新讀取，不參與修復內容。
 */
export function LegacyActivityRecordsCard(
  props: LegacyActivityRecordsCardProps,
): JSX.Element {
  const { uid } = props;
  const lt = useLegacyT();
  // 回呼用 ref 保存最新值：不讓父層換 callback 造成載入流程重建。
  const onSummaryRefreshedRef = useRef(props.onSummaryRefreshed);
  onSummaryRefreshedRef.current = props.onSummaryRefreshed;

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<Status>('idle');
  const [stats, setStats] = useState<UserStatsSnapshot | null>(null);
  const [summary, setSummary] = useState<UserAttendanceSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const mountedRef = useRef(true);
  const loadSeqRef = useRef(0);
  // 每次換 uid 遞增：進行中的載入／刷新看到世代不同就放棄結果。
  const epochRef = useRef(0);
  // 目前的世代屬於哪個 uid：掛載 effect 不遞增世代（它屬於初始 uid）。Preact 的 effect 在繪製後才跑，
  // 使用者可能在那之前就按了刷新；若這時遞增，刷新捕捉的世代會被當成「換 uid 前」的請求而丟棄。
  const epochUidRef = useRef(String(uid || '').trim());
  // 收合狀態就已讀到的 summary（首次展開不必重讀，除非已過期）；換 uid 時重置。
  const summaryLoadedRef = useRef(false);
  const summaryFetchedAtRef = useRef(0);
  // summary 請求的發出序號保護（與 ProfilePage 共用同一套）：較晚發出的請求優先，慢的舊請求晚到不得蓋掉較新的。
  const summarySeq = useSummarySequencer();
  const refreshingRef = useRef(false);
  // Callable 已成功但重讀失敗時記住結果：下一次按「重新整理」只重讀，不再打 Callable（避免撞冷卻）。
  const reloadOnlyRef = useRef<{ changed: number } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 套用 summary：序號不比已套用的新就丟棄；讀取失敗（null）不蓋掉已顯示的值。
  const applySummary = useCallback(
    (token: number, sum: UserAttendanceSummary | null): void => {
      if (sum === null || !summarySeq.accept(token)) return;
      summaryLoadedRef.current = true;
      summaryFetchedAtRef.current = Date.now();
      setSummary(sum);
    },
    [summarySeq],
  );

  // 照 A：標題列「資料更新」時間跟著統計走（A 以 onSnapshot 常駐），不必等展開卡片才有。
  // 同一 UID 的並行讀取在 loadUserAttendanceSummary 內合併，和頁首統計不會重複讀。
  // uid 改變（同一元件實例換人）：整張卡回到初始狀態，舊 uid 還在飛的請求結果一律丟棄。
  useEffect(() => {
    const targetUid = String(uid || '').trim();
    if (epochUidRef.current !== targetUid) {
      epochUidRef.current = targetUid;
      epochRef.current += 1;
    }
    loadSeqRef.current += 1;
    summaryLoadedRef.current = false;
    summaryFetchedAtRef.current = 0;
    reloadOnlyRef.current = null;
    setSummary(null);
    setStats(null);
    setStatus('idle');
    setOpen(false);
    setFilter('all');
    setPage(1);
    if (!targetUid) return undefined;
    let active = true;
    const token = summarySeq.issue();
    loadUserAttendanceSummary(targetUid)
      .then((sum) => {
        if (!active || !mountedRef.current) return;
        applySummary(token, sum);
      })
      .catch(() => { /* 讀取失敗維持 -- */ });
    return () => {
      active = false;
    };
  }, [uid, applySummary, summarySeq]);

  const loadAll = useCallback(
    async (
      opts: { reuseSummary?: boolean; freshSummary?: boolean } = {},
    ): Promise<LoadOutcome> => {
      const stale: LoadOutcome = { result: 'stale', summary: null, summaryFailed: false };
      const targetUid = String(uid || '').trim();
      if (!targetUid || !mountedRef.current) return stale;
      const epoch = epochRef.current;
      const seq = ++loadSeqRef.current;
      setStatus('loading');
      try {
        const skipSummary =
          opts.reuseSummary === true &&
          summaryLoadedRef.current &&
          Date.now() - summaryFetchedAtRef.current < SUMMARY_REUSE_MS;
        const summaryToken = skipSummary ? 0 : summarySeq.issue();
        const [snap, sum] = await Promise.all([
          loadUserStats(targetUid),
          skipSummary
            ? Promise.resolve(undefined)
            : opts.freshSummary
              ? loadUserAttendanceSummary(targetUid, { fresh: true })
              : loadUserAttendanceSummary(targetUid),
        ]);
        if (!mountedRef.current || seq !== loadSeqRef.current || epoch !== epochRef.current) {
          return stale;
        }
        setStats(snap);
        if (sum !== undefined) applySummary(summaryToken, sum);
        setStatus('ready');
        return { result: 'ok', summary: sum ?? null, summaryFailed: sum === null };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[LegacyActivityRecordsCard] load failed', err);
        if (!mountedRef.current || seq !== loadSeqRef.current || epoch !== epochRef.current) {
          return stale;
        }
        setStatus('error');
        return { result: 'error', summary: null, summaryFailed: false };
      }
    },
    [uid, applySummary, summarySeq],
  );

  const handleToggle = useCallback((): void => {
    if (!open) {
      setOpen(true);
      if (status === 'idle') {
        loadAll({ reuseSummary: true }).catch(() => { /* loadAll 內部已處理錯誤 */ });
      }
    } else {
      setOpen(false);
    }
  }, [open, status, loadAll]);

  const handleHeaderKeyDown = useCallback(
    (ev: KeyboardEvent): void => {
      // 只處理標題列本身的按鍵；焦點在內部按鈕（重新整理、?）時保持原生行為，不 preventDefault、不切換。
      if (ev.target !== ev.currentTarget) return;
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
      const epoch = epochRef.current;
      const superseded = (): boolean => !mountedRef.current || epoch !== epochRef.current;
      (async (): Promise<void> => {
        try {
          // A `refreshMyActivityRecords`：先請伺服器依報名補齊／修正 activityRecords 並重算統計，
          // 再重讀（有冷卻時間，太頻繁會被擋）。上次 Callable 已成功只差重讀時，這次只重讀。
          let pending = reloadOnlyRef.current;
          if (!pending) {
            const res = (await callFn('refreshMyActivityRecords', {})) as {
              created?: unknown;
              updated?: unknown;
            } | null;
            // 等待 Callable 期間可能已卸載或換 uid：先檢查，才不會把舊人的結果寫進「只重讀」旗標。
            if (superseded()) return;
            pending = { changed: Number(res?.created || 0) + Number(res?.updated || 0) };
            reloadOnlyRef.current = pending;
          }
          // 剛重算完：summary 必須是新發出的請求，不能沿用刷新前就已在飛的。
          const outcome = await loadAll({ freshSummary: true });
          if (outcome.result === 'stale' || superseded()) return;
          if (outcome.result === 'error') {
            toast.show({
              message: lt(
                '報名紀錄已修復，但重新讀取失敗，請再按一次重新整理',
                '報名紀錄已修復，但重新讀取失敗，請再按一次重新整理',
              ),
            });
            return;
          }
          setPage(1); // 照 A：renderActivityRecords(filter, 1)，篩選維持
          if (outcome.summaryFailed) {
            // 紀錄已重讀成功、統計（summary）讀取失敗：頁首數字仍是舊值，不能說「已是最新」。
            // reloadOnlyRef 保留：下一次按只重讀，不再打 Callable、不撞冷卻。
            toast.show({
              message: lt(
                '報名紀錄已更新，但統計讀取失敗，請再按一次重新整理',
                '報名紀錄已更新，但統計讀取失敗，請再按一次重新整理',
              ),
            });
            return;
          }
          reloadOnlyRef.current = null;
          if (outcome.summary) {
            try {
              onSummaryRefreshedRef.current?.(outcome.summary);
            } catch (cbErr) {
              // 父層回呼出錯不能讓已成功的刷新被當成失敗。
              // eslint-disable-next-line no-console
              console.warn('[LegacyActivityRecordsCard] onSummaryRefreshed failed', cbErr);
            }
          }
          toast.show({
            message: pending.changed > 0
              ? lt('報名紀錄已更新', '報名紀錄已更新')
              : lt('報名紀錄已是最新', '報名紀錄已是最新'),
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[LegacyActivityRecordsCard] refresh failed', err);
          if (superseded()) return;
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

  // 換 uid 的那一個 render（effect 清狀態之前）也不顯示上一人的資料。
  const items = useMemo(
    () => (stats && stats.uid === String(uid || '').trim()
      ? getFilteredRecords(stats, filter, false)
      : []),
    [stats, filter, uid],
  );

  // 換 uid 的那一個 render（effect 清狀態之前）也不顯示上一人的更新時間。
  const updatedValue = summary && summary.uid === String(uid || '').trim()
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
