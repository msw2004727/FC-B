// 代表看的名單。背號、顯示名、位置同一行。人數不足不能確認。鎖定後唯讀。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { PageSpinner } from '@/ui/PageSpinner';
import { liveCpActions } from '../actions';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { positionLabel } from '../format';
import { LiveBoundary } from '../live';
import type { EntryStatus, RosterPublicDoc } from '../data/types';
import { CpError, CpLoadFailed, errorOf, loadFailOf, type CpLoadFail } from '../ui/feedback';
import { CpCard, CpFrame, CpI18nPending, TrashIcon } from '../ui/shell';
import { TeamCrest } from '../ui/TeamCrest';

async function loadRoster(env: CpInjectedEnv, cid: string, enId: string): Promise<CpBundle> {
  const uid = env.actor.uid;
  const [competition, divisions, entries, roster, staff] = await Promise.all([
    env.repo.getCompetition(cid),
    env.repo.listDivisions(cid),
    env.repo.listEntries(cid),
    env.repo.listRoster(cid, enId),
    uid ? env.repo.getStaff(cid, uid) : Promise.resolve(null),
  ]);
  return { competition, divisions, entries, roster, privates: [], staff };
}

function entryStatusBadge(
  ct: CompetitionsT,
  status: EntryStatus,
): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (status === 'approved') return { label: ct('approved'), tone: 'success' };
  if (status === 'pending') return { label: ct('pending'), tone: 'warning' };
  if (status === 'rejected') return { label: ct('rejected'), tone: 'danger' };
  return { label: ct('withdrawn'), tone: 'neutral' };
}

function PlayerRow({
  player,
  canEdit,
  onRemove,
}: {
  player: RosterPublicDoc;
  canEdit: boolean;
  onRemove: () => void;
}): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const pos = positionLabel(player.position, player.positionText, {
    none: ct('positionNone'),
    GK: ct('positionGK'),
    DF: ct('positionDF'),
    MF: ct('positionMF'),
    FW: ct('positionFW'),
    custom: ct('positionCustom'),
  });
  return (
    <li class="cps-li cps-player" data-roster-row>
      <span class="cps-num">{player.number}</span>
      {/* 顧問 §3.471 X-02：20 字暱稱把這列撐出卡片。只在名單頁暱稱加 --fit：可縮、超過省略（單行列）。 */}
      <span class="cps-player__name cps-player__name--fit">{player.displayName}</span>
      <span class="cps-player__pos">{pos}</span>
      {player.isMinor ? <Badge tone="warning" label={ct('minor')} size="sm" /> : null}
      {canEdit ? (
        <button type="button" class="cps-iconbtn cps-iconbtn--flat" aria-label={ct('removePlayer', { name: player.displayName })} onClick={onRemove}>
          <TrashIcon />
        </button>
      ) : null}
    </li>
  );
}

