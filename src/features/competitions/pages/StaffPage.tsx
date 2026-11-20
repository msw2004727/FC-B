// 人員清單。主辦或共同主辦指派記分角色。平面卡片，沿用 v4 清單。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { PageSpinner } from '@/ui/PageSpinner';
import { canHostOrCo, isCpAdmin } from '../access';
import { liveCpActions } from '../actions';
import {
  canRemoveStaffRow,
  compareStaffOrder,
  rowRole,
  staffDisplayNames,
  viewerKind,
  type StaffViewerKind,
} from '../data/staff-assign';
import type { StaffAssignment, StaffAssignmentRole } from '../data/types';
import type { CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { LiveBoundary } from '../live';
import { StaffDeniedScreen, StaffListScreen, type StaffListRow } from '../step4b/staff';
import { errorOf, reasonText } from '../ui/feedback';
import { CpI18nPending } from '../ui/shell';

function roleText(ct: CompetitionsT, role: StaffAssignmentRole): string {
  if (role === 'host') return ct('host');
  if (role === 'coHost') return ct('roleCoHost');
  if (role === 'scorer') return ct('roleScorer');
  return ct('roleReferee');
}

function toRows(
  ct: CompetitionsT,
  list: readonly StaffAssignment[],
  selfUid: string,
  viewer: StaffViewerKind,
): StaffListRow[] {
  const ordered = [...list].sort(compareStaffOrder);
  const names = staffDisplayNames(ordered, selfUid, {
    me: ct('staffMe'),
    member: ct('staffMember'),
    memberN: (n) => ct('staffMemberN', { n }),
  });
  const rows: StaffListRow[] = [];
  for (const item of ordered) {
    const role = rowRole(item.roles);
    if (!role) continue;
    rows.push({
      id: item.uid,
      name: names.get(item.uid) ?? ct('staffMember'),
      role,
      roleLabel: roleText(ct, role),
      countLabel: ct('assignedCount', { n: item.matchIds.length }),
      removable: canRemoveStaffRow(viewer, item.roles, item.uid === selfUid),
    });
  }
  return rows;
}

function StaffView({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [phase, setPhase] = useState<'loading' | 'denied' | 'ready' | 'error'>('loading');
  const [list, setList] = useState<StaffAssignment[]>([]);
  const [viewer, setViewer] = useState<StaffViewerKind | null>(null);
  const [confirmUid, setConfirmUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    if (env.actor.authPending) return undefined;
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
      const allowed = canHostOrCo({
        staffRoles: staff?.roles ?? [],
        isAdmin: isCpAdmin(env.actor.role),
      });
      if (!allowed) {
        setPhase('denied');
        return;
      }
      const next = await env.repo.listStaff(cid);
      if (!alive) return;
      setList(next);
      setViewer(viewerKind(staff?.roles ?? [], isCpAdmin(env.actor.role)));
      setPhase('ready');
    })().catch(() => {
      if (alive) setPhase('error');
    });
    return () => {
      alive = false;
    };
  }, [cid, env.actor.authPending, env.actor.role, env.actor.uid, env.repo]);

  async function reload(): Promise<void> {
    const next = await env.repo.listStaff(cid);
    setList(next);
  }

  async function confirmRemove(): Promise<void> {
    if (!confirmUid) return;
    setBusy(true);
    setRemoveError(null);
    try {
      await env.actions.removeStaff({ cid, uid: confirmUid });
      setConfirmUid(null);
      await reload();
    } catch (err) {
      const info = errorOf(err);
      setRemoveError(reasonText(ct, info.reason, info.params));
    } finally {
      setBusy(false);
    }
  }

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const back = () => route(`/competitions/${cid}`);
  if (env.actor.authPending || phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
  if (phase === 'error') {
    return (
      <StaffDeniedScreen title={ct('staffTitle')} message={ct('loadFailed')} backLabel={ct('backToCompetition')} onBack={back} />
    );
  }
  if (phase === 'denied' || !viewer || !env.actor.uid) {
    return (
      <StaffDeniedScreen
        title={ct('staffTitle')}
        message={ct('staffNoPermission')}
        backLabel={ct('backToCompetition')}
        onBack={back}
      />
    );
  }
  const uid = env.actor.uid;
  return (
    <StaffListScreen
      viewerRole={viewer}
      title={ct('staffTitle')}
      rows={toRows(ct, list, uid, viewer)}
      onBack={back}
      onAssign={() => route(`/competitions/${cid}/staff/assign`)}
      onRemove={(id) => {
        setRemoveError(null);
        setConfirmUid(id);
      }}
      confirmBusy={busy}
      confirm={confirmUid ? {
        title: ct('staffRemoveTitle'),
        body: ct('staffRemoveBody'),
        confirmLabel: ct('remove'),
        cancelLabel: ct('cancel'),
        ...(removeError ? { error: removeError } : {}),
      } : null}
      onConfirm={() => { void confirmRemove(); }}
      onDismiss={() => {
        if (busy) return;
        setConfirmUid(null);
        setRemoveError(null);
      }}
    />
  );
}

export default function StaffPage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  if (injected) return <StaffView env={injected} cid={cid} />;
  return (
    <LiveBoundary>
      {(actor, repo) => <StaffView env={{ actor, repo, actions: liveCpActions, route: { cid } }} cid={cid} />}
    </LiveBoundary>
  );
}
