// 站內賽事卡。結構對預覽 harness 的 tc-card／cpl-cover。封面只吃 CSS，不讀圖。
// 預覽沒有「建立賽事」。這顆鈕是第 2 步既有入口，留在篩選列下方，文案沿用建立賽事。

import type { JSX } from 'preact';
import { useId } from 'preact/hooks';
import type { CompetitionsT } from '../i18n';
import type { InAppListCard, InAppStatusFilter, InAppStatusLine } from '../data/list-cards';
import { IN_APP_STATUS_FILTERS } from '../data/list-cards';
import type { CompetitionCategory } from '../data/types';
import type { CompetitionPhase } from '../data/present';

function TrophyGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9 17h6" />
    </svg>
  );
}

function BallGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7l4 3-1.5 4.5h-5L8 10z" />
      <path d="M12 3v4M21 10l-5 0M3 10l5 0M7 20l2.5-5.5M17 20l-2.5-5.5" />
    </svg>
  );
}

function HandGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
    </svg>
  );
}

function DefaultCover({ cat }: { cat: CompetitionCategory }): JSX.Element {
  return (
    <div class={`tc-card-img cpl-cover cpl-cover--${cat}`} aria-hidden="true">
      <span class="cpl-cover__glyph">
        {cat === 'cup' ? <TrophyGlyph /> : cat === 'league' ? <BallGlyph /> : <HandGlyph />}
      </span>
    </div>
  );
}

const CAT_KEY: Record<CompetitionCategory, 'catLeague' | 'catCup' | 'catFriendly'> = {
  league: 'catLeague',
  cup: 'catCup',
  friendly: 'catFriendly',
};

function statusKey(phase: CompetitionPhase): 'recruiting' | 'statusWarm' | 'statusLive' | 'statusDone' {
  if (phase === 'recruit') return 'recruiting';
  if (phase === 'warm') return 'statusWarm';
  if (phase === 'live') return 'statusLive';
  return 'statusDone';
}

function lineText(ct: CompetitionsT, line: InAppStatusLine): string {
  if (line.kind === 'deadline') return ct('lineDeadline', { date: line.date });
  if (line.kind === 'warm') return ct('lineWarm', { n: line.days });
  if (line.kind === 'live') return ct('lineToday', { n: line.count, time: line.time });
  return ct('lineTodayOnly', { n: line.count });
}

const FILTER_KEY: Record<InAppStatusFilter, 'statusOpen' | 'recruiting' | 'statusWarm' | 'statusLive' | 'statusDone' | 'filterAll'> = {
  open: 'statusOpen',
  recruit: 'recruiting',
  warm: 'statusWarm',
  live: 'statusLive',
  done: 'statusDone',
  all: 'filterAll',
};

function InCard({ card, ct, onOpen }: {
  card: InAppListCard;
  ct: CompetitionsT;
  onOpen: (cid: string, event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => void;
}): JSX.Element {
  const line = card.line ? lineText(ct, card.line) : '';
  const highlight = card.phase !== 'recruit' && card.phase !== null && line !== '';
  const pill = card.statusMark === 'postponed'
    ? { mark: 'postponed', label: ct('compPostponed') }
    : card.statusMark === 'cancelled'
      ? { mark: 'cancelled', label: ct('cancelled') }
      : card.phase
        ? { mark: card.phase, label: ct(statusKey(card.phase)) }
        : null;
  return (
    <div class={`tc-card cpl-card${card.ended ? ' ended' : ''}`} data-cid={card.cid} data-phase={card.phase ?? 'unknown'}>
      <a class="tc-card-link" href={`/competitions/${card.cid}`} onClick={(event) => onOpen(card.cid, event)}>
        <div class="cpl-cover-wrap">
          <DefaultCover cat={card.category} />
          {pill ? <span class={`cpl-st cpl-st--${pill.mark}`}><i />{pill.label}</span> : null}
        </div>
        <div class="tc-card-body">
          <div class="tc-card-text">
            <div class="tc-card-name">{card.name}</div>
            {card.dates ? <div class="tc-card-dates">{card.dates}</div> : null}
            {line ? <div class={`cpl-line${highlight ? ' cpl-line--hl' : ''}`}>{line}</div> : null}
          </div>
          <span class={`tc-chip cpl-chip cpl-chip--${card.category}`}>{ct(CAT_KEY[card.category])}</span>
        </div>
      </a>
    </div>
  );
}

export function InAppCardList({
  cards,
  ct,
  status,
  onlyMine,
  showCreate,
  onStatus,
  onOnlyMine,
  onCreate,
  onOpen,
}: {
  cards: readonly InAppListCard[];
  ct: CompetitionsT;
  status: InAppStatusFilter;
  onlyMine: boolean;
  showCreate: boolean;
  onStatus: (value: InAppStatusFilter) => void;
  onOnlyMine: (value: boolean) => void;
  onCreate: () => void;
  onOpen: (cid: string, event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => void;
}): JSX.Element {
  const statusId = useId();
  const onlyMineId = useId();
  return (
    <div data-inapp="competitions">
      {showCreate ? (
        <div class="cpl-create">
          <button type="button" class="primary-btn small" onClick={onCreate}>{ct('createAction')}</button>
        </div>
      ) : null}
      <div class="tc-toolbar cpl-toolbar">
        <label class="cpl-select" for={statusId}>
          <select
            id={statusId}
            aria-label={ct('statusLabel')}
            value={status}
            onChange={(event) => {
              const value = event.currentTarget.value as InAppStatusFilter;
              if ((IN_APP_STATUS_FILTERS as readonly string[]).includes(value)) onStatus(value);
            }}
          >
            {IN_APP_STATUS_FILTERS.map((value) => (
              <option key={value} value={value}>{ct(FILTER_KEY[value])}</option>
            ))}
          </select>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </label>
        <label for={onlyMineId}>
          <span>{ct('onlyMine')}</span>
          <span class="toggle-switch">
            <input
              type="checkbox"
              id={onlyMineId}
              checked={onlyMine}
              onChange={(event) => onOnlyMine(event.currentTarget.checked)}
            />
            <span class="toggle-slider" />
          </span>
        </label>
      </div>
      {cards.map((card) => <InCard key={card.cid} card={card} ct={ct} onOpen={onOpen} />)}
    </div>
  );
}