function RosterView({ env, cid, enId }: { env: CpInjectedEnv; cid: string; enId: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [phase, setPhase] = useState<'loading' | 'ready' | CpLoadFail>(env.bundle ? 'ready' : 'loading');
  const [error, setError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (env.bundle) return;
    let alive = true;
    void loadRoster(env, cid, enId).then((next) => {
      if (!alive) return;
      setBundle(next);
      setPhase(next.competition ? 'ready' : 'error');
    }).catch((err: unknown) => {
      if (alive) setPhase(loadFailOf(err));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, enId, env.actor.uid, env.bundle]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  if (phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
  const competition = bundle?.competition;
  const entry = bundle?.entries.find((row) => row.id === enId);
  const division = bundle?.divisions.find((row) => row.dvId === entry?.dvId);
  if (!competition || !entry || !division || phase === 'error' || phase === 'hidden') {
    return <CpLoadFailed title={ct('rosterTitle')} fail={phase === 'hidden' ? 'hidden' : 'error'} />;
  }

  const players = bundle?.roster.filter((row) => row.enId === enId) ?? [];
  const now = env.now ?? Date.now();
  const locked = competition.rostersLockedAt != null;
  const started = now >= competition.firstMatchAt;
  const isRep = env.actor.repClubs.some((club) => club.id === entry.teamId);
  const isMember = !isRep && env.actor.memberClubIds.includes(entry.teamId);
  const min = division.rosterMin;
  const max = division.rosterMax;
  const short = players.length < min;
  const canEdit = isRep && !locked && !started && entry.status === 'approved';
  const canAdd = isRep && !locked && !started;
  const canJoin = isMember && !locked && !started && (entry.status === 'pending' || entry.status === 'approved');
  const statusBadge = entryStatusBadge(ct, entry.status);

  async function remove(player: RosterPublicDoc): Promise<void> {
    if (busy) return;
    const ok = await appConfirm(ct('removePlayerConfirm', { name: player.displayName }), {
      okText: ct('remove'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.leaveRoster({ cid, plId: player.id });
      setBundle((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          roster: prev.roster.filter((row) => row.id !== player.id),
          entries: prev.entries.map((row) => (
            row.id === enId
              ? { ...row, rosterConfirmed: false, rosterCount: Math.max(0, row.rosterCount - 1) }
              : row
          )),
        };
      });
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (busy || short || locked) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.confirmRoster({ cid, enId });
      setBundle((prev) => prev ? {
        ...prev,
        entries: prev.entries.map((row) => row.id === enId ? { ...row, rosterConfirmed: true } : row),
      } : prev);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CpFrame title={ct('rosterTitle')}>
      <CpCard>
        <div class="cps-badges" style="margin-bottom:6px">
          <Badge tone={statusBadge.tone} label={statusBadge.label} size="sm" />
          {entry.rosterConfirmed || locked
            ? <Badge tone="success" label={ct('rosterConfirmed')} size="sm" />
            : <Badge tone="warning" label={ct('rosterUnconfirmed')} size="sm" />}
        </div>
        <div class="cp3-roster-head">
          {/* ASSUMPTION: 名單這頁的 listEntries 已經帶 teamLogo，不再多打一筆 listEntriesForCrest。 */}
          <TeamCrest teamId={entry.teamId} name={entry.name} teamLogo={entry.teamLogo} size={48} />
          <div class="cp3-roster-head__t">
            <h2 class="cps-title">{entry.name}</h2>
            <p class="cps-sub">{division.name}　{ct('formatN', { n: division.playersOnField })}</p>
          </div>
        </div>
        <div class="cps-bar" aria-hidden="true">
          <i class={short ? 'low' : ''} style={`width:${Math.min(100, (players.length / max) * 100)}%`} />
        </div>
        <div class="cps-kv">
          <span>{ct('currentCount')}</span>
          <span>{ct('rosterCount', { n: players.length, max, min })}</span>
        </div>
        {!locked && short ? <p class="cps-note cps-warn" style="margin-top:8px">{ct('needMore', { n: min - players.length, min })}</p> : null}
        {locked ? <p class="cps-note" style="margin-top:8px">{ct('rosterLocked')}</p> : null}
        {error ? <CpError reason={error.reason} params={error.params} /> : null}
      </CpCard>
      <CpCard>
        <h2 class="cps-h">{ct('players')}</h2>
        <ul class="cps-list">
          {players.map((player) => (
            <PlayerRow key={player.id} player={player} canEdit={canEdit} onRemove={() => { void remove(player); }} />
          ))}
        </ul>
      </CpCard>
      {canAdd ? (
        <div class="cps-actions cps-actions--col" style="margin-top:0">
          <Button variant="secondary" onClick={() => route(`/competitions/${cid}/entries/${enId}/add`)}>{ct('addPlayer')}</Button>
          <Button variant="primary" disabled={short || entry.status !== 'approved'} onClick={() => { void confirm(); }}>{ct('confirmRoster')}</Button>
        </div>
      ) : null}
      {canJoin ? (
        <div class="cps-actions">
          <Button variant="primary" onClick={() => route(`/competitions/${cid}/entries/${enId}/join`)}>{ct('joinAction')}</Button>
        </div>
      ) : null}
    </CpFrame>
  );
}

export default function RosterPage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  const enId = injected?.route?.enId ?? routed.params?.enId ?? '';
  if (injected) return <RosterView env={injected} cid={cid} enId={enId} />;
  return (
    <LiveBoundary>
      {(actor, repo) => (
        <RosterView env={{ actor, repo, actions: liveCpActions, route: { cid, enId } }} cid={cid} enId={enId} />
      )}
    </LiveBoundary>
  );
}
