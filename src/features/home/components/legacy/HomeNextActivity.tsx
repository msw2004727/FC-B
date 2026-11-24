import type { JSX } from 'preact';
import { taipeiParts } from '@/core/taipei-time';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getVisibleEvents } from '@/features/events/data/visibility';
import type { EventDoc } from '@/features/events/data/types';
import type { ViewerView } from '@/features/profile/data/viewer';
import { readAuthHint } from '@/data/auth-hint';
import {
  loadNextActivityLoad,
  parseEventDateRange,
  registrationStatusMeta,
  resolveNextActivity,
  type NextActivityActiveInput,
  type NextActivityResult,
} from '../../data/next-activity';
import { readNextActivitySnapshot } from '../../data/next-activity-snapshot';
import '../../legacy/home-stale.css';

const FALLBACK_IMAGE = 'LOGO/Nocoverimage%20set.png';

// 快照寫入端延遲載入（首頁入口 JS 預算）。共用同一個模組 promise，後續寫入／刪除都接在它後面，先後順序才不會錯亂；
// 載入失敗就清掉，下次再試（L-08）。
let snapshotWriter: Promise<typeof import('../../data/next-activity-snapshot-write')> | null = null;
function loadSnapshotWriter(): Promise<typeof import('../../data/next-activity-snapshot-write')> {
  snapshotWriter ??= import('../../data/next-activity-snapshot-write').catch((err: unknown) => {
    snapshotWriter = null;
    throw err;
  });
  return snapshotWriter;
}
const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'] as const;

function pad2(num: number): string {
  return String(num).padStart(2, '0');
}

export function formatNextActivityDateRange(event: EventDoc | null | undefined): string {
  if (!event) return '';
  const range = parseEventDateRange(event.date ?? event.startAt ?? event.startTime);
  if (!range?.startMs) return String(event.date ?? '');
  const start = taipeiParts(range.startMs);
  const end = taipeiParts(range.endMs || range.startMs + 2 * 60 * 60 * 1000);
  const dayName = DAY_NAMES[start.weekday] ?? '日';
  const datePart = `${pad2(start.month)}/${pad2(start.day)} (${dayName})`;
  const startTime = `${pad2(start.hour)}:${pad2(start.minute)}`;
  const endTime = `${pad2(end.hour)}:${pad2(end.minute)}`;
  return `${datePart} ${startTime} - ${endTime}`;
}

export interface HomeNextActivityProps {
  viewer: ViewerView;
  onViewAll: () => void;
  onFindActivity: () => void;
  onCreateEvent: (e: MouseEvent) => void;
  onOpenDetail: (event: EventDoc) => void;
  onAddToCalendar: (event: EventDoc) => void;
  /** 首頁 useEvents 確認向伺服器新取得的 active 清單；'pending' 等待中；undefined 走現行查法。 */
  activeEvents?: NextActivityActiveInput;
}

