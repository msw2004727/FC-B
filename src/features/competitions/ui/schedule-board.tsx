// 詳情的封面、賽程、積分榜、預熱／進行中／已結束。class 對照預覽 harness 的 cp3-*。

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import { Tabs } from '@/ui/Tabs';
import type { CompetitionsT } from '../i18n';
import {
  championName,
  daysUntilStart,
  formatGoalDiff,
  groupSchedule,
  liveStrip,
  scheduleHeading,
  standingHeading,
  standingLines,
  type GroupHeading,
  type PublicMark,
  type ScheduleGroup,
} from '../data/schedule-present';
import { rankingRuleKeys } from '../data/tie-present';
import { scorerDivisions, type ScorerTables } from '../data/audience';
import type { CompetitionCategory, DivisionDoc, EntryDoc, StandingDoc, StandingRanking, SummaryEntry } from '../data/types';
import { ScorersTable } from '../live/ScorersTable';
import type { CompetitionPhase } from '../data/present';
import { pkScoreLabel } from '../live/copy';
import { LiveScoreBadge } from '../live/LiveScoreBadge';
import { crestFromEntry, TeamCrest } from './TeamCrest';
import { CpCard } from './shell';
import { StatusTag, type StatusKind } from './status-tag';

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
  logo,
}: {
  entryId: string;
  name: string;
  crests: readonly EntryDoc[];
  align: 'home' | 'away';
  /** 摘要 h.l／a.l。有值就用這張；沒有才用報名隊徽或字首。 */
  logo?: string | null;
}): JSX.Element {
  const crest = crestFromEntry(entryId, name, crests);
  const mark = <TeamCrest teamId={crest.teamId} name={crest.name} teamLogo={logo || crest.teamLogo} size={22} />;
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
  // 首字跟畫面上顯示的隊名一致；報隊資料只用來取隊徽圖片（截圖驗收：兩個來源名稱不一致時首字會對不上）
  return { teamId: found.teamId || teamId, name: name || found.name, teamLogo: found.teamLogo };
}

function markBadge(ct: CompetitionsT, mark: PublicMark): { label: string; kind: StatusKind } {
  if (mark === 'pending') return { label: ct('matchPending'), kind: 'neutral' };
  if (mark === 'forfeit') return { label: ct('matchForfeit'), kind: 'neutral' };
  if (mark === 'cancelled') return { label: ct('matchCancelled'), kind: 'cancelled' };
  return { label: ct('matchMoved'), kind: 'neutral' };
}

function headingText(ct: CompetitionsT, heading: GroupHeading | null): string | null {
  if (!heading) return null;
  return heading.name ?? ct('divisionFallback', { n: heading.n });
}

export function scheduleLabels(ct: CompetitionsT): {
  tbd: string;
  today: string;
  weekdays: string[];
  nextDay: (time: string) => string;
} {
  return {
    tbd: ct('timeTbd'),
    today: ct('todayMark'),
    nextDay: (time) => ct('nextDayTime', { time }),
    weekdays: [
      ct('weekdaySun'),
      ct('weekdayMon'),
      ct('weekdayTue'),
      ct('weekdayWed'),
      ct('weekdayThu'),
      ct('weekdayFri'),
      ct('weekdaySat'),
    ],
  };
}

export type ScheduleClock = 'keep' | 'tbd' | 'cancelled';

/**
 * 整場延期把每一列的時間改成「待定」，整場取消改成「已取消」，並且不掛單場小標。
 * keep 才畫原本的時間與小標。
 */
