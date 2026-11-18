// 主辦管理：待審／已核准／已拒絕。審核、繳費、鎖定只給主辦方或管理員。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { useT } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { Badge } from '@/ui/Badge';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { PageSpinner } from '@/ui/PageSpinner';
import { Switch } from '@/ui/Switch';
import { Tabs } from '@/ui/Tabs';
import { Textarea } from '@/ui/Textarea';
import { canManageCompetition, canUnlockRosters, isCpAdmin } from '../access';
import { liveCpActions } from '../actions';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { LiveBoundary } from '../live';
import { buildPaymentInput, buildReviewInput } from '../payload';
import type { DivisionDoc, EntryDoc, EntryPrivateDoc, PaymentStatus } from '../data/types';
import { CpError, errorOf } from '../ui/feedback';
import { FeeLine } from '../ui/fields';
import { CpCard, CpFrame } from '../ui/shell';

async function loadManage(env: CpInjectedEnv, cid: string): Promise<CpBundle> {
  const uid = env.actor.uid;
  const [competition, divisions, entries, staff] = await Promise.all([
    env.repo.getCompetition(cid),
    env.repo.listDivisions(cid),
    env.repo.listEntries(cid),
    uid ? env.repo.getStaff(cid, uid) : Promise.resolve(null),
  ]);
  const manage = competition ? canManageCompetition({
    staffRoles: staff?.roles ?? [],
    hostType: competition.hostType,
    hostTeamId: competition.hostTeamId,
    repClubIds: env.actor.repClubs.map((club) => club.id),
    isAdmin: isCpAdmin(env.actor.role),
  }) : false;
  const privates = manage ? await env.repo.listEntryPrivate(cid, null) : [];
  return { competition, divisions, entries, roster: [], privates, staff };
}

function payLabel(t: (key: string) => string, status: PaymentStatus): { label: string; tone: 'success' | 'neutral' } {
  if (status === 'paid') return { label: t('competitions.paid'), tone: 'success' };
  if (status === 'refunded') return { label: t('competitions.refunded'), tone: 'neutral' };
  return { label: t('competitions.unpaid'), tone: 'neutral' };
}

function privateOf(rows: readonly EntryPrivateDoc[], entry: EntryDoc): EntryPrivateDoc | null {
  return rows.find((row) => row.id === entry.id) ?? rows.find((row) => row.teamId === entry.teamId) ?? null;
}

