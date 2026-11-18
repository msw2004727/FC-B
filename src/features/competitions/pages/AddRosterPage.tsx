// 代表代填。生日只送去判斷年齡，不留在畫面上的其他地方。
// 未成年只能選姓氏候選。成年預設姓氏，也可以改填暱稱。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { useT } from '@/i18n/i18n';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Input } from '@/ui/Input';
import { PageSpinner } from '@/ui/PageSpinner';
import { RadioGroup } from '@/ui/RadioGroup';
import { liveCpActions } from '../actions';
import { minorPublicNameCandidates } from '../data/names';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { isMinorAt } from '../format';
import { LiveBoundary } from '../live';
import { buildAddInput, type PositionChoice } from '../payload';
import { CpError, errorOf } from '../ui/feedback';
import { DateField, PositionField } from '../ui/fields';
import { CpCard, CpFrame } from '../ui/shell';

async function loadHead(env: CpInjectedEnv, cid: string): Promise<CpBundle> {
  const [competition, divisions, entries] = await Promise.all([
    env.repo.getCompetition(cid),
    env.repo.listDivisions(cid),
    env.repo.listEntries(cid),
  ]);
  return { competition, divisions, entries, roster: [], privates: [], staff: null };
}

function AddView({ env, cid, enId }: { env: CpInjectedEnv; cid: string; enId: string }): JSX.Element {
  const t = useT();
  const { route } = useLocation();
  const prefill = env.preview?.prefillForm === true;
  const adultSeed = env.preview?.repAdult === true;
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [phase, setPhase] = useState(env.bundle ? 'ready' : 'loading');
  const [realName, setRealName] = useState(prefill ? (adultSeed ? '王示範' : '歐陽示範') : '');
  const [birthday, setBirthday] = useState(prefill ? (adultSeed ? '1990-05-20' : '2016-05-20') : '');
  const [number, setNumber] = useState(prefill ? (adultSeed ? '10' : '14') : '');
  const [position, setPosition] = useState<PositionChoice>(prefill ? (adultSeed ? 'MF' : 'FW') : 'none');
  const [positionText, setPositionText] = useState('');
  const [publicName, setPublicName] = useState(prefill ? (adultSeed ? '王' : '歐陽') : '');
  const [nickname, setNickname] = useState('');
  const [guardian, setGuardian] = useState(prefill && !adultSeed);
  const [privacy, setPrivacy] = useState(prefill && !adultSeed);
  const [error, setError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (env.bundle) return;
    let alive = true;
    void loadHead(env, cid).then((next) => {
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
  }, [cid, env.bundle]);

  const entry = bundle?.entries.find((row) => row.id === enId);
  const division = bundle?.divisions.find((row) => row.dvId === entry?.dvId);
  const competition = bundle?.competition;
  const basis = competition?.ageBasisAt ?? competition?.firstMatchAt ?? env.now ?? Date.now();
  const minorFlag = birthday ? isMinorAt(birthday, basis) : null;
  const minor = minorFlag === true;
  const candidates = minorPublicNameCandidates(realName);

  if (phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;

  async function submit(): Promise<void> {
    if (!realName.trim()) {
      setError({ reason: 'REAL_NAME_REQUIRED' });
      return;
    }
    if (!birthday) {
      setError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    if (number.trim() === '') {
      setError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    const parsed = Number(number);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 99) {
      setError({ reason: 'FIELD_RANGE' });
      return;
    }
    if (position === 'custom' && (positionText.trim().length < 1 || positionText.trim().length > 6)) {
      setError({ reason: 'FIELD_LENGTH', params: { min: 1, max: 6 } });
      return;
    }
    if (!nickname.trim() && !publicName.trim()) {
      setError({ reason: 'MINOR_PUBLIC_NAME' });
      return;
    }
    if (minor && nickname.trim()) {
      setError({ reason: 'MINOR_PUBLIC_NAME' });
      return;
    }
    if (minor && !guardian) {
      setError({ reason: 'GUARDIAN_CONSENT_REQUIRED' });
      return;
    }
    if (!privacy) {
      setError({ reason: 'PRIVACY_ACK_REQUIRED' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await env.actions.addRosterByRep(buildAddInput({
        cid,
        enId,
        number: parsed,
        position,
        positionText,
        minor,
        nickname,
        realName,
        publicName,
        guardianConsent: guardian,
        birthday,
        nicknameOverrides: !minor && nickname.trim().length > 0,
      }));
      route(`/competitions/${cid}/entries/${enId}`);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CpFrame title={t('competitions.addTitle')} onBack={() => route(`/competitions/${cid}/entries/${enId}`)}>
      <CpCard>
        <h2 class="cps-title">{entry?.name ?? ''}</h2>
        {division ? <p class="cps-sub">{division.name}　{t('competitions.formatN', { n: division.playersOnField })}</p> : null}
      </CpCard>
      <CpCard>
        <div class="cps-fields">
          <Input label={t('competitions.realName')} required value={realName} maxLength={40} onValueChange={setRealName} />
          <div>
            <DateField id="cp-birthday" label={t('competitions.birthday')} required value={birthday} onValueChange={setBirthday} />
            <p class="cps-cap" style="margin-top:6px">{t('competitions.birthdayHint')}</p>
          </div>
          {minor ? (
            <div class="cps-hint-line"><Badge tone="warning" label={t('competitions.minor')} size="sm" /></div>
          ) : null}
          <div class="cps-grid2">
            <Input label={t('competitions.number')} type="number" value={number} min={0} max={99} onValueChange={setNumber} />
            <div />
          </div>
          <PositionField value={position} text={positionText} onChange={(next, text) => { setPosition(next); setPositionText(text); }} />
          {candidates.length > 0 ? (
            <RadioGroup
              label={minor ? t('competitions.publicSurname') : t('competitions.publicName')}
              value={publicName}
              orientation="horizontal"
              onValueChange={setPublicName}
              options={candidates.map((name) => ({ value: name, label: name }))}
            />
          ) : null}
          {minor ? null : (
            <Input label={t('competitions.nickname')} value={nickname} maxLength={20} onValueChange={setNickname} />
          )}
          {minor ? <p class="cps-privacy cps-pre">{t('competitions.minorPublic')}{'\n'}{t('competitions.minorRealName')}</p> : null}
          {minor ? <Checkbox label={t('competitions.guardianConsent')} checked={guardian} onCheckedChange={setGuardian} /> : null}
          <Checkbox
            label={minor ? t('competitions.ackSurname') : t('competitions.ackNickname')}
            checked={privacy}
            onCheckedChange={setPrivacy}
          />
          {error ? <CpError reason={error.reason} params={error.params} /> : null}
        </div>
      </CpCard>
      <div class="cps-actions">
        <Button variant="secondary" onClick={() => route(`/competitions/${cid}/entries/${enId}`)}>{t('competitions.cancel')}</Button>
        <Button variant="primary" loading={busy} onClick={() => { void submit(); }}>{t('competitions.addSubmit')}</Button>
      </div>
    </CpFrame>
  );
}

export default function AddRosterPage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  const enId = injected?.route?.enId ?? routed.params?.enId ?? '';
  if (injected) return <AddView env={injected} cid={cid} enId={enId} />;
  return (
    <LiveBoundary>
      {(actor, repo) => <AddView env={{ actor, repo, actions: liveCpActions }} cid={cid} enId={enId} />}
    </LiveBoundary>
  );
}
