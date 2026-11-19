// B. 隊伍登錄連結。代表頁與核可頁：代表沿用賽事卡片，主辦核可用平面卡片。

import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Chip } from '@/ui/Chip';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Stepper } from '@/ui/Stepper';
import { Textarea } from '@/ui/Textarea';
import { isMinorAt } from '../format';
import { DateField } from '../ui/fields';
import {
  S4B_ADDITION_LEFT,
  S4B_ADDITION_SENT,
  S4B_ADDITIONS,
  S4B_CLAIM_NUMBER,
  S4B_CLAIM_TEAM,
  S4B_COMP_NAME,
  S4B_JOIN_LINE_NAME,
  S4B_LINK_DAYS_MAX,
  S4B_LINK_MAX_USES,
  S4B_LINK_PATH,
  S4B_LINK_USED,
  S4B_LINK_USES_MAX,
  S4B_LINK_USES_MIN,
  S4B_NOW,
  S4B_NUMBER_MAX,
  S4B_NUMBER_MIN,
  S4B_PLAYERS,
  S4B_ROSTER_LINK_EXPIRES,
  S4B_TEAM_THUNDER,
  S4B_YEAR,
  formatMd,
  formatMdHm,
  usedNumbers,
  type S4bPlayer,
} from '../testing/step4b-fixtures';
import { copy, posLabel } from './copy';
import { Line, S4bCard, S4bFrame } from './ui';

