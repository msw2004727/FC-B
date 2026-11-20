// 代表看的名單。背號、顯示名、位置同一行。人數不足不能確認。鎖定後唯讀。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { useGoBack } from '@/core/back-guard';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { Button } from '@/ui/Button';
import { PageSpinner } from '@/ui/PageSpinner';
import { liveCpActions } from '../actions';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { positionLabel } from '../format';
import { LiveBoundary } from '../live';
import type { EntryStatus, RosterPublicDoc } from '../data/types';
import { CpError, CpLoadFailed, errorOf, loadFailOf, type CpLoadFail } from '../ui/feedback';
import { dangerConfirm } from '../ui/danger-confirm';
import { CpCard, CpFrame, CpI18nPending, TrashIcon } from '../ui/shell';
import { StatusTag } from '../ui/status-tag';
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

/** 照背號排，同號再比 id（與記分頁選人同一套；live/ 不能動，這裡另寫一份）。 */
function byNumber(a: RosterPublicDoc, b: RosterPublicDoc): number {
  return a.number - b.number || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** 報隊狀態的字。新外觀卡 3-2：四種都是中性標籤（3.0.5），不再分色。 */
function entryStatusLabel(ct: CompetitionsT, status: EntryStatus): string {
  if (status === 'approved') return ct('approved');
  if (status === 'pending') return ct('pending');
  if (status === 'rejected') return ct('rejected');
  return ct('withdrawn');
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
      {player.isMinor ? <StatusTag kind="neutral" label={ct('minor')} /> : null}
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
  // 直接開名單頁時「<」退到賽事詳情，不跳出賽事。
  const back = useGoBack(`/competitions/${cid}`);
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

  const players = (bundle?.roster.filter((row) => row.enId === enId) ?? []).sort(byNumber);
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

  async function remove(player: RosterPublicDoc): Promise<void> {
    if (busy) return;
    const ok = await dangerConfirm(ct('removePlayerConfirm', { name: player.displayName }), {
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
    <CpFrame title={ct('rosterTitle')} context={competition.name} onBack={back}>
      {/* 新外觀卡 3-2：隊伍卡順序改成 隊徽＋隊名 → 兩顆標籤 → 人數 → 進度條 → 說明句（標記順序＝讀螢幕順序） */}
      <CpCard>
        <div class="cp3-roster-head">
          {/* ASSUMPTION: 名單這頁的 listEntries 已經帶 teamLogo，不再多打一筆 listEntriesForCrest。 */}
          <TeamCrest teamId={entry.teamId} name={entry.name} teamLogo={entry.teamLogo} size={48} />
          <div class="cp3-roster-head__t">
            <h2 class="cps-title">{entry.name}</h2>
            <p class="cps-sub">{division.name}　{ct('formatN', { n: division.playersOnField })}</p>
          </div>
        </div>
        <div class="cps-badges cp3-roster-tags">
          <StatusTag kind="neutral" label={entryStatusLabel(ct, entry.status)} />
          <StatusTag kind="neutral" label={entry.rosterConfirmed || locked ? ct('rosterConfirmed') : ct('rosterUnconfirmed')} />
        </div>
        <div class="cps-kv cp3-roster-count">
          <span>{ct('currentCount')}</span>
          <span>{ct('rosterCount', { n: players.length, max, min })}</span>
        </div>
        <div class="cps-bar cp3-roster-bar" aria-hidden="true">
          <i class={short ? 'low' : ''} style={`width:${Math.min(100, (players.length / max) * 100)}%`} />
        </div>
        {!locked && short ? <p class="cps-note cps-warn cp3-roster-note">{ct('needMore', { n: min - players.length, min })}</p> : null}
        {locked ? <p class="cps-note cp3-roster-note">{ct('rosterLocked')}</p> : null}
        {error ? <CpError reason={error.reason} params={error.params} /> : null}
      </CpCard>
      <CpCard class="cp3-roster-list">
        <div class="cp3-roster-list__h">
          <h2 class="cps-h">{ct('players')}</h2>
          {canAdd ? (
            <Button variant="secondary" size="sm" onClick={() => route(`/competitions/${cid}/entries/${enId}/add`)}>{ct('addPlayer')}</Button>
          ) : null}
        </div>
        <ul class="cps-list">
          {players.map((player) => (
            <PlayerRow key={player.id} player={player} canEdit={canEdit} onRemove={() => { void remove(player); }} />
          ))}
        </ul>
      </CpCard>
      {canAdd ? (
        <div class="cps-actions cp3-roster-act">
          <Button variant={entry.rosterConfirmed ? 'secondary' : 'primary'} disabled={short || entry.status !== 'approved'} onClick={() => { void confirm(); }}>{ct('confirmRoster')}</Button>
        </div>
      ) : null}
      {canJoin ? (
        <div class="cps-actions cp3-roster-act">
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
