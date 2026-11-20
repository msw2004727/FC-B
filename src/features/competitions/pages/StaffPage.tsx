// 人員清單。主辦或共同主辦指派記分角色、邀請記分員（K11）。平面卡片，沿用 v4 清單。
// 尚未使用的邀請：listInvites（status open、limit 30），只在確認是主辦／共同主辦後才讀。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { PageSpinner } from '@/ui/PageSpinner';
import { canHostOrCo, isCpAdmin } from '../access';
import { liveCpActions, missingAction } from '../actions';
import {
  canRemoveStaffRow,
  compareStaffOrder,
  hasScoreRole,
  rowRole,
  staffDisplayNames,
  viewerKind,
  type StaffViewerKind,
} from '../data/staff-assign';
import type { InviteDoc, StaffAssignment, StaffAssignmentRole } from '../data/types';
import { formatTaipeiShort } from '../format';
import type { CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { LiveBoundary } from '../live';
import { OpenInviteList, StaffDeniedScreen, StaffListScreen, type OpenInviteRow, type StaffListRow } from '../step4b/staff';
import { inviteRoleText } from './StaffInvitePage';
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
      // 只有記分角色才有到期；null＝不過期，不顯示。
      ...(hasScoreRole(item.roles) && item.expiresAt != null
        ? { expiresLabel: ct('staffExpires', { date: formatTaipeiShort(item.expiresAt) }) }
        : {}),
    });
  }
  return rows;
}

function inviteRows(ct: CompetitionsT, list: readonly InviteDoc[]): OpenInviteRow[] {
  return list.filter((row) => row.status === 'open').map((row) => ({
    id: row.id,
    roleLabel: inviteRoleText(ct, row.roles),
    countLabel: ct('assignedCount', { n: row.matchIds.length }),
    expiresLabel: row.expiresAt == null ? '' : ct('inviteExpires', { date: formatTaipeiShort(row.expiresAt) }),
  }));
}

type ConfirmTarget = { kind: 'staff' | 'invite'; id: string };

function StaffView({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [phase, setPhase] = useState<'loading' | 'denied' | 'ready' | 'error'>('loading');
  const [list, setList] = useState<StaffAssignment[]>([]);
  const [viewer, setViewer] = useState<StaffViewerKind | null>(null);
  const [invites, setInvites] = useState<InviteDoc[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
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
      const [next, open] = await Promise.all([
        env.repo.listStaff(cid),
        env.repo.listInvites(cid).catch(() => [] as InviteDoc[]),
      ]);
      if (!alive) return;
      setList(next);
      setInvites(open);
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
    if (!confirmTarget || busy) return;
    setBusy(true);
    setRemoveError(null);
    try {
      if (confirmTarget.kind === 'invite') {
        const revoke = env.actions.revokeInvite ?? missingAction;
        await revoke({ cid, ivId: confirmTarget.id });
        // 撤銷成功只從畫面拿掉，不重讀（+0 讀）。
        const gone = confirmTarget.id;
        setInvites((prev) => prev.filter((row) => row.id !== gone));
        setConfirmTarget(null);
        return;
      }
      await env.actions.removeStaff({ cid, uid: confirmTarget.id });
      setConfirmTarget(null);
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
  const confirmCopy = confirmTarget?.kind === 'invite'
    ? { title: ct('inviteRevokeTitle'), body: ct('inviteRevokeBody'), confirmLabel: ct('inviteRevoke') }
    : { title: ct('staffRemoveTitle'), body: ct('staffRemoveBody'), confirmLabel: ct('remove') };
  return (
    <StaffListScreen
      viewerRole={viewer}
      title={ct('staffTitle')}
      rows={toRows(ct, list, uid, viewer)}
      onBack={back}
      onAssign={() => route(`/competitions/${cid}/staff/assign`)}
      onRemove={(id) => {
        setRemoveError(null);
        setConfirmTarget({ kind: 'staff', id });
      }}
      inviteLabel={ct('staffInvite')}
      onInvite={() => route(`/competitions/${cid}/staff/invite`)}
      confirmBusy={busy}
      confirm={confirmTarget ? {
        ...confirmCopy,
        cancelLabel: ct('cancel'),
        ...(removeError ? { error: removeError } : {}),
      } : null}
      onConfirm={() => { void confirmRemove(); }}
      onDismiss={() => {
        if (busy) return;
        setConfirmTarget(null);
        setRemoveError(null);
      }}
    >
      <OpenInviteList
        title={ct('inviteOpenList')}
        empty={ct('inviteNone')}
        rows={inviteRows(ct, invites)}
        revokeLabel={ct('inviteRevoke')}
        onRevoke={(id) => {
          setRemoveError(null);
          setConfirmTarget({ kind: 'invite', id });
        }}
      />
    </StaffListScreen>
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
