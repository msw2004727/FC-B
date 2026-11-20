// 人員清單。主辦或共同主辦指派記分角色、邀請記分員（K11）。平面卡片，沿用 v4 清單。
// 尚未使用的邀請：listInvites（status open、limit 30），只在確認是主辦／共同主辦後才讀。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { PageSpinner } from '@/ui/PageSpinner';
import { isCpAdmin } from '../access';
import { liveCpActions } from '../actions';
import {
  canRemoveStaffRow,
  compareStaffOrder,
  hasScoreRole,
  rowRole,
  staffDisplayNames,
  viewerKind,
  withRepSelf,
  type StaffViewerKind,
} from '../data/staff-assign';
import { resolveHostAccess } from '../data/host-access';
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
      // 主辦／共同主辦本人也有記分角色：多顯示記分角色標籤，到期跟著它（顧問 11-20 測試賽 D）。
      ...(role === 'host' || role === 'coHost'
        ? (() => {
          const extra = (['scorer', 'referee'] as const)
            .filter((r) => item.roles.includes(r))
            .map((r) => ({ role: r, label: roleText(ct, r) }));
          return extra.length ? { extraRoles: extra } : {};
        })()
        : {}),
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
  // 邀請讀取失敗不當成「沒有邀請」（Opus 審 P3-3）。
  const [invitesFailed, setInvitesFailed] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // 俱樂部目前代表：自己那一列顯示主辦（後端沒有代表的主辦 staff 文件）。
  const [clubRep, setClubRep] = useState(false);
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
      const [next, open] = await Promise.all([
        env.repo.listStaff(cid),
        env.repo.listInvites(cid).then((rows) => ({ ok: true as const, rows }), () => ({ ok: false as const, rows: [] as InviteDoc[] })),
      ]);
      if (!alive) return;
      setList(next);
      setInvites(open.rows);
      setInvitesFailed(!open.ok);
      setClubRep(access.clubRep);
      setViewer(viewerKind(staff?.roles ?? [], isCpAdmin(env.actor.role), access.clubRep));
      setPhase('ready');
    })().catch(() => {
      if (alive) setPhase('error');
    });
    return () => {
      alive = false;
    };
    // repKey 代表 env.actor.repClubs 的內容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, env.actor.authPending, env.actor.role, env.actor.uid, env.repo, repKey, repPending]);

  async function reload(): Promise<void> {
    const next = await env.repo.listStaff(cid);
    setList(next);
  }

  async function retryInvites(): Promise<void> {
    try {
      setInvites(await env.repo.listInvites(cid));
      setInvitesFailed(false);
    } catch {
      setInvitesFailed(true);
    }
  }

  async function confirmRemove(): Promise<void> {
    if (!confirmTarget || busy) return;
    setBusy(true);
    setRemoveError(null);
    try {
      if (confirmTarget.kind === 'invite') {
        const revoke = env.actions.revokeInvite;
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
  if (env.actor.authPending || repPending || phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
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
      rows={toRows(ct, clubRep ? withRepSelf(list, uid) : list, uid, viewer)}
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
        failed={invitesFailed ? { message: ct('loadFailed'), retryLabel: ct('retry'), onRetry: () => { void retryInvites(); } } : null}
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
