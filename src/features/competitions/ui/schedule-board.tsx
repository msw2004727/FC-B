// 詳情的賽程、積分榜、預熱／進行中／已結束的分頁內容。class 對照預覽 harness 的 cp3-*。頂部在 detail-hero.tsx。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import { Tabs } from '@/ui/Tabs';
import type { CompetitionsT } from '../i18n';
import {
  formatGoalDiff,
  groupSchedule,
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
import { TeamCrest } from './TeamCrest';
import { MatchVs, MatchWhen } from './match-row';
import { CpCard, NextIcon } from './shell';
import { StatusTag, type StatusKind } from './status-tag';

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
  nextIds,
  onOpenMatch,
}: {
  ct: CompetitionsT;
  groups: readonly ScheduleGroup[];
  standings: readonly StandingDoc[];
  crests: readonly EntryDoc[];
  clock?: ScheduleClock;
  /** 「下一場」的場次 id（同一時間多場都算）。只有進行中、clock 是 keep 才傳。 */
  nextIds?: ReadonlySet<string>;
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
                      const live = clock === 'keep' && match.live;
                      // 「下一場」標籤：這一列沒有別的狀態標籤、也不是進行中才掛
                      const next = clock === 'keep' && !badge && !live && nextIds?.has(match.id) === true;
                      const off = clock === 'cancelled' || match.mark === 'cancelled';
                      const mod = next ? ' cp3-m--next' : live ? ' cp3-m--live' : off ? ' cp3-m--off' : '';
                      return (
                        <li
                          class={`cp3-m${mod}`}
                          key={match.id}
                          onClick={onOpenMatch ? () => onOpenMatch(match.id) : undefined}
                        >
                          <div class="cp3-m__top">
                            {clock === 'tbd' ? (
                              <MatchWhen time={ct('compTbd')} />
                            ) : clock === 'cancelled' ? (
                              <MatchWhen time={ct('cancelled')} />
                            ) : match.time == null ? (
                              <MatchWhen time={ct('timeTbd')} />
                            ) : (
                              <MatchWhen time={match.time} venue={match.venue} />
                            )}
                            {badge ? <StatusTag kind={badge.kind} label={badge.label} /> : null}
                            {next ? <StatusTag kind="next" label={ct('boardNext')} /> : null}
                            {live ? <LiveScoreBadge kind="live" /> : null}
                            {clock === 'keep' && match.corrected ? <LiveScoreBadge kind="corrected" /> : null}
                          </div>
                          <MatchVs
                            home={{ id: match.homeId, name: match.homeName, logo: match.homeLogo }}
                            away={{ id: match.awayId, name: match.awayName, logo: match.awayLogo }}
                            crests={crests}
                            score={match.score}
                            pk={match.pk ? pkScoreLabel(match.pk[0], match.pk[1]) : null}
                          />
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
  // 排序規則預設收合（新外觀卡 3-4，已定案的行為變更）；每個組別各自一份
  const [rulesOpen, setRulesOpen] = useState<Record<string, boolean>>({});
  return (
    <div class="cps-stack">
      {docs.map((doc, index) => {
        const lines = standingLines(doc);
        const heading = headingText(ct, standingHeading(doc, index, multiple));
        const open = rulesOpen[doc.id] === true;
        const rulesId = `cp-rules-${doc.id}`;
        return (
          <div key={doc.id}>
            {heading ? <h3 class="cp3-day">{heading}</h3> : null}
            {/* 新外觀卡 3-4：三張表共用 .cp-tbl；測試用到的 class（.cp3-st、.cp3-st__r、--h、--top、.rk、.t、.pt）留在對應元素上 */}
            <CpCard class="cp-tblcard cp3-st">
              <table class="cp-tbl cp-tbl--st">
                <thead>
                  <tr class="cp3-st__r cp3-st__r--h">
                    <th scope="col" class="rk">{ct('colRank')}</th>
                    <th scope="col" class="t">{ct('colTeam')}</th>
                    <th scope="col">{ct('colPlayed')}</th>
                    <th scope="col">{ct('colWon')}</th>
                    <th scope="col">{ct('colDrawn')}</th>
                    <th scope="col">{ct('colLost')}</th>
                    <th scope="col">{ct('colGoals')}</th>
                    <th scope="col">{ct('colDiff')}</th>
                    <th scope="col" class="pt">{ct('colPoints')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const shown = standingCrest(line.teamId, line.name, crests);
                    return (
                      <tr key={line.teamId} class={`cp3-st__r${line.top ? ' cp3-st__r--top' : ''}`}>
                        <td class="rk">
                          {/* 名次固定在列中間；「同分／裁定」掛在數字下面、不把數字頂上去。已裁定的列只留「裁定」一顆（顧問 §3.466 第 7 題）。 */}
                          <span class="cp3-rk">
                            {line.rank}
                            {line.decidedBy ? (
                              // 名次欄窄：畫面顯示短標「裁定」，讀屏與提示用完整「主辦裁定」（顧問 §3.294 P3）
                              <button type="button" class="cpm-tiebtn" aria-label={ct('hostRuling')} title={ct('hostRuling')} onClick={() => onDecision?.(doc)}>{ct('hostRulingShort')}</button>
                            ) : line.samePoints && canExplain ? (
                              <button type="button" class="cpm-tiebtn" onClick={() => onExplain?.(doc, line.teamId)}>{ct('tie')}</button>
                            ) : line.tie ? <small>{ct('tie')}</small> : null}
                          </span>
                        </td>
                        <td class="t">
                          <span class="cp3-tn">
                            <TeamCrest teamId={shown.teamId} name={shown.name} teamLogo={shown.teamLogo} size={24} />
                            <em>{line.name}</em>
                          </span>
                        </td>
                        <td>{line.played}</td>
                        <td>{line.win}</td>
                        <td>{line.draw}</td>
                        <td>{line.loss}</td>
                        <td>{line.goalsFor}/{line.goalsAgainst}</td>
                        <td class="gd">{formatGoalDiff(line.goalDiff)}</td>
                        <td class="pt">{line.points}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button
                type="button"
                class={`cp3-fold cp-tbl__fold${open ? ' cp3-fold--open' : ''}`}
                aria-expanded={open}
                aria-controls={rulesId}
                onClick={() => setRulesOpen((prev) => ({ ...prev, [doc.id]: !open }))}
              >
                <span>{ct('rulesTitle')}</span>
                <ChevronIcon />
              </button>
              {open ? (
                <ol id={rulesId} class="cpm-rules">
                  {rankingRuleKeys(rankingFor(doc, divisions)).map((key) => <li key={key}>{ct(key)}</li>)}
                </ol>
              ) : null}
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

/**
 * 射手榜的組別切換（新外觀卡 3-4）：語意維持按鈕＋aria-pressed（不換成 Tabs），長相是小一號的分段切換。
 * 整組單行、不折行、不平分寬度；每格最寬 8 個全形字（超過省略）；整組比一列寬時這一條自己橫向捲動（隱藏捲軸），
 * 切換後把選中的那一格捲進看得到的範圍。
 */
function GroupSwitch({
  choices,
  current,
  onPick,
}: {
  choices: readonly { id: string; name: string }[];
  current: string | null;
  onPick: (id: string) => void;
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    const on = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !on) return;
    const outer = el.getBoundingClientRect();
    const inner = on.getBoundingClientRect();
    if (inner.left < outer.left) el.scrollLeft -= outer.left - inner.left;
    else if (inner.right > outer.right) el.scrollLeft += inner.right - outer.right;
  }, [current]);
  return (
    <div class="cp-grp" ref={box}>
      <div class="ui-tabs d2-seg-sm">
        <div class="ui-tabs__list" role="group">
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              class="ui-tabs__tab"
              aria-pressed={current === choice.id}
              title={choice.name}
              onClick={() => onPick(choice.id)}
            >
              <span class="ui-tabs__label">{choice.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
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
  const groups = choices.length > 1
    ? <GroupSwitch choices={choices} current={state?.dvId ?? null} onPick={onPick} />
    : null;
  return (
    <div style="margin-top:12px">
      {tables ? (
        <ScorersTable
          scorers={tables.scorers}
          cards={tables.cards}
          stalled={tables.stalled}
          stalledLabel={ct('scorersStalled')}
          empty={tables.empty}
          emptyLabel={ct('scorersEmpty')}
          capNote={tables.capped ? ct('scorersCap') : null}
          aside={groups}
        />
      ) : groups ? <div class="cp-sc__bar">{groups}</div> : null}
    </div>
  );
}

export function DetailPhaseBody({
  ct,
  phase,
  divisions,
  crests,
  summary,
  standings,
  now,
  fullSchedule,
  onRequestFull,
  clock = 'keep',
  nextIds,
  renderStandings,
  onOpenStandings,
  venues,
  onOpenMatch,
  scorerState = null,
  onOpenScorers,
}: {
  ct: CompetitionsT;
  phase: Exclude<CompetitionPhase, 'recruit'>;
  divisions: readonly DivisionDoc[];
  crests: readonly EntryDoc[];
  /** 預熱＝首場那天；進行中＝今天。已結束首屏是空的。 */
  summary: readonly SummaryEntry[];
  standings: readonly StandingDoc[];
  now: number;
  /** null＝還沒按「全部賽程」或已結束展開。有值才是全集，而且同一頁只讀一次。 */
  fullSchedule: readonly SummaryEntry[] | null;
  onRequestFull: () => boolean | Promise<boolean>;
  clock?: ScheduleClock;
  /** 「下一場」的場次 id（頂部記分板同一條規則），只標在賽程分頁。 */
  nextIds?: ReadonlySet<string>;
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
    const loadedRows = fullSchedule;
    const foldGroups = scheduleGroups(ct, loadedRows ?? [], divisions, now, venues);
    const foldLabel = loadedRows ? ct('foldSchedule', { n: loadedRows.length }) : ct('tabSchedule');
    return (
      <>
        {standingsNode}
        {/* 已結束的「射手榜」：入口列卡（一列、右邊箭頭），按了在卡內原地展開 */}
        <CpCard class="d2-rows d2-lines d2-lines--48">
          <Button
            variant="ghost"
            trailing={<NextIcon />}
            onClick={() => {
              const id = scorerState?.dvId || divisionChoices[0]?.id || '';
              if (!id) return;
              setDoneScorers(true);
              onOpenScorers?.(id);
            }}
          >{ct('tabScorers')}</Button>
          {doneScorers ? (
            <ScorerBlock ct={ct} choices={divisionChoices} state={scorerState} onPick={(id) => onOpenScorers?.(id)} />
          ) : null}
        </CpCard>
        <CpCard class="d2-foldcard">
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
            <div>
              <MatchSchedule ct={ct} groups={foldGroups} standings={standings} crests={crests} clock={clock} onOpenMatch={onOpenMatch} />
            </div>
          ) : null}
          {foldError && !open ? (
            <div role="alert" class="cp3-panel">
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
              <div class="cp3-panel">
                <MatchSchedule ct={ct} groups={shown} standings={standings} crests={crests} clock={clock} nextIds={nextIds} onOpenMatch={onOpenMatch} />
                <div class="cps-actions">
                  <Button variant="secondary" trailing={<NextIcon />} onClick={onRequestFull}>{ct('fullSchedule')}</Button>
                </div>
              </div>
            ),
          },
          {
            id: 'stand',
            label: ct('tabStandings'),
            panel: (
              <div class="cp3-panel">
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
