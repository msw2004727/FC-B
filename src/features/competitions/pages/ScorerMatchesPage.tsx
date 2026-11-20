// 記分員的場次。先讀自己的 staff，再依 matchIds 逐筆取場次，最多 100。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { PageSpinner } from '@/ui/PageSpinner';
import { liveCpActions } from '../actions';
import {
  dayHeadingText,
  groupByCompetitionDay,
  matchVenueName,
  showScoreEntry,
} from '../data/staff-assign';
import type { CompetitionDoc, MatchDoc, MatchStatus } from '../data/types';
import type { CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { LiveBoundary } from '../live';
import { markScorerBoard, ScorerMatchesScreen, type ScorerDay } from '../step4b/staff';
import type { S4bMatch } from '../testing/step4b-fixtures';
import { CpI18nPending } from '../ui/shell';
import type { StatusKind } from '../ui/status-tag';

const WEEKDAYS = ['weekdaySun', 'weekdayMon', 'weekdayTue', 'weekdayWed', 'weekdayThu', 'weekdayFri', 'weekdaySat'] as const;
const MATCH_CAP = 100;

/** 每列的狀態字與標籤長相（3.0.5）：進行中、中場＝亮燈；已取消＝紅字描邊；未開賽＝不放標籤（null）；其餘中性。 */
function statusOf(ct: CompetitionsT, status: MatchStatus): { label: string; kind: StatusKind | null } {
  if (status === 'scheduled') return { label: ct('matchNotStarted'), kind: null };
  if (status === 'live') return { label: ct('phaseLive'), kind: 'live' };
  if (status === 'halftime') return { label: ct('matchHalftime'), kind: 'live' };
  if (status === 'finished') return { label: ct('phaseDone'), kind: 'neutral' };
  if (status === 'confirmed') return { label: ct('matchConfirmed'), kind: 'neutral' };
  if (status === 'walkover') return { label: ct('matchForfeit'), kind: 'neutral' };
  if (status === 'postponed') return { label: ct('matchMoved'), kind: 'neutral' };
  return { label: ct('matchCancelled'), kind: 'cancelled' };
}

function previewMatch(match: MatchDoc, venue: string): S4bMatch {
  const status: S4bMatch['status'] = match.status === 'live' ? 'live' : match.status === 'scheduled' ? 'scheduled' : 'done';
  return {
    id: match.id,
    kickoffAt: match.kickoffAt ?? 0,
    venue,
    home: match.home.name,
    away: match.away.name,
    status,
  };
}

function toDays(
  ct: CompetitionsT,
  matches: readonly MatchDoc[],
  venues: readonly { name: string }[],
  now: number,
): ScorerDay[] {
  const rows = matches.map((match) => ({ match, kickoffAt: match.kickoffAt }));
  const grouped = groupByCompetitionDay(rows);
  function block(key: string, heading: string, items: readonly { match: MatchDoc }[]): ScorerDay {
    return {
      key,
      heading,
      matches: items.map(({ match }) => {
        const venue = matchVenueName(match, venues);
        const badge = statusOf(ct, match.status);
        return {
          id: match.id,
          match: previewMatch(match, venue),
          statusLabel: badge.label,
          statusKind: badge.kind,
          showEnter: showScoreEntry(match.status, match.finishedAt, now),
          ...(match.kickoffAt == null ? { timeLabel: ct('timeTbd') } : {}),
        };
      }),
    };
  }
  const days = grouped.days.map((group) => block(
    group.key,
    dayHeadingText(group.month, group.day, ct(WEEKDAYS[group.weekday] ?? 'weekdaySun')),
    group.items,
  ));
  if (grouped.undated.length > 0) days.push(block('tbd', ct('timeTbd'), grouped.undated));
  // 板卡用每列的狀態種類挑，不看 previewMatch 的 status（它把中場歸成 done）。
  return markScorerBoard(days);
}

function ScorerView({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [venues, setVenues] = useState<CompetitionDoc['venues']>([]);

  useEffect(() => {
    if (env.actor.authPending) return undefined;
    let alive = true;
    setPhase('loading');
    void (async () => {
      const uid = env.actor.uid;
      if (!uid) {
        if (alive) {
          setMatches([]);
          setPhase('ready');
        }
        return;
      }
      const assignment = await env.repo.getStaffAssignment(cid, uid);
      if (!alive) return;
      const ids = (assignment?.matchIds ?? []).slice(0, MATCH_CAP);
      if (ids.length === 0) {
        setMatches([]);
        setPhase('ready');
        return;
      }
      const found = (await Promise.all(ids.map((id) => env.repo.getMatch(cid, id))))
        .filter((match): match is MatchDoc => match != null);
      if (!alive) return;
      const needVenue = found.some((match) => !match.venueName && match.venueIdx != null);
      if (needVenue) {
        const competition = await env.repo.getCompetition(cid);
        if (!alive) return;
        setVenues(competition?.venues ?? []);
      }
      setMatches(found);
      setPhase('ready');
    })().catch(() => {
      if (alive) setPhase('error');
    });
    return () => {
      alive = false;
    };
  }, [cid, env.actor.authPending, env.actor.uid, env.repo]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const back = () => route(`/competitions/${cid}`);
  if (env.actor.authPending || phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
  if (phase === 'error') {
    return (
      <ScorerMatchesScreen title={ct('myMatches')} days={[]} empty={ct('loadFailed')} onBack={back} />
    );
  }
  const now = env.now ?? Date.now();
  const days = toDays(ct, matches, venues, now);
  return (
    <ScorerMatchesScreen
      title={ct('myMatches')}
      days={days}
      empty={ct('staffEmpty')}
      enterLabel={ct('staffEnter')}
      onBack={back}
      onEnter={(mtId) => route(`/competitions/${cid}/matches/${mtId}/score`)}
    />
  );
}

export default function ScorerMatchesPage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  if (injected) return <ScorerView env={injected} cid={cid} />;
  return (
    <LiveBoundary>
      {(actor, repo) => <ScorerView env={{ actor, repo, actions: liveCpActions, route: { cid } }} cid={cid} />}
    </LiveBoundary>
  );
}
