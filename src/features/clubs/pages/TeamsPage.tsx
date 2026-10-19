import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { lt, useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { useViewer } from '@/features/profile/data/viewer';
import { SPORTS } from '@/features/events/data/sports';
import { LegacyTeamCard } from '../components/legacy/LegacyTeamCard';
import {
  filterTeams,
   normalizeTeamCategory,
  sortTeams,
} from '../data/team-list-model';
import { loadTeams } from '../data/teams-repo';
import type { TeamDoc } from '../data/types';
import '../legacy/team.css';

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; teams: TeamDoc[] };

const UNAVAILABLE_MSG = '此功能尚未開放，請先使用舊版';

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

export default function TeamsPage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const location = useLocation();

  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sportTag, setSportTag] = useState('');
  const [region, setRegion] = useState('');
  const [typeTab, setTypeTab] = useState('');
  const sequence = useRef(0);

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

  const hasActiveFilters = Boolean(query.trim() || sportTag || region);
  const filterBtnActive = filtersOpen || hasActiveFilters;

  const sortedTeams = useMemo(() => {
    if (state.status !== 'ready') return [];
    const filtered = filterTeams(state.teams, {
      query,
      region,
      sportTag,
      typeTab,
    });
    return sortTeams(filtered);
  }, [state, query, region, sportTag, typeTab]);

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

  function handleSelectTeam(teamId: string): void {
    if (!teamId) return;
    location.route(`/teams/${encodeURIComponent(teamId)}`);
  }

  const emptyMessage = hasActiveFilters
    ? lt('未找到符合條件的俱樂部', '未找到符合條件的俱樂部')
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
              onClick={() => setFiltersOpen((open) => !open)}
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

        <div class="team-grid" id="team-list">
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
