// 建賽精靈：基本資料、組別（全部展開）、確認後建立草稿，再發布。
// 場地選點沿用活動的 EventLocationPicker，只在點開時才載入。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { ctOrKey, useCompetitionsT } from '../i18n';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Input } from '@/ui/Input';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
import { Stepper } from '@/ui/Stepper';
import { Switch } from '@/ui/Switch';
import { Textarea } from '@/ui/Textarea';
import type { EventLocationSelection } from '@/features/events/components/event-form/EventLocationPicker';
import { liveCpActions } from '../actions';
import { canSeeInAppSection, isCpAdmin } from '../access';
import type { CompetitionsRepo } from '../data/cp-repo';
import type { LaunchDoc } from '../data/types';
import { useInjectedEnv, type CpActor, type CpInjectedEnv } from '../env';
import { LiveBoundary } from '../live';
import { clipCodePoints, fromDatetimeLocalValue, formatTaipeiDateTime } from '../format';
import { buildCreateInput, type DivisionDraft, type VenueDraft, type WizardDraft } from '../payload';
import type { CompetitionCategory } from '../data/types';
import { categoryText } from '../ui/schedule-board';
import { representativeClubs } from '../rep-clubs';
import { CpError, CpGate, errorOf, reasonText } from '../ui/feedback';
import { DateTimeField, FeeLine } from '../ui/fields';
import { CpCard, CpFrame, CpI18nPending, CpRow, InfoIcon, LockIcon, PinIcon, PlusIcon, TrashIcon } from '../ui/shell';
import { StatusTag } from '../ui/status-tag';
import { PageSpinner } from '@/ui/PageSpinner';
import { duplicateDivisionField, fieldSpot, step1Problem, step2Problem, type FieldProblem } from './new-competition-check';
import '../live/score-fullscreen.css';

/**
 * 建立賽事照記分頁全幅（ScoringPage.tsx 的 useScoreFullscreen、score-fullscreen.css）：掛載時 <html> 加同一個 class，
 * 隱藏 App 頂欄、底部導覽（z-index 900）、角標與同步列，卸載時移除；避免誤觸底部導覽換頁、表單要重填（站長 11-21）。
 * 不從 ScoringPage 匯入（會把整支記分頁帶進建賽頁的 chunk），class 名稱必須與 SCORE_FULLSCREEN_CLASS 相同。
 */
const FULLSCREEN_CLASS = 'cp-score-full';

const FORMATS = [5, 7, 8, 9, 11] as const;

/** field：後端 params.field 同一套路徑（例如 venues.0.name）；畫面有對應欄位時錯誤畫在那一欄。 */
interface WizardError {
  reason: string;
  params?: Record<string, unknown>;
  field?: string;
}

const TIME_REQUIRED_KEY: Record<string, string> = {
  regOpenAt: 'fe.reqRegOpen',
  regCloseAt: 'fe.reqRegClose',
  firstMatchAt: 'fe.reqFirst',
  lastMatchAt: 'fe.reqLast',
};

const ORDER_KEY: Record<string, string> = {
  regCloseAt: 'fe.regClose',
  firstMatchAt: 'fe.firstMatch',
  lastMatchAt: 'fe.lastMatch',
};

const LABEL_KEY: Record<string, string> = {
  address: 'fe.address',
  feeNote: 'feeNote',
  contactNote: 'contactField',
  maxTeams: 'maxTeams',
  rosterMin: 'rosterMin',
  rosterMax: 'rosterMax',
  minAge: 'minAge',
  maxAge: 'maxAge',
  feePerTeam: 'feePerTeam',
};

