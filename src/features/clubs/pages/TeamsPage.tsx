import { UNAVAILABLE_FEATURE_MSG } from '@/core/unavailable';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import {
  getActiveSport,
  resolveTeamSportFilterSync,
  useActiveSport,
} from '@/core/sport-filter';
import { getLastKnownAuthUid } from '@/data/auth';
import { lt, useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { useViewer } from '@/features/profile/data/viewer';
import { SPORTS } from '@/features/events/data/sports';
import { resolveClubDetailAccess } from '../club-policy';
import { LegacyTeamCard } from '../components/legacy/LegacyTeamCard';
import {
  filterTeams,
  normalizeTeamCategory,
  sortTeams,
} from '../data/team-list-model';
import { loadTeams } from '../data/teams-repo';
import type { TeamDoc } from '../data/types';
import { getClubListFilters, saveClubListFilters } from './clubs-list-session';
import { loginForClubs } from './clubs-session';
import '../legacy/team.css';

/** M-114：照 A `filterTeams`，最後一次變動起算 300ms 才套到列表。 */
const FILTER_APPLY_MS = 300;
/** M-115：照 A `_teamCardPendingDelayMs`。 */
const CARD_PENDING_DELAY_MS = 150;
const CARD_PROGRESS_INTERVAL_MS = 100;
/** 列表仍掛載超過這段時間，視為換頁失敗。 */
const CARD_PENDING_GIVE_UP_MS = 10_000;

interface AppliedListFilters {
  query: string;
  region: string;
  sportTag: string;
  typeTab: string;
}

function sameAppliedFilters(a: AppliedListFilters, b: AppliedListFilters): boolean {
  return (
    a.query === b.query
    && a.region === b.region
    && a.sportTag === b.sportTag
    && a.typeTab === b.typeTab
  );
}

/** M-115：照 A `_showTeamCardPending` 每 100ms 的增量，上限 85。 */
function nextClubCardProgress(progress: number): number {
  const inc = progress < 30 ? 4 : progress < 60 ? 2 : progress < 80 ? 0.5 : 0.15;
  return Math.min(progress + inc, 85);
}

/**
 * 點卡後 150ms 才亮載入條，之後每 100ms 推進進度。
 * 顯示中的 id 必須仍是目前 pending，換卡或清除時立刻收掉舊的。
 */
function useClubCardPendingVisual(pendingTeamId: string | null): {
  visibleTeamId: string | null;
  progress: number;
} {
  const [shownTeamId, setShownTeamId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!pendingTeamId) {
      setShownTeamId(null);
      setProgress(0);
      return;
    }
    setShownTeamId(null);
    setProgress(0);
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const delayId = setTimeout(() => {
      setShownTeamId(pendingTeamId);
      setProgress(0);
      intervalId = setInterval(() => {
        setProgress((value) => nextClubCardProgress(value));
      }, CARD_PROGRESS_INTERVAL_MS);
    }, CARD_PENDING_DELAY_MS);
    return () => {
      clearTimeout(delayId);
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, [pendingTeamId]);

  const visibleTeamId = shownTeamId !== null && shownTeamId === pendingTeamId
    ? shownTeamId
    : null;
  return {
    visibleTeamId,
    progress: visibleTeamId !== null ? progress : 0,
  };
}

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; teams: TeamDoc[] };

// U-020：共用 core/unavailable 的提示文字。
const UNAVAILABLE_MSG = UNAVAILABLE_FEATURE_MSG;

const TAIWAN_REGIONS = [
  '台北市',
  '新北市',
  '桃園市',
  '台中市',
  '台南市',
  '高雄市',
  '基隆市',
  '新竹市',
  '嘉義市',
  '新竹縣',
  '苗栗縣',
  '彰化縣',
  '南投縣',
  '雲林縣',
  '嘉義縣',
  '屏東縣',
  '宜蘭縣',
  '花蓮縣',
  '台東縣',
  '澎湖縣',
  '金門縣',
  '連江縣',
] as const;

function toTeamSportValue(globalSport: string): string {
  return globalSport && globalSport !== 'all' ? globalSport : '';
}