const POSITIONS: readonly { id: string; label: string }[] = [
  { id: 'none', label: copy.posNone },
  { id: 'GK', label: posLabel.GK },
  { id: 'DF', label: posLabel.DF },
  { id: 'MF', label: posLabel.MF },
  { id: 'FW', label: posLabel.FW },
  { id: 'custom', label: copy.posCustom },
];

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function birthdayIso(year: string, month: string, day: string): string {
  if (!year || !month || !day) return '';
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function BirthdayFields({ onBirthdayChange }: { onBirthdayChange: (iso: string) => void }): JSX.Element {
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  // 連續改年／月／日時，用最新值組生日，不吃到尚未重繪的舊狀態。
  const yearRef = useRef('');
  const monthRef = useRef('');
  const dayRef = useRef('');
  const years = useMemo(() => {
    const out: { value: string; label: string }[] = [{ value: '', label: copy.year }];
    for (let y = S4B_YEAR; y >= 1930; y -= 1) out.push({ value: String(y), label: copy.yearOption(y) });
    return out;
  }, []);
  const months = useMemo(() => {
    const out: { value: string; label: string }[] = [{ value: '', label: copy.month }];
    for (let m = 1; m <= 12; m += 1) out.push({ value: String(m), label: copy.monthOption(m) });
    return out;
  }, []);
  const dayMax = year && month ? daysInMonth(Number(year), Number(month)) : 31;
  const days = useMemo(() => {
    const out: { value: string; label: string }[] = [{ value: '', label: copy.day }];
    for (let d = 1; d <= dayMax; d += 1) out.push({ value: String(d), label: copy.dayOption(d) });
    return out;
  }, [dayMax]);
  function apply(nextYear: string, nextMonth: string, nextDay: string): void {
    yearRef.current = nextYear;
    monthRef.current = nextMonth;
    dayRef.current = nextDay;
    setYear(nextYear);
    setMonth(nextMonth);
    setDay(nextDay);
    onBirthdayChange(birthdayIso(nextYear, nextMonth, nextDay));
  }
  function changeMonth(next: string): void {
    const y = yearRef.current;
    const d = dayRef.current;
    const overflow = Boolean(d && y && next && Number(d) > daysInMonth(Number(y), Number(next)));
    apply(y, next, overflow ? '' : d);
  }
  function changeYear(next: string): void {
    const m = monthRef.current;
    const d = dayRef.current;
    const overflow = Boolean(d && m && next && Number(d) > daysInMonth(Number(next), Number(m)));
    apply(next, m, overflow ? '' : d);
  }
  return (
    <div class="s4b-gap">
      <span class="s4b-label">{copy.birthday}</span>
      <div class="s4b-bday">
        <select aria-label={copy.year} value={year} onChange={(event) => changeYear(event.currentTarget.value)}>
          {years.map((option) => <option key={option.value || 'y'} value={option.value}>{option.label}</option>)}
        </select>
        <select aria-label={copy.month} value={month} onChange={(event) => changeMonth(event.currentTarget.value)}>
          {months.map((option) => <option key={option.value || 'm'} value={option.value}>{option.label}</option>)}
        </select>
        <select aria-label={copy.day} value={day} onChange={(event) => apply(yearRef.current, monthRef.current, event.currentTarget.value)}>
          {days.map((option) => <option key={option.value || 'd'} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <p class="s4b-line">
        <span class="s4b-k">{copy.birthdayPrivate1}</span>
        <span class="s4b-v">{copy.birthdayPrivate2}</span>
      </p>
    </div>
  );
}

function PositionPick({
  value,
  text,
  onChange,
}: {
  value: string;
  text: string;
  onChange: (value: string, text: string) => void;
}): JSX.Element {
  return (
    <div>
      <span class="s4b-label">{copy.position}</span>
      <div class="s4b-chips">
        {POSITIONS.map((item) => (
          <Chip
            key={item.id}
            label={item.label}
            size="sm"
            selected={value === item.id}
            onSelect={() => onChange(item.id, text)}
          />
        ))}
      </div>
      {value === 'custom' ? (
        <div style="margin-top:12px">
          <Input label={copy.posCustomLabel} value={text} maxLength={5} onValueChange={(next) => onChange(value, next)} />
        </div>
      ) : null}
    </div>
  );
}

export function LinkRepScreen(): JSX.Element {
  const [term, setTerm] = useState('auto');
  const [uses, setUses] = useState(S4B_LINK_MAX_USES);
  const [revoked, setRevoked] = useState(false);
  const [players, setPlayers] = useState<readonly S4bPlayer[]>(
    S4B_PLAYERS.filter((player) => player.teamId === S4B_TEAM_THUNDER),
  );
  const dayOptions = [
    { value: 'auto', label: copy.daysDefault },
    ...Array.from({ length: S4B_LINK_DAYS_MAX }, (_, index) => {
      const n = index + 1;
      return { value: String(n), label: copy.days(n) };
    }),
  ];
  return (
    <S4bFrame title={copy.linkRepTitle} screen="link-rep">
      <S4bCard>
        <div class="s4b-gap">
          <Select label={copy.term} value={term} options={dayOptions} onValueChange={setTerm} />
          <Stepper label={copy.uses} value={uses} min={S4B_LINK_USES_MIN} max={S4B_LINK_USES_MAX} onValueChange={setUses} />
          <div class="s4b-blockbtn">
            <Button variant="primary">{copy.makeLink}</Button>
          </div>
        </div>
      </S4bCard>
      <S4bCard>
        <div class="s4b-gap">
          <p class="s4b-line"><span class="s4b-k">{S4B_LINK_PATH}</span></p>
          <div class="s4b-pair">
            <Button variant="secondary" size="sm">{copy.copyLink}</Button>
            <Button variant="secondary" size="sm">{copy.shareLine}</Button>
          </div>
        </div>
      </S4bCard>
      {revoked ? null : (
        <S4bCard>
          <h2 class="s4b-h">{copy.activeLinks}</h2>
          <div class="s4b-gap">
            <p class="s4b-line"><span class="s4b-k">{copy.usedOf(S4B_LINK_USED, S4B_LINK_MAX_USES)}</span></p>
            <p class="s4b-line"><span class="s4b-k">{copy.expireOn(formatMd(S4B_ROSTER_LINK_EXPIRES))}</span></p>
            <div class="s4b-mini">
              <Button variant="danger" size="sm" onClick={() => setRevoked(true)}>{copy.revoke}</Button>
            </div>
          </div>
        </S4bCard>
      )}
      <S4bCard>
        <h2 class="s4b-h">{copy.roster}</h2>
        <ul class="cps-list">
          {players.map((player) => (
            <li key={player.id} class="s4b-li">
              <span class="s4b-num">{player.number}</span>
              <span class="s4b-staff__name">{player.displayName}</span>
              <span class="s4b-staff__meta">{posLabel[player.position]}</span>
              <span class="s4b-staff__gap" />
              <span class="s4b-mini">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setPlayers((prev) => prev.filter((row) => row.id !== player.id))}
                >
                  {copy.remove}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </S4bCard>
    </S4bFrame>
  );
}

export type JoinStatus = 'active' | 'rosterFull' | 'invalid';

function joinScreen(minor: boolean, needBirthday: boolean, status: JoinStatus): string {
  if (status === 'rosterFull') return 'link-join-full';
  if (status === 'invalid') return 'link-join-invalid';
  if (needBirthday) return 'link-join-birthday';
  if (minor) return 'link-join-minor';
  return 'link-join';
}

export function LinkJoinScreen({
  minor = false,
  needBirthday = false,
  status = 'active',
}: {
  minor?: boolean;
  needBirthday?: boolean;
  status?: JoinStatus;
}): JSX.Element {
  const used = usedNumbers(S4B_TEAM_THUNDER);
  const [number, setNumber] = useState('7');
  const [position, setPosition] = useState('FW');
  const [positionText, setPositionText] = useState('');
  const [birthday, setBirthday] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [guardian, setGuardian] = useState(false);
  const screen = joinScreen(minor, needBirthday, status);
  const teamName = S4B_PLAYERS.find((player) => player.teamId === S4B_TEAM_THUNDER)?.teamName ?? '';
  // 要補生日時，未成年只看輸入的生日。minor prop 只用於已有生日的畫面。
  const birthdayMinor = isMinorAt(birthday, S4B_NOW) === true;
  function changeBirthday(next: string): void {
    if ((isMinorAt(next, S4B_NOW) === true) !== birthdayMinor) setGuardian(false);
    setBirthday(next);
  }
  const minorNow = needBirthday ? birthdayMinor : minor;
  const names = (
    <>
      <h2 class="s4b-h">{S4B_COMP_NAME}</h2>
      <h2 class="s4b-h">{teamName}</h2>
    </>
  );
  if (status === 'rosterFull') {
    return (
      <S4bFrame title={copy.joinTitle} screen={screen}>
        <S4bCard>
          <div class="s4b-gap">
            {names}
            <div data-reason="ROSTER_FULL">
              <h2 class="s4b-h">{copy.rosterFullTitle}</h2>
              <p class="s4b-alert">{copy.rosterFull}</p>
            </div>
          </div>
        </S4bCard>
      </S4bFrame>
    );
  }
  if (status === 'invalid') {
    return (
      <S4bFrame title={copy.joinTitle} screen={screen}>
        <S4bCard>
          <div class="s4b-gap">
            {names}
            <h2 class="s4b-h">{copy.linkDeadTitle}</h2>
            <p class="s4b-alert">{copy.linkDead}</p>
          </div>
        </S4bCard>
      </S4bFrame>
    );
  }
  const options = [];
  for (let n = S4B_NUMBER_MIN; n <= S4B_NUMBER_MAX; n += 1) {
    const taken = used.has(n);
    options.push({ value: String(n), label: taken ? copy.numberUsed(n) : String(n), disabled: taken });
  }
  const canJoin = privacy && (!minorNow || guardian);
  return (
    <S4bFrame title={copy.joinTitle} screen={screen}>
      <S4bCard>
        <div class="s4b-gap">
          {names}
          <Input label={copy.name} value={S4B_JOIN_LINE_NAME} readOnly />
          {needBirthday ? <BirthdayFields onBirthdayChange={changeBirthday} /> : <Line text={copy.birthdayKnown} />}
          <Select
            id="s4b-number"
            label={copy.number}
            value={number}
            options={options}
            onValueChange={(next) => {
              if (used.has(Number(next))) return;
              setNumber(next);
            }}
          />
          <PositionPick value={position} text={positionText} onChange={(next, text) => { setPosition(next); setPositionText(text); }} />
          <Checkbox label={copy.privacy} checked={privacy} onCheckedChange={setPrivacy} />
          {minorNow ? <Checkbox label={copy.guardian} checked={guardian} onCheckedChange={setGuardian} /> : null}
          <div class="s4b-blockbtn">
            <Button variant="primary" disabled={!canJoin}>{copy.join}</Button>
          </div>
        </div>
      </S4bCard>
    </S4bFrame>
  );
}

export type ClaimStatus = 'claimable' | 'ageMismatch';

export function ClaimScreen({
  status = 'claimable',
  minor = false,
}: {
  status?: ClaimStatus;
  minor?: boolean;
}): JSX.Element {
  const [privacy, setPrivacy] = useState(false);
  const [guardian, setGuardian] = useState(false);
  const screen = status === 'ageMismatch' ? 'claim-age-mismatch' : 'claim';
  if (status === 'ageMismatch') {
    return (
      <S4bFrame title={copy.claimTitle} screen={screen}>
        <S4bCard>
          <h2 class="s4b-h">{copy.claimAgeTitle}</h2>
          <p class="s4b-alert">{copy.claimAge}</p>
        </S4bCard>
      </S4bFrame>
    );
  }
  const ready = privacy && (!minor || guardian);
  return (
    <S4bFrame title={copy.claimTitle} screen={screen}>
      <S4bCard>
        <div class="s4b-gap">
          <h2 class="s4b-h">{S4B_COMP_NAME}</h2>
          <h2 class="s4b-h">{S4B_CLAIM_TEAM}</h2>
          <h2 class="s4b-h">{copy.claimLine(S4B_CLAIM_TEAM, S4B_CLAIM_NUMBER)}</h2>
          <Checkbox label={copy.privacy} checked={privacy} onCheckedChange={setPrivacy} />
          {minor ? <Checkbox label={copy.guardian} checked={guardian} onCheckedChange={setGuardian} /> : null}
          <div class="s4b-blockbtn">
            <Button variant="primary" disabled={!ready}>{copy.claimYes}</Button>
          </div>
        </div>
      </S4bCard>
    </S4bFrame>
  );
}

export function AdditionRequestScreen(): JSX.Element {
  const [realName, setRealName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [number, setNumber] = useState('');
  const [position, setPosition] = useState('FW');
  const [positionText, setPositionText] = useState('');
  const [consent, setConsent] = useState(false);
  const [ack, setAck] = useState(false);
  const minor = isMinorAt(birthday, S4B_NOW) === true;
  function changeBirthday(next: string): void {
    const nextMinor = isMinorAt(next, S4B_NOW) === true;
    if (nextMinor !== minor) setConsent(false);
    setBirthday(next);
  }
  const consentLabel = minor ? copy.guardian : copy.selfConsent;
  return (
    <S4bFrame title={copy.additionTitle} screen="addition-request">
      <S4bCard>
        <Line text={copy.remain(S4B_ADDITION_LEFT)} strong />
      </S4bCard>
      <S4bCard>
        <div class="s4b-gap">
          <Input label={copy.realName} value={realName} onValueChange={setRealName} />
          <DateField id="s4b-add-birthday" label={copy.birthday} value={birthday} onValueChange={changeBirthday} />
          <Input label={copy.number} type="number" value={number} min={0} max={99} onValueChange={setNumber} />
          <PositionPick value={position} text={positionText} onChange={(next, text) => { setPosition(next); setPositionText(text); }} />
          <Checkbox label={consentLabel} checked={consent} onCheckedChange={setConsent} />
          {/* 顧問 §3.306-3：比照正式代填頁，另有名單公開告知勾選 */}
          <Checkbox label={copy.addAck} checked={ack} onCheckedChange={setAck} />
          <div class="s4b-blockbtn">
            <Button variant="primary" disabled={!consent || !ack}>{copy.addSubmit}</Button>
          </div>
        </div>
      </S4bCard>
      <S4bCard>
        <div class="s4b-between">
          <span class="s4b-num">{S4B_ADDITION_SENT.number}</span>
          <span class="s4b-k">{S4B_ADDITION_SENT.displayName}</span>
          <span class="s4b-staff__gap" />
          <Badge tone="warning" size="sm" label={copy.waitHost} />
        </div>
      </S4bCard>
    </S4bFrame>
  );
}

export function AdditionReviewScreen(): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const rows = S4B_ADDITIONS.filter((row) => !done.has(row.id));
  function submit(): void {
    if (reason.trim().length === 0) {
      setError(true);
      return;
    }
    if (openId) setDone((prev) => new Set(prev).add(openId));
    setOpenId(null);
    setReason('');
    setError(false);
  }
  return (
    <S4bFrame title={copy.reviewTitle} admin screen="addition-review">
      <S4bCard plain>
        <ul class="cps-list">
          {rows.map((row) => (
            <li key={row.id} class="s4b-li">
              <div class="s4b-gap" style="width:100%">
                <div class="s4b-m__top">
                  <span class="s4b-k">{row.teamName}</span>
                  <span class="s4b-k">{row.displayName}</span>
                  <span class="s4b-k">{row.number}</span>
                </div>
                <p class="s4b-status">{formatMdHm(row.at)}</p>
                <Line text={copy.ageFit(row.ageOk)} warn={!row.ageOk} />
                <div class="s4b-pair">
                  <Button variant="primary" size="sm" onClick={() => setDone((prev) => new Set(prev).add(row.id))}>{copy.approve}</Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setOpenId(row.id);
                      setReason('');
                      setError(false);
                    }}
                  >
                    {copy.reject}
                  </Button>
                </div>
                {openId === row.id ? (
                  <div class="s4b-gap">
                    <Textarea
                      label={copy.reasonLabel}
                      value={reason}
                      maxLength={100}
                      rows={2}
                      onValueChange={(next) => {
                        setReason(next);
                        if (next.trim()) setError(false);
                      }}
                    />
                    {error ? <p class="s4b-alert" role="alert">{copy.reasonRequired}</p> : null}
                    <div class="s4b-blockbtn">
                      <Button variant="danger" onClick={submit}>{copy.rejectSubmit}</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </S4bCard>
    </S4bFrame>
  );
}
