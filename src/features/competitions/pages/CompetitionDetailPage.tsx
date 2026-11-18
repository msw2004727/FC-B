// 賽事詳情。報隊鈕只給代表且在報名期間；檢舉在右上選單。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { openHttpAnchor } from '@/core/open-external';
import { ctOrKey, useCompetitionsT, type CompetitionsT } from '../i18n';
import { Badge } from '@/ui/Badge';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { PageSpinner } from '@/ui/PageSpinner';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { canManageCompetition, canRegisterClubEntry, isCpAdmin } from '../access';
import { representativeClubs } from '../rep-clubs';
import { liveCpActions } from '../actions';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { formatTaipeiDate, formatTaipeiShort, taipeiParts, venueMapUrl } from '../format';
import { LiveBoundary } from '../live';
import { buildRegisterInput, buildReportInput } from '../payload';
import type { CompetitionDoc, DivisionDoc, EntryDoc, ReportReason } from '../data/types';
import { CpError, errorOf } from '../ui/feedback';
import { FeeLine } from '../ui/fields';
import { CpCard, CpFrame, CpI18nPending, CpRow, MoreIcon } from '../ui/shell';

const REPORTS: ReportReason[] = ['impersonation', 'fake', 'inappropriate', 'privacy', 'other'];

function statusBadge(
  ct: CompetitionsT,
  competition: CompetitionDoc,
  now: number,
): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (competition.status === 'draft') return { label: ct('draft'), tone: 'warning' };
  if (competition.status === 'postponed') return { label: ct('postponed'), tone: 'warning' };
  if (competition.status === 'cancelled') return { label: ct('cancelled'), tone: 'danger' };
  if (now < competition.regOpenAt) return { label: ct('reason.REG_NOT_OPEN'), tone: 'neutral' };
  if (now > competition.regCloseAt) return { label: ct('reason.REG_CLOSED'), tone: 'neutral' };
  return { label: ct('recruiting'), tone: 'success' };
}

function hostName(competition: CompetitionDoc, env: CpInjectedEnv): string {
  if (competition.hostDisplay) return competition.hostDisplay;
  // 俱樂部 id 一律用文件路徑 id 的 repClubs（顧問 §3.254：不再混用 viewer.staffTeams 的欄位 id）
  const known = env.actor.repClubs.find((club) => club.id === competition.hostTeamId);
  return known?.name ?? '';
}

async function loadDetail(env: CpInjectedEnv, cid: string): Promise<CpBundle> {
  const uid = env.actor.uid;
  const [competition, divisions, entries, staff] = await Promise.all([
    env.repo.getCompetition(cid),
    env.repo.listDivisions(cid),
    env.repo.listEntries(cid),
    uid ? env.repo.getStaff(cid, uid) : Promise.resolve(null),
  ]);
  return { competition, divisions, entries, roster: [], privates: [], staff };
}

