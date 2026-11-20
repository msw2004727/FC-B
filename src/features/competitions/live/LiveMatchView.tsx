import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { EntryDoc, MatchDoc, RosterPublicDoc } from '../data/types';
import { crestFromEntry, TeamCrest } from '../ui/TeamCrest';
import { LiveScoreBadge } from './LiveScoreBadge';
import { type LiveClock, formatMatchClock, stageLabel } from './clock';
import { LIVE_COPY } from './copy';
import { linesIfOpen, type EventLine } from './present';
import type { TimelineEvent, VoidMark } from './types';
import './live.css';

/** 開賽時間：time 是窄體數字（或沒有時間時的中文 tbd）；跨日的場次 nextDay 是放在前面的小字。 */
export interface LiveKickoff {
  time: string;
  nextDay: string | null;
  tbd: boolean;
}

/** 已取消、改期：不放板，玻璃卡。detail＝改期的日期時間、或已取消的「原因　…」。 */
export interface LiveOff {
  label: string;
  cancelled: boolean;
  detail: string | null;
}

function Chevron(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function markTone(line: EventLine): string {
  if (line.kind === 'pk') return line.pkScored ? 'goal' : 'miss';
  if (line.kind === 'goal') return 'goal';
  return line.secondYellow || line.kind === 'red' ? 'red' : 'yellow';
}

/** 事件列：分鐘｜記號｜隊名｜球員｜（PK）進／沒進。只省略隊名；完整念法在 .s4-sr。 */
function EventRow({ line }: { line: EventLine }): JSX.Element {
  const who = line.number == null ? LIVE_COPY.unspecified : `${line.number} ${line.name}`;
  return (
    <li class={line.voided ? 'cp-ev cp-ev--void' : 'cp-ev'}>
      <span class="cp-ev__min">{line.minute}</span>
      <i class={`cp-ev__mk cp-ev__mk--${markTone(line)}`} aria-hidden="true" />
      <span class="cp-ev__team">{line.team}</span>
      <span class="cp-ev__who">{who}</span>
      {line.pkRound != null ? <span class="cp-ev__pk">{line.pkScored ? LIVE_COPY.pkIn : LIVE_COPY.pkMiss}</span> : null}
      <span class="s4-sr">{line.label}</span>
      {line.voided ? <span class="cp-ev__tag">{LIVE_COPY.undone}</span> : null}
    </li>
  );
}

function BoardTeam({ entryId, name, crests }: { entryId: string; name: string; crests: readonly EntryDoc[] }): JSX.Element {
  const crest = crestFromEntry(entryId, name, crests);
  return (
    <span class="cp-lv__team">
      <TeamCrest teamId={crest.teamId} name={crest.name} teamLogo={crest.teamLogo} size={44} />
      <span class="cp-lv__name">{name}</span>
    </span>
  );
}

function OffTeam({ entryId, name, crests }: { entryId: string; name: string; crests: readonly EntryDoc[] }): JSX.Element {
  const crest = crestFromEntry(entryId, name, crests);
  return (
    <span class="cp-lvo__team">
      <TeamCrest teamId={crest.teamId} name={crest.name} teamLogo={crest.teamLogo} size={28} />
      <span class="cp-lvo__name">{name}</span>
    </span>
  );
}

/**
 * 觀眾單場頁（新外觀卡 3-5）。整頁一塊記分板：上排「主隊｜比分｜客隊」，細線以下「狀態｜時鐘｜場地」；
 * 板下玻璃上是「比賽紀錄」收合列（未開賽不放）。已取消、改期不放板，改玻璃卡。
 * 亮燈只看比賽狀態（進行中、中場）。事件預設收起，按「比賽紀錄」才展開、才計算事件列。
 * 預設隱藏作廢；觀眾頁傳 showVoided 才劃線。這一頁自己的 class 都是 cp-lv*／cp-ev*，不用記分頁的 .s4-board 等共用規則。
 */
export function LiveMatchView({
  match,
  clock,
  events,
  voids,
  homeRoster,
  awayRoster,
  crests = [],
  pk = null,
  penalty = null,
  corrected = false,
  kickoff = null,
  venue = '',
  off = null,
  hasLog = false,
  stageText,
  showVoided = false,
  startOpen = false,
  onLog,
}: {
  match: MatchDoc;
  clock: LiveClock;
  events: readonly TimelineEvent[];
  voids: readonly VoidMark[];
  homeRoster: readonly RosterPublicDoc[];
  awayRoster: readonly RosterPublicDoc[];
  crests?: readonly EntryDoc[];
  /** 終場後比分下方的 PK 小字（例「PK 4:3」）。 */
  pk?: string | null;
  /** PK 進行中：下排中間改放 PK 比分（取代時鐘）。 */
  penalty?: { home: number; away: number } | null;
  corrected?: boolean;
  /** 未開賽：下排中間放開賽時間，上排中間是「vs」，不放「比賽紀錄」。 */
  kickoff?: LiveKickoff | null;
  /** 下排右邊的場地；所有狀態都放，沒有就留空。 */
  venue?: string;
  off?: LiveOff | null;
  /** 已取消、改期：這場有紀錄才放「比賽紀錄」。 */
  hasLog?: boolean;
  /** 下排左邊的狀態字；省略時照時鐘（stageLabel）。 */
  stageText?: string;
  /** 觀眾單場頁才劃線顯示作廢。預覽維持隱藏。 */
  showVoided?: boolean;
  startOpen?: boolean;
  /** 展開或收合時通知。收合後呼叫端不再讀。 */
  onLog?: (open: boolean) => void;
}): JSX.Element {
  const [open, setOpen] = useState(startOpen);
  const lines = linesIfOpen(open, {
    events,
    voids,
    homeName: match.home.name,
    awayName: match.away.name,
    homeRoster,
    awayRoster,
    hideVoided: !showVoided,
    order: 'timeline',
  });

  function toggle(): void {
    setOpen((value) => {
      const next = !value;
      onLog?.(next);
      return next;
    });
  }

  const pre = off == null && kickoff != null;
  const showLog = off ? hasLog : !pre;
  const log = showLog ? (
    <>
      <button type="button" class={`cp3-fold cp-lv__fold${open ? ' cp3-fold--open' : ''}`} aria-expanded={open} onClick={toggle}>
        <span>{LIVE_COPY.matchLog}</span>
        <Chevron />
      </button>
      {open ? <ul class="cp-lv__evs">{lines.map((line) => <EventRow key={line.seq} line={line} />)}</ul> : null}
    </>
  ) : null;

  if (off) {
    return (
      <section class="s4-page">
        <div class={`cp-lv${showLog ? '' : ' cp-lv--nolog'}`}>
          <div class={`cp-lvo${off.cancelled ? ' cp-lvo--x' : ''}`}>
            <div class="cp-lvo__top">
              <span class="cp-lvo__st">{off.label}</span>
              {venue ? <span class="cp-lvo__venue">{venue}</span> : null}
            </div>
            <div class="cp-lvo__vs">
              <OffTeam entryId={match.home.teamId} name={match.home.name} crests={crests} />
              <span class="cp-lvo__x">vs</span>
              <OffTeam entryId={match.away.teamId} name={match.away.name} crests={crests} />
            </div>
            {off.detail ? <p class={off.cancelled ? 'cp-lvo__why' : 'cp-lvo__when'}>{off.detail}</p> : null}
          </div>
          {log}
        </div>
      </section>
    );
  }

  const lit = match.status === 'live' || match.status === 'halftime';
  const ended = clock.period === 'ft';
  const pkLive = lit && clock.period === 'pk' && penalty != null;
  return (
    <section class="s4-page">
      <div class={`cp-lv${showLog ? '' : ' cp-lv--nolog'}`}>
        <div class={lit ? 'd2-sb d2-sb--lit cp-lv__sb' : 'd2-sb cp-lv__sb'}>
          <div class="cp-lv__top">
            <BoardTeam entryId={match.home.teamId} name={match.home.name} crests={crests} />
            <span class="cp-lv__mid">
              {pre ? <span class="cp-lv__vs">vs</span> : (
                // 三段相連、中間不加空白：讀螢幕與測試讀到的仍是「1:1」
                <span class="cp-lv__score"><span class="d2-num">{match.score.home}</span><span class="cp-lv__colon">:</span><span class="d2-num">{match.score.away}</span></span>
              )}
              {ended && pk ? <span class="cp-lv__pk">{pk}</span> : null}
              {ended && corrected ? <LiveScoreBadge kind="corrected" /> : null}
            </span>
            <BoardTeam entryId={match.away.teamId} name={match.away.name} crests={crests} />
          </div>
          <div class="cp-lv__bot">
            {pre ? <span /> : <span class="d2-sb__st"><i aria-hidden="true" />{stageText ?? stageLabel(clock)}</span>}
            {pre && kickoff ? (
              <span class="cp-lv__when">
                {kickoff.nextDay ? <small>{kickoff.nextDay}</small> : null}
                <span class={kickoff.tbd ? 'cp-lv__tbd' : 'd2-num cp-lv__clock'}>{kickoff.time}</span>
              </span>
            ) : (
              <span class="d2-num cp-lv__clock">{pkLive && penalty ? `${penalty.home}:${penalty.away}` : formatMatchClock(clock.elapsedSec)}</span>
            )}
            <span class="cp-lv__venue">{venue}</span>
          </div>
        </div>
        {log}
      </div>
    </section>
  );
}
