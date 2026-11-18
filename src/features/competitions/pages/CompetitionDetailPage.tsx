// 賽事詳情。報隊鈕只給代表且在報名期間；檢舉在右上選單。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { openHttpAnchor } from '@/core/open-external';
import { useT } from '@/i18n/i18n';
import { Badge } from '@/ui/Badge';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { PageSpinner } from '@/ui/PageSpinner';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { canManageCompetition, canRegisterClubEntry, isCpAdmin } from '../access';
import { liveCpActions } from '../actions';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { formatTaipeiDate, formatTaipeiShort, taipeiParts, venueMapUrl } from '../format';
import { LiveBoundary } from '../live';
import { buildRegisterInput, buildReportInput } from '../payload';
import type { CompetitionDoc, DivisionDoc, EntryDoc, ReportReason } from '../data/types';
import { CpError, errorOf } from '../ui/feedback';
import { FeeLine } from '../ui/fields';
import { CpCard, CpFrame, CpRow, MoreIcon } from '../ui/shell';

const REPORTS: ReportReason[] = ['impersonation', 'fake', 'inappropriate', 'privacy', 'other'];

function statusBadge(t: (key: string) => string, competition: CompetitionDoc): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (competition.status === 'draft') return { label: t('competitions.draft'), tone: 'warning' };
  if (competition.status === 'postponed') return { label: t('competitions.postponed'), tone: 'warning' };
  if (competition.status === 'cancelled') return { label: t('competitions.cancelled'), tone: 'danger' };
  return { label: t('competitions.recruiting'), tone: 'success' };
}