/** 錯誤句要說是哪一欄、怎麼改；沒有對應句子的退回後端原因的通用文案。 */
function problemText(ct: (key: string, params?: Record<string, string | number>) => string, err: WizardError): string {
  const f = err.field ?? '';
  const p = err.params ?? {};
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  const kind = f.split('.').pop() ?? '';
  const nameKey = f.startsWith('venues.') ? 'venueName' : f.startsWith('divisions.') ? 'divisionName' : 'name';
  const key = kind === 'name' ? nameKey : LABEL_KEY[kind];
  const label = key ? ct(key) : '';
  const timeKey = TIME_REQUIRED_KEY[f];
  const orderKey = ORDER_KEY[f];
  switch (err.reason) {
    case 'FIELD_REQUIRED':
      if (f === 'hostTeamId') return ct('fe.club');
      if (timeKey) return ct(timeKey);
      if (kind === 'address') return ct('fe.map');
      if (label) return ct('fe.required', { field: label });
      break;
    case 'FIELD_LENGTH':
      if (label) {
        return num(p.min) > 0
          ? ct('fe.length', { field: label, min: num(p.min), max: num(p.max) })
          : ct('fe.max', { field: label, max: num(p.max) });
      }
      break;
    case 'FIELD_RANGE':
      // 後端「最小年齡大於最大年齡」也是 FIELD_RANGE，min 帶最小年齡（大於 3 才可能比最大年齡大）。
      if (kind === 'maxAge' && num(p.min) > 3) return ct('fe.ageOrder');
      if (label) return ct('fe.range', { field: label, min: num(p.min), max: num(p.max) });
      break;
    case 'SCHEDULE_ORDER':
      if (orderKey) return ct(orderKey);
      break;
    case 'SCHEDULE_SPAN':
      if (f === 'regCloseAt') return ct('fe.regSpan', { max: 120 });
      if (f === 'lastMatchAt') return ct('fe.matchSpan', { max: 180 });
      break;
    case 'SCHEDULE_TOO_FAR':
      return ct('fe.tooFar');
    case 'SCHEDULE_PAST':
      if (f === 'firstMatchAt') return ct('fe.past');
      break;
    case 'FIELD_TIME':
      return ct('fe.time');
    case 'REG_CLOSED':
      if (f === 'regCloseAt') return ct('fe.regPast');
      break;
    case 'DIVISION_NAME_DUPLICATE':
      return ct('fe.dupName');
    default:
      break;
  }
  return reasonText(ct, err.reason, err.params);
}

function emptyDivision(): DivisionDraft {
  return {
    name: '',
    playersOnField: 5,
    maxTeams: 8,
    rosterMin: 7,
    rosterMax: 12,
    limitAge: false,
    minAge: 8,
    maxAge: 12,
    requireRealName: false,
    feePerTeam: 0,
  };
}

function emptyVenue(): VenueDraft {
  return { name: '', address: '' };
}

interface FormState {
  name: string;
  category: CompetitionCategory;
  hostType: 'personal' | 'club';
  hostTeamId: string;
  feeNote: string;
  contactNote: string;
  regOpen: string;
  regClose: string;
  firstMatch: string;
  lastMatch: string;
  venues: VenueDraft[];
  divisions: DivisionDraft[];
}

function blankForm(): FormState {
  return {
    name: '',
    category: 'league',
    hostType: 'personal',
    hostTeamId: '',
    feeNote: '',
    contactNote: '',
    regOpen: '',
    regClose: '',
    firstMatch: '',
    lastMatch: '',
    venues: [emptyVenue()],
    divisions: [{ ...emptyDivision(), name: '' }],
  };
}

function formFromEnv(env: CpInjectedEnv): FormState {
  const seed = env.wizardSeed;
  if (!seed) return blankForm();
  return {
    name: seed.name,
    category: seed.category ?? 'league',
    hostType: env.preview?.wizardClub ? 'club' : seed.hostType,
    hostTeamId: seed.hostTeamId,
    feeNote: seed.feeNote,
    contactNote: seed.contactNote ?? '',
    regOpen: seed.regOpen,
    regClose: seed.regClose,
    firstMatch: seed.firstMatch,
    lastMatch: seed.lastMatch,
    venues: seed.venues.map((venue) => ({ ...venue })),
    divisions: seed.divisions.map((division) => ({ ...division })),
  };
}

function toDraft(form: FormState, hostDisplay: string): WizardDraft | null {
  const regOpenAt = fromDatetimeLocalValue(form.regOpen);
  const regCloseAt = fromDatetimeLocalValue(form.regClose);
  const firstMatchAt = fromDatetimeLocalValue(form.firstMatch);
  const lastMatchAt = fromDatetimeLocalValue(form.lastMatch);
  if (regOpenAt == null || regCloseAt == null || firstMatchAt == null || lastMatchAt == null) return null;
  return {
    name: form.name,
    category: form.category,
    hostType: form.hostType,
    hostTeamId: form.hostTeamId,
    hostDisplay,
    feeNote: form.feeNote,
    contactNote: form.contactNote,
    regOpenAt,
    regCloseAt,
    firstMatchAt,
    lastMatchAt,
    venues: form.venues,
    divisions: form.divisions,
  };
}