function ManageView({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const t = useT();
  const { route } = useLocation();
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [phase, setPhase] = useState(env.bundle ? 'ready' : 'loading');
  const [tab, setTab] = useState(() => {
    if (env.preview?.unlockOpen || env.preview?.lockDialog) return 'approved';
    return env.preview?.manageTab ?? 'pending';
  });
  const [rejectId, setRejectId] = useState<string | null>(env.preview?.rejectOpen ? 'pending' : null);
  const [rejectReason, setRejectReason] = useState('');
  const [unlockOpen, setUnlockOpen] = useState(env.preview?.unlockOpen === true);
  const [unlockReason, setUnlockReason] = useState('');
  const [error, setError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const now = env.now ?? Date.now();

  useEffect(() => {
    if (env.bundle) return;
    let alive = true;
    void loadManage(env, cid).then((next) => {
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
  }, [cid, env.actor.uid, env.bundle]);

  const competition = bundle?.competition;
  const manage = competition ? canManageCompetition({
    staffRoles: bundle?.staff?.roles ?? [],
    hostType: competition.hostType,
    hostTeamId: competition.hostTeamId,
    repClubIds: env.actor.repClubs.map((club) => club.id),
    isAdmin: isCpAdmin(env.actor.role),
  }) : false;
  const locked = competition?.rostersLockedAt != null;
  const entries = bundle?.entries ?? [];
  const pending = entries.filter((entry) => entry.status === 'pending');
  const approved = entries.filter((entry) => entry.status === 'approved');
  const rejected = entries.filter((entry) => entry.status === 'rejected');
  const unconfirmed = approved.filter((entry) => !entry.rosterConfirmed).length;

  useEffect(() => {
    if (!env.preview?.lockDialog) return;
    void appConfirm(t('competitions.lockConfirm', { n: unconfirmed }), {
      okText: t('competitions.lock'),
      danger: false,
    });
    // 只為截圖把確認框打開，不在這裡鎖定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (env.preview?.rejectOpen && rejectId === 'pending' && pending[0]) {
      setRejectId(pending[0].id);
      setTab('pending');
    }
  }, [env.preview?.rejectOpen, pending, rejectId]);

  if (phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
  if (!competition) {
    return (
      <CpFrame title={t('competitions.manageTitle')}>
        <p class="cps-note" role="alert">{t('competitions.loadFailed')}</p>
      </CpFrame>
    );
  }

  const rejectEntry = entries.find((entry) => entry.id === rejectId) ?? null;
  const divisionName = (dvId: string): string => bundle?.divisions.find((row) => row.dvId === dvId)?.name ?? '';
  const divisionOf = (dvId: string): DivisionDoc | undefined => bundle?.divisions.find((row) => row.dvId === dvId);

  async function approve(enId: string): Promise<void> {
    if (!manage || busy) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.review(buildReviewInput({ cid, enId, decision: 'approve' }));
      setBundle((prev) => prev ? {
        ...prev,
        entries: prev.entries.map((row) => row.id === enId ? { ...row, status: 'approved' } : row),
      } : prev);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function reject(): Promise<void> {
    if (!manage || !rejectEntry) return;
    const reason = rejectReason.trim();
    if (reason.length < 1) {
      setError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await env.actions.review(buildReviewInput({ cid, enId: rejectEntry.id, decision: 'reject', reason }));
      setBundle((prev) => prev ? {
        ...prev,
        entries: prev.entries.map((row) => row.id === rejectEntry.id ? { ...row, status: 'rejected' } : row),
        privates: prev.privates.map((row) => row.id === rejectEntry.id || row.teamId === rejectEntry.teamId
          ? { ...row, reviewNote: reason }
          : row),
      } : prev);
      setRejectId(null);
      setRejectReason('');
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(entry: EntryDoc, paid: boolean): Promise<void> {
    if (!manage || busy) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.setPaymentStatus(buildPaymentInput({ cid, enId: entry.id, paid }));
      setBundle((prev) => {
        if (!prev) return prev;
        const status: PaymentStatus = paid ? 'paid' : 'none';
        const exists = prev.privates.some((row) => row.id === entry.id || row.teamId === entry.teamId);
        const privates = exists
          ? prev.privates.map((row) => row.id === entry.id || row.teamId === entry.teamId
            ? { ...row, paymentStatus: status }
            : row)
          : [...prev.privates, {
            id: entry.id,
            teamId: entry.teamId,
            contactName: null,
            contactPhone: null,
            paymentStatus: status,
            reviewNote: null,
          } as EntryPrivateDoc];
        return { ...prev, privates };
      });
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function lock(): Promise<void> {
    if (!manage || busy || locked) return;
    const ok = await appConfirm(t('competitions.lockConfirm', { n: unconfirmed }), {
      okText: t('competitions.lock'),
      danger: false,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.lockRosters({ cid });
      setBundle((prev) => prev && prev.competition ? {
        ...prev,
        competition: { ...prev.competition, rostersLockedAt: now },
      } : prev);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function unlock(): Promise<void> {
    const reason = unlockReason.trim();
    if (!reason) {
      setError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await env.actions.unlockRosters({ cid, reason });
      setBundle((prev) => prev && prev.competition ? {
        ...prev,
        competition: { ...prev.competition, rostersLockedAt: null },
      } : prev);
      setUnlockOpen(false);
      setUnlockReason('');
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  const showUnlock = canUnlockRosters({
    locked,
    canManage: manage,
    isAdmin: isCpAdmin(env.actor.role),
    firstMatchAt: competition.firstMatchAt,
    now,
  });

  const pendingPanel = (
    <div class="cps-stack" style="margin-top:12px">
      {pending.map((entry) => {
        const priv = privateOf(bundle?.privates ?? [], entry);
        return (
          <CpCard key={entry.id}>
            <div class="cps-head-row">
              <h3 class="cps-h">{entry.name}</h3>
              <Badge tone="warning" label={t('competitions.pending')} size="sm" />
            </div>
            <p class="cps-sub" style="margin:4px 0 8px">{divisionName(entry.dvId)}</p>
            {priv?.contactName ? (
              <div class="cps-kv"><span>{t('competitions.contact')}</span><span>{priv.contactName}</span></div>
            ) : null}
            {manage ? (
              <div class="cps-actions">
                <Button variant="secondary" onClick={() => { setRejectId(entry.id); setError(null); }}>{t('competitions.reject')}</Button>
                <Button variant="primary" onClick={() => { void approve(entry.id); }}>{t('competitions.approve')}</Button>
              </div>
            ) : null}
          </CpCard>
        );
      })}
    </div>
  );

  const approvedPanel = (
    <div class="cps-stack" style="margin-top:12px">
      {approved.map((entry) => {
        const division = divisionOf(entry.dvId);
        const priv = privateOf(bundle?.privates ?? [], entry);
        const pay = payLabel(t, priv?.paymentStatus ?? 'none');
        return (
          <CpCard key={entry.id}>
            <div class="cps-head-row">
              <h3 class="cps-h">
                <a class="cps-link" href={`/competitions/${cid}/entries/${entry.id}`} onClick={(event) => { event.preventDefault(); route(`/competitions/${cid}/entries/${entry.id}`); }}>
                  {entry.name}
                </a>
              </h3>
              {entry.rosterConfirmed
                ? <Badge tone="success" label={t('competitions.rosterConfirmed')} size="sm" />
                : <Badge tone="warning" label={t('competitions.rosterUnconfirmed')} size="sm" />}
            </div>
            <p class="cps-sub" style="margin:4px 0 8px">{divisionName(entry.dvId)}</p>
            {division ? <FeeLine amount={division.feePerTeam} /> : null}
            <div class="cps-kv">
              <span>{t('competitions.rosterPeople')}</span>
              <span>{t('competitions.rosterCount', { n: entry.rosterCount, max: division?.rosterMax ?? 0, min: division?.rosterMin ?? 0 })}</span>
            </div>
            {manage ? (
              <div class="cps-pay">
                <Badge tone={pay.tone} label={pay.label} size="sm" />
                <Switch
                  label={t('competitions.markPaid')}
                  checked={priv?.paymentStatus === 'paid'}
                  onCheckedChange={(checked) => { void markPaid(entry, checked); }}
                />
              </div>
            ) : null}
          </CpCard>
        );
      })}
      {manage && !locked ? (
        <div class="cps-actions cps-actions--col" style="margin-top:0">
          <Button variant="danger" onClick={() => { void lock(); }}>{t('competitions.lockAll')}</Button>
        </div>
      ) : null}
      {showUnlock ? (
        <div class="cps-actions">
          <Button variant="secondary" onClick={() => setUnlockOpen(true)}>{t('competitions.unlock')}</Button>
        </div>
      ) : null}
    </div>
  );

  const rejectedPanel = (
    <div class="cps-stack" style="margin-top:12px">
      {rejected.map((entry) => {
        const priv = privateOf(bundle?.privates ?? [], entry);
        return (
          <CpCard key={entry.id}>
            <div class="cps-head-row">
              <h3 class="cps-h">{entry.name}</h3>
              <Badge tone="danger" label={t('competitions.rejected')} size="sm" />
            </div>
            <p class="cps-sub" style="margin:4px 0 8px">{divisionName(entry.dvId)}</p>
            {priv?.reviewNote ? (
              <div class="cps-kv"><span>{t('competitions.rejectReason')}</span><span>{priv.reviewNote}</span></div>
            ) : null}
          </CpCard>
        );
      })}
    </div>
  );

  return (
    <CpFrame title={t('competitions.manageTitle')}>
      <div>
        <p class="cps-sub" style="margin-bottom:8px">{competition.name}</p>
        <Tabs
          label={t('competitions.entryTabs')}
          variant="segmented"
          value={tab}
          onValueChange={(id) => {
            if (id === 'pending' || id === 'approved' || id === 'rejected') setTab(id);
          }}
          items={[
            { id: 'pending', label: t('competitions.tabPending', { n: pending.length }), panel: pendingPanel },
            { id: 'approved', label: t('competitions.tabApproved', { n: approved.length }), panel: approvedPanel },
            { id: 'rejected', label: t('competitions.tabRejected', { n: rejected.length }), panel: rejectedPanel },
          ]}
        />
      </div>
      {error && !rejectEntry && !unlockOpen ? <CpError reason={error.reason} params={error.params} /> : null}
      {rejectEntry ? (
        <BottomSheet
          open
          title={t('competitions.rejectTitle')}
          onClose={() => setRejectId(null)}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" onClick={() => setRejectId(null)}>{t('competitions.cancel')}</Button>
              <Button variant="danger" loading={busy} onClick={() => { void reject(); }}>{t('competitions.rejectSubmit')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            <p class="cps-note">{rejectEntry.name}　{divisionName(rejectEntry.dvId)}</p>
            <Textarea
              label={t('competitions.rejectReason')}
              required
              value={rejectReason}
              maxLength={200}
              placeholder={t('competitions.rejectPlaceholder')}
              onValueChange={setRejectReason}
            />
            {error ? <CpError reason={error.reason} params={error.params} /> : null}
          </div>
        </BottomSheet>
      ) : null}
      {unlockOpen ? (
        <BottomSheet
          open
          title={t('competitions.unlockTitle')}
          onClose={() => setUnlockOpen(false)}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" onClick={() => setUnlockOpen(false)}>{t('competitions.cancel')}</Button>
              <Button variant="primary" loading={busy} onClick={() => { void unlock(); }}>{t('competitions.unlockSubmit')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            <Textarea
              label={t('competitions.unlockReason')}
              required
              value={unlockReason}
              maxLength={200}
              onValueChange={setUnlockReason}
            />
            {error ? <CpError reason={error.reason} params={error.params} /> : null}
          </div>
        </BottomSheet>
      ) : null}
    </CpFrame>
  );
}

export default function CompetitionManagePage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  if (injected) return <ManageView env={injected} cid={cid} />;
  return (
    <LiveBoundary>
      {(actor, repo) => <ManageView env={{ actor, repo, actions: liveCpActions }} cid={cid} />}
    </LiveBoundary>
  );
}