export function HomeNextActivity({
  viewer,
  onViewAll,
  onFindActivity,
  onCreateEvent,
  onOpenDetail,
  onAddToCalendar,
  activeEvents,
}: HomeNextActivityProps): JSX.Element {
  const [state, setState] = useState<{
    uid: string | null;
    loading: boolean;
    /** 這次讀取失敗（不是「確定沒有下一場」）：不刪快照、畫面保留上次內容。 */
    failed: boolean;
    result: NextActivityResult | null;
  }>(() => ({
    uid: viewer.uid,
    loading: Boolean(viewer.uid),
    failed: false,
    result: null,
  }));
  // 上次的內容（站長 2026-11-19）：開頁讀一次；帳號確認後 owner 不符就不用，讀到新結果後換掉。
  const [snapshot] = useState(() => readNextActivitySnapshot());

  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  // 批次 A §4.4 H-2：activeEvents 用 ref 讀取最新值，effect 只在 activeReady 由「等待中」變「可用」時重跑。
  const activeRef = useRef(activeEvents);
  activeRef.current = activeEvents;
  const activeReady = activeEvents !== 'pending';

  useEffect(() => {
    const uid = viewer.uid;
    if (!uid) {
      setState({ uid: null, loading: false, failed: false, result: null });
      return;
    }

    let current = true;
    // 批次 A §4.4 H-3：uid 有值時先預載讀取段（review-lessons L-07：要接 .catch）
    loadNextActivityLoad().catch(() => undefined);
    setState({ uid, loading: true, failed: false, result: null });

    // 等待中：不發查詢；快照照舊由下方判斷是否顯示。
    if (!activeReady) {
      return () => {
        current = false;
      };
    }

    // 這一段與 HEAD 完全相同（H-3）：deps 只多了 activeReady，陣列→陣列不重跑。
    const list = activeRef.current;
    resolveNextActivity(Array.isArray(list) ? { activeEvents: list } : {}, uid)
      .then((next) => {
        if (!current) return;
        setState({ uid, loading: false, failed: false, result: next });
      })
      .catch(() => {
        if (!current) return;
        // 照 A home-next-activity.js#refreshHomeNextActivity：發生錯誤時 renderEmpty(host)；有上次內容時改保留上次內容。
        setState({ uid, loading: false, failed: true, result: null });
      });

    return () => {
      current = false;
    };
  }, [viewer.uid, activeReady]);

  const isCurrentUid = state.uid === viewer.uid;
  // L-43：登入狀態還在還原（authPending）時不是訪客，顯示載入中，不得先顯示「還沒有報名活動」。
  const authPending = !viewer.uid && viewer.authPending === true;
  const loading = authPending || (Boolean(viewer.uid) && (!isCurrentUid || state.loading));
  const confirmed = Boolean(viewer.uid) && isCurrentUid && !state.loading && !state.failed;
  const candidate = confirmed ? state.result : null;

  const visibleList = candidate
    ? getVisibleEvents(
        [candidate.event],
        viewer,
        candidate.registration ? [candidate.registration] : [],
      )
    : [];
  const confirmedEvent = visibleList[0] ?? null;

  // 上次內容可用的條件：活動還沒開始（每次 render 都重新判斷，頁面開著期間活動開始後，下一次 render 就撤掉），且帳號已確認、owner 相同（讀取中或讀取失敗）；
  // 或帳號還在還原、但「上次已登入」旗標在——這段刻意不比對 owner（還不知道是誰），是站長 2026-11-19 同意的放寬，
  // 帳號一確認就改比對 owner，不符立刻撤掉。
  const snapshotUsable = snapshot !== null && !confirmed
    && (parseEventDateRange(snapshot.result.event.date)?.startMs ?? 0) > Date.now()
    && (viewer.uid ? snapshot.owner === viewer.uid : authPending && readAuthHint());
  const shown = confirmed ? candidate : snapshotUsable ? snapshot.result : null;
  const visibleEvent = confirmed ? confirmedEvent : snapshotUsable ? snapshot.result.event : null;
  const stale = !confirmed && snapshotUsable;
  const showLoading = loading && !stale;

  // 讀完確定的結果才更新快照：畫面要顯示的那場就存，確定沒有就刪。讀取失敗不動。
  // 寫入端延遲載入（首頁入口 JS 預算），見 loadSnapshotWriter。
  const confirmedUid = confirmed ? viewer.uid : null;
  // 帳號一確認、本機快照屬於別的帳號就刪掉，不等讀取結果（顧問 §3.342）。刪除放在延遲載入的寫入端（入口 JS 預算），
  // 寫入端內再讀一次 owner 才刪，不會誤刪同帳號剛寫入的快照。
  const foreignSnapshot = Boolean(viewer.uid) && snapshot !== null && snapshot.owner !== viewer.uid;
  useEffect(() => {
    const uid = viewer.uid;
    if (!uid || !foreignSnapshot) return;
    loadSnapshotWriter()
      .then((m) => m.removeNextActivitySnapshotOfOthers(uid))
      .catch(() => undefined);
  }, [viewer.uid, foreignSnapshot]);

  // 寫入端還在載入時帳號已換（登出、換帳號）或元件已卸載：取消這次寫入／刪除，避免把前一個帳號的結果寫成快照、或刪掉新帳號的快照。
  useEffect(() => {
    if (!confirmedUid) return undefined;
    let live = true;
    const save = candidate && confirmedEvent ? candidate : null;
    loadSnapshotWriter()
      .then((m) => {
        if (!live) return;
        if (save) m.writeNextActivitySnapshot(confirmedUid, save);
        else m.removeNextActivitySnapshot();
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [confirmedUid, candidate, confirmedEvent]);

  const rawImage =
    (visibleEvent?.imageVariants as { homeNext?: string; cover?: string } | undefined)?.homeNext
    || visibleEvent?.imageVariants?.cover
    || visibleEvent?.image
    || FALLBACK_IMAGE;
  // 第一張就用活動圖。預設封面只在這張網址載入失敗後才換，避免先打一趟 LOGO 再換真圖。
  const imgSrc = brokenUrl === rawImage ? FALLBACK_IMAGE : rawImage;

  const statusMeta = registrationStatusMeta(
    shown?.registration ?? (shown?.managedRole ? { managedRole: shown.managedRole } : null),
  );

  return (
    <section class="home-next-activity-section" id="home-next-activity" aria-live="polite">
      <div class={!loading && !visibleEvent ? 'home-next-card is-empty' : 'home-next-card'}>
        <div class="home-next-head">
          <h3>我的下一場活動</h3>
          {stale && loading ? <span class="home-refresh-pill" role="status">更新中</span> : null}
          <button
            class="home-next-view-all"
            type="button"
            data-home-next-action="all"
            onClick={onViewAll}
          >
            查看全部
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.3"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>

        {showLoading ? (
          <div class="home-next-loading" role="status" aria-label="載入中">
            <div class="home-next-loading-img skeleton" />
            <div class="home-next-loading-lines">
              <span class="skeleton" />
              <span class="skeleton" />
              <span class="skeleton short" />
            </div>
          </div>
        ) : visibleEvent ? (
          <div class="home-next-event">
            <button
              class="home-next-cover"
              type="button"
              data-home-next-action="detail"
              aria-label="查看活動"
              onClick={() => onOpenDetail(visibleEvent)}
            >
              <img
                src={imgSrc}
                alt={visibleEvent.title || '未命名活動'}
                width={1000}
                height={750}
                loading="lazy"
                decoding="async"
                onError={() => {
                  if (rawImage !== FALLBACK_IMAGE) setBrokenUrl(rawImage);
                }}
              />
            </button>
            <div class="home-next-event-main">
              <h4>{visibleEvent.title || '未命名活動'}</h4>
              <div class="home-next-meta-row">
                <span class="home-next-meta">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.1"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4" />
                    <path d="M8 2v4" />
                    <path d="M3 10h18" />
                  </svg>
                  <span>{formatNextActivityDateRange(visibleEvent)}</span>
                </span>
                <span class="home-next-meta">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>{visibleEvent.location || '地點待補'}</span>
                </span>
                <span class={`home-next-status-pill home-next-status-${statusMeta.key}`}>
                  {statusMeta.label}
                </span>
              </div>
            </div>
            <div class="home-next-event-actions">
              <button
                class="home-next-primary"
                type="button"
                data-home-next-action="detail"
                onClick={() => onOpenDetail(visibleEvent)}
              >
                查看活動
              </button>
              <button
                class={stale ? 'home-next-outline is-pending' : 'home-next-outline'}
                type="button"
                data-home-next-action="calendar"
                aria-disabled={stale ? 'true' : undefined}
                onClick={() => {
                  // 上次內容的時間可能已改：讀到新資料前不寫行事曆。
                  if (!stale) onAddToCalendar(visibleEvent);
                }}
              >
                <span>加入行事曆</span>
              </button>
            </div>
          </div>
        ) : (
          <div class="home-next-empty">
            <svg class="home-next-empty-art" viewBox="0 0 160 130" fill="none" aria-hidden="true">
              <defs>
                <linearGradient id="hne-art-a" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" style="stop-color:var(--hne-g1)" />
                  <stop offset="1" style="stop-color:var(--hne-g2)" />
                </linearGradient>
                <linearGradient id="hne-art-b" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" style="stop-color:var(--hne-g1)" stop-opacity=".5" />
                  <stop offset="1" style="stop-color:var(--hne-g2)" stop-opacity=".12" />
                </linearGradient>
              </defs>
              <circle cx="104" cy="70" r="52" stroke="url(#hne-art-a)" stroke-opacity=".35" stroke-width="1.6" />
              <circle cx="104" cy="70" r="36" stroke="url(#hne-art-a)" stroke-opacity=".25" stroke-width="1.4" stroke-dasharray="3 5" />
              <rect x="40" y="26" width="86" height="78" rx="14" fill="url(#hne-art-b)" stroke="url(#hne-art-a)" stroke-width="2.6" />
              <path d="M40 50h86" stroke="url(#hne-art-a)" stroke-width="2.6" />
              <path d="M64 18v16M102 18v16" stroke="url(#hne-art-a)" stroke-width="3.4" stroke-linecap="round" />
              <g fill="url(#hne-art-a)" opacity=".85">
                <rect x="52" y="62" width="12" height="11" rx="3.5" />
                <rect x="71" y="62" width="12" height="11" rx="3.5" />
                <rect x="90" y="62" width="12" height="11" rx="3.5" />
                <rect x="52" y="81" width="12" height="11" rx="3.5" />
                <rect x="71" y="81" width="12" height="11" rx="3.5" />
              </g>
              <rect x="90" y="81" width="12" height="11" rx="3.5" stroke="url(#hne-art-a)" stroke-width="2" stroke-dasharray="3 2.5" />
              <g transform="translate(122 96)">
                <circle r="22" style="fill:var(--bg-card)" fill-opacity=".85" stroke="url(#hne-art-a)" stroke-width="2.6" />
                <path d="M0-9l8.8 6.4-3.4 10.3H-5.4l-3.4-10.3z" fill="url(#hne-art-a)" />
                <path d="M0-9V-22M8.8-2.6l12-3.9M5.4 7.7l7.4 10.2M-5.4 7.7l-7.4 10.2M-8.8-2.6l-12-3.9" stroke="url(#hne-art-a)" stroke-width="2.2" stroke-linecap="round" />
              </g>
              <g fill="url(#hne-art-a)">
                <path d="M140 22l2.6 6.8 6.8 2.6-6.8 2.6-2.6 6.8-2.6-6.8-6.8-2.6 6.8-2.6z" />
                <path d="M26 14l1.5 3.8 3.8 1.5-3.8 1.5L26 24.6l-1.5-3.8-3.8-1.5 3.8-1.5z" opacity=".7" />
                <circle cx="148" cy="56" r="2.4" opacity=".6" />
              </g>
            </svg>
            <div class="home-next-empty-copy">
              <div class="home-next-empty-title">你目前還沒有報名活動</div>
              <div class="home-next-empty-sub">找一場活動，或建立你的第一場活動</div>
            </div>
            <div class="home-next-empty-actions">
              <button
                class="home-next-primary"
                type="button"
                data-home-next-action="find"
                onClick={onFindActivity}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <span>找活動</span>
              </button>
              <button
                class="home-next-outline"
                type="button"
                data-home-next-action="create"
                onClick={onCreateEvent}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
                <span>我要開團</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
