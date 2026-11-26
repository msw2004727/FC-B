// 自己登錄。成年可填暱稱；組別 requireRealName 時成年也要填真名（不公開）。
// 未成年填真名，公開名由遮字即時算出，不送 publicName。
// 生日還沒載入前只顯示載入中，不先畫成年欄位。

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { useGoBack } from '@/core/back-guard';
import { ctOrKey, useCompetitionsT } from '../i18n';
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
import { isClubMemberByKeys, loadClubMemberKeys, useClubMemberKeys } from '../club-member-keys';
import { loadMyBirthday } from '../rep-clubs';
import { buildJoinInput, type PositionChoice } from '../payload';
import { CpError, CpLoadFailed, errorOf, loadFailOf, RosterBlocked } from '../ui/feedback';
import { POSITION_TEXT_MAX, PositionField } from '../ui/fields';
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

function JoinView({ env, cid, enId }: { env: CpInjectedEnv; cid: string; enId: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  // 三個出口（成功、返回、取消）都回上一頁；直開網址時才導到名單頁。原本 route() 再推一筆名單頁，
  // 名單頁的「<」（history.back）又回到這裡，形成循環（11-20 模擬器預演；取代 route(名單頁)）。
  const backToRoster = useGoBack(`/competitions/${cid}/entries/${enId}`);
  const prefill = env.preview?.prefillForm === true;
  const forcedMinor = env.preview?.selfMinor === true;
  // 預覽與 harness 不打個人資料。正式頁要等生日回來才決定成年或未成年欄位。
  const waitBirthday = env.preview == null && !!env.actor.uid;
  const [bundle, setBundle] = useState<CpBundle | null>(env.bundle ?? null);
  const [phase, setPhase] = useState(env.bundle ? 'ready' : 'loading');
  const [number, setNumber] = useState(prefill ? '14' : '');
  const [position, setPosition] = useState<PositionChoice>(prefill ? 'FW' : 'none');
  const [positionText, setPositionText] = useState('');
  const [nickname, setNickname] = useState(prefill && !forcedMinor ? '阿範' : '');
  const [realName, setRealName] = useState(prefill && forcedMinor ? '歐陽小明' : '');
  const [guardian, setGuardian] = useState(forcedMinor && prefill);
  const [privacy, setPrivacy] = useState(forcedMinor && prefill);
  const [profileBirthday, setProfileBirthday] = useState<string | null>(null);
  const [birthdayReady, setBirthdayReady] = useState(!waitBirthday);
  const [error, setError] = useState<{ reason: string; params?: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  // 成員雙鍵（顧問 §3.846）：hook 要在提早 return 之前叫。
  const clubKeys = useClubMemberKeys(env.actor, bundle?.entries.find((row) => row.id === enId)?.teamId ?? '', env.clubKeys);

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

  useEffect(() => {
    if (!waitBirthday || !env.actor.uid) return;
    let alive = true;
    void loadMyBirthday(env.actor.uid).then((value) => {
      if (!alive) return;
      setProfileBirthday(value);
      setBirthdayReady(true);
    }).catch(() => {
      if (!alive) return;
      setProfileBirthday(null);
      setBirthdayReady(true);
    });
    return () => {
      alive = false;
    };
  }, [env.actor.uid, waitBirthday]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;

  const entry = bundle?.entries.find((row) => row.id === enId) ?? null;
  const division = bundle?.divisions.find((row) => row.dvId === entry?.dvId);
  const competition = bundle?.competition ?? null;
  const now = env.now ?? Date.now();
  const basis = competition?.ageBasisAt ?? competition?.firstMatchAt ?? now;
  const minor = forcedMinor || (profileBirthday != null && isMinorAt(profileBirthday, basis) === true);
  const masked = maskedPublicName(realName);
  const ackKey = !minor && nickname.trim()
    ? 'ackNickname'
    : !minor
      ? 'ackDisplayName'
      : 'ackMasked';

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
    const customLen = codePoints(positionText.trim());
    if (position === 'custom' && (customLen < 1 || customLen > POSITION_TEXT_MAX)) {
      setError({ reason: 'FIELD_LENGTH', params: { min: 1, max: POSITION_TEXT_MAX } });
      return;
    }
    const needRealName = minor || division?.requireRealName === true;
    if (needRealName && !realName.trim()) {
      setError({ reason: 'REAL_NAME_REQUIRED' });
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
        // 組別不要求真名時不送。公開名仍是暱稱或主站顯示名。
        realName: needRealName ? realName : '',
        guardianConsent: guardian,
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
    return <CpLoadFailed title={ct('joinTitle')} fail={phase === 'hidden' ? 'hidden' : 'error'} />;
  }

  // 代表清單還沒回來時，空陣列不代表「不是成員」。
  if (env.actor.repClubsPending === true) return <div class="cps-root"><PageSpinner /></div>;

  const isRep = env.actor.repClubs.some((club) => club.id === entry?.teamId);
  // 雙鍵還在換算時，「不是成員」還不能下結論（代表不必等）。
  if (!isRep && clubKeys.pending) return <div class="cps-root"><PageSpinner /></div>;
  const isMember = isClubMemberByKeys(env.actor.memberClubIds, entry?.teamId ?? '', clubKeys.keys);
  const block = rosterFormBlock({
    kind: 'self',
    // 後端 joinRoster 接受成員或代表。代表也可以自己登錄。
    isMember: isMember || isRep,
    isRep,
    status: entry?.status ?? null,
    locked: competition.rostersLockedAt != null,
    started: now >= competition.firstMatchAt,
  });
  if (block) return <RosterBlocked reason={block} cid={cid} enId={enId} />;
  if (!birthdayReady) return <div class="cps-root"><PageSpinner /></div>;
  if (!env.preview && (profileBirthday == null || isMinorAt(profileBirthday, basis) == null)) {
    return <RosterBlocked reason="BIRTHDAY_REQUIRED" cid={cid} enId={enId} />;
  }

  return (
    <CpFrame title={ct('joinTitle')} context={competition.name} onBack={backToRoster}>
      {/* 新外觀卡 3-2：隊伍卡縮成一列（隊名可縮並省略、組別賽制不換行） */}
      <CpCard class="cp3-jteam">
        <h2 class="cps-title">{entry?.name ?? ''}</h2>
        {division ? <p class="cps-sub">{division.name}　{ct('formatN', { n: division.playersOnField })}</p> : null}
      </CpCard>
      <CpCard>
        <div class="cps-fields cp3-jform">
          <div class="cps-grid2">
            <Input label={ct('number')} type="number" value={number} min={0} max={99} onValueChange={setNumber} />
            <div />
          </div>
          <PositionField value={position} text={positionText} onChange={(next, text) => { setPosition(next); setPositionText(text); }} />
          {minor ? (
            <>
              <Input label={ct('realName')} required value={realName} maxLength={40} onValueChange={setRealName} />
              {masked ? <p class="cps-sub cp3-pubname" data-public-name>{ct('maskedPreview', { name: masked })}</p> : null}
              <p class="cps-privacy cps-pre">{ct('minorPublic')}{'\n'}{ct('minorRealName')}</p>
              <Checkbox label={ct('guardianConsent')} checked={guardian} onCheckedChange={setGuardian} />
            </>
          ) : (
            <>
              {division?.requireRealName ? (
                <div>
                  <Input label={ct('realName')} required value={realName} maxLength={40} onValueChange={setRealName} />
                  <p class="cps-cap cp3-cap">{ct('minorRealName')}</p>
                </div>
              ) : null}
              <Input label={ct('nickname')} value={nickname} maxLength={20} onValueChange={setNickname} />
            </>
          )}
          <Checkbox label={ct(ackKey)} checked={privacy} onCheckedChange={setPrivacy} />
          {error ? <CpError reason={error.reason} params={error.params} /> : null}
        </div>
      </CpCard>
      <div class="cps-actions cp3-jact">
        <Button variant="secondary" onClick={backToRoster}>{ct('cancel')}</Button>
        <Button variant="primary" loading={busy} onClick={() => { void submit(); }}>{ct('submit')}</Button>
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
      {(actor, repo) => <JoinView env={{ actor, repo, actions: liveCpActions, clubKeys: loadClubMemberKeys }} cid={cid} enId={enId} />}
    </LiveBoundary>
  );
}
