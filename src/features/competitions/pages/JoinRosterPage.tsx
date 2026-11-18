// 自己登錄。成年填暱稱；未成年填真名、姓氏候選、監護人同意。兩種都要勾名單公開。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { useT } from '@/i18n/i18n';
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
import { loadMyBirthday } from '../rep-clubs';
import { buildJoinInput, type PositionChoice } from '../payload';
import { CpError, errorOf } from '../ui/feedback';
import { PositionField } from '../ui/fields';
import { CpCard, CpFrame } from '../ui/shell';

async function loadHead(env: CpInjectedEnv, cid: string): Promise<CpBundle> {
  const [competition, divisions, entries] = await Promise.all([
    env.repo.getCompetition(cid),
    env.repo.listDivisions(cid),
    env.repo.listEntries(cid),
  ]);
  return { competition, divisions, entries, roster: [], privates: [], staff: null };
}

function JoinView({ env, cid, enId }: { env: CpInjectedEnv; cid: string; enId: string }): JSX.Element {
  const t = useT();
  const { route } = useLocation();
  const prefill = env.preview?.prefillForm === true;
  const forcedMinor = env.preview?.selfMinor === true;
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [phase, setPhase] = useState(env.bundle ? 'ready' : 'loading');
  const [number, setNumber] = useState(prefill ? '14' : '');
  const [position, setPosition] = useState<PositionChoice>(prefill ? 'FW' : 'none');
  const [positionText, setPositionText] = useState('');
  const [nickname, setNickname] = useState(prefill && !forcedMinor ? '阿範' : '');
  const [realName, setRealName] = useState(prefill && forcedMinor ? '歐陽示範' : '');
  const [publicName, setPublicName] = useState(prefill && forcedMinor ? '歐陽' : '');
  const [guardian, setGuardian] = useState(forcedMinor && prefill);
  const [privacy, setPrivacy] = useState(forcedMinor && prefill);
  const [profileBirthday, setProfileBirthday] = useState<string | null>(null);
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

  useEffect(() => {
    if (env.preview || !env.actor.uid) return;
    let alive = true;
    void loadMyBirthday(env.actor.uid).then((value) => {
      if (alive) setProfileBirthday(value);
    }).catch(() => {
      if (alive) setProfileBirthday(null);
    });
    return () => {
      alive = false;
    };
  }, [env.actor.uid, env.preview]);

  const entry = bundle?.entries.find((row) => row.id === enId);
  const division = bundle?.divisions.find((row) => row.dvId === entry?.dvId);
  const competition = bundle?.competition;
  const basis = competition?.ageBasisAt ?? competition?.firstMatchAt ?? env.now ?? Date.now();
  const minor = forcedMinor || (profileBirthday != null && isMinorAt(profileBirthday, basis) === true);
  const candidates = minorPublicNameCandidates(realName);

  if (phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;

  async function submit(): Promise<void> {
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
    if (minor && !realName.trim()) {
      setError({ reason: 'REAL_NAME_REQUIRED' });
      return;
    }
    if (minor && !publicName.trim()) {
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
      await env.actions.joinRoster(buildJoinInput({
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
      }));
      route(`/competitions/${cid}/entries/${enId}`);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CpFrame title={t('competitions.joinTitle')} onBack={() => route(`/competitions/${cid}/entries/${enId}`)}>
      <CpCard>
        <h2 class="cps-title">{entry?.name ?? ''}</h2>
        {division ? <p class="cps-sub">{division.name}　{t('competitions.formatN', { n: division.playersOnField })}</p> : null}
      </CpCard>
      <CpCard>
        <div class="cps-fields">
          <div class="cps-grid2">
            <Input label={t('competitions.number')} type="number" value={number} min={0} max={99} onValueChange={setNumber} />
            <div />
          </div>
          <PositionField value={position} text={positionText} onChange={(next, text) => { setPosition(next); setPositionText(text); }} />
          {minor ? (
            <>
              <Input label={t('competitions.realName')} required value={realName} maxLength={40} onValueChange={setRealName} />
              {candidates.length > 0 ? (
                <RadioGroup
                  label={t('competitions.publicSurname')}
                  value={publicName}
                  orientation="horizontal"
                  onValueChange={setPublicName}
                  options={candidates.map((name) => ({ value: name, label: name }))}
                />
              ) : null}
              <p class="cps-privacy cps-pre">{t('competitions.minorPublic')}{'\n'}{t('competitions.minorRealName')}</p>
              <Checkbox label={t('competitions.guardianConsent')} checked={guardian} onCheckedChange={setGuardian} />
            </>
          ) : (
            <Input label={t('competitions.nickname')} value={nickname} maxLength={20} onValueChange={setNickname} />
          )}
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
        <Button variant="primary" loading={busy} onClick={() => { void submit(); }}>{t('competitions.submit')}</Button>
      </div>
    </CpFrame>
  );
}

export default function JoinRosterPage(): JSX.Element {
  const injected = useInjectedEnv();
  const routed = useRoute();
  const cid = injected?.route?.cid ?? routed.params?.cid ?? '';
  const enId = injected?.route?.enId ?? routed.params?.enId ?? '';
  if (injected) return <JoinView env={injected} cid={cid} enId={enId} />;
  return (
    <LiveBoundary>
      {(actor, repo) => <JoinView env={{ actor, repo, actions: liveCpActions }} cid={cid} enId={enId} />}
    </LiveBoundary>
  );
}