export default function TeamsPage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const location = useLocation();
  const [globalSport] = useActiveSport();

  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // M-114：返回列表時還原搜尋字、地區、類型頁籤、篩選面板。運動不在這份記憶裡。
  const [restoredFilters] = useState(() => getClubListFilters());
  const [filtersOpen, setFiltersOpen] = useState(restoredFilters.filtersOpen);
  const [query, setQuery] = useState(restoredFilters.query);
  const [sportTag, setSportTag] = useState<string>(() => toTeamSportValue(getActiveSport()));
  const [region, setRegion] = useState(restoredFilters.region);
  const [typeTab, setTypeTab] = useState(restoredFilters.typeTab);
  // ASSUMPTION: 重新掛載時 applied 直接採用 session 的即時篩選，不再等 300ms，返回後列表與輸入框一致。
  const [applied, setApplied] = useState<AppliedListFilters>(() => ({
    query: restoredFilters.query,
    region: restoredFilters.region,
    sportTag: toTeamSportValue(getActiveSport()),
    typeTab: restoredFilters.typeTab,
  }));
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);
  const { visibleTeamId, progress } = useClubCardPendingVisual(pendingTeamId);
  const sequence = useRef(0);
  const syncedGlobalSportRef = useRef<string>(toTeamSportValue(getActiveSport()));
  const appliedRef = useRef(applied);
  appliedRef.current = applied;
  const filterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const failTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTeamIdRef = useRef<string | null>(null);
  // M-119：訪客登入進行中不再 toast／route／signIn。結束（含失敗）後解鎖。
  const loginLockRef = useRef(false);

  // M-020：照 A `team-list.js#_syncTeamSportFilterWithGlobal` 與頂部全站運動篩選同步（force: true）
  useEffect(() => {
    const resolved = resolveTeamSportFilterSync(
      sportTag,
      syncedGlobalSportRef.current,
      globalSport,
      true,
    );
    syncedGlobalSportRef.current = resolved.syncedGlobalSport;
    if (sportTag !== resolved.value) {
      setSportTag(resolved.value);
    }
  }, [globalSport]);

  // ASSUMPTION: 照 A `_canCreateTeamByPermission()` 檢查 `team.create` 權限決定「新增俱樂部」按鈕是否顯示。
  const canCreateTeam = useMemo(
    () => viewer.hasPermission('team.create'),
    [viewer],
  );

  useEffect(() => {
    const current = ++sequence.current;
    let disposed = false;
    setState({ status: 'loading' });
    loadTeams().then(
      (teams) => {
        if (!disposed && sequence.current === current) {
          setState({ status: 'ready', teams });
        }
      },
      () => {
        if (!disposed && sequence.current === current) {
          setState({ status: 'error' });
        }
      },
    );
    return () => {
      disposed = true;
    };
  }, [attempt]);

  // 寫即時值，不是 applied。運動不寫入。
  useEffect(() => {
    saveClubListFilters({ query, region, typeTab, filtersOpen });
  }, [query, region, typeTab, filtersOpen]);

  // 控制項立刻反映在 state；列表只吃 300ms 後的 applied。卸載時清 timer。
  useEffect(() => {
    const next: AppliedListFilters = { query, region, sportTag, typeTab };
    if (sameAppliedFilters(next, appliedRef.current)) return;
    if (filterTimerRef.current !== null) {
      clearTimeout(filterTimerRef.current);
    }
    filterTimerRef.current = setTimeout(() => {
      filterTimerRef.current = null;
      setApplied(next);
    }, FILTER_APPLY_MS);
    return () => {
      if (filterTimerRef.current !== null) {
        clearTimeout(filterTimerRef.current);
        filterTimerRef.current = null;
      }
    };
  }, [query, region, sportTag, typeTab]);

  useEffect(() => {
    return () => {
      if (focusFrameRef.current !== null) {
        cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
      if (failTimerRef.current !== null) {
        clearTimeout(failTimerRef.current);
        failTimerRef.current = null;
      }
    };
  }, []);

  const hasActiveFilters = Boolean(query.trim() || sportTag || region);
  const filterBtnActive = filtersOpen || hasActiveFilters;
  // 照 A team-list.js `_doFilterTeams`：只選類型頁籤也算篩過，無結果用 team.noMatch。
  const appliedHasActiveFilters = Boolean(
    applied.query.trim() || applied.sportTag || applied.region || applied.typeTab !== '',
  );

  const sortedTeams = useMemo(() => {
    if (state.status !== 'ready') return [];
    const filtered = filterTeams(state.teams, {
      query: applied.query,
      region: applied.region,
      sportTag: applied.sportTag,
      typeTab: applied.typeTab,
    });
    return sortTeams(filtered);
  }, [state, applied]);

  function switchTeamTypeTab(rawType: string): void {
    const nextType = rawType ? normalizeTeamCategory(rawType) : '';
    setTypeTab(
      ['none', 'competitive', 'education', 'leisure'].includes(nextType)
        ? nextType
        : '',
    );
  }

  function handleOpenCreate(): void {
    // 下一批補：新增俱樂部表單
    toast.show({ message: UNAVAILABLE_MSG });
  }

  function handleToggleFilters(): void {
    const nextOpen = !filtersOpen;
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
    if (nextOpen) {
      // M-114：照 A `toggleTeamFilterPanel`，展開後下一幀聚焦 #team-search；收合不聚焦。
      focusFrameRef.current = requestAnimationFrame(() => {
        focusFrameRef.current = null;
        const panel = document.getElementById('team-filter-panel');
        if (!panel || panel.hidden) return;
        const search = document.getElementById('team-search');
        if (search instanceof HTMLInputElement) {
          search.focus({ preventScroll: true });
        }
      });
    }
    setFiltersOpen(nextOpen);
  }

  function handleSelectTeam(teamId: string): void {
    if (!teamId) return;
    // M-119：照 A team-detail.js:997-1000。先換成詳情網址再 signIn，redirectUri 才是這頁。
    // 只有 login-required 走訪客登入；pending／allowed 交給詳情頁，並維持點卡 pending。
    const access = resolveClubDetailAccess(viewer, getLastKnownAuthUid());
    if (access === 'login-required') {
      if (loginLockRef.current) return;
      loginLockRef.current = true;
      toast.show({ message: lt('請先登入 LINE 帳號', '請先登入 LINE 帳號') });
      location.route(`/teams/${encodeURIComponent(teamId)}`);
      void (async () => {
        try {
          await loginForClubs();
        } catch {
          toast.show({ message: t('clubs.actionError'), tone: 'error' });
        } finally {
          loginLockRef.current = false;
        }
      })();
      return;
    }
    // 同一張卡已在 pending 時不再 route。
    if (pendingTeamIdRef.current === teamId) return;
    if (failTimerRef.current !== null) {
      clearTimeout(failTimerRef.current);
      failTimerRef.current = null;
    }
    pendingTeamIdRef.current = teamId;
    setPendingTeamId(teamId);
    // ASSUMPTION: lazy 換頁失敗不會丟出拒絕；列表若 10 秒後仍掛載就清回饋並提示。
    // 換卡會重計這 10 秒；同一張卡重點直接 return，不重計。
    failTimerRef.current = setTimeout(() => {
      failTimerRef.current = null;
      pendingTeamIdRef.current = null;
      setPendingTeamId(null);
      toast.show({
        message: lt('俱樂部頁面載入失敗，請稍後再試', '俱樂部頁面載入失敗，請稍後再試'),
        tone: 'error',
      });
    }, CARD_PENDING_GIVE_UP_MS);
    location.route(`/teams/${encodeURIComponent(teamId)}`);
  }

  const emptyMessage = appliedHasActiveFilters
    ? lt('team.noMatch', '找不到符合的俱樂部')
    : '此類型尚無俱樂部';

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-teams">
        <div class="page-header">
          <button
            class="back-btn"
            type="button"
            aria-label={lt('返回', '返回')}
            data-i18n-aria-label="返回"
            onClick={() => location.route('/')}
          >
            <svg
              class="back-btn-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M15 6l-6 6 6 6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <div class="team-page-title-wrap">
            <h2 class="page-header-title" data-i18n="俱樂部">
              {lt('俱樂部', '俱樂部')}
            </h2>
            <button
              class={`team-filter-toggle-btn${filterBtnActive ? ' active' : ''}`}
              id="team-filter-toggle-btn"
              type="button"
              aria-label={lt('搜尋與篩選俱樂部', '搜尋與篩選俱樂部')}
              aria-expanded={filtersOpen ? 'true' : 'false'}
              aria-controls="team-filter-panel"
              data-i18n-aria-label="搜尋與篩選俱樂部"
              onClick={handleToggleFilters}
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
                <path d="m16.2 16.2 4 4" />
              </svg>
            </button>
          </div>
          {/* 下一批補：新增俱樂部 */}
          <button
            type="button"
            class="primary-btn small"
            id="team-page-create-btn"
            style={canCreateTeam ? undefined : 'display:none'}
            data-i18n="新增俱樂部"
            onClick={handleOpenCreate}
          >
            {lt('新增俱樂部', '新增俱樂部')}
          </button>
        </div>

        <div
          class="team-search-bar team-filter-panel"
          id="team-filter-panel"
          hidden={!filtersOpen}
          aria-hidden={filtersOpen ? 'false' : 'true'}
        >
          <input
            type="text"
            id="team-search"
            value={query}
            placeholder={lt('搜尋俱樂部名稱...', '搜尋俱樂部名稱...')}
            data-i18n-placeholder="搜尋俱樂部名稱..."
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <select
            id="team-sport-filter"
            value={sportTag}
            data-synced-global-sport={syncedGlobalSportRef.current}
            onChange={(e) => setSportTag(e.currentTarget.value)}
          >
            <option value="" data-i18n="全部運動">
              {lt('全部運動', '全部運動')}
            </option>
            {SPORTS.map((item) => (
              <option key={item.key} value={item.sportTag}>
                {/* A _initTeamListSportFilter：emoji＋空格＋名稱 */}
                {`${item.symbol} ${item.label}`}
              </option>
            ))}
          </select>
          <select
            id="team-region-filter"
            value={region}
            onChange={(e) => setRegion(e.currentTarget.value)}
          >
            <option value="" data-i18n="全部地區">
              {lt('全部地區', '全部地區')}
            </option>
            {TAIWAN_REGIONS.map((reg) => (
              <option key={reg} value={reg} data-i18n={reg}>
                {lt(reg, reg)}
              </option>
            ))}
          </select>
        </div>

        <div class="team-type-tabs" id="team-type-tabs">
          <button
            type="button"
            class={`team-type-tab${typeTab === '' ? ' active' : ''}`}
            data-type=""
            onClick={() => switchTeamTypeTab('')}
          >
            <svg
              class="team-tab-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            <span data-i18n="全部">{lt('全部', '全部')}</span>
          </button>
          <button
            type="button"
            class={`team-type-tab${typeTab === 'none' ? ' active' : ''}`}
            data-type="none"
            onClick={() => switchTeamTypeTab('none')}
          >
            <svg
              class="team-tab-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="8" />
              <path d="m7.5 16.5 9-9" />
            </svg>
            <span data-i18n="無">{lt('無', '無')}</span>
          </button>
          <button
            type="button"
            class={`team-type-tab${typeTab === 'competitive' ? ' active' : ''}`}
            data-type="competitive"
            onClick={() => switchTeamTypeTab('competitive')}
          >
            <svg
              class="team-tab-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M8 21h8" />
              <path d="M12 17v4" />
              <path d="M7 4h10v4a5 5 0 0 1-10 0z" />
              <path d="M5 5H3v2a3 3 0 0 0 3 3" />
              <path d="M19 5h2v2a3 3 0 0 1-3 3" />
            </svg>
            <span data-i18n="競技">{lt('競技', '競技')}</span>
          </button>
          <button
            type="button"
            class={`team-type-tab${typeTab === 'education' ? ' active' : ''}`}
            data-type="education"
            onClick={() => switchTeamTypeTab('education')}
          >
            <svg
              class="team-tab-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            <span data-i18n="教學">{lt('教學', '教學')}</span>
          </button>
          <button
            type="button"
            class={`team-type-tab${typeTab === 'leisure' ? ' active' : ''}`}
            data-type="leisure"
            onClick={() => switchTeamTypeTab('leisure')}
          >
            <svg
              class="team-tab-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12h14" />
              <path d="M7 12a5 5 0 0 1 10 0" />
              <path d="M7 12a5 5 0 0 0 10 0" />
              <path d="M9 15l-2 4" />
              <path d="M15 15l2 4" />
            </svg>
            <span data-i18n="休閒">{lt('休閒', '休閒')}</span>
          </button>
        </div>

        <div
          class="team-grid"
          id="team-list"
          aria-busy={state.status === 'loading' ? 'true' : undefined}
        >
          {state.status === 'loading' && (
            <>
              <div class="skeleton skeleton-team-card" />
              <div class="skeleton skeleton-team-card" />
            </>
          )}
          {state.status === 'error' && (
            <div
              role="alert"
              style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem"
            >
              <div>{t('clubs.loadError')}</div>
              <button
                type="button"
                class="outline-btn"
                style="margin-top:.65rem"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {t('clubs.retry')}
              </button>
            </div>
          )}
          {state.status === 'ready' &&
            (sortedTeams.length > 0 ? (
              sortedTeams.map((team, idx) => (
                <LegacyTeamCard
                  key={team.id || team._docId || `team-${idx}`}
                  team={team}
                  isPending={
                    visibleTeamId !== null
                    && visibleTeamId === String(team.id || team._docId || '').trim()
                  }
                  pendingProgress={progress}
                  onSelect={handleSelectTeam}
                />
              ))
            ) : (
              <div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">
                {emptyMessage}
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
