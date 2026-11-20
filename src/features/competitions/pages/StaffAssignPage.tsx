// 指派記分員或裁判。場次沿用 listMatches，不另寫查詢。儲存以單一角色覆寫場次清單。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { PageSpinner } from '@/ui/PageSpinner';
import { toast } from '@/ui/Toast';
import { isCpAdmin } from '../access';
import { liveCpActions } from '../actions';
import {
  assignPeople,
  assignStaffFields,
  clockLabel,
  dayHeadingText,
  groupByCompetitionDay,
  matchVenueName,
  vsText,
  type ScoreRole,
} from '../data/staff-assign';
import { resolveHostAccess } from '../data/host-access';
import { recallCompName, rememberCompName } from '../data/comp-name-hint';
import type { CompetitionDoc, MatchDoc, StaffAssignment } from '../data/types';
import type { CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { LiveBoundary } from '../live';
import { StaffAssignScreen, StaffDeniedScreen, type AssignDayGroup } from '../step4b/staff';
import { errorOf, reasonText } from '../ui/feedback';
import { CpI18nPending } from '../ui/shell';

const WEEKDAYS = ['weekdaySun', 'weekdayMon', 'weekdayTue', 'weekdayWed', 'weekdayThu', 'weekdayFri', 'weekdaySat'] as const;

function routeUid(env: CpInjectedEnv): string {
  if (env.route?.uid) return env.route.uid;
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('uid') ?? '';
}

/** 一場的三段（時間、場地、對戰）與完整的一句（報讀名稱）。跨日的時間是「M/D HH:MM」，日期拆出來放在時間上面。 */
function checkboxParts(match: MatchDoc, venues: CompetitionDoc['venues']): { label: string; day?: string; time: string; venue: string; vs: string } {
  const venue = matchVenueName(match, venues);
  const vs = vsText(match.home.name, match.away.name);
  if (match.kickoffAt == null) return { label: `${venue} ${vs}`.trim(), time: '', venue, vs };
  const clock = clockLabel(match.kickoffAt).time;
  const cut = clock.lastIndexOf(' ');
  return {
    label: `${clock} ${venue} ${vs}`.trim(),
    ...(cut > 0 ? { day: clock.slice(0, cut) } : {}),
    time: cut > 0 ? clock.slice(cut + 1) : clock,
    venue,
    vs,
  };
}

export function assignDays(ct: CompetitionsT, matches: readonly MatchDoc[], venues: CompetitionDoc['venues']): AssignDayGroup[] {
  const labeled = matches.map((match) => ({ match, parts: checkboxParts(match, venues) }));
  const grouped = groupByCompetitionDay(labeled.map((row) => ({ ...row, kickoffAt: row.match.kickoffAt })));
  const days = grouped.days.map((group) => ({
    key: group.key,
    heading: dayHeadingText(group.month, group.day, ct(WEEKDAYS[group.weekday] ?? 'weekdaySun')),
    matches: group.items.map((item) => ({ id: item.match.id, ...item.parts })),
  }));
  if (grouped.undated.length > 0) {
    days.push({
      key: 'tbd',
      heading: ct('timeTbd'),
      matches: grouped.undated.map((item) => ({ id: item.match.id, ...item.parts })),
    });
  }
  return days;
}

function initialRole(row: StaffAssignment | undefined): ScoreRole {
  if (row && row.roles.includes('referee') && !row.roles.includes('scorer')) return 'referee';
  return 'scorer';
}

function StaffAssignView({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [phase, setPhase] = useState<'loading' | 'denied' | 'ready' | 'error'>('loading');
  const [list, setList] = useState<StaffAssignment[]>([]);
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [venues, setVenues] = useState<CompetitionDoc['venues']>([]);
  // 頁首賽事名小字：這頁讀到賽事文件（代表那條路、或需要場地名）就用它，否則用報隊管理、排賽程記下的名稱（不為名稱多讀）。
  const [compName, setCompName] = useState<string | undefined>(() => recallCompName(cid));
  const [person, setPerson] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [role, setRole] = useState<ScoreRole>('scorer');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const repKey = env.actor.repClubs.map((club) => club.id).join('\n');
  const repPending = env.actor.repClubsPending === true;

  useEffect(() => {
    // 代表清單還在讀：空清單不代表不是代表，先等（不發讀取）。
    if (env.actor.authPending || repPending) return undefined;
    let alive = true;
    setPhase('loading');
    void (async () => {
      const uid = env.actor.uid;
      if (!uid) {
        if (alive) setPhase('denied');
        return;
      }
      const staff = await env.repo.getStaff(cid, uid);
      if (!alive) return;
      const access = await resolveHostAccess({
        repo: env.repo,
        cid,
        staffRoles: staff?.roles ?? [],
        repClubIds: env.actor.repClubs.map((club) => club.id),
        isAdmin: isCpAdmin(env.actor.role),
      });
      if (!alive) return;
      if (!access.allowed) {
        setPhase('denied');
        return;
      }
      const [staffList, matchList] = await Promise.all([
        env.repo.listStaff(cid),
        env.repo.listMatches(cid),
      ]);
      if (!alive) return;
      const needVenue = matchList.some((match) => !match.venueName && match.venueIdx != null);
      // 代表判斷已讀過賽事就沿用，不再讀。
      const competition = needVenue ? (access.competition ?? await env.repo.getCompetition(cid)) : null;
      if (!alive) return;
      setVenues(competition?.venues ?? []);
      const loadedComp = competition ?? access.competition;
      if (loadedComp) rememberCompName(cid, loadedComp.name);
      setCompName(loadedComp?.name ?? recallCompName(cid));
      setList(staffList);
      setMatches(matchList);
      const wanted = routeUid(env);
      const known = new Set(staffList.map((row) => row.uid));
      const initial = wanted && (wanted === uid || known.has(wanted)) ? wanted : uid;
      setPerson(initial);
      setPhase('ready');
    })().catch(() => {
      if (alive) setPhase('error');
    });
    return () => {
      alive = false;
    };
    // repKey 代表 env.actor.repClubs 的內容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, env.actor.authPending, env.actor.role, env.actor.uid, env.repo, env.route?.uid, repKey, repPending]);

  useEffect(() => {
    if (phase !== 'ready') return;
    const row = list.find((item) => item.uid === person);
    const known = new Set(matches.map((match) => match.id));
    setPicked(new Set((row?.matchIds ?? []).filter((id) => known.has(id))));
    setRole(initialRole(row));
  }, [person, list, matches, phase]);

  async function save(): Promise<void> {
    const uid = env.actor.uid;
    if (!uid || saving) return;
    setSaving(true);
    setError('');
    const days = assignDays(ct, matches, venues);
    const order = days.flatMap((group) => group.matches.map((match) => match.id));
    const matchIds = order.filter((id) => picked.has(id));
    try {
      await env.actions.assignStaff(assignStaffFields({
        cid,
        uid: person || uid,
        role,
        matchIds,
      }));
      toast.show({ message: ct('staffSaved'), tone: 'success' });
      route(`/competitions/${cid}/staff`);
    } catch (err) {
      const info = errorOf(err);
      setError(reasonText(ct, info.reason, info.params));
    } finally {
      setSaving(false);
    }
  }

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const back = () => route(`/competitions/${cid}/staff`);
  if (env.actor.authPending || repPending || phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
  if (phase === 'denied' || !env.actor.uid) {
    return (
      <StaffDeniedScreen
        title={ct('staffTitle')}
        message={ct('staffNoPermission')}
        backLabel={ct('backToCompetition')}
        onBack={() => route(`/competitions/${cid}`)}
      />
    );
  }
  if (phase === 'error') {
    return (
      <StaffDeniedScreen
        title={ct('staffTitle')}
        message={ct('loadFailed')}
        backLabel={ct('backToCompetition')}
        onBack={() => route(`/competitions/${cid}`)}
        failed
      />
    );
  }
  const uid = env.actor.uid;
  const labels = {
    me: ct('staffMe'),
    member: ct('staffMember'),
    memberN: (n: number) => ct('staffMemberN', { n }),
  };
  return (
    <StaffAssignScreen
      title={ct('staffTitle')}
      context={compName}
      people={assignPeople(list, uid, labels).map((item) => ({ id: item.uid, name: item.name }))}
      person={person}
      onPerson={setPerson}
      days={assignDays(ct, matches, venues)}
      picked={picked}
      onToggle={(id, on) => {
        setPicked((prev) => {
          const next = new Set(prev);
          if (on) next.add(id);
          else next.delete(id);
          return next;
        });
      }}
      role={role}
      onRole={setRole}
      personLabel={ct('staffPerson')}
      roleLabel={ct('staffRole')}
      scorerLabel={ct('roleScorer')}
      refereeLabel={ct('roleReferee')}
      saveLabel={ct('staffSave')}
      saving={saving}
      error={error}
      onSave={() => { void save(); }}
      onBack={back}
    />
  );
}

export default function StaffAssignPage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  if (injected) return <StaffAssignView env={injected} cid={cid} />;
  return (
    <LiveBoundary>
      {(actor, repo) => <StaffAssignView env={{ actor, repo, actions: liveCpActions, route: { cid } }} cid={cid} />}
    </LiveBoundary>
  );
}