export function MatchSchedule({
  ct,
  groups,
  standings,
  crests,
  clock = 'keep',
  onOpenMatch,
}: {
  ct: CompetitionsT;
  groups: readonly ScheduleGroup[];
  standings: readonly StandingDoc[];
  crests: readonly EntryDoc[];
  clock?: ScheduleClock;
  /** 每一場都能進單場頁，含未開賽。 */
  onOpenMatch?: (mtId: string) => void;
}): JSX.Element {
  const multiple = groups.length > 1;
  return (
    <div>
      {groups.map((group, index) => {
        const heading = headingText(ct, scheduleHeading(group.divisionId, index, multiple, standings));
        return (
          <div key={group.divisionId}>
            {heading ? <h3 class="cp3-day">{heading}</h3> : null}
            {group.days.map((day) => (
              <div key={day.key}>
                <h4 class="cp3-day">{day.label}</h4>
                <CpCard>
                  <ul class="cp3-ml">
                    {day.matches.map((match) => {
                      const badge = clock === 'keep' && match.mark ? markBadge(ct, match.mark) : null;
                      return (
                        <li
                          class="cp3-m"
                          key={match.id}
                          onClick={onOpenMatch ? () => onOpenMatch(match.id) : undefined}
                        >
                          <div class="cp3-m__top">
                            {clock === 'tbd' ? (
                              <span class="cp3-m__when"><b>{ct('compTbd')}</b></span>
                            ) : clock === 'cancelled' ? (
                              <span class="cp3-m__when"><b>{ct('cancelled')}</b></span>
                            ) : match.time == null ? (
                              <span class="cp3-m__when"><b>{ct('timeTbd')}</b></span>
                            ) : (
                              <span class="cp3-m__when">
                                <b>{match.time}</b>
                                {match.venue ? `　${match.venue}` : ''}
                              </span>
                            )}
                            {badge ? <StatusTag kind={badge.kind} label={badge.label} /> : null}
                            {clock === 'keep' && match.live ? <LiveScoreBadge kind="live" /> : null}
                            {clock === 'keep' && match.corrected ? <LiveScoreBadge kind="corrected" /> : null}
                          </div>
                          <div class="cp3-m__vs">
                            <span class="h">
                              <SideName entryId={match.homeId} name={match.homeName} crests={crests} align="home" logo={match.homeLogo} />
                            </span>
                            {match.score ? (
                              <span class="s">{match.score[0]}：{match.score[1]}</span>
                            ) : (
                              <span class="s vs">vs</span>
                            )}
                            <span class="a">
                              <SideName entryId={match.awayId} name={match.awayName} crests={crests} align="away" logo={match.awayLogo} />
                            </span>
                            {match.pk ? <span class="cp3-m__pk">{pkScoreLabel(match.pk[0], match.pk[1])}</span> : null}
                          </div>
                          {clock === 'keep' && match.reason ? (
                            <p class="cpm-reason"><b>{ct('reasonPrefix')}</b>　{match.reason}</p>
                          ) : null}
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

function rankingFor(doc: StandingDoc, divisions: readonly DivisionDoc[]): StandingRanking | null {
  if (doc.ranking) return doc.ranking;
  return divisions.find((division) => division.dvId === doc.divisionId)?.ranking ?? null;
}

export function StandingsTable({
  ct,
  docs,
  crests,
  divisions = [],
  canExplain = false,
  onExplain,
  onDecision,
}: {
  ct: CompetitionsT;
  docs: readonly StandingDoc[];
  crests: readonly EntryDoc[];
  divisions?: readonly DivisionDoc[];
  /** 主辦／共同主辦／管理員才看得到可點的同分說明。觀眾維持小標。 */
  canExplain?: boolean;
  onExplain?: (doc: StandingDoc, teamId: string) => void;
  onDecision?: (doc: StandingDoc) => void;
}): JSX.Element {
  const multiple = docs.length > 1;
  return (
    <div class="cps-stack">
      {docs.map((doc, index) => {
        const lines = standingLines(doc);
        const heading = headingText(ct, standingHeading(doc, index, multiple));
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
                      {line.samePoints && canExplain ? (
                        <button type="button" class="cpm-tiebtn" onClick={() => onExplain?.(doc, line.teamId)}>{ct('tie')}</button>
                      ) : line.tie ? <small>{ct('tie')}</small> : null}
                      {/* 名次欄只有 28px：畫面顯示短標「裁定」，讀屏與提示用完整「主辦裁定」（顧問 §3.294 P3：360 寬四個字貼到隊徽） */}
                      {line.decidedBy ? (
                        <button type="button" class="cpm-tiebtn" aria-label={ct('hostRuling')} title={ct('hostRuling')} onClick={() => onDecision?.(doc)}>{ct('hostRulingShort')}</button>
                      ) : null}
                    </span>
                    <span class="t">
                      <span class="cp3-tn">
                        <TeamCrest teamId={shown.teamId} name={shown.name} teamLogo={shown.teamLogo} size={20} />
                        <em>{line.name}</em>
                      </span>
                    </span>
                    <span>{line.played}</span>
                    <span>{line.win}</span>
                    <span>{line.draw}</span>
                    <span>{line.loss}</span>
                    <span>{line.goalsFor}/{line.goalsAgainst}</span>
                    <span>{formatGoalDiff(line.goalDiff)}</span>
                    <span class="pt">{line.points}</span>
                  </div>
                );
              })}
            </CpCard>
            <CpCard>
              <h3 class="cpm-sec cpm-sec--first">{ct('rulesTitle')}</h3>
              <ol class="cpm-rules">
                {rankingRuleKeys(rankingFor(doc, divisions)).map((key) => <li key={key}>{ct(key)}</li>)}
              </ol>
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
  venues?: readonly { name?: string | null }[],
): ScheduleGroup[] {
  return groupSchedule(
    summary,
    now,
    scheduleLabels(ct),
    divisions.map((division) => division.dvId),
    venues,
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
  badge: { label: string; kind: StatusKind };
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
        <StatusTag kind={badge.kind} label={badge.label} />
      </div>
    </CpCard>
  );
}

function ScorerBlock({
  ct,
  choices,
  state,
  onPick,
}: {
  ct: CompetitionsT;
  choices: readonly { id: string; name: string }[];
  state: { dvId: string; tables: ScorerTables | null } | null;
  onPick: (id: string) => void;
}): JSX.Element {
  const tables = state?.tables ?? null;
  return (
    <div style="margin-top:12px">
      {choices.length > 1 ? (
        <div class="cps-actions">
          {choices.map((choice) => (
            <Button
              key={choice.id}
              variant={state?.dvId === choice.id ? 'primary' : 'secondary'}
              onClick={() => onPick(choice.id)}
            >
              {choice.name}
            </Button>
          ))}
        </div>
      ) : null}
      {tables ? (
        <ScorersTable
          scorers={tables.scorers}
          cards={tables.cards}
          stalled={tables.stalled}
          stalledLabel={ct('scorersStalled')}
          empty={tables.empty}
          emptyLabel={ct('scorersEmpty')}
          capNote={tables.capped ? ct('scorersCap') : null}
        />
      ) : null}
    </div>
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
  statusShownAbove = false,
  fullSchedule,
  onRequestFull,
  clock = 'keep',
  renderStandings,
  onOpenStandings,
  venues,
  onOpenMatch,
  scorerState = null,
  onOpenScorers,
}: {
  ct: CompetitionsT;
  phase: Exclude<CompetitionPhase, 'recruit'>;
  firstMatchAt: number;
  divisions: readonly DivisionDoc[];
  crests: readonly EntryDoc[];
  /** 預熱＝首場那天；進行中＝今天。已結束首屏是空的。 */
  summary: readonly SummaryEntry[];
  standings: readonly StandingDoc[];
  now: number;
  badge: { label: string; kind: StatusKind };
  /** 頁面上方已經有狀態卡（整場取消／延期附原因）時為 true；沒有冠軍就不再畫只剩狀態標籤的卡。 */
  statusShownAbove?: boolean;
  /** null＝還沒按「全部賽程」或已結束展開。有值才是全集，而且同一頁只讀一次。 */
  fullSchedule: readonly SummaryEntry[] | null;
  onRequestFull: () => boolean | Promise<boolean>;
  clock?: ScheduleClock;
  /** 省略就用內建積分榜（含排序說明）。同分面板由呼叫端塞進來。 */
  renderStandings?: (docs: readonly StandingDoc[]) => JSX.Element;
  /** 切到積分頁時才補讀組別（進行中首屏不讀）。 */
  onOpenStandings?: () => void;
  /** 場地序號對到賽事 venues。省略時只用摘要 v。 */
  venues?: readonly { name?: string | null }[];
  onOpenMatch?: (mtId: string) => void;
  /** 打開射手榜或切換組別才讀。null 表示這次還沒回來。 */
  scorerState?: { dvId: string; tables: ScorerTables | null } | null;
  onOpenScorers?: (dvId: string) => void;
}): JSX.Element {
  const [tab, setTab] = useState<'sched' | 'stand' | 'scorers'>('sched');
  const [doneScorers, setDoneScorers] = useState(false);
  const [open, setOpen] = useState(false);
  const [foldError, setFoldError] = useState(false);
  const shown = scheduleGroups(ct, fullSchedule ?? summary, divisions, now, venues);
  const divisionChoices = scorerDivisions(divisions, standings, fullSchedule ?? summary);
  const standingsNode = renderStandings
    ? renderStandings(standings)
    : <StandingsTable ct={ct} docs={standings} crests={crests} divisions={divisions} />;

  function openFold(): void {
    setFoldError(false);
    const result = onRequestFull();
    if (result === true) {
      setOpen(true);
      return;
    }
    if (result === false) {
      setOpen(false);
      setFoldError(true);
      return;
    }
    void result.then((ok) => {
      if (ok) setOpen(true);
      else {
        setOpen(false);
        setFoldError(true);
      }
    });
  }

  if (phase === 'done') {
    const multiple = standings.length > 1;
    const loadedRows = fullSchedule;
    const foldGroups = scheduleGroups(ct, loadedRows ?? [], divisions, now, venues);
    const foldLabel = loadedRows ? ct('foldSchedule', { n: loadedRows.length }) : ct('tabSchedule');
    const champions = standings.flatMap((doc, index) => {
      const result = championName(doc);
      const value = result.pending ? ct('championPending') : result.name;
      if (!value) return [];
      const label = headingText(ct, standingHeading(doc, index, multiple));
      return [{ id: doc.id, text: label ? `${label}　${value}` : value }];
    });
    return (
      <>
        {champions.length > 0 ? (
          <CpCard class="cps-card--ok">
            <div class="cp3-row">
              <div class="cp3-champ">
                <TrophyIcon />
                <div class="cp3-champ__t">
                  <span class="cp3-champ__k">{ct('champion')}</span>
                  {champions.map((c) => (
                    <span class="cp3-champ__v" key={c.id}>{c.text}</span>
                  ))}
                </div>
              </div>
              <StatusTag kind={badge.kind} label={badge.label} />
            </div>
          </CpCard>
        ) : statusShownAbove ? null : (
          // 沒有冠軍（整場取消、沒有積分榜）時不畫獎盃與「冠軍」字樣，只留狀態標籤（PM 截圖驗收發現）；
          // 上方已有狀態卡時整張省略，避免空卡只剩標籤（顧問 §3.294 P3）
          <CpCard>
            <div class="cp3-row">
              <span />
              <StatusTag kind={badge.kind} label={badge.label} />
            </div>
          </CpCard>
        )}
        {standingsNode}
        <CpCard>
          <div class="cps-actions">
            <Button
              variant="secondary"
              onClick={() => {
                const id = scorerState?.dvId || divisionChoices[0]?.id || '';
                if (!id) return;
                setDoneScorers(true);
                onOpenScorers?.(id);
              }}
            >{ct('tabScorers')}</Button>
          </div>
          {doneScorers ? (
            <ScorerBlock ct={ct} choices={divisionChoices} state={scorerState} onPick={(id) => onOpenScorers?.(id)} />
          ) : null}
        </CpCard>
        <CpCard>
          <button
            type="button"
            class={`cp3-fold${open ? ' cp3-fold--open' : ''}`}
            aria-expanded={open}
            onClick={() => {
              if (open) {
                setOpen(false);
                return;
              }
              openFold();
            }}
          >
            <span>{foldLabel}</span>
            <ChevronIcon />
          </button>
          {open && loadedRows ? (
            <div style="margin-top:12px">
              <MatchSchedule ct={ct} groups={foldGroups} standings={standings} crests={crests} clock={clock} onOpenMatch={onOpenMatch} />
            </div>
          ) : null}
          {foldError && !open ? (
            <div role="alert" style="margin-top:12px">
              <p class="cps-note">{ct('loadFailed')}</p>
              <div class="cps-actions">
                <Button variant="secondary" onClick={openFold}>{ct('retry')}</Button>
              </div>
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
          if (id !== 'sched' && id !== 'stand' && id !== 'scorers') return;
          setTab(id);
          if (id === 'stand') onOpenStandings?.();
          if (id === 'scorers') {
            const next = scorerState?.dvId || divisionChoices[0]?.id || '';
            if (next) onOpenScorers?.(next);
          }
        }}
        items={[
          {
            id: 'sched',
            label: ct('tabSchedule'),
            panel: (
              <div style="margin-top:12px">
                <MatchSchedule ct={ct} groups={shown} standings={standings} crests={crests} clock={clock} onOpenMatch={onOpenMatch} />
                <div class="cps-actions">
                  <Button variant="secondary" onClick={onRequestFull}>{ct('fullSchedule')}</Button>
                </div>
              </div>
            ),
          },
          {
            id: 'stand',
            label: ct('tabStandings'),
            panel: (
              <div style="margin-top:12px">
                {standingsNode}
              </div>
            ),
          },
          {
            id: 'scorers',
            label: ct('tabScorers'),
            panel: (
              <ScorerBlock ct={ct} choices={divisionChoices} state={scorerState} onPick={(id) => onOpenScorers?.(id)} />
            ),
          },
        ]}
      />
    </>
  );
}
