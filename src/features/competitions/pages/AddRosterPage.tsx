// 代表代填。生日只用來判斷年齡。
// 未成年公開名遮字、不收暱稱。成年暱稱選填；沒填就顯示遮字結果。都不送 publicName。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { useGoBack } from '@/core/back-guard';
import { ctOrKey, useCompetitionsT } from '../i18n';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Input } from '@/ui/Input';
import { PageSpinner } from '@/ui/PageSpinner';
import { rosterFormBlock } from '../access';
import { liveCpActions } from '../actions';
import { maskedPublicName } from '../data/names';
import type { CpBundle, CpInjectedEnv } from '../env';
import { useInjectedEnv } from '../env';
import { isMinorAt } from '../format';
import { LiveBoundary } from '../live';
import { buildAddInput, type PositionChoice } from '../payload';
import { CpError, CpLoadFailed, errorOf, loadFailOf, RosterBlocked } from '../ui/feedback';
import { DateField, POSITION_TEXT_MAX, PositionField } from '../ui/fields';
import { CpCard, CpFrame, CpI18nPending } from '../ui/shell';

async function loadHead(env: CpInjectedEnv, cid: string): Promise<CpBundle> {
  const [competition, divisions, entries] = await Promise.all([
    env.repo.getCompetition(cid),
    env.repo.listDivisions(cid),
    env.repo.listEntries(cid),
  ]);
  return { competition, divisions, entries, roster: [], privates: [], staff: null };
}

function codePoints(value: string): number {
  return [...value].length;
}

function AddView({ env, cid, enId }: { env: CpInjectedEnv; cid: string; enId: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  // 三個出口（成功、返回、取消）都回上一頁；直開網址時才導到名單頁。原本 route() 再推一筆名單頁，
  // 名單頁的「<」（history.back）又回到這裡，形成循環（11-20 模擬器預演；取代 route(名單頁)）。
  const backToRoster = useGoBack(`/competitions/${cid}/entries/${enId}`);
  const prefill = env.preview?.prefillForm === true;
  const adultSeed = env.preview?.repAdult === true || env.preview?.repNick === true;
  const nickSeed = env.preview?.repNick === true;
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [phase, setPhase] = useState(env.bundle ? 'ready' : 'loading');
  const [realName, setRealName] = useState(prefill ? (adultSeed ? '王小範' : '歐陽小明') : '');
  const [birthday, setBirthday] = useState(prefill ? (adultSeed ? '1990-05-20' : '2016-05-20') : '');
  const [number, setNumber] = useState(prefill ? (adultSeed ? '10' : '14') : '');
  const [position, setPosition] = useState<PositionChoice>(prefill ? (adultSeed ? 'MF' : 'FW') : 'none');
  const [positionText, setPositionText] = useState('');
  const [nickname, setNickname] = useState(nickSeed ? '阿範' : '');
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
    }).catch((err: unknown) => {
      if (alive) setPhase(loadFailOf(err));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, env.bundle]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;

  const entry = bundle?.entries.find((row) => row.id === enId) ?? null;
  const division = bundle?.divisions.find((row) => row.dvId === entry?.dvId);
  const competition = bundle?.competition ?? null;
  const now = env.now ?? Date.now();
  const basis = competition?.ageBasisAt ?? competition?.firstMatchAt ?? now;
  const ageFlag = birthday ? isMinorAt(birthday, basis) : null;
  const minor = ageFlag === true;
  const adult = ageFlag === false;
  const shown = adult && nickname.trim() ? nickname.trim() : maskedPublicName(realName);
  const ackKey = adult && nickname.trim() ? 'ackNickname' : 'ackMasked';

  async function submit(): Promise<void> {
    if (!realName.trim()) {
      setError({ reason: 'REAL_NAME_REQUIRED' });
      return;
    }
    if (!birthday.trim()) {
      setError({ reason: 'FIELD_REQUIRED' });
      return;
    }
    if (isMinorAt(birthday, basis) == null) {
      setError({ reason: 'BIRTHDAY_INVALID' });
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
    const customLen = codePoints(positionText.trim());
    if (position === 'custom' && (customLen < 1 || customLen > POSITION_TEXT_MAX)) {
      setError({ reason: 'FIELD_LENGTH', params: { min: 1, max: POSITION_TEXT_MAX } });
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
        nickname: adult ? nickname : '',
        realName,
        guardianConsent: guardian,
        birthday,
      }));
      backToRoster();
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'loading') return <div class="cps-root"><PageSpinner /></div>;
  if (!competition || phase === 'error' || phase === 'hidden') {
    return <CpLoadFailed title={ct('addTitle')} fail={phase === 'hidden' ? 'hidden' : 'error'} />;
  }

  const block = rosterFormBlock({
    kind: 'rep',
    isMember: env.actor.memberClubIds.includes(entry?.teamId ?? ''),
    isRep: env.actor.repClubs.some((club) => club.id === entry?.teamId),
    status: entry?.status ?? null,
    locked: competition.rostersLockedAt != null,
    started: now >= competition.firstMatchAt,
  });
  if (block) return <RosterBlocked reason={block} cid={cid} enId={enId} />;

  return (
    <CpFrame title={ct('addTitle')} onBack={backToRoster}>
      <CpCard>
        <h2 class="cps-title">{entry?.name ?? ''}</h2>
        {division ? <p class="cps-sub">{division.name}　{ct('formatN', { n: division.playersOnField })}</p> : null}
      </CpCard>
      <CpCard>
        <div class="cps-fields">
          <Input label={ct('realName')} required value={realName} maxLength={40} onValueChange={setRealName} />
          <div>
            <DateField id="cp-birthday" label={ct('birthday')} required value={birthday} onValueChange={setBirthday} />
            <p class="cps-cap" style="margin-top:6px">{ct('birthdayHint')}</p>
          </div>
          {minor ? (
            <div class="cps-hint-line"><Badge tone="warning" label={ct('minor')} size="sm" /></div>
          ) : null}
          <div class="cps-grid2">
            <Input label={ct('number')} type="number" value={number} min={0} max={99} onValueChange={setNumber} />
            <div />
          </div>
          <PositionField value={position} text={positionText} onChange={(next, text) => { setPosition(next); setPositionText(text); }} />
          {shown ? <p class="cps-sub" data-public-name>{ct('maskedPreview', { name: shown })}</p> : null}
          {adult ? (
            <Input label={ct('nickname')} value={nickname} maxLength={20} onValueChange={setNickname} />
          ) : null}
          {minor ? <p class="cps-privacy cps-pre">{ct('minorPublic')}{'\n'}{ct('minorRealName')}</p> : null}
          {minor ? <Checkbox label={ct('guardianConsent')} checked={guardian} onCheckedChange={setGuardian} /> : null}
          <Checkbox label={ct(ackKey)} checked={privacy} onCheckedChange={setPrivacy} />
          {error ? <CpError reason={error.reason} params={error.params} /> : null}
        </div>
      </CpCard>
      <div class="cps-actions">
        <Button variant="secondary" onClick={backToRoster}>{ct('cancel')}</Button>
        <Button variant="primary" loading={busy} onClick={() => { void submit(); }}>{ct('addSubmit')}</Button>
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
