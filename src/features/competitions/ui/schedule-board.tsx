// 詳情的封面、賽程、積分榜、預熱／進行中／已結束。class 對照預覽 harness 的 cp3-*。

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { Tabs } from '@/ui/Tabs';
import type { CompetitionsT } from '../i18n';
import {
  championName,
  daysUntilStart,
  divisionHeading,
  formatGoalDiff,
  groupSchedule,
  liveStrip,
  standingLines,
  type PublicMark,
  type ScheduleGroup,
} from '../data/schedule-present';
import type { CompetitionCategory, DivisionDoc, EntryDoc, StandingDoc, SummaryEntry } from '../data/types';
import type { CompetitionPhase } from '../data/present';
import { crestFromEntry, TeamCrest } from './TeamCrest';
import { CpCard } from './shell';

function CoverGlyph({ category }: { category: CompetitionCategory }): JSX.Element {
  if (category === 'cup') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9 17h6" />
      </svg>
    );
  }
  if (category === 'friendly') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7l4 3-1.5 4.5h-5L8 10z" />
      <path d="M12 3v4M21 10l-5 0M3 10l5 0M7 20l2.5-5.5M17 20l-2.5-5.5" />
    </svg>
  );
}

function TrophyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9 17h6" />
    </svg>
  );
}

function ChevronIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function categoryText(ct: CompetitionsT, category: CompetitionCategory): string {
  if (category === 'cup') return ct('categoryCup');
  if (category === 'friendly') return ct('categoryFriendly');
  return ct('categoryLeague');
}

export function CategoryCover({ category, label }: { category: CompetitionCategory; label: string }): JSX.Element {
  return (
    <div class="cp3-cover">
      <div class={`cp3-cover__def cp3-cover__def--${category}`} aria-hidden="true">
        <CoverGlyph category={category} />
      </div>
      <span class={`cp3-cover__cat cp3-cover__cat--${category}`}>{label}</span>
    </div>
  );
}

function SideName({
  entryId,
  name,
  crests,
  align,
}: {
  entryId: string;
  name: string;
  crests: readonly EntryDoc[];
  align: 'home' | 'away';
}): JSX.Element {
  const crest = crestFromEntry(entryId, name, crests);
  const mark = <TeamCrest teamId={crest.teamId} name={crest.name} teamLogo={crest.teamLogo} size={22} />;
  if (align === 'home') {
    return <span class="cp3-tn cp3-tn--h"><em>{name}</em>{mark}</span>;
  }
  return <span class="cp3-tn">{mark}<em>{name}</em></span>;
}

function standingCrest(teamId: string, name: string, crests: readonly EntryDoc[]): {
  teamId: string;
  name: string;
  teamLogo: string | null;
} {
  // ASSUMPTION: 積分列的 teamId 可能是報名文件 id，也可能是俱樂部 id。兩種都試。
  const found = crests.find((row) => row.id === teamId || row.teamId === teamId);
  if (!found) return { teamId, name, teamLogo: null };
  return { teamId: found.teamId || teamId, name: found.name || name, teamLogo: found.teamLogo };
}

function markBadge(ct: CompetitionsT, mark: PublicMark): { label: string; tone: BadgeTone } {
  if (mark === 'pending') return { label: ct('matchPending'), tone: 'warning' };
  if (mark === 'forfeit') return { label: ct('matchForfeit'), tone: 'danger' };
  return { label: ct('matchMoved'), tone: 'info' };
}

