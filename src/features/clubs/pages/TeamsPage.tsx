import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { Text } from '@/ui/Text';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { SPORTS } from '@/features/events/data/sports';
import {
  filterTeams,
  getTeamCategoryMeta,
  getTeamCategoryOptions,
  getTeamCoverImageUrl,
  getTeamRank,
  getTeamThemeColor,
  sortTeams,
} from '../data/team-list-model';
import { loadTeams } from '../data/teams-repo';
import type { TeamDoc } from '../data/types';
import '../clubs.css';

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; teams: TeamDoc[] };

function CategoryIcon({ category }: { category: string }): JSX.Element {
  const paths: Record<string, JSX.Element> = {
    none: <><circle cx="12" cy="12" r="8" /><path d="m7 17 10-10" /></>,
    competitive: <><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0zM5 5H3v2a3 3 0 0 0 3 3M19 5h2v2a3 3 0 0 1-3 3" /></>,
    education: <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></>,
    leisure: <><circle cx="12" cy="12" r="5" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[category] ?? <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>}
    </svg>
  );
}

function TeamCard({ team }: { team: TeamDoc }): JSX.Element {
  const t = useT();
  const category = getTeamCategoryMeta(team);
  const rank = getTeamRank(team.teamExp);
  const image = getTeamCoverImageUrl(team, 'card');
  const theme = getTeamThemeColor(team);
  const id = team.id || team._docId || '';
  const bodyStyle = theme
    ? {
        background: team.themeOverlayEnabled === false
          ? theme
          : `color-mix(in srgb, ${theme} 22%, var(--color-bg-surface))`,
      }
    : undefined;

  return (
    <a
      href={`/teams/${encodeURIComponent(id)}`}
      class={`clubs-card${team.pinned ? ' clubs-card--pinned' : ''}`}
      aria-label={team.name || t('clubs.unnamed')}
    >
      <div class={`clubs-card__media${image ? '' : ' clubs-card__media--empty'}`}>
        {image
          ? <img src={image} alt="" width="800" height="800" loading="lazy" decoding="async" />
          : <Text>{t('clubs.coverPlaceholder')}</Text>}
        {team.pinned && (
          <span class="clubs-card__pin"><Text>{t('clubs.pinned')}</Text></span>
        )}
        {category.key !== 'none' && (
          <span class={`clubs-card__ribbon clubs-category--${category.key}`}>
            <Text>{t(category.labelKey)}</Text>
          </span>
        )}
        <span class="clubs-card__rank" style={{ color: rank.color }}>
          <Text class="clubs-card__score">{(team.teamExp ?? 0).toLocaleString()}</Text>
          <Text>{rank.rank}</Text>
        </span>
      </div>
      <div class="clubs-card__body" style={bodyStyle}>
        <Text as="h2" class="clubs-card__name">{team.name || t('clubs.unnamed')}</Text>
        <div class="clubs-card__info">
          <Text>{t('clubs.members')}</Text>
          <Text>{t('clubs.people', { count: team.members ?? 0 })}</Text>
        </div>
        <div class="clubs-card__info">
          <Text>{t('clubs.region')}</Text>
          <Text>{team.region || t('clubs.notSet')}</Text>
        </div>
      </div>
    </a>
  );
}

export default function TeamsPage(): JSX.Element {
  const t = useT();
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sportTag, setSportTag] = useState('');
  const [typeTab, setTypeTab] = useState('');
  const sequence = useRef(0);

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
    return () => { disposed = true; };
  }, [attempt]);

  const teams = state.status === 'ready'
    ? sortTeams(filterTeams(state.teams, { query, sportTag, typeTab }))
    : [];
  const categories = [
    { key: '', labelKey: 'clubs.all' },
    ...getTeamCategoryOptions(),
  ];

  return (
    <section class="clubs-page">
      <header class="clubs-list-header">
        <a class="clubs-icon-button" href="/" aria-label={t('clubs.back')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </a>
        <div class="clubs-list-header__title">
          <Text as="h1">{t('clubs.title')}</Text>
          <button
            type="button"
            class="clubs-icon-button clubs-filter-toggle"
            aria-label={t('clubs.filterToggle')}
            aria-expanded={filtersOpen}
            aria-controls="clubs-filter-panel"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" />
            </svg>
          </button>
        </div>
      </header>

      <div id="clubs-filter-panel" class="clubs-filters" hidden={!filtersOpen}>
        <Input
          type="search"
          label={t('clubs.search')}
          placeholder={t('clubs.searchPlaceholder')}
          value={query}
          onValueChange={setQuery}
        />
        <Select
          label={t('clubs.sport')}
          value={sportTag}
          onValueChange={setSportTag}
          options={[
            { value: '', label: t('clubs.allSports') },
            ...SPORTS.map((sport) => ({
              value: sport.sportTag,
              label: t(`events.sport.${sport.key}`),
            })),
          ]}
        />
      </div>

      <div class="clubs-categories" role="group" aria-label={t('clubs.categories')}>
        {categories.map((category) => (
          <button
            key={category.key}
            type="button"
            class="clubs-category-tab"
            aria-pressed={typeTab === category.key}
            onClick={() => setTypeTab(category.key)}
          >
            <CategoryIcon category={category.key} />
            <Text>{t(category.labelKey)}</Text>
          </button>
        ))}
      </div>

      {state.status === 'loading' && (
        <div role="status" class="clubs-loading">
          <Text>{t('clubs.loading')}</Text>
          <div class="clubs-grid" aria-hidden="true">
            <div class="clubs-skeleton" /><div class="clubs-skeleton" />
          </div>
        </div>
      )}
      {state.status === 'error' && (
        <div role="alert" class="clubs-feedback">
          <Text>{t('clubs.loadError')}</Text>
          <Button onClick={() => setAttempt((value) => value + 1)}>
            {t('clubs.retry')}
          </Button>
        </div>
      )}
      {state.status === 'ready' && (
        teams.length > 0
          ? <div class="clubs-grid">{teams.map((team, index) => (
              <TeamCard key={team.id || team._docId || index} team={team} />
            ))}</div>
          : <EmptyState title={t('clubs.empty')} body={t('clubs.emptyHint')} />
      )}
    </section>
  );
}
