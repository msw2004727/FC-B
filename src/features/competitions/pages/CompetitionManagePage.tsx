// 主辦管理：待審／已核准／已拒絕。審核、繳費、鎖定只給主辦方或管理員。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { Badge } from '@/ui/Badge';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { PageSpinner } from '@/ui/PageSpinner';
import { RadioGroup } from '@/ui/RadioGroup';
import { Switch } from '@/ui/Switch';
import { Tabs } from '@/ui/Tabs';
import { Textarea } from '@/ui/Textarea';
import { canHostOrCo, canManageCompetition, canUnlockRosters, isCpAdmin } from '../access';
import { contactNoteProblem } from '../data/flex-schedule';
import { clipCodePoints } from '../format';
import { liveCpActions } from '../actions';
import { representativeClubs } from '../rep-clubs';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { LiveBoundary } from '../live';
import { buildPaymentInput, buildReviewInput } from '../payload';
import type { CompetitionCategory, DivisionDoc, EntryDoc, EntryPrivateDoc, PaymentStatus } from '../data/types';
import { CpError, errorOf } from '../ui/feedback';
import { FeeLine } from '../ui/fields';
import { CpCard, CpFrame, CpI18nPending } from '../ui/shell';

const INFO_TOGGLE_ID = 'cp-comp-info-toggle';
const INFO_PANEL_ID = 'cp-comp-info';

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
    repClubIds: representativeClubs(env.actor).map((club) => club.id),
    isAdmin: isCpAdmin(env.actor.role),
  }) : false;
  const privates = manage ? await env.repo.listEntryPrivate(cid, null) : [];
  return { competition, divisions, entries, roster: [], privates, staff };
}

function payLabel(ct: CompetitionsT, status: PaymentStatus): { label: string; tone: 'success' | 'neutral' } {
  if (status === 'paid') return { label: ct('paid'), tone: 'success' };
  if (status === 'refunded') return { label: ct('refunded'), tone: 'neutral' };
  return { label: ct('unpaid'), tone: 'neutral' };
}

function privateOf(rows: readonly EntryPrivateDoc[], entry: EntryDoc): EntryPrivateDoc | null {
  return rows.find((row) => row.id === entry.id) ?? rows.find((row) => row.teamId === entry.teamId) ?? null;
}