function MapPicker({
  venue,
  onClose,
  onConfirm,
}: {
  venue: VenueDraft;
  onClose: () => void;
  onConfirm: (selection: EventLocationSelection) => void;
}): JSX.Element | null {
  const [Comp, setComp] = useState<((props: {
    locationText: string;
    initial: { lat: number | null; lng: number | null; mapAddress: string; mapPlaceId: string };
    onClose: () => void;
    onConfirm: (selection: EventLocationSelection) => void;
  }) => JSX.Element) | null>(null);
  useEffect(() => {
    let alive = true;
    void import('@/features/events/components/event-form/EventLocationPicker').then((mod) => {
      if (alive) setComp(() => mod.EventLocationPicker);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!Comp) return null;
  return (
    <Comp
      locationText={venue.address || venue.name}
      initial={{
        lat: venue.lat ?? null,
        lng: venue.lng ?? null,
        mapAddress: venue.address,
        mapPlaceId: venue.mapPlaceId ?? '',
      }}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

function WizardView({ env }: { env: CpInjectedEnv }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const preview = env.preview;
  const [step, setStep] = useState<1 | 2 | 3>(preview?.wizardStep === 2 || preview?.wizardStep === 3 ? preview.wizardStep : 1);
  const [done, setDone] = useState(preview?.wizardStep === 'done');
  const [cid, setCid] = useState('');
  const [form, setForm] = useState<FormState>(() => formFromEnv(env));
  const [error, setError] = useState<WizardError | null>(
    preview?.wizardError ? { reason: 'BANNED_WORD', field: 'name' } : null,
  );
  const [jumpTick, setJumpTick] = useState(0);
  // 有欄位但畫面上找不到那一欄（例如俱樂部清單還在讀、下拉還沒畫）：改顯示整頁錯誤，不讓按了沒反應。
  const [lostField, setLostField] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mapIndex, setMapIndex] = useState<number | null>(null);
  const clubs = representativeClubs(env.actor);
  // ASSUMPTION: repClubsPending 省略＝清單已定案。還在讀時空陣列不改回個人，晚到的俱樂部仍要補上。
  const clubsPending = env.actor.repClubsPending === true;

  useEffect(() => {
    if (form.hostType !== 'club') return;
    if (clubsPending) return;
    if (clubs.length === 0) {
      // 沒有可用俱樂部不能維持 club：後端 club 必填 hostTeamId。
      setForm((prev) => (
        prev.hostType === 'personal' && prev.hostTeamId === ''
          ? prev
          : { ...prev, hostType: 'personal', hostTeamId: '' }
      ));
      return;
    }
    if (form.hostTeamId && clubs.some((club) => club.id === form.hostTeamId)) return;
    const first = clubs[0]?.id ?? '';
    if (!first) return;
    setForm((prev) => (prev.hostTeamId === first ? prev : { ...prev, hostTeamId: first }));
  }, [clubs, clubsPending, form.hostType, form.hostTeamId]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add(FULLSCREEN_CLASS);
    return () => {
      root.classList.remove(FULLSCREEN_CLASS);
    };
  }, []);

  // 沒過的欄位：捲到畫面中間再聚焦。減少動態時不做平滑捲動。
  useEffect(() => {
    if (!jumpTick) return;
    const spot = fieldSpot(error?.field);
    const node = spot ? document.getElementById(spot.id) : null;
    if (!node) {
      if (spot) setLostField(true);
      return;
    }
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    node.focus({ preventScroll: true });
  }, [jumpTick]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;

  function patch(partial: Partial<FormState>): void {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function patchDivision(index: number, partial: Partial<DivisionDraft>): void {
    setForm((prev) => ({
      ...prev,
      divisions: prev.divisions.map((row, i) => (i === index ? { ...row, ...partial } : row)),
    }));
  }

  function patchVenue(index: number, partial: Partial<VenueDraft>): void {
    setForm((prev) => ({
      ...prev,
      venues: prev.venues.map((row, i) => (i === index ? { ...row, ...partial } : row)),
    }));
  }

  /** 欄位有問題：回到那一欄所在的步驟、錯誤畫在欄位上、捲過去聚焦。畫面上沒有對應欄位就留在原步驟顯示整頁錯誤。 */
  function showProblem(problem: WizardError | FieldProblem): void {
    const spot = fieldSpot(problem.field);
    setLostField(false);
    setError(spot ? { ...problem, field: spot.field } : problem);
    if (!spot) return;
    setStep(spot.step);
    setJumpTick((n) => n + 1);
  }

  function clearField(field: string): void {
    setError((current) => (current?.field === field ? null : current));
  }

  /** 刪除場地或組別後索引會位移：錯誤直接清掉，下次按下一步再檢查。 */
  function removeRow(partial: Partial<FormState>): void {
    patch(partial);
    setError(null);
  }

  /** 加減器改值：這一組的隊數、人數、年齡錯誤都收掉（最大年齡的錯誤可能是改最小年齡修好的）。 */
  function clearDivisionNumbers(index: number): void {
    setError((current) => (
      current?.field && /^divisions\.\d+\.(maxTeams|rosterMin|rosterMax|minAge|maxAge)$/.test(current.field) && current.field.startsWith(`divisions.${index}.`)
        ? null
        : current
    ));
  }

  function fieldError(field: string): string | undefined {
    return error && error.field === field ? problemText(ct, error) : undefined;
  }

  function goNext(): void {
    const problem = step === 1 ? step1Problem(form, env.now ?? Date.now()) : step2Problem(form);
    if (problem) {
      showProblem(problem);
      return;
    }
    setError(null);
    setStep(step === 1 ? 2 : 3);
  }

  async function create(): Promise<void> {
    // 第 1、2 步都過了才會到這裡；送出前再整份驗一次（預填或其他路徑可能帶進不合法的值）。
    const problem = step1Problem(form, env.now ?? Date.now()) ?? step2Problem(form);
    if (problem) {
      showProblem(problem);
      return;
    }
    const draft = toDraft(form, env.actor.displayName ?? '');
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await env.actions.create(buildCreateInput(draft));
      setCid(result.cid);
      setDone(true);
    } catch (err) {
      const info = errorOf(err);
      const raw = typeof info.params.field === 'string' ? info.params.field : undefined;
      // 重複組別名稱後端只標 divisions：找出是哪一組，落在那一組的名稱欄。
      const field = info.reason === 'DIVISION_NAME_DUPLICATE' ? (duplicateDivisionField(form.divisions) ?? raw) : raw;
      showProblem({ reason: info.reason, params: info.params, field });
    } finally {
      setBusy(false);
    }
  }

  async function publish(): Promise<void> {
    if (!cid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await env.actions.publish({ cid });
      route(`/competitions/${cid}`);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  const stepName = step === 1 ? ct('stepBasic') : step === 2 ? ct('stepDivisions') : ct('stepConfirm');
  const hostName = form.hostType === 'club'
    ? (clubs.find((club) => club.id === form.hostTeamId)?.name ?? '')
    : (env.actor.displayName ?? '');

  if (done) {
    return (
      <CpFrame title={ct('createTitle')}>
        <CpCard class="cps-success">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M7.5 12.5l3 3 6-6.5" /></svg>
          <h2 class="cps-title" style="margin:12px 0 4px">{ct('createdDraft')}</h2>
          <p class="cps-sub cps-success__name">{form.name.trim()}</p>
          {error ? <CpError reason={error.reason} params={error.params} /> : null}
          <div class="cps-actions cps-actions--col">
            <Button variant="primary" loading={busy} onClick={() => { void publish(); }}>{ct('publish')}</Button>
            <Button variant="secondary" onClick={() => route(cid ? `/competitions/${cid}` : '/tournaments')}>{ct('publishLater')}</Button>
          </div>
        </CpCard>
      </CpFrame>
    );
  }

  const draftTimes = toDraft(form, '');

  const pageError = error && (lostField || fieldSpot(error.field)?.step !== step) ? error : null;

  return (
    <CpFrame
      title={ct('createTitle')}
      menu={<span class="cph-stepno">{ct('stepOf', { step })}</span>}
      onBack={step === 1 ? undefined : () => { setError(null); setStep(step === 3 ? 2 : 1); }}
    >
      {/* 兩層頁首的第二層：這一步的名稱當大標，下面三段進度條 */}
      <div>
        <div class="cps-stepname"><b>{stepName}</b></div>
        <div class="cps-steps" aria-hidden="true">
          {[1, 2, 3].map((n) => <i key={n} class={n <= step ? 'on' : ''} />)}
        </div>
      </div>

      {step === 1 ? (
        <>
          <CpCard>
            <div class="cps-fields">
              <Input
                id="cpf-name"
                label={ct('name')}
                required
                value={form.name}
                maxLength={60}
                error={fieldError('name')}
                onValueChange={(name) => { patch({ name }); clearField('name'); }}
              />
              <RadioGroup
                label={ct('category')}
                orientation="horizontal"
                value={form.category}
                onValueChange={(value) => {
                  if (value === 'league' || value === 'cup' || value === 'friendly') patch({ category: value });
                }}
                options={[
                  { value: 'league', label: ct('categoryLeague') },
                  { value: 'cup', label: ct('categoryCup') },
                  { value: 'friendly', label: ct('categoryFriendly') },
                ]}
              />
              <RadioGroup
                label={ct('hostKind')}
                orientation="horizontal"
                value={form.hostType}
                onValueChange={(value) => {
                  const hostType = value === 'club' ? 'club' : 'personal';
                  patch({
                    hostType,
                    hostTeamId: hostType === 'club' ? (form.hostTeamId || clubs[0]?.id || '') : form.hostTeamId,
                  });
                }}
                options={[
                  { value: 'personal', label: ct('hostPersonalShort') },
                  ...(clubs.length > 0 ? [{ value: 'club', label: ct('hostClubOption') }] : []),
                ]}
              />
              {form.hostType === 'club' && clubs.length > 0 ? (
                <Select
                  id="cpf-club"
                  label={ct('club')}
                  value={form.hostTeamId}
                  error={fieldError('hostTeamId')}
                  onValueChange={(hostTeamId) => { patch({ hostTeamId }); clearField('hostTeamId'); }}
                  options={clubs.map((club) => ({ value: club.id, label: club.name }))}
                />
              ) : null}
              {form.hostType === 'club' ? (
                <div>
                  <Textarea
                    id="cpf-fee-note"
                    label={ct('feeNote')}
                    value={form.feeNote}
                    maxLength={500}
                    error={fieldError('feeNote')}
                    onValueChange={(feeNote) => { patch({ feeNote }); clearField('feeNote'); }}
                  />
                  <p class="cps-cap cph-hint">
                    <span class="cps-line">{ct('feeHandledByHost')}</span>
                    <span class="cps-line">{ct('feeSiteDoesNotHandle')}</span>
                  </p>
                </div>
              ) : null}
              <Input
                id="cpf-contact"
                label={ct('contactField')}
                hint={ct('publicHint')}
                value={form.contactNote}
                maxLength={60}
                error={fieldError('contactNote')}
                onValueChange={(value) => {
                  patch({ contactNote: clipCodePoints(value.replace(/[\r\n]/g, ''), 60) });
                  clearField('contactNote');
                }}
              />
              {form.hostType === 'personal' ? <p class="cps-cap cph-hint">{ct('contactEmptyHint')}</p> : null}
            </div>
          </CpCard>
          <CpCard>
            <h2 class="cp3-sec-h">{ct('regPeriod')}</h2>
            <div class="cps-fields">
              <DateTimeField id="cp-reg-open" label={ct('regStart')} value={form.regOpen} error={fieldError('regOpenAt')} onValueChange={(regOpen) => { patch({ regOpen }); clearField('regOpenAt'); }} />
              <DateTimeField id="cp-reg-close" label={ct('regEnd')} value={form.regClose} error={fieldError('regCloseAt')} onValueChange={(regClose) => { patch({ regClose }); clearField('regCloseAt'); }} />
            </div>
          </CpCard>
          <CpCard>
            <h2 class="cp3-sec-h">{ct('matchPeriod')}</h2>
            <div class="cps-fields">
              <DateTimeField id="cp-first" label={ct('firstMatch')} value={form.firstMatch} error={fieldError('firstMatchAt')} onValueChange={(firstMatch) => { patch({ firstMatch }); clearField('firstMatchAt'); }} />
              <DateTimeField id="cp-last" label={ct('lastMatch')} value={form.lastMatch} error={fieldError('lastMatchAt')} onValueChange={(lastMatch) => { patch({ lastMatch }); clearField('lastMatchAt'); }} />
            </div>
          </CpCard>
          <CpCard>
            <h2 class="cp3-sec-h">{ct('venue')}</h2>
            <div class="cps-fields">
              {form.venues.map((venue, index) => (
                <div class="cps-fields" key={index}>
                  <div class="cps-head-row cph-venue">
                    <Input
                      id={`cpf-v${index}-name`}
                      label={ct('venueName')}
                      value={venue.name}
                      maxLength={40}
                      error={fieldError(`venues.${index}.name`)}
                      onValueChange={(name) => { patchVenue(index, { name }); clearField(`venues.${index}.name`); }}
                    />
                    {form.venues.length > 1 ? (
                      <button type="button" class="cps-iconbtn cps-iconbtn--flat cph-trash" aria-label={ct('removeVenue')} onClick={() => removeRow({ venues: form.venues.filter((_, i) => i !== index) })}>
                        <TrashIcon />
                      </button>
                    ) : null}
                  </div>
                  <Input
                    id={`cpf-v${index}-address`}
                    label={ct('venueAddress')}
                    value={venue.address}
                    maxLength={100}
                    error={fieldError(`venues.${index}.address`)}
                    onValueChange={(address) => {
                      patchVenue(index, { address, mapPlaceId: '', mapProvider: address === venue.address ? venue.mapProvider : 'manual' });
                      clearField(`venues.${index}.address`);
                    }}
                  />
                  <div class="cph-start">
                    <Button variant="secondary" size="sm" leading={<PinIcon />} onClick={() => setMapIndex(index)}>{ct('pickOnMap')}</Button>
                  </div>
                </div>
              ))}
              {form.venues.length < 10 ? (
                <div class="cph-start">
                  <Button variant="secondary" size="sm" leading={<PlusIcon />} onClick={() => patch({ venues: [...form.venues, emptyVenue()] })}>{ct('addVenue')}</Button>
                </div>
              ) : null}
            </div>
          </CpCard>
        </>
      ) : null}

      {step === 2 ? (
        <>
          {form.divisions.map((division, index) => (
            <CpCard key={index}>
              <div class="cps-head-row" style="margin-bottom:12px">
                <h2 class="cp3-sec-h">{ct('divisionN', { n: index + 1 })}</h2>
                {form.divisions.length > 1 ? (
                  <button
                    type="button"
                    class="cps-iconbtn cps-iconbtn--flat cph-trash"
                    aria-label={ct('removeDivision')}
                    onClick={() => removeRow({ divisions: form.divisions.filter((_, i) => i !== index) })}
                  >
                    <TrashIcon />
                  </button>
                ) : null}
              </div>
              <div class="cps-fields">
                <Input
                  id={`cpf-d${index}-name`}
                  label={ct('divisionName')}
                  value={division.name}
                  maxLength={30}
                  error={fieldError(`divisions.${index}.name`)}
                  onValueChange={(name) => { patchDivision(index, { name }); clearField(`divisions.${index}.name`); }}
                />
                <div>
                  <span class="cps-label">{ct('playersOnField')}</span>
                  <div class="cps-chips cph-five">
                    {FORMATS.map((count) => (
                      <Chip
                        key={count}
                        label={ct('formatN', { n: count })}
                        size="sm"
                        selected={division.playersOnField === count}
                        onSelect={() => {
                          const playersOnField = count;
                          const rosterMax = Math.max(division.rosterMax, playersOnField);
                          const rosterMin = Math.min(division.rosterMin, rosterMax);
                          patchDivision(index, { playersOnField, rosterMax, rosterMin });
                        }}
                      />
                    ))}
                  </div>
                </div>
                {/* 連續的加減器與開關：細線等高列（列高 48），左標籤、右控制 */}
                <div class="d2-lines d2-lines--48 cph-ctl">
                <Stepper id={`cpf-d${index}-maxTeams`} label={ct('maxTeams')} value={division.maxTeams} min={2} max={64} onValueChange={(maxTeams) => { patchDivision(index, { maxTeams }); clearDivisionNumbers(index); }} />
                <Stepper id={`cpf-d${index}-rosterMin`} label={ct('rosterMin')} value={division.rosterMin} min={1} max={division.rosterMax} onValueChange={(rosterMin) => { patchDivision(index, { rosterMin }); clearDivisionNumbers(index); }} />
                <Stepper
                  id={`cpf-d${index}-rosterMax`}
                  label={ct('rosterMax')}
                  value={division.rosterMax}
                  min={division.playersOnField}
                  max={40}
                  onValueChange={(rosterMax) => {
                    patchDivision(index, { rosterMax, rosterMin: Math.min(division.rosterMin, rosterMax) });
                    clearDivisionNumbers(index);
                  }}
                />
                <Switch
                  class="cph-switch"
                  label={ct('limitAge')}
                  checked={division.limitAge}
                  onCheckedChange={(limitAge) => patchDivision(index, {
                    limitAge,
                    requireRealName: limitAge ? true : division.requireRealName,
                  })}
                />
                {division.limitAge ? (
                  <>
                    <Stepper id={`cpf-d${index}-minAge`} label={ct('minAge')} value={division.minAge} min={3} max={99} onValueChange={(minAge) => { patchDivision(index, { minAge }); clearDivisionNumbers(index); }} />
                    <Stepper id={`cpf-d${index}-maxAge`} label={ct('maxAge')} value={division.maxAge} min={3} max={99} onValueChange={(maxAge) => { patchDivision(index, { maxAge }); clearDivisionNumbers(index); }} />
                  </>
                ) : null}
                <Switch
                  class="cph-switch"
                  label={ct('requireRealName')}
                  checked={division.requireRealName}
                  onCheckedChange={(requireRealName) => patchDivision(index, { requireRealName })}
                />
                </div>
                {/* 加減器沒有自己的錯誤列：這一組的隊數、人數、年齡沒過時，錯誤句畫在控制列下面（同一套欄位錯誤樣式） */}
                {(['maxTeams', 'rosterMin', 'rosterMax', 'minAge', 'maxAge'] as const).map((kind) => {
                  const text = fieldError(`divisions.${index}.${kind}`);
                  return text ? (
                    <div class="ui-input" key={kind}>
                      <div id={`cpf-d${index}-${kind}-error`} data-field-error aria-live="polite">{text}</div>
                    </div>
                  ) : null;
                })}
                {/* 報名費只限俱樂部主辦（顧問 §3.257，站長親口）：個人主辦不顯示費用欄 */}
                {form.hostType === 'club' ? (
                  <Input
                    id={`cpf-d${index}-feePerTeam`}
                    label={ct('feePerTeam')}
                    type="number"
                    error={fieldError(`divisions.${index}.feePerTeam`)}
                    value={String(division.feePerTeam)}
                    min={0}
                    max={1000000}
                    onValueChange={(raw) => {
                      const parsed = Number(raw);
                      const feePerTeam = Number.isFinite(parsed) ? Math.max(0, Math.min(1_000_000, Math.trunc(parsed))) : 0;
                      patchDivision(index, { feePerTeam });
                    }}
                  />
                ) : null}
              </div>
            </CpCard>
          ))}
          {form.divisions.length < 8 ? (
            <div class="cph-start">
              <Button variant="secondary" size="sm" leading={<PlusIcon />} onClick={() => patch({ divisions: [...form.divisions, emptyDivision()] })}>{ct('addDivision')}</Button>
            </div>
          ) : null}
        </>
      ) : null}

      {step === 3 && draftTimes ? (
        <>
          <CpCard>
            <div class="cps-badges" style="margin-bottom:8px">
              <StatusTag kind="neutral" label={form.hostType === 'club' ? ct('hostClub') : ct('hostPersonal')} />
              <StatusTag kind="neutral" label={ct('draft')} />
            </div>
            <h2 class="cps-title cps-title--user" style="margin-bottom:12px">{form.name.trim()}</h2>
            <dl class="cps-rows">
              <CpRow k={ct('category')}>{categoryText(ct, form.category)}</CpRow>
              <CpRow k={ct('host')}>{hostName}</CpRow>
              <CpRow k={ct('regPeriod')}>
                <span class="cps-line">{formatTaipeiDateTime(draftTimes.regOpenAt)}</span>
                <span class="cps-line">{ct('until')} {formatTaipeiDateTime(draftTimes.regCloseAt)}</span>
              </CpRow>
              <CpRow k={ct('matchPeriod')}>
                <span class="cps-line">{formatTaipeiDateTime(draftTimes.firstMatchAt)}</span>
                <span class="cps-line">{ct('until')} {formatTaipeiDateTime(draftTimes.lastMatchAt)}</span>
              </CpRow>
              <CpRow k={ct('venue')}>
                {form.venues.map((venue) => <span class="cps-line" key={venue.name}>{venue.name}</span>)}
              </CpRow>
            </dl>
          </CpCard>
          <CpCard>
            <h2 class="cp3-sec-h">{ct('stepDivisions')}</h2>
            <ul class="cps-list">
              {form.divisions.map((division) => (
                <li class="cps-li" key={division.name}>
                  <div class="cps-li__main">
                    <span class="cps-li__name">{division.name}</span>
                    <div class="cps-li__meta">
                      <span class="cps-cap cps-nowrap">
                        {ct('divisionLine', {
                          format: ct('formatN', { n: division.playersOnField }),
                          teams: division.maxTeams,
                          min: division.rosterMin,
                          max: division.rosterMax,
                        })}
                        {division.limitAge ? `　${ct('ageLimit', { min: division.minAge, max: division.maxAge })}` : ''}
                      </span>
                    </div>
                    {form.hostType === 'club' ? <FeeLine amount={division.feePerTeam} /> : null}
                  </div>
                </li>
              ))}
            </ul>
          </CpCard>
          <p class="cps-note">{ct('draftNote')}</p>
        </>
      ) : null}

      {/* 沒有對應欄位的錯誤（後端沒帶欄位、或欄位使用者改不到）：整頁一句，至少說出後端給的原因 */}
      {pageError?.field === 'hostDisplay' ? (
        <p class="cps-note cps-warn" role="alert">
          <span class="cps-nowrap">{ct('fe.hostDisplay')}</span>
          {' '}
          <a
            class="cps-link"
            href="/profile"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              route('/profile');
            }}
          >
            {ct('goBirthday')}
          </a>
        </p>
      ) : pageError ? <p class="cps-note cps-warn" role="alert">{problemText(ct, pageError)}</p> : null}

      <div class="cph-split">
        {step > 1 ? <Button variant="secondary" class="cph-narrow" onClick={() => { setError(null); setStep(step === 3 ? 2 : 1); }}>{ct('prev')}</Button> : null}
        {step < 3 ? <Button variant="primary" onClick={goNext}>{ct('next')}</Button> : (
          <Button variant="primary" loading={busy} onClick={() => { void create(); }}>{ct('createAction')}</Button>
        )}
      </div>

      {mapIndex != null ? (
        <MapPicker
          venue={form.venues[mapIndex] ?? emptyVenue()}
          onClose={() => setMapIndex(null)}
          onConfirm={(selection) => {
            const picked = form.venues[mapIndex]?.address || selection.mapAddress;
            patchVenue(mapIndex, {
              lat: selection.lat,
              lng: selection.lng,
              mapPlaceId: selection.mapPlaceId,
              mapProvider: selection.mapProvider,
              address: clipCodePoints(picked, 100),
            });
            setMapIndex(null);
          }}
        />
      ) : null}
    </CpFrame>
  );
}

type CreateAccess = 'pending' | 'login' | 'denied' | 'error' | 'ok';

/**
 * 建賽頁與站內清單同一個開賽閘門（canSeeInAppSection）：內部期只給管理員與測試者，對外公開後給所有已登入會員。
 * 伺服器同樣會擋，這裡只決定表單出不出現。登入、角色或閘門還沒定案時一律轉圈，不先閃表單、也不先說不能用。
 * cpConfig/launch 每次進頁最多讀 1 次（另有 repo 的分頁快取）；管理員角色已確定時不讀。
 */
function useCreateAccess(actor: CpActor, repo: CompetitionsRepo): CreateAccess {
  const adminKnown = !actor.rolePending && isCpAdmin(actor.role);
  const [gate, setGate] = useState<{ uid: string; result: 'ok' | 'denied' | 'error' } | null>(null);
  const launchOnce = useRef<Promise<LaunchDoc | null> | null>(null);

  useEffect(() => {
    if (actor.authPending || !actor.uid || adminKnown) return;
    const uid = actor.uid;
    let alive = true;
    void (async () => {
      launchOnce.current ??= repo.getLaunch();
      const launch = await launchOnce.current;
      const isPublic = launch ? launch.isPublic : null;
      if (isPublic !== true && actor.rolePending) return; // 角色到了 effect 會重跑，launch 不再讀
      const isTester = isPublic === false ? await repo.getLaunchTester(uid) : false;
      if (!alive) return;
      setGate({ uid, result: canSeeInAppSection({ isPublic, isTester, isAdmin: false }) ? 'ok' : 'denied' });
    })().catch(() => {
      launchOnce.current = null;
      if (alive) setGate({ uid, result: 'error' });
    });
    return () => {
      alive = false;
    };
  }, [actor.authPending, actor.uid, actor.rolePending, adminKnown, repo]);

  if (actor.authPending) return 'pending';
  if (!actor.uid) return 'login';
  if (adminKnown) return 'ok';
  if (!gate || gate.uid !== actor.uid) return 'pending';
  return gate.result;
}

function CreateGate({
  actor,
  repo,
  children,
}: {
  actor: CpActor;
  repo: CompetitionsRepo;
  children: () => JSX.Element;
}): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const access = useCreateAccess(actor, repo);
  const [loginBusy, setLoginBusy] = useState(false);
  if (access === 'ok') return children();
  if (access === 'pending') return <div class="cps-root" data-cp-create="pending"><PageSpinner /></div>;
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;

  function login(): void {
    if (loginBusy) return;
    setLoginBusy(true);
    // 沿用站內登入：signIn 的回跳網址是目前這頁，登入後回到建賽頁。轉去 LINE 不算失敗。
    void import('@/data/auth')
      .then((auth) => auth.signIn())
      .catch(() => undefined)
      .finally(() => setLoginBusy(false));
  }

  const back = <Button variant={access === 'login' ? 'secondary' : 'primary'} onClick={() => route('/tournaments', true)}>{ct('backToTournaments')}</Button>;
  // 「一句話＋回去的鈕」：未登入與讀取失敗用圓圈 i、沒開放用鎖頭；未登入那一句不是錯誤，不帶 role="alert"。
  return (
    <CpFrame title={ct('createTitle')}>
      <CpGate
        icon={access === 'denied' ? <LockIcon /> : <InfoIcon />}
        text={access === 'login' ? ct('createLoginHint') : access === 'error' ? ct('loadFailed') : ct('createNotOpen')}
        load={access}
        alert={access !== 'login'}
      >
        {back}
        {access === 'login'
          ? <Button variant="primary" loading={loginBusy} onClick={login}>{ct('createLogin')}</Button>
          : null}
      </CpGate>
    </CpFrame>
  );
}

export default function NewCompetitionPage(): JSX.Element {
  const injected = useInjectedEnv();
  if (injected) {
    return <CreateGate actor={injected.actor} repo={injected.repo}>{() => <WizardView env={injected} />}</CreateGate>;
  }
  // 外層只過閘門、不查代表俱樂部；通過才掛內層去讀，沒資格的人一筆 teams 都不讀。
  return (
    <LiveBoundary loadClubs={false}>
      {(gateActor, gateRepo) => (
        <CreateGate actor={gateActor} repo={gateRepo}>
          {() => (
            <LiveBoundary>
              {(actor, repo) => <WizardView env={{ actor, repo, actions: liveCpActions }} />}
            </LiveBoundary>
          )}
        </CreateGate>
      )}
    </LiveBoundary>
  );
}
