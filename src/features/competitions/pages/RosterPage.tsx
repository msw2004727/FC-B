// 代表看的名單。背號、顯示名、位置同一行。人數不足不能確認。鎖定後唯讀。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { useT } from '@/i18n/i18n';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { PageSpinner } from '@/ui/PageSpinner';
import { liveCpActions } from '../actions';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { positionLabel } from '../format';
import { LiveBoundary } from '../live';
import type { RosterPublicDoc } from '../data/types';
import { CpError, errorOf } from '../ui/feedback';
import { CpCard, CpFrame, TrashIcon } from '../ui/shell';

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

function PlayerRow({
  player,
  canEdit,
  onRemove,
}: {
  player: RosterPublicDoc;
  canEdit: boolean;
  onRemove: () => void;
}): JSX.Element {
  const t = useT();
  const pos = positionLabel(player.position, player.positionText, {
    none: t('competitions.positionNone'),
    GK: t('competitions.positionGK'),
    DF: t('competitions.positionDF'),
    MF: t('competitions.positionMF'),
    FW: t('competitions.positionFW'),
    custom: t('competitions.positionCustom'),
  });
  return (
    <li class="cps-li cps-player" data-roster-row>
      <span class="cps-num">{player.number}</span>
      <span class="cps-player__name">{player.displayName}</span>
      <span class="cps-player__pos">{pos}</span>
      {player.isMinor ? <Badge tone="warning" label={t('competitions.minor')} size="sm" /> : null}
      {canEdit ? (
        <button type="button" class="cps-iconbtn cps-iconbtn--flat" aria-label={t('competitions.removePlayer', { name: player.displayName })} onClick={onRemove}>
          <TrashIcon />
        </button>
      ) : null}
    </li>
  );
}

function RosterView({ env, cid, enId }: { env: CpInjectedEnv; cid: string; enId: string }): JSX.Element {
  const t = useT();
  const { route } = useLocation();
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>(env.bundle ? 'ready' : 'loading');
  const [error, setError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (env.bundle) return;
    let alive = true;
    void loadRoster(env, cid, enId).then((next) => {
      if (!alive) return;
      setBundle(next);
      setPhase(next.competition ? 'ready' : 'error');
    }).catch(() => {
      if (alive) setPhase('error');
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, enId, env.actor.uid, env.bundle]);

  if (phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
  const competition = bundle?.competition;
  const entry = bundle?.entries.find((row) => row.id === enId);
  const division = bundle?.divisions.find((row) => row.dvId === entry?.dvId);
  if (!competition || !entry || !division || phase === 'error') {
    return (
      <CpFrame title={t('competitions.rosterTitle')}>
        <p class="cps-note" role="alert">{t('competitions.loadFailed')}</p>
      </CpFrame>
    );
  }

  const players = bundle?.roster.filter((row) => row.enId === enId) ?? [];
  const locked = competition.rostersLockedAt != null;
  const isRep = env.actor.repClubs.some((club) => club.id === entry.teamId);
  const isMember = !isRep && env.actor.memberClubIds.includes(entry.teamId);
  const min = division.rosterMin;
  const max = division.rosterMax;
  const short = players.length < min;
  const canEdit = isRep && !locked && entry.status === 'approved';

  async function remove(player: RosterPublicDoc): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.leaveRoster({ cid, plId: player.id });
      setBundle((prev) => prev ? { ...prev, roster: prev.roster.filter((row) => row.id !== player.id) } : prev);
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
    <CpFrame title={t('competitions.rosterTitle')}>
      <CpCard>
        <div class="cps-badges" style="margin-bottom:6px">
          <Badge tone="success" label={t('competitions.approved')} size="sm" />
          {entry.rosterConfirmed || locked
            ? <Badge tone="success" label={t('competitions.rosterConfirmed')} size="sm" />
            : <Badge tone="warning" label={t('competitions.rosterUnconfirmed')} size="sm" />}
        </div>
        <h2 class="cps-title">{entry.name}</h2>
        <p class="cps-sub">{division.name}　{t('competitions.formatN', { n: division.playersOnField })}</p>
        <div class="cps-bar" aria-hidden="true">
          <i class={short ? 'low' : ''} style={`width:${Math.min(100, (players.length / max) * 100)}%`} />
        </div>
        <div class="cps-kv">
          <span>{t('competitions.currentCount')}</span>
          <span>{t('competitions.rosterCount', { n: players.length, max, min })}</span>
        </div>
        {!locked && short ? <p class="cps-note cps-warn" style="margin-top:8px">{t('competitions.needMore', { n: min - players.length, min })}</p> : null}
        {locked ? <p class="cps-note" style="margin-top:8px">{t('competitions.rosterLocked')}</p> : null}
        {error ? <CpError reason={error.reason} params={error.params} /> : null}
      </CpCard>
      <CpCard>
        <h2 class="cps-h">{t('competitions.players')}</h2>
        <ul class="cps-list">
          {players.map((player) => (
            <PlayerRow key={player.id} player={player} canEdit={canEdit} onRemove={() => { void remove(player); }} />
          ))}
        </ul>
      </CpCard>
      {!locked && isRep ? (
        <div class="cps-actions cps-actions--col" style="margin-top:0">
          <Button variant="secondary" onClick={() => route(`/competitions/${cid}/entries/${enId}/add`)}>{t('competitions.addPlayer')}</Button>
          <Button variant="primary" disabled={short || entry.status !== 'approved'} onClick={() => { void confirm(); }}>{t('competitions.confirmRoster')}</Button>
        </div>
      ) : null}
      {!locked && isMember && entry.status === 'approved' ? (
        <div class="cps-actions">
          <Button variant="primary" onClick={() => route(`/competitions/${cid}/entries/${enId}/join`)}>{t('competitions.joinAction')}</Button>
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