function DetailView({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>(env.bundle ? 'ready' : 'loading');
  const [menuOpen, setMenuOpen] = useState(env.preview?.menuOpen === true);
  const [reportOpen, setReportOpen] = useState(env.preview?.reportOpen === true);
  const [reportReason, setReportReason] = useState<ReportReason>('fake');
  const [reportDetail, setReportDetail] = useState('');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [teamId, setTeamId] = useState(representativeClubs(env.actor)[0]?.id ?? '');
  const [dvId, setDvId] = useState('');
  const [error, setError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [registerError, setRegisterError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [reportError, setReportError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const now = env.now ?? Date.now();
  const clubs = representativeClubs(env.actor);

  useEffect(() => {
    if (teamId) return;
    const first = clubs[0]?.id ?? '';
    if (first) setTeamId(first);
  }, [clubs, teamId]);

  useEffect(() => {
    if (env.bundle) return;
    let alive = true;
    setPhase('loading');
    void loadDetail(env, cid).then((next) => {
      if (!alive) return;
      setBundle(next);
      setPhase(next.competition ? 'ready' : 'error');
    }).catch(() => {
      if (alive) setPhase('error');
    });
    return () => {
      alive = false;
    };
    // 注入的 bundle 是首屏快照。正式頁只在賽事 id 或帳號變了才重讀。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, env.actor.uid, env.bundle]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const competition = bundle?.competition ?? null;
  if (phase === 'loading') {
    return <div class="cps-root"><PageSpinner /></div>;
  }
  if (!competition || phase === 'error') {
    return (
      <CpFrame title={ct('detailTitle')}>
        <p class="cps-note" role="alert">{ct('loadFailed')}</p>
        <Button variant="secondary" onClick={() => {
          setPhase('loading');
          void loadDetail(env, cid).then((next) => {
            setBundle(next);
            setPhase(next.competition ? 'ready' : 'error');
          }).catch(() => setPhase('error'));
        }}
        >{ct('retry')}</Button>
      </CpFrame>
    );
  }

  const manage = canManageCompetition({
    staffRoles: bundle?.staff?.roles ?? [],
    hostType: competition.hostType,
    hostTeamId: competition.hostTeamId,
    repClubIds: clubs.map((club) => club.id),
    isAdmin: isCpAdmin(env.actor.role),
  });
  const showRegister = canRegisterClubEntry({
    repClubIds: clubs.map((club) => club.id),
    status: competition.status,
    hidden: competition.hidden,
    regOpenAt: competition.regOpenAt,
    regCloseAt: competition.regCloseAt,
    now,
  });
  const badge = statusBadge(ct, competition, now);
  const divisions = bundle?.divisions ?? [];
  const entries = bundle?.entries ?? [];
  const sameYear = taipeiParts(competition.regOpenAt).year === taipeiParts(competition.regCloseAt).year;

  async function publish(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.publish({ cid });
      const next = await loadDetail(env, cid);
      setBundle((prev) => {
        if (next.competition) return next;
        if (!prev?.competition) return next;
        return { ...prev, competition: { ...prev.competition, status: 'published' } };
      });
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendReport(): Promise<void> {
    if (reportReason === 'other' && reportDetail.trim().length < 1) {
      setReportError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    setBusy(true);
    setReportError(null);
    try {
      await env.actions.report(buildReportInput({ cid, reason: reportReason, detail: reportDetail }));
      setReportOpen(false);
      setReportError(null);
    } catch (err) {
      setReportError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendRegister(): Promise<void> {
    const chosenTeam = teamId || clubs[0]?.id || '';
    if (!chosenTeam || !dvId) {
      setRegisterError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    setBusy(true);
    setRegisterError(null);
    try {
      await env.actions.registerEntry(buildRegisterInput({ cid, dvId, teamId: chosenTeam }));
      setRegisterOpen(false);
      setRegisterError(null);
      const next = await loadDetail(env, cid);
      setBundle(next);
    } catch (err) {
      setRegisterError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  const reportLabels: Record<ReportReason, string> = {
    impersonation: ct('reportImpersonation'),
    fake: ct('reportFake'),
    inappropriate: ct('reportInappropriate'),
    privacy: ct('reportPrivacy'),
    other: ct('reportOther'),
  };

  return (
    <CpFrame
      title={ct('detailTitle')}
      menu={(
        <>
          <button
            type="button"
            class="cps-iconbtn"
            aria-label={ct('more')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreIcon />
          </button>
          {menuOpen ? (
            <div class="cps-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setReportError(null); setReportOpen(true); }}>
                {ct('report')}
              </button>
            </div>
          ) : null}
        </>
      )}
    >
      <CpCard>
        <div class="cps-badges" style="margin-bottom:8px">
          <Badge tone={badge.tone} label={badge.label} size="sm" />
          <Badge
            tone={competition.hostType === 'club' ? 'info' : 'neutral'}
            label={competition.hostType === 'club' ? ct('hostClub') : ct('hostPersonal')}
            size="sm"
          />
        </div>
        <h2 class="cps-title" style="margin-bottom:12px">{competition.name}</h2>
        <dl class="cps-rows">
          <CpRow k={ct('host')}>{hostName(competition, env)}</CpRow>
          <CpRow k={ct('regPeriod')}>
            <span class="cps-line">
              {sameYear ? formatTaipeiShort(competition.regOpenAt) : formatTaipeiDate(competition.regOpenAt)}
              {' '}{ct('until')}{' '}
              {sameYear ? formatTaipeiShort(competition.regCloseAt) : formatTaipeiDate(competition.regCloseAt)}
            </span>
          </CpRow>
          <CpRow k={ct('matchPeriod')}>
            <span class="cps-line">
              {formatTaipeiDate(competition.firstMatchAt)} {ct('until')} {formatTaipeiDate(competition.lastMatchAt)}
            </span>
          </CpRow>
          <CpRow k={ct('venue')}>
            {competition.venues.map((venue) => {
              const mapUrl = venueMapUrl(venue);
              return (
                <a
                  key={`${venue.name}-${venue.lat ?? ''}`}
                  class="cps-line cps-link"
                  href={mapUrl}
                  rel="noopener"
                  onClick={(event) => openHttpAnchor(event, mapUrl)}
                >
                  {venue.name}
                </a>
              );
            })}
          </CpRow>
          {competition.hostType === 'club' && competition.feeNote ? (
            <CpRow k={ct('feeNote')}>
              <span class="cps-pre">{competition.feeNote}</span>
              <span class="cps-cap" style="display:block;margin-top:4px">
                <span class="cps-line">{ct('feeHandledByHost')}</span>
                <span class="cps-line">{ct('feeSiteDoesNotHandle')}</span>
              </span>
            </CpRow>
          ) : null}
        </dl>
        {error ? <CpError reason={error.reason} params={error.params} /> : null}
        {showRegister ? (
          <div class="cps-actions">
            <Button variant="primary" onClick={() => { setDvId(divisions[0]?.dvId ?? ''); setRegisterError(null); setRegisterOpen(true); }}>
              {ct('registerClub')}
            </Button>
          </div>
        ) : null}
        {manage ? (
          <div class="cps-actions">
            {competition.status === 'draft' ? (
              <Button variant="primary" loading={busy} onClick={() => { void publish(); }}>
                {ct('publish')}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => route(`/competitions/${cid}/manage`)}>{ct('manageLink')}</Button>
          </div>
        ) : null}
      </CpCard>

      {divisions.map((division) => (
        <DivisionBlock key={division.dvId} division={division} entries={entries} cid={cid} competition={competition} now={now} />
      ))}

      {registerOpen ? (
        <BottomSheet
          open
          title={ct('registerClub')}
          onClose={() => { setRegisterOpen(false); setRegisterError(null); }}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" onClick={() => { setRegisterOpen(false); setRegisterError(null); }}>{ct('cancel')}</Button>
              <Button variant="primary" loading={busy} onClick={() => { void sendRegister(); }}>{ct('submitRegister')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            {clubs.length > 1 ? (
              <Select
                label={ct('club')}
                value={teamId}
                onValueChange={setTeamId}
                options={clubs.map((club) => ({ value: club.id, label: club.name }))}
              />
            ) : null}
            <RadioGroup
              label={ct('pickDivision')}
              value={dvId}
              onValueChange={setDvId}
              options={divisions.map((division) => ({ value: division.dvId, label: division.name }))}
            />
            {registerError ? <CpError reason={registerError.reason} params={registerError.params} /> : null}
          </div>
        </BottomSheet>
      ) : null}

      {reportOpen ? (
        <BottomSheet
          open
          title={ct('reportTitle')}
          onClose={() => { setReportOpen(false); setReportError(null); }}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" onClick={() => { setReportOpen(false); setReportError(null); }}>{ct('cancel')}</Button>
              <Button variant="primary" loading={busy} onClick={() => { void sendReport(); }}>{ct('reportSubmit')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            <RadioGroup
              label={ct('reportReason')}
              value={reportReason}
              onValueChange={(value) => setReportReason(value as ReportReason)}
              options={REPORTS.map((reason) => ({ value: reason, label: reportLabels[reason] }))}
            />
            <Textarea
              label={ct('reportDetail')}
              required={reportReason === 'other'}
              value={reportDetail}
              maxLength={300}
              placeholder={ct('reportDetailPlaceholder')}
              onValueChange={setReportDetail}
            />
            {reportError ? <CpError reason={reportError.reason} params={reportError.params} /> : null}
          </div>
        </BottomSheet>
      ) : null}
    </CpFrame>
  );
}

function DivisionBlock({
  division,
  entries,
  cid,
  competition,
  now,
}: {
  division: DivisionDoc;
  entries: EntryDoc[];
  cid: string;
  competition: CompetitionDoc;
  now: number;
}): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const approved = entries.filter((entry) => entry.dvId === division.dvId && entry.status === 'approved');
  const meta = [
    ct('rosterLine', {
      format: ct('formatN', { n: division.playersOnField }),
      min: division.rosterMin,
      max: division.rosterMax,
    }),
    division.minAge != null && division.maxAge != null
      ? ct('ageLimit', { min: division.minAge, max: division.maxAge })
      : '',
  ].filter(Boolean).join('　');
  const width = division.maxTeams > 0 ? Math.min(100, (division.approvedCount / division.maxTeams) * 100) : 0;
  return (
    <CpCard>
      <div class="cps-head-row">
        <h3 class="cps-h">{division.name}</h3>
        <Badge tone={statusBadge(ct, competition, now).tone} label={statusBadge(ct, competition, now).label} size="sm" />
      </div>
      <p class="cps-sub cps-nowrap" style="margin-top:4px">{meta}</p>
      {/* 報名費與停用的線上支付鈕只限俱樂部主辦（顧問 §3.257） */}
      {competition.hostType === 'club' ? <FeeLine amount={division.feePerTeam} /> : null}
      <div class="cps-bar" aria-hidden="true"><i style={`width:${width}%`} /></div>
      <p class="cps-cap" style="margin-bottom:8px">{ct('approvedTeams', { teams: division.approvedCount, max: division.maxTeams })}</p>
      <ul class="cps-list">
        {approved.map((entry) => (
          <li class="cps-li" key={entry.id}>
            <div class="cps-li__main">
              <a class="cps-li__name cps-link" href={`/competitions/${cid}/entries/${entry.id}`} onClick={(event) => { event.preventDefault(); route(`/competitions/${cid}/entries/${entry.id}`); }}>
                {entry.name}
              </a>
            </div>
            <Badge tone="success" label={ct('approved')} size="sm" />
          </li>
        ))}
      </ul>
    </CpCard>
  );
}

export default function CompetitionDetailPage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  if (injected) return <DetailView env={injected} cid={cid} />;
  return (
    <LiveBoundary>
      {(actor, repo) => <DetailView env={{ actor, repo, actions: liveCpActions, route: { cid } }} cid={cid} />}
    </LiveBoundary>
  );
}
