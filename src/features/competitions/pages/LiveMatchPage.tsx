// 觀眾單場頁。只監聽場次文件。比賽紀錄展開後才讀時間軸與作廢。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { PageSpinner } from '@/ui/PageSpinner';
import { liveCpActions } from '../actions';
import {
  bindVisible,
  isPrefaceStatus,
  showsCorrected,
  summaryVenue,
  type AudienceMatch,
  type AudienceMatchResult,
  type ParsedTimeline,
} from '../data/audience';
import { createAudiencePorts } from '../data/audience-watch';
import { kickoffTimeLabel } from '../data/match-day';
import type { EntryDoc, MatchDoc, RosterPublicDoc } from '../data/types';
import type { CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { ctOrKey, useCompetitionsT } from '../i18n';
import { LiveBoundary } from '../live';
import { clockFromBase, type LiveClock } from '../live/clock';
import { pkScoreLabel } from '../live/copy';
import { LiveMatchView } from '../live/LiveMatchView';
import { timelineFrom } from '../live/scoring-adapter';
import type { TimelineEvent, VoidMark } from '../live/types';
import { reasonText } from '../ui/feedback';
import { CpFrame, CpI18nPending } from '../ui/shell';

function crest(id: string, name: string, logo: string | null): EntryDoc {
  return {
    id,
    dvId: '',
    teamId: id,
    name,
    status: 'approved',
    rosterCount: 0,
    rosterConfirmed: false,
    teamLogo: logo,
  };
}

function asMatchDoc(match: AudienceMatch): MatchDoc {
  return {
    id: match.id,
    divisionId: match.divisionId || 'group',
    stageId: 'group',
    groupId: 'A',
    round: 0,
    matchNo: 0,
    label: null,
    matchKey: null,
    kickoffAt: match.kickoffAt,
    venueIdx: match.venueIdx,
    venueName: match.venueName,
    home: { teamId: match.home.teamId, name: match.home.name },
    away: { teamId: match.away.teamId, name: match.away.name },
    teamIds: [match.home.teamId, match.away.teamId],
    score: match.score,
    penaltyScore: null,
    status: match.status,
    rev: match.rev,
    resetRev: match.resetRev,
    lock: { locked: false },
    clockBase: match.clockBase,
    finishedAt: null,
    confirmedAt: null,
    walkoverSide: null,
    result: null,
    resultSource: null,
    updatedAt: null,
    cancelReason: null,
    cancelledAt: null,
  };
}

function toLiveClock(match: AudienceMatch, nowMs: number): LiveClock {
  const reading = clockFromBase(match.clockBase, nowMs);
  // 已終場（含已確認）顯示「終場」，不再落到上半場（11-20 走查）。
  const ended = match.status === 'finished' || match.status === 'confirmed' || reading.period === 'ft';
  const period: LiveClock['period'] = ended
    ? 'ft'
    : reading.period === 'ht' || reading.period === 'h2' || reading.period === 'pk'
      ? reading.period
      : 'h1';
  return { elapsedSec: reading.elapsedSec, period, addedMin: null };
}

function rosterSide(rows: readonly ParsedTimeline[], side: 'home' | 'away'): RosterPublicDoc[] {
  const seen = new Set<string>();
  const out: RosterPublicDoc[] = [];
  for (const row of rows) {
    if (row.side !== side || !row.plId || row.number == null || seen.has(row.plId)) continue;
    seen.add(row.plId);
    out.push({
      id: row.plId,
      enId: '',
      displayName: row.playerName || '',
      number: row.number,
      position: null,
      positionText: null,
      isMinor: false,
    });
  }
  return out;
}

function maxSeq(rows: readonly { seq: number }[]): number {
  let max = 0;
  for (const row of rows) if (row.seq > max) max = row.seq;
  return max;
}

export function LiveMatchScreen({
  env,
  cid,
  mtId,
}: {
  env: CpInjectedEnv;
  cid: string;
  mtId: string;
}): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [result, setResult] = useState<AudienceMatchResult | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [voids, setVoids] = useState<VoidMark[]>([]);
  const [homeRoster, setHomeRoster] = useState<RosterPublicDoc[]>([]);
  const [awayRoster, setAwayRoster] = useState<RosterPublicDoc[]>([]);
  const [tick, setTick] = useState(env.now ?? Date.now());
  const openRef = useRef(false);
  const parsedRef = useRef<ParsedTimeline[]>([]);
  const voidRef = useRef<VoidMark[]>([]);
  const revRef = useRef<number | null>(null);
  const matchRef = useRef<AudienceMatch | null>(null);
  const readGen = useRef(0);

  useEffect(() => {
    if (env.now != null) return undefined;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [env.now]);

  useEffect(() => {
    if (!cid || !mtId) {
      setResult({ kind: 'missing' });
      return undefined;
    }
    if (env.bundle && !env.audience) {
      setResult({ kind: 'missing' });
      return undefined;
    }
    const ports = env.audience ?? createAudiencePorts();
    return bindVisible(() => ports.watchMatch({ cid, mtId }, (next) => {
      matchRef.current = next.kind === 'ok' ? next.match : null;
      setResult(next);
    }));
  }, [cid, mtId, env.audience, env.bundle]);

  function publish(rows: ParsedTimeline[], marks: VoidMark[]): void {
    parsedRef.current = rows;
    voidRef.current = marks;
    setEvents(timelineFrom(rows.map((row) => row.event), marks));
    setVoids(marks);
    setHomeRoster(rosterSide(rows, 'home'));
    setAwayRoster(rosterSide(rows, 'away'));
  }

  async function readLog(fresh: boolean): Promise<void> {
    const match = matchRef.current;
    const ports = env.audience ?? (env.bundle ? null : createAudiencePorts());
    if (!match || !ports || !openRef.current) return;
    const gen = readGen.current + 1;
    readGen.current = gen;
    const afterEvents = fresh ? match.resetRev : Math.max(match.resetRev, maxSeq(parsedRef.current.map((row) => row.event)));
    const afterVoids = fresh ? match.resetRev : Math.max(match.resetRev, maxSeq(voidRef.current));
    const page = await ports.readLog({
      cid,
      mtId,
      afterEvents,
      afterVoids,
      alreadyEvents: fresh ? 0 : parsedRef.current.length,
      alreadyVoids: fresh ? 0 : voidRef.current.length,
    });
    if (gen !== readGen.current || !openRef.current) return;
    if (fresh) {
      publish(page.events, page.voids);
      return;
    }
    const eventMap = new Map(parsedRef.current.map((row) => [row.event.seq, row]));
    for (const row of page.events) eventMap.set(row.event.seq, row);
    const voidMap = new Map(voidRef.current.map((row) => [row.seq, row]));
    for (const row of page.voids) voidMap.set(row.seq, row);
    publish(
      [...eventMap.values()].sort((a, b) => a.event.seq - b.event.seq),
      [...voidMap.values()].sort((a, b) => a.seq - b.seq),
    );
  }

  useEffect(() => {
    if (result?.kind !== 'ok') return;
    const rev = result.match.rev;
    const prev = revRef.current;
    revRef.current = rev;
    matchRef.current = result.match;
    if (!openRef.current) return;
    // 第一筆到達時若已經展開，從 resetRev 讀。之後 rev 變大只補讀。函式本體用當下的 refs。
    if (prev == null) {
      void readLog(true);
      return;
    }
    if (rev > prev) void readLog(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const back = () => route(`/competitions/${cid}`);
  if (!result) return <div class="cps-root"><PageSpinner /></div>;
  if (result.kind === 'missing') {
    return (
      <CpFrame title={ct('liveMatchTitle')} onBack={back}>
        <p class="cps-note">{reasonText(ct, 'MATCH_NOT_FOUND')}</p>
      </CpFrame>
    );
  }

  const match = result.match;
  const nowMs = env.now ?? tick;
  const preface = isPrefaceStatus(match.status)
    ? (() => {
      const time = match.kickoffAt == null
        ? ct('timeTbd')
        : kickoffTimeLabel(match.kickoffAt, (timeText) => ct('nextDayTime', { time: timeText }));
      const venue = summaryVenue({ st: match.status, v: match.venueName, vi: match.venueIdx });
      return venue ? `${time}　${venue}` : time;
    })()
    : null;
  const pk = match.penaltyScore ? pkScoreLabel(match.penaltyScore.home, match.penaltyScore.away) : null;
  const corrected = showsCorrected({ st: match.status, cx: match.scoreCorrectedAt });

  return (
    <LiveMatchView
      match={asMatchDoc(match)}
      clock={toLiveClock(match, nowMs)}
      events={events}
      voids={voids}
      homeRoster={homeRoster}
      awayRoster={awayRoster}
      crests={[
        crest(match.home.teamId, match.home.name, match.home.logo),
        crest(match.away.teamId, match.away.name, match.away.logo),
      ]}
      pk={pk}
      corrected={corrected}
      preface={preface}
      showVoided
      onLog={(next) => {
        openRef.current = next;
        if (!next) {
          readGen.current += 1;
          return;
        }
        void readLog(true);
      }}
    />
  );
}

export default function LiveMatchPage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  const mtId = injected?.route?.mtId ?? routed.params?.mtId ?? '';
  if (injected) return <LiveMatchScreen env={injected} cid={cid} mtId={mtId} />;
  return (
    <LiveBoundary loadClubs={false}>
      {(actor, repo) => (
        actor.authPending ? (
          <div class="cps-root"><PageSpinner /></div>
        ) : (
          <LiveMatchScreen
            env={{ actor, repo, actions: liveCpActions, route: { cid, mtId } }}
            cid={cid}
            mtId={mtId}
          />
        )
      )}
    </LiveBoundary>
  );
}