function hostName(competition: CompetitionDoc, env: CpInjectedEnv): string {
  if (competition.hostDisplay) return competition.hostDisplay;
  const known = [...env.actor.repClubs, ...env.actor.managedClubs].find((club) => club.id === competition.hostTeamId);
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
  const t = useT();
  const { route } = useLocation();
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>(env.bundle ? 'ready' : 'loading');
  const [menuOpen, setMenuOpen] = useState(env.preview?.menuOpen === true);
  const [reportOpen, setReportOpen] = useState(env.preview?.reportOpen === true);
  const [reportReason, setReportReason] = useState<ReportReason>('fake');
  const [reportDetail, setReportDetail] = useState('');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [teamId, setTeamId] = useState(env.actor.repClubs[0]?.id ?? '');
  const [dvId, setDvId] = useState('');
  const [error, setError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const now = env.now ?? Date.now();

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

  const competition = bundle?.competition ?? null;
  if (phase === 'loading') {
    return <div class="cps-root"><PageSpinner /></div>;
  }
  if (!competition || phase === 'error') {
    return (
      <CpFrame title={t('competitions.detailTitle')}>
        <p class="cps-note" role="alert">{t('competitions.loadFailed')}</p>
        <Button variant="secondary" onClick={() => {
          setPhase('loading');
          void loadDetail(env, cid).then((next) => {
            setBundle(next);
            setPhase(next.competition ? 'ready' : 'error');
          }).catch(() => setPhase('error'));
        }}
        >{t('competitions.retry')}</Button>
      </CpFrame>
    );
  }

  const manage = canManageCompetition({
    staffRoles: bundle?.staff?.roles ?? [],
    hostType: competition.hostType,
    hostTeamId: competition.hostTeamId,
    repClubIds: env.actor.repClubs.map((club) => club.id),
    isAdmin: isCpAdmin(env.actor.role),
  });
  const showRegister = canRegisterClubEntry({
    repClubIds: env.actor.repClubs.map((club) => club.id),
    status: competition.status,
    hidden: competition.hidden,
    regOpenAt: competition.regOpenAt,
    regCloseAt: competition.regCloseAt,
    now,
  });
  const badge = statusBadge(t, competition);
  const divisions = bundle?.divisions ?? [];
  const entries = bundle?.entries ?? [];
  const sameYear = taipeiParts(competition.regOpenAt).year === taipeiParts(competition.regCloseAt).year;

  async function sendReport(): Promise<void> {
    if (reportReason === 'other' && reportDetail.trim().length < 1) {
      setError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await env.actions.report(buildReportInput({ cid, reason: reportReason, detail: reportDetail }));
      setReportOpen(false);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendRegister(): Promise<void> {
    if (!teamId || !dvId) {
      setError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await env.actions.registerEntry(buildRegisterInput({ cid, dvId, teamId }));
      setRegisterOpen(false);
      const next = await loadDetail(env, cid);
      setBundle(next);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  const reportLabels: Record<ReportReason, string> = {
    impersonation: t('competitions.reportImpersonation'),
    fake: t('competitions.reportFake'),
    inappropriate: t('competitions.reportInappropriate'),
    privacy: t('competitions.reportPrivacy'),
    other: t('competitions.reportOther'),
  };

  return (
    <CpFrame
      title={t('competitions.detailTitle')}
      menu={(
        <>
          <button
            type="button"
            class="cps-iconbtn"
            aria-label={t('competitions.more')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreIcon />
          </button>
          {menuOpen ? (
            <div class="cps-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setReportOpen(true); }}>
                {t('competitions.report')}
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
            label={competition.hostType === 'club' ? t('competitions.hostClub') : t('competitions.hostPersonal')}
            size="sm"
          />
        </div>
        <h2 class="cps-title" style="margin-bottom:12px">{competition.name}</h2>
        <dl class="cps-rows">
          <CpRow k={t('competitions.host')}>{hostName(competition, env)}</CpRow>
          <CpRow k={t('competitions.regPeriod')}>
            <span class="cps-line">
              {sameYear ? formatTaipeiShort(competition.regOpenAt) : formatTaipeiDate(competition.regOpenAt)}
              {' '}{t('competitions.until')}{' '}
              {sameYear ? formatTaipeiShort(competition.regCloseAt) : formatTaipeiDate(competition.regCloseAt)}
            </span>
          </CpRow>
          <CpRow k={t('competitions.matchPeriod')}>
            <span class="cps-line">
              {formatTaipeiDate(competition.firstMatchAt)} {t('competitions.until')} {formatTaipeiDate(competition.lastMatchAt)}
            </span>
          </CpRow>
          <CpRow k={t('competitions.venue')}>
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
            <CpRow k={t('competitions.feeNote')}>
              <span class="cps-pre">{competition.feeNote}</span>
              <span class="cps-cap" style="display:block;margin-top:4px">
                <span class="cps-line">{t('competitions.feeHandledByHost')}</span>
                <span class="cps-line">{t('competitions.feeSiteDoesNotHandle')}</span>
              </span>
            </CpRow>
          ) : null}
        </dl>
        {showRegister ? (
          <div class="cps-actions">
            <Button variant="primary" onClick={() => { setDvId(divisions[0]?.dvId ?? ''); setRegisterOpen(true); }}>
              {t('competitions.registerClub')}
            </Button>
          </div>
        ) : null}
        {manage ? (
          <div class="cps-actions">
            {competition.status === 'draft' ? (
              <Button variant="primary" onClick={() => { void env.actions.publish({ cid }).then(() => route(`/competitions/${cid}`)); }}>
                {t('competitions.publish')}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => route(`/competitions/${cid}/manage`)}>{t('competitions.manageLink')}</Button>
          </div>
        ) : null}
      </CpCard>

      {divisions.map((division) => (
        <DivisionBlock key={division.dvId} division={division} entries={entries} cid={cid} />
      ))}

      {registerOpen ? (
        <BottomSheet
          open
          title={t('competitions.registerClub')}
          onClose={() => setRegisterOpen(false)}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" onClick={() => setRegisterOpen(false)}>{t('competitions.cancel')}</Button>
              <Button variant="primary" loading={busy} onClick={() => { void sendRegister(); }}>{t('competitions.submitRegister')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            {env.actor.repClubs.length > 1 ? (
              <Select
                label={t('competitions.club')}
                value={teamId}
                onValueChange={setTeamId}
                options={env.actor.repClubs.map((club) => ({ value: club.id, label: club.name }))}
              />
            ) : null}
            <RadioGroup
              label={t('competitions.pickDivision')}
              value={dvId}
              onValueChange={setDvId}
              options={divisions.map((division) => ({ value: division.dvId, label: division.name }))}
            />
            {error ? <CpError reason={error.reason} params={error.params} /> : null}
          </div>
        </BottomSheet>
      ) : null}

      {reportOpen ? (
        <BottomSheet
          open
          title={t('competitions.reportTitle')}
          onClose={() => setReportOpen(false)}
          footer={(
            <div class="cps-footer">
              <Button variant="secondary" onClick={() => setReportOpen(false)}>{t('competitions.cancel')}</Button>
              <Button variant="primary" loading={busy} onClick={() => { void sendReport(); }}>{t('competitions.reportSubmit')}</Button>
            </div>
          )}
        >
          <div class="cps-sheet-body">
            <RadioGroup
              label={t('competitions.reportReason')}
              value={reportReason}
              onValueChange={(value) => setReportReason(value as ReportReason)}
              options={REPORTS.map((reason) => ({ value: reason, label: reportLabels[reason] }))}
            />
            <Textarea
              label={t('competitions.reportDetail')}
              required={reportReason === 'other'}
              value={reportDetail}
              maxLength={300}
              placeholder={t('competitions.reportDetailPlaceholder')}
              onValueChange={setReportDetail}
            />
            {error ? <CpError reason={error.reason} params={error.params} /> : null}
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
}: {
  division: DivisionDoc;
  entries: EntryDoc[];
  cid: string;
}): JSX.Element {
  const t = useT();
  const { route } = useLocation();
  const approved = entries.filter((entry) => entry.dvId === division.dvId && entry.status === 'approved');
  const meta = [
    t('competitions.rosterLine', {
      format: t('competitions.formatN', { n: division.playersOnField }),
      min: division.rosterMin,
      max: division.rosterMax,
    }),
    division.minAge != null && division.maxAge != null
      ? t('competitions.ageLimit', { min: division.minAge, max: division.maxAge })
      : '',
  ].filter(Boolean).join('　');
  const width = division.maxTeams > 0 ? Math.min(100, (division.approvedCount / division.maxTeams) * 100) : 0;
  return (
    <CpCard>
      <div class="cps-head-row">
        <h3 class="cps-h">{division.name}</h3>
        <Badge tone="success" label={t('competitions.recruiting')} size="sm" />
      </div>
      <p class="cps-sub cps-nowrap" style="margin-top:4px">{meta}</p>
      <FeeLine amount={division.feePerTeam} />
      <div class="cps-bar" aria-hidden="true"><i style={`width:${width}%`} /></div>
      <p class="cps-cap" style="margin-bottom:8px">{t('competitions.approvedTeams', { teams: division.approvedCount, max: division.maxTeams })}</p>
      <ul class="cps-list">
        {approved.map((entry) => (
          <li class="cps-li" key={entry.id}>
            <div class="cps-li__main">
              <a class="cps-li__name cps-link" href={`/competitions/${cid}/entries/${entry.id}`} onClick={(event) => { event.preventDefault(); route(`/competitions/${cid}/entries/${entry.id}`); }}>
                {entry.name}
              </a>
            </div>
            <Badge tone="success" label={t('competitions.approved')} size="sm" />
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