export function MatchSchedule({
  ct,
  groups,
  divisions,
  crests,
}: {
  ct: CompetitionsT;
  groups: readonly ScheduleGroup[];
  divisions: readonly DivisionDoc[];
  crests: readonly EntryDoc[];
}): JSX.Element {
  const multiple = groups.length > 1;
  return (
    <div>
      {groups.map((group) => {
        const heading = divisionHeading(group.divisionId, divisions, multiple);
        return (
          <div key={group.divisionId}>
            {heading ? <h3 class="cp3-day">{heading}</h3> : null}
            {group.days.map((day) => (
              <div key={day.key}>
                <h4 class="cp3-day">{day.label}</h4>
                <CpCard>
                  <ul class="cp3-ml">
                    {day.matches.map((match) => {
                      const badge = match.mark ? markBadge(ct, match.mark) : null;
                      return (
                        <li class="cp3-m" key={match.id}>
                          <div class="cp3-m__top">
                            {match.time == null ? (
                              <span class="cp3-m__when"><b>{ct('timeTbd')}</b></span>
                            ) : (
                              <span class="cp3-m__when">
                                <b>{match.time}</b>
                                {match.venue ? `　${match.venue}` : ''}
                              </span>
                            )}
                            {badge ? <Badge tone={badge.tone} label={badge.label} size="sm" /> : null}
                          </div>
                          <div class="cp3-m__vs">
                            <span class="h">
                              <SideName entryId={match.homeId} name={match.homeName} crests={crests} align="home" />
                            </span>
                            {match.score ? (
                              <span class="s">{match.score[0]}：{match.score[1]}</span>
                            ) : (
                              <span class="s vs">vs</span>
                            )}
                            <span class="a">
                              <SideName entryId={match.awayId} name={match.awayName} crests={crests} align="away" />
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </CpCard>
                <div style="height:12px" />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function StandingsTable({
  ct,
  docs,
  divisions,
  crests,
}: {
  ct: CompetitionsT;
  docs: readonly StandingDoc[];
  divisions: readonly DivisionDoc[];
  crests: readonly EntryDoc[];
}): JSX.Element {
  const multiple = docs.length > 1;
  return (
    <div class="cps-stack">
      {docs.map((doc) => {
        const lines = standingLines(doc);
        const heading = divisionHeading(doc.divisionId, divisions, multiple);
        return (
          <div key={doc.id}>
            {heading ? <h3 class="cp3-day">{heading}</h3> : null}
            <CpCard class="cp3-st">
              <div class="cp3-st__r cp3-st__r--h">
                <span>{ct('colRank')}</span>
                <span class="t">{ct('colTeam')}</span>
                <span>{ct('colPlayed')}</span>
                <span>{ct('colWon')}</span>
                <span>{ct('colDrawn')}</span>
                <span>{ct('colLost')}</span>
                <span>{ct('colGoals')}</span>
                <span>{ct('colDiff')}</span>
                <span>{ct('colPoints')}</span>
              </div>
              {lines.map((line) => {
                const shown = standingCrest(line.teamId, line.name, crests);
                return (
                  <div key={line.teamId} class={`cp3-st__r${line.top ? ' cp3-st__r--top' : ''}`}>
                    <span class="rk">
                      {line.rank}
                      {line.tie ? <small>{ct('tie')}</small> : null}
                    </span>
                    <span class="t">
                      <span class="cp3-tn">
                        <TeamCrest teamId={shown.teamId} name={shown.name} teamLogo={shown.teamLogo} size={20} />
                        <em>{line.name}</em>
                      </span>
                    </span>
                    <span>{line.played}</span>
                    <span>{line.won}</span>
                    <span>{line.drawn}</span>
                    <span>{line.lost}</span>
                    <span>{line.goalsFor}/{line.goalsAgainst}</span>
                    <span>{formatGoalDiff(line.goalDiff)}</span>
                    <span class="pt">{line.points}</span>
                  </div>
                );
              })}
            </CpCard>
          </div>
        );
      })}
    </div>
  );
}

function scheduleGroups(
  ct: CompetitionsT,
  summary: readonly SummaryEntry[],
  divisions: readonly DivisionDoc[],
  now: number,
): ScheduleGroup[] {
  return groupSchedule(
    summary,
    now,
    { tbd: ct('timeTbd'), today: '（今天）' },
    divisions.map((division) => division.dvId),
  );
}

function PhaseStrip({
  ct,
  phase,
  summary,
  now,
  badge,
  firstMatchAt,
}: {
  ct: CompetitionsT;
  phase: 'warm' | 'live';
  summary: readonly SummaryEntry[];
  now: number;
  badge: { label: string; tone: BadgeTone };
  firstMatchAt: number;
}): JSX.Element {
  const strip = liveStrip(summary, now);
  // ASSUMPTION: 沒有更晚的場次時只寫「今天 N 場」，不硬湊下一場時間。
  const text = phase === 'warm'
    ? ct('countdown', { n: daysUntilStart(firstMatchAt, now) })
    : (strip.next
      ? ct('todayLine', { n: strip.today, time: strip.next })
      : ct('todayOnly', { n: strip.today }));
  return (
    <CpCard>
      <div class="cp3-strip">
        <span class="cp3-strip__txt">{text}</span>
        <Badge tone={badge.tone} label={badge.label} size="sm" />
      </div>
    </CpCard>
  );
}

export function DetailPhaseBody({
  ct,
  phase,
  firstMatchAt,
  divisions,
  crests,
  summary,
  standings,
  now,
  badge,
}: {
  ct: CompetitionsT;
  phase: Exclude<CompetitionPhase, 'recruit'>;
  firstMatchAt: number;
  divisions: readonly DivisionDoc[];
  crests: readonly EntryDoc[];
  summary: readonly SummaryEntry[];
  standings: readonly StandingDoc[];
  now: number;
  badge: { label: string; tone: BadgeTone };
}): JSX.Element {
  const [tab, setTab] = useState<'sched' | 'stand'>('sched');
  const [open, setOpen] = useState(false);
  const groups = scheduleGroups(ct, summary, divisions, now);

  if (phase === 'done') {
    const name = championName(standings);
    return (
      <>
        <CpCard class="cps-card--ok">
          <div class="cp3-row">
            <div class="cp3-champ">
              <TrophyIcon />
              <div class="cp3-champ__t">
                <span class="cp3-champ__k">{ct('champion')}</span>
                {name ? <span class="cp3-champ__v">{name}</span> : null}
              </div>
            </div>
            <Badge tone={badge.tone} label={badge.label} size="sm" />
          </div>
        </CpCard>
        <StandingsTable ct={ct} docs={standings} divisions={divisions} crests={crests} />
        <CpCard>
          <button
            type="button"
            class={`cp3-fold${open ? ' cp3-fold--open' : ''}`}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span>{ct('foldSchedule', { n: summary.length })}</span>
            <ChevronIcon />
          </button>
          {open ? (
            <div style="margin-top:12px">
              <MatchSchedule ct={ct} groups={groups} divisions={divisions} crests={crests} />
            </div>
          ) : null}
        </CpCard>
      </>
    );
  }

  return (
    <>
      <PhaseStrip
        ct={ct}
        phase={phase}
        summary={summary}
        now={now}
        badge={badge}
        firstMatchAt={firstMatchAt}
      />
      <Tabs
        label={ct('detailTabs')}
        variant="underline"
        value={tab}
        onValueChange={(id) => {
          if (id === 'sched' || id === 'stand') setTab(id);
        }}
        items={[
          {
            id: 'sched',
            label: ct('tabSchedule'),
            panel: (
              <div style="margin-top:12px">
                <MatchSchedule ct={ct} groups={groups} divisions={divisions} crests={crests} />
              </div>
            ),
          },
          {
            id: 'stand',
            label: ct('tabStandings'),
            panel: (
              <div style="margin-top:12px">
                <StandingsTable ct={ct} docs={standings} divisions={divisions} crests={crests} />
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