function ManageView({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
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
  const [rejectError, setRejectError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [unlockError, setUnlockError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  // 聯絡文字儲存用 lock。只看 busy 的話，連點會在重繪前再送一次。
  const contactLock = useRef(false);
  const [category, setCategory] = useState<CompetitionCategory>(env.bundle?.competition?.category ?? 'league');
  const [contactDraft, setContactDraft] = useState(env.bundle?.competition?.contactNote ?? '');
  // 站長「畫面要簡潔」：賽事分類與聯絡文字預設收成一顆按鈕，點了才展開；聯絡文字儲存成功後收回。
  const [infoOpen, setInfoOpen] = useState(false);
  const infoFocus = useRef<string | null>(null);
  const now = env.now ?? Date.now();
  const repKey = representativeClubs(env.actor).map((club) => club.id).join('\n');

  useEffect(() => {
    const target = infoFocus.current;
    infoFocus.current = null;
    if (target) document.querySelector<HTMLElement>(target)?.focus();
  }, [infoOpen]);

  function toggleInfo(next: boolean): void {
    infoFocus.current = next ? `#${INFO_PANEL_ID} input` : `#${INFO_TOGGLE_ID}`;
    setInfoOpen(next);
  }

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
    // repClubs 晚到要補讀 entryPrivate，否則繳費、拒絕原因、聯絡人是空的。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, env.actor.uid, env.actor.role, env.bundle, repKey]);

  useEffect(() => {
    const next = bundle?.competition?.category;
    if (next) setCategory(next);
  }, [bundle?.competition?.category]);

  useEffect(() => {
    setContactDraft(bundle?.competition?.contactNote ?? '');
  }, [bundle?.competition?.contactNote]);

  const competition = bundle?.competition;
  const manage = competition ? canManageCompetition({
    staffRoles: bundle?.staff?.roles ?? [],
    hostType: competition.hostType,
    hostTeamId: competition.hostTeamId,
    repClubIds: representativeClubs(env.actor).map((club) => club.id),
    isAdmin: isCpAdmin(env.actor.role),
  }) : false;
  const hostOps = canHostOrCo({
    staffRoles: bundle?.staff?.roles ?? [],
    isAdmin: isCpAdmin(env.actor.role),
  });
  const locked = competition?.rostersLockedAt != null;
  const entries = bundle?.entries ?? [];
  const pending = entries.filter((entry) => entry.status === 'pending');
  const approved = entries.filter((entry) => entry.status === 'approved');
  const rejected = entries.filter((entry) => entry.status === 'rejected');
  const unconfirmed = approved.filter((entry) => !entry.rosterConfirmed).length;

  useEffect(() => {
    if (!env.preview?.lockDialog || !cpDict.ct) return;
    void appConfirm(cpDict.ct('lockConfirm', { n: unconfirmed }), {
      okText: cpDict.ct('lock'),
      danger: false,
    });
    // 只為截圖把確認框打開，不在這裡鎖定。字典晚到時補開一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpDict.ct]);

  useEffect(() => {
    if (env.preview?.rejectOpen && rejectId === 'pending' && pending[0]) {
      setRejectId(pending[0].id);
      setTab('pending');
    }
  }, [env.preview?.rejectOpen, pending, rejectId]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  if (phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
  if (!competition) {
    return (
      <CpFrame title={ct('manageTitle')}>
        <p class="cps-note" role="alert">{ct('loadFailed')}</p>
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
      setBundle((prev) => {
        if (!prev) return prev;
        const entry = prev.entries.find((row) => row.id === enId);
        return {
          ...prev,
          entries: prev.entries.map((row) => row.id === enId ? { ...row, status: 'approved' } : row),
          divisions: prev.divisions.map((division) => (
            entry && division.dvId === entry.dvId
              ? { ...division, approvedCount: division.approvedCount + 1 }
              : division
          )),
        };
      });
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function reject(): Promise<void> {
    if (!manage || !rejectEntry) return;
    const reason = rejectReason.trim();
    const reasonLen = [...reason].length;
    if (!reason) {
      setRejectError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    if (reasonLen < 2 || reasonLen > 200) {
      setRejectError({ reason: 'FIELD_LENGTH', params: { min: 2, max: 200 } });
      return;
    }
    setBusy(true);
    setRejectError(null);
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
      setRejectError(null);
    } catch (err) {
      setRejectError(errorOf(err));
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
    const ok = await appConfirm(ct('lockConfirm', { n: unconfirmed }), {
      okText: ct('lock'),
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
    const reasonLen = [...reason].length;
    if (!reason) {
      setUnlockError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    if (reasonLen < 2 || reasonLen > 200) {
      setUnlockError({ reason: 'FIELD_LENGTH', params: { min: 2, max: 200 } });
      return;
    }
    setBusy(true);
    setUnlockError(null);
    try {
      await env.actions.unlockRosters({ cid, reason });
      setBundle((prev) => prev && prev.competition ? {
        ...prev,
        competition: { ...prev.competition, rostersLockedAt: null },
      } : prev);
      setUnlockOpen(false);
      setUnlockReason('');
      setUnlockError(null);
    } catch (err) {
      setUnlockError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveContact(): Promise<void> {
    if (!hostOps || contactLock.current) return;
    const problem = contactNoteProblem(contactDraft);
    if (problem) {
      setError({ reason: problem, params: problem === 'FIELD_LENGTH' ? { min: 1, max: 60 } : undefined });
      return;
    }
    const text = contactDraft.trim();
    contactLock.current = true;
    setBusy(true);
    setError(null);
    try {
      await env.actions.update({ cid, contactNote: text ? text : null });
      setBundle((current) => (current?.competition ? {
        ...current,
        competition: { ...current.competition, contactNote: text || null },
      } : current));
      toggleInfo(false);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      contactLock.current = false;
      setBusy(false);
    }
  }

  async function saveCategory(next: CompetitionCategory): Promise<void> {
    if (!manage || busy || next === category) return;
    const prev = category;
    setCategory(next);
    setBusy(true);
    setError(null);
    try {
      await env.actions.update({ cid, category: next });
      setBundle((current) => current?.competition ? {
        ...current,
        competition: { ...current.competition, category: next },
      } : current);
    } catch (err) {
      setCategory(prev);
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
              <Badge tone="warning" label={ct('pending')} size="sm" />
            </div>
            <p class="cps-sub" style="margin:4px 0 8px">{divisionName(entry.dvId)}</p>
            {priv?.contactName ? (
              <div class="cps-kv"><span>{ct('contact')}</span><span>{priv.contactName}</span></div>
            ) : null}
            {manage ? (
              <div class="cps-actions">
                <Button variant="secondary" onClick={() => { setRejectError(null); setRejectId(entry.id); }}>{ct('reject')}</Button>
                <Button variant="primary" onClick={() => { void approve(entry.id); }}>{ct('approve')}</Button>
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
        const pay = payLabel(ct, priv?.paymentStatus ?? 'none');
        return (
          <CpCard key={entry.id}>
            <div class="cps-head-row">
              <h3 class="cps-h">
                <a class="cps-link" href={`/competitions/${cid}/entries/${entry.id}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); route(`/competitions/${cid}/entries/${entry.id}`); }}>
                  {entry.name}
                </a>
              </h3>
              {entry.rosterConfirmed
                ? <Badge tone="success" label={ct('rosterConfirmed')} size="sm" />
                : <Badge tone="warning" label={ct('rosterUnconfirmed')} size="sm" />}
            </div>
            <p class="cps-sub" style="margin:4px 0 8px">{divisionName(entry.dvId)}</p>
            {/* 報名費、繳費標籤、標示已繳費只限俱樂部主辦（顧問 §3.257） */}
            {division && competition?.hostType === 'club' ? <FeeLine amount={division.feePerTeam} /> : null}
            <div class="cps-kv">
              <span>{ct('rosterPeople')}</span>
              <span>{ct('rosterCount', { n: entry.rosterCount, max: division?.rosterMax ?? 0, min: division?.rosterMin ?? 0 })}</span>
            </div>
            {manage && competition?.hostType === 'club' ? (
              <div class="cps-pay">
                <Badge tone={pay.tone} label={pay.label} size="sm" />
                <Switch
                  label={ct('markPaid')}
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
          <Button variant="danger" onClick={() => { void lock(); }}>{ct('lockAll')}</Button>
        </div>
      ) : null}
      {showUnlock ? (
        <div class="cps-actions">
          <Button variant="secondary" onClick={() => { setUnlockError(null); setUnlockOpen(true); }}>{ct('unlock')}</Button>
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
              <Badge tone="danger" label={ct('rejected')} size="sm" />
            </div>
            <p class="cps-sub" style="margin:4px 0 8px">{divisionName(entry.dvId)}</p>
            {priv?.reviewNote ? (
              <div class="cps-kv"><span>{ct('rejectReason')}</span><span>{priv.reviewNote}</span></div>
            ) : null}
          </CpCard>
        );
      })}
    </div>
  );

  return (
    <CpFrame title={ct('manageTitle')}>
      {hostOps ? (
        <div class="cps-actions" style="margin-top:0">
          <Button variant="secondary" onClick={() => route(`/competitions/${cid}/schedule`)}>{ct('hostSchedTitle')}</Button>
          <Button variant="secondary" onClick={() => route(`/competitions/${cid}/matches`)}>{ct('hostListTitle')}</Button>
          <Button variant="secondary" onClick={() => route(`/competitions/${cid}/staff`)}>{ct('assignScorer')}</Button>
        </div>
      ) : null}
      {manage || hostOps ? (
        <div class="cps-actions" style="margin-top:0">
          <Button
            id={INFO_TOGGLE_ID}
            variant="secondary"
            aria-expanded={infoOpen}
            aria-controls={INFO_PANEL_ID}
            onClick={() => toggleInfo(!infoOpen)}
          >
            {ct('editCompInfo')}
          </Button>
        </div>
      ) : null}
      {(manage || hostOps) && infoOpen ? (
      <div id={INFO_PANEL_ID} class="cps-stack">
      {manage ? (
        <CpCard>
          {/* ASSUMPTION: 沒有獨立的編輯賽事路由。分類改在報隊管理；建立仍走精靈步驟 1。 */}
          <RadioGroup
            label={ct('category')}
            orientation="horizontal"
            value={category}
            onValueChange={(value) => {
              if (value === 'league' || value === 'cup' || value === 'friendly') void saveCategory(value);
            }}
            options={[
              { value: 'league', label: ct('categoryLeague') },
              { value: 'cup', label: ct('categoryCup') },
              { value: 'friendly', label: ct('categoryFriendly') },
            ]}
          />
        </CpCard>
      ) : null}
      {hostOps ? (
        <CpCard>
          <div class="cps-fields">
            <Input
              label={ct('contactField')}
              hint={ct('publicHint')}
              value={contactDraft}
              maxLength={60}
              disabled={busy}
              onValueChange={(value) => setContactDraft(clipCodePoints(value.replace(/[\r\n]/g, ''), 60))}
            />
            {competition?.hostType === 'personal' ? <p class="cps-cap">{ct('contactEmptyHint')}</p> : null}
            <div class="cps-actions">
              <Button variant="secondary" disabled={busy} onClick={() => { void saveContact(); }}>{ct('contactSave')}</Button>
            </div>
          </div>
        </CpCard>
      ) : null}
      </div>
      ) : null}
      <div>
        <p class="cps-sub" style="margin-bottom:8px">{competition.name}</p>
        {(bundle?.divisions ?? []).map((division) => (
          <p class="cps-cap" key={division.dvId} data-approved-count={division.dvId}>
            {division.name}　{ct('approvedTeams', { teams: division.approvedCount, max: division.maxTeams })}
          </p>
        ))}
        <Tabs
          label={ct('entryTabs')}
          variant="segmented"
          value={tab}
          onValueChange={(id) => {
            if (id === 'pending' || id === 'approved' || id === 'rejected') setTab(id);
          }}
          items={[
            { id: 'pending', label: ct('tabPending', { n: pending.length }), panel: pendingPanel },
            { id: 'approved', label: ct('tabApproved', { n: approved.length }), panel: approvedPanel },
            { id: 'rejected', label: ct('tabRejected', { n: rejected.length }), panel: rejectedPanel },
          ]}
        />
      </div>
      {error ? <CpError reason={error.reason} params={error.params} /> : null}
      {rejectEntry ? (
        <BottomSheet
          open
          title={ct('rejectTitle')}
          onClose={() => { setRejectId(null); setRejectError(null); }}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" onClick={() => { setRejectId(null); setRejectError(null); }}>{ct('cancel')}</Button>
              <Button variant="danger" loading={busy} onClick={() => { void reject(); }}>{ct('rejectSubmit')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            <p class="cps-note">{rejectEntry.name}　{divisionName(rejectEntry.dvId)}</p>
            <Textarea
              label={ct('rejectReason')}
              required
              value={rejectReason}
              maxLength={200}
              placeholder={ct('rejectPlaceholder')}
              onValueChange={setRejectReason}
            />
            {rejectError ? <CpError reason={rejectError.reason} params={rejectError.params} /> : null}
          </div>
        </BottomSheet>
      ) : null}
      {unlockOpen ? (
        <BottomSheet
          open
          title={ct('unlockTitle')}
          onClose={() => { setUnlockOpen(false); setUnlockError(null); }}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" onClick={() => { setUnlockOpen(false); setUnlockError(null); }}>{ct('cancel')}</Button>
              <Button variant="primary" loading={busy} onClick={() => { void unlock(); }}>{ct('unlockSubmit')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            <Textarea
              label={ct('unlockReason')}
              required
              value={unlockReason}
              maxLength={200}
              onValueChange={setUnlockReason}
            />
            {unlockError ? <CpError reason={unlockError.reason} params={unlockError.params} /> : null}
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
