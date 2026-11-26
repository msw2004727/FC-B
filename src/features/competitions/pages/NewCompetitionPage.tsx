// 建賽精靈：基本資料、組別（全部展開）、確認後建立草稿，再發布。
// 場地選點沿用活動的 EventLocationPicker，只在點開時才載入。

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useGoBack } from '@/core/back-guard';
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
import { canEditCompetition, canHostOrCo, canSeeInAppSection, isCpAdmin } from '../access';
import type { CompetitionsRepo } from '../data/cp-repo';
import type { LaunchDoc } from '../data/types';
import { useInjectedEnv, type CpActor, type CpInjectedEnv } from '../env';
import { LiveBoundary } from '../live';
import { clipCodePoints, fromDatetimeLocalValue, formatTaipeiDateTime } from '../format';
import { buildCreateInput, buildUpdateInput, type DivisionDraft, type VenueDraft, type WizardDraft } from '../payload';
import type { CompetitionCategory, CompetitionDoc, DivisionDoc, StaffDoc } from '../data/types';
import { categoryText } from '../ui/schedule-board';
import { representativeClubs } from '../rep-clubs';
import { dangerConfirm } from '../ui/danger-confirm';
import { waitOverlayReleased } from '../ui/delete-competition';
import { CpError, CpGate, CpLoadFailed, errorOf, loadFailOf, reasonText } from '../ui/feedback';
import { DateTimeField, FeeLine } from '../ui/fields';
import { CpCard, CpFrame, CpI18nPending, CpRow, InfoIcon, LockIcon, PinIcon, PlusIcon, TrashIcon } from '../ui/shell';
import { StatusTag } from '../ui/status-tag';
import { CoverField, coverProblemText, isCoverField, type CoverShown } from '../ui/cover-field';
import { PageSpinner } from '@/ui/PageSpinner';
import { toast } from '@/ui/Toast';
import { duplicateDivisionField, fieldSpot, step1Problem, step2Problem, type EditCheck, type FieldProblem } from './new-competition-check';
import { divisionTaken, editDraftOf, editErrorField, editLocks, isCompetitionId, type EditSource } from './edit-competition';
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
  hostDisplay: 'hostDisplayField',
};

/** 錯誤句要說是哪一欄、怎麼改；沒有對應句子的退回後端原因的通用文案。 */
function problemText(ct: (key: string, params?: Record<string, string | number>) => string, err: WizardError): string {
  const f = err.field ?? '';
  if (f === 'cover') return coverProblemText(ct, err.reason, err.params);
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
    case 'SCHEDULE_OUT_OF_RANGE':
      return ct('fe.outOfRange');
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

/** 有座標才算「已設定地圖座標」（與 payload venueOf 送不送座標同一個條件）。 */
function hasPoint(venue: VenueDraft): boolean {
  return venue.lat != null && venue.lng != null && Number.isFinite(venue.lat) && Number.isFinite(venue.lng);
}

function emptyVenue(): VenueDraft {
  return { name: '', address: '' };
}

interface FormState {
  name: string;
  category: CompetitionCategory;
  hostType: 'personal' | 'club';
  hostTeamId: string;
  /** 編輯個人主辦時的主辦名稱；建立時不用（後端取主站顯示名）。 */
  hostDisplay: string;
  feeNote: string;
  contactNote: string;
  regOpen: string;
  regClose: string;
  firstMatch: string;
  lastMatch: string;
  venues: VenueDraft[];
  divisions: DivisionDraft[];
  /** 已上傳好的封面（選填）；null＝沒選，送出時不帶 cover 鍵。 */
  cover: CoverShown | null;
}

function blankForm(): FormState {
  return {
    name: '',
    category: 'league',
    hostType: 'personal',
    hostTeamId: '',
    hostDisplay: '',
    feeNote: '',
    contactNote: '',
    regOpen: '',
    regClose: '',
    firstMatch: '',
    lastMatch: '',
    venues: [emptyVenue()],
    divisions: [{ ...emptyDivision(), name: '' }],
    cover: null,
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
    hostDisplay: '',
    feeNote: seed.feeNote,
    contactNote: seed.contactNote ?? '',
    regOpen: seed.regOpen,
    regClose: seed.regClose,
    firstMatch: seed.firstMatch,
    lastMatch: seed.lastMatch,
    venues: seed.venues.map((venue) => ({ ...venue })),
    divisions: seed.divisions.map((division) => ({ ...division })),
    cover: seed.cover ?? null,
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
    cover: form.cover,
  };
}

/** 建立、發布等待超過這麼久，轉圈下面才出現說明；1～2 秒內完成的不閃字（站長 11-21：慢網路或冷啟動時的安心提示）。 */
export const WAIT_HINT_MS = 2000;
/** 等待超過這麼久換成「還在處理、別關頁面」那一句。 */
export const WAIT_LONG_MS = 15000;

/** 0＝不顯示、1＝等超過 2 秒、2＝等超過 15 秒。busy 結束或卸載時兩個計時器都清掉。 */
function useWaitStage(busy: boolean): 0 | 1 | 2 {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    setStage(0);
    if (!busy) return;
    const hint = setTimeout(() => setStage(1), WAIT_HINT_MS);
    const long = setTimeout(() => setStage(2), WAIT_LONG_MS);
    return () => {
      clearTimeout(hint);
      clearTimeout(long);
    };
  }, [busy]);
  // effect 要等畫完那一幀才歸零；busy 一結束當場回 0，失敗或切到「已建立草稿」那一幀不殘留等待句。
  return busy ? stage : 0;
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

/**
 * edit：編輯既有賽事（站長 11-21：照活動系統，建立與編輯共用這一份表單）。預填讀到的值；第 3 步主鈕「儲存變更」只送有變的鍵；
 * 取消比對預填值；儲存或放棄後回到進來的頁面（報隊管理或詳情；歷史起點時取代成賽事詳情）。
 */
function WizardView({ env, edit }: { env: CpInjectedEnv; edit?: EditSource }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  const preview = env.preview;
  const [step, setStep] = useState<1 | 2 | 3>(preview?.wizardStep === 2 || preview?.wizardStep === 3 ? preview.wizardStep : 1);
  const [done, setDone] = useState(!edit && preview?.wizardStep === 'done');
  const [cid, setCid] = useState('');
  const [form, setForm] = useState<FormState>(() => (edit ? editDraftOf(edit) : formFromEnv(env)));
  // 進頁時的表單：取消與第 1 步返回拿來比對「有沒有填過」（站長 11-21）；編輯時也是送出比對「改了哪些」的基準。
  const startForm = useRef(form);
  const goBack = useGoBack(edit ? `/competitions/${edit.cid}` : '/tournaments');
  const now = env.now ?? Date.now();
  const locks = edit ? editLocks(edit, now) : null;
  const [error, setError] = useState<WizardError | null>(
    preview?.wizardError ? { reason: 'BANNED_WORD', field: 'name' } : null,
  );
  const [jumpTick, setJumpTick] = useState(0);
  // 有欄位但畫面上找不到那一欄（例如俱樂部清單還在讀、下拉還沒畫）：改顯示整頁錯誤，不讓按了沒反應。
  const [lostField, setLostField] = useState(false);
  const [busy, setBusy] = useState(false);
  // 同步鎖：連按兩下時第二下可能比按鈕停用的重畫早到（busy 還是舊值），建立／發布只送一次。
  const inFlight = useRef(false);
  const waitStage = useWaitStage(busy);
  const [mapIndex, setMapIndex] = useState<number | null>(null);
  // 封面上傳中：第 1 步「下一步」先擋（建立時一定要有完整網址組或完全不帶）。
  const [coverBusy, setCoverBusy] = useState(false);
  const clubs = representativeClubs(env.actor);
  // ASSUMPTION: repClubsPending 省略＝清單已定案。還在讀時空陣列不改回個人，晚到的俱樂部仍要補上。
  const clubsPending = env.actor.repClubsPending === true;

  useEffect(() => {
    // 編輯時主辦身分不能改：不拿目前的代表俱樂部去改寫（管理員或共同主辦不一定是這個俱樂部的代表）。
    if (edit) return;
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
  }, [clubs, clubsPending, form.hostType, form.hostTeamId, edit]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add(FULLSCREEN_CLASS);
    return () => {
      root.classList.remove(FULLSCREEN_CLASS);
    };
  }, []);

  // 編輯個人主辦多一個主辦名稱欄；建立時 hostDisplay 沒有欄位（整頁錯誤＋個人資料連結，照舊）。
  const editHostName = !!edit && form.hostType === 'personal';
  const spotOf = (field: string | undefined): ReturnType<typeof fieldSpot> => (
    field === 'hostDisplay' && editHostName ? { step: 1, field, id: 'cpf-host-display' } : fieldSpot(field)
  );
  // 編輯：四個時間沒改就不檢查（報名已截止的賽事也能改其他欄位），有改照後端 updateCompetition 的規則。
  const start = startForm.current;
  const editCheck: EditCheck | undefined = edit ? {
    timesChanged: form.regOpen !== start.regOpen || form.regClose !== start.regClose
      || form.firstMatch !== start.firstMatch || form.lastMatch !== start.lastMatch,
    admin: edit.isAdmin,
    hostDisplay: editHostName,
  } : undefined;

  // 沒過的欄位：立即捲到畫面中間再聚焦。不依賴動畫：立即捲動在聚焦前就完成（顧問 §3.533）。
  useEffect(() => {
    if (!jumpTick) return;
    const spot = spotOf(error?.field);
    const node = spot ? document.getElementById(spot.id) : null;
    if (!node) {
      if (spot) setLostField(true);
      return;
    }
    node.scrollIntoView?.({ block: 'center', behavior: 'auto' });
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
    const spot = spotOf(problem.field);
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
    if (step === 1 && coverBusy) {
      showProblem({ field: 'cover', reason: 'COVER_BUSY' });
      return;
    }
    const problem = step === 1 ? step1Problem(form, now, editCheck) : step2Problem(form);
    if (problem) {
      showProblem(problem);
      return;
    }
    setError(null);
    setStep(step === 1 ? 2 : 3);
  }

  async function create(): Promise<void> {
    if (inFlight.current) return;
    // 第 1、2 步都過了才會到這裡；送出前再整份驗一次（預填或其他路徑可能帶進不合法的值）。
    const problem = step1Problem(form, env.now ?? Date.now()) ?? step2Problem(form);
    if (problem) {
      showProblem(problem);
      return;
    }
    const draft = toDraft(form, env.actor.displayName ?? '');
    if (!draft || busy) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await env.actions.create(buildCreateInput(draft));
      setCid(result.cid);
      setDone(true);
    } catch (err) {
      const info = errorOf(err);
      // 後端鏡像未建好時先判代表會回 NOT_CLUB_REP（第二輪模擬 C-04），前端已知是代表就顯示同步中。
      const reason = info.reason === 'NOT_CLUB_REP' && form.hostType === 'club' && clubs.some((club) => club.id === form.hostTeamId)
        ? 'CLUB_SYNC_PENDING'
        : info.reason;
      const raw = typeof info.params.field === 'string' ? info.params.field : undefined;
      // 重複組別名稱後端只標 divisions：找出是哪一組，落在那一組的名稱欄。封面三種 field 都落在封面欄。
      const field = reason === 'DIVISION_NAME_DUPLICATE'
        ? (duplicateDivisionField(form.divisions) ?? raw)
        : isCoverField(raw) ? 'cover' : raw;
      showProblem({ reason, params: info.params, field });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /** 編輯：送出前整份再驗一次；沒有任何變動直接回去（不打後端、不跳已儲存）。成功回到進來的頁面，那頁掛載時重讀。 */
  async function save(): Promise<void> {
    if (!edit || inFlight.current) return;
    const problem = step1Problem(form, now, editCheck) ?? step2Problem(form);
    if (problem) {
      showProblem(problem);
      return;
    }
    const input = buildUpdateInput(edit.cid, startForm.current, form);
    if (!input) {
      goBack();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    let saved = false;
    try {
      await env.actions.update(input);
      saved = true;
      toast.show({ message: ct('editSaved') });
      goBack();
    } catch (err) {
      const info = errorOf(err);
      const raw = typeof info.params.field === 'string' ? info.params.field : undefined;
      const field = info.reason === 'DIVISION_NAME_DUPLICATE'
        ? (duplicateDivisionField(form.divisions) ?? raw)
        : isCoverField(raw) ? 'cover' : editErrorField(info.reason, raw);
      showProblem({ reason: info.reason, params: info.params, field });
    } finally {
      // 成功時維持鎖定與轉圈到換頁（返回是非同步的），不讓第二下再送一次。
      if (!saved) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  async function publish(): Promise<void> {
    if (!cid || busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await env.actions.publish({ cid });
      route(`/competitions/${cid}`);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /** 取消與第 1 步返回：和進頁時不同才問要不要放棄，沒填過直接走（同 CpFrame 返回）。送出中不動（同步鎖擋按下建立同一刻的取消）。 */
  async function leave(): Promise<void> {
    if (inFlight.current) return;
    // 封面在 form 裡，選好的封面自動算「填過」；上傳中 form 還沒有封面，也當填過一起問。放棄後上傳中那張成孤兒（計畫書第 5 題接受）。
    if (coverBusy || JSON.stringify(form) !== JSON.stringify(startForm.current)) {
      if (!(await dangerConfirm(ct(edit ? 'discardEdit' : 'discardCreate'), { okText: ct('discard'), danger: true }))) return;
      // 確認框開著時推了一筆同網址紀錄（overlay-back）：先等它退掉，返回才會退到進來前那頁、起點時的取代才蓋到建立頁那筆。
      await waitOverlayReleased();
    }
    goBack();
  }

  /** 第 2、3 步回上一步（左上返回與底部上一步）；送出中不動。 */
  function goPrev(): void {
    if (inFlight.current) return;
    setError(null);
    setStep(step === 3 ? 2 : 1);
  }

  const stepName = step === 1 ? ct('stepBasic') : step === 2 ? ct('stepDivisions') : ct(edit ? 'stepConfirmEdit' : 'stepConfirm');
  // 等待說明：轉圈的按鈕下面一句，螢幕閱讀器也會唸（role="status"）
  const waitHint = waitStage ? <p class="cps-note" role="status">{ct(waitStage === 2 ? 'waitLong' : 'waitSlow')}</p> : null;
  const hostName = edit
    ? (form.hostType === 'club' ? (edit.competition.hostDisplay ?? '') : form.hostDisplay.trim())
    : form.hostType === 'club'
      ? (clubs.find((club) => club.id === form.hostTeamId)?.name ?? '')
      : (env.actor.displayName ?? '');

  if (done) {
    return (
      <CpFrame title={ct('createTitle')} backDisabled={busy}>
        <CpCard class="cps-success">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M7.5 12.5l3 3 6-6.5" /></svg>
          <h2 class="cps-title" style="margin:12px 0 4px">{ct('createdDraft')}</h2>
          <p class="cps-sub cps-success__name">{form.name.trim()}</p>
          {error ? <CpError reason={error.reason} params={error.params} /> : null}
          <div class="cps-actions cps-actions--col">
            <Button variant="primary" loading={busy} onClick={() => { void publish(); }}>{ct('publish')}</Button>
            <Button variant="secondary" onClick={() => route(cid ? `/competitions/${cid}` : '/tournaments')}>{ct('publishLater')}</Button>
            {waitHint}
          </div>
        </CpCard>
      </CpFrame>
    );
  }

  const draftTimes = toDraft(form, '');

  const pageError = error && (lostField || spotOf(error.field)?.step !== step) ? error : null;

  return (
    <CpFrame
      title={ct(edit ? 'editTitle' : 'createTitle')}
      menu={<span class="cph-stepno">{ct('stepOf', { step })}</span>}
      onBack={step === 1 ? () => { void leave(); } : goPrev}
      backDisabled={busy}
    >
      {/* 兩層頁首的第二層：這一步的名稱當大標，下面三段進度條 */}
      <div>
        <div class="cps-stepname"><b>{stepName}</b></div>
        <div class="cps-steps" aria-hidden="true">
          {[1, 2, 3].map((n) => <i key={n} class={n <= step ? 'on' : ''} />)}
        </div>
      </div>

      {/* 第 1 步收緊（站長 11-21）：卡片 .cph-tight，分類與主辦身分標籤和選項同一列；兩段期間合成一張卡 */}
      {step === 1 ? (
        <>
          <CpCard class="cph-tight">
            <div class="cps-fields">
              <CoverField
                ct={ct}
                value={form.cover}
                upload={env.coverUpload}
                error={fieldError('cover')}
                onDirty={() => clearField('cover')}
                onBusyChange={setCoverBusy}
                onChange={(cover) => patch({ cover })}
              />
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
              {/* 編輯時主辦身分顯示但停用（後端 UPDATE_KEYS 沒有 hostType／hostTeamId） */}
              <RadioGroup
                label={ct('hostKind')}
                orientation="horizontal"
                value={form.hostType}
                disabled={!!edit}
                onValueChange={(value) => {
                  const hostType = value === 'club' ? 'club' : 'personal';
                  patch({
                    hostType,
                    hostTeamId: hostType === 'club' ? (form.hostTeamId || clubs[0]?.id || '') : form.hostTeamId,
                  });
                }}
                options={edit ? [
                  { value: 'personal', label: ct('hostPersonalShort') },
                  { value: 'club', label: ct('club') },
                ] : [
                  { value: 'personal', label: ct('hostPersonalShort') },
                  ...(clubs.length > 0 ? [{ value: 'club', label: ct('hostClubOption') }] : []),
                ]}
              />
              {form.hostType === 'club' && (edit || clubs.length > 0) ? (
                <Select
                  id="cpf-club"
                  label={ct('club')}
                  required
                  disabled={!!edit}
                  value={form.hostTeamId}
                  error={fieldError('hostTeamId')}
                  onValueChange={(hostTeamId) => { patch({ hostTeamId }); clearField('hostTeamId'); }}
                  options={edit
                    ? [{ value: form.hostTeamId, label: edit.competition.hostDisplay ?? '' }]
                    : clubs.map((club) => ({ value: club.id, label: club.name }))}
                />
              ) : null}
              {editHostName ? (
                <Input
                  id="cpf-host-display"
                  label={ct('hostDisplayField')}
                  required
                  value={form.hostDisplay}
                  maxLength={30}
                  error={fieldError('hostDisplay')}
                  onValueChange={(hostDisplay) => { patch({ hostDisplay }); clearField('hostDisplay'); }}
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
          <CpCard class="cph-tight">
            <h2 class="cp3-sec-h">{ct('regPeriod')}</h2>
            <div class="cps-fields cph-pair">
              <DateTimeField id="cp-reg-open" required disabled={locks?.times} label={ct('regStart')} value={form.regOpen} error={fieldError('regOpenAt')} onValueChange={(regOpen) => { patch({ regOpen }); clearField('regOpenAt'); }} />
              <DateTimeField id="cp-reg-close" required disabled={locks?.times} label={ct('regEnd')} value={form.regClose} error={fieldError('regCloseAt')} onValueChange={(regClose) => { patch({ regClose }); clearField('regCloseAt'); }} />
            </div>
            <h2 class="cp3-sec-h">{ct('matchPeriod')}</h2>
            <div class="cps-fields cph-pair">
              <DateTimeField id="cp-first" required disabled={locks?.times} label={ct('firstMatch')} value={form.firstMatch} error={fieldError('firstMatchAt')} onValueChange={(firstMatch) => { patch({ firstMatch }); clearField('firstMatchAt'); }} />
              <DateTimeField id="cp-last" required disabled={locks?.times} label={ct('lastMatch')} value={form.lastMatch} error={fieldError('lastMatchAt')} onValueChange={(lastMatch) => { patch({ lastMatch }); clearField('lastMatchAt'); }} />
            </div>
            {/* 編輯：首場已過且不是管理員，四個時間停用（後端 COMPETITION_STARTED） */}
            {locks?.times ? <p class="cps-cap cph-hint" data-edit-lock="times">{ct('editTimesLocked')}</p> : null}
          </CpCard>
          <CpCard class="cph-tight">
            <h2 class="cp3-sec-h">{ct('venue')}</h2>
            <div class="cps-fields">
              {/* 場地照建立活動的地點欄（EventFormFields 的 event-location-control）：文字欄下一列「座標狀態＋選點鈕」，選點同一個 EventLocationPicker */}
              {form.venues.map((venue, index) => {
                // 已排賽程：進頁時就有的場地全部停用（含刪除與選點），只有新增的那幾列可改可刪
                const venueOff = locks?.venues === true && index < (edit?.competition.venues.length ?? 0);
                return (
                <div class="cps-fields cph-vrow" key={index}>
                  <div class="cps-fields cph-pair">
                    <div class="cps-head-row cph-venue">
                      <Input
                        id={`cpf-v${index}-name`}
                        label={ct('venueName')}
                        required
                        disabled={venueOff}
                        value={venue.name}
                        maxLength={40}
                        error={fieldError(`venues.${index}.name`)}
                        onValueChange={(name) => { patchVenue(index, { name }); clearField(`venues.${index}.name`); }}
                      />
                      {form.venues.length > 1 ? (
                        <button type="button" class="cps-iconbtn cps-iconbtn--flat cph-trash" aria-label={ct('removeVenue')} disabled={venueOff} style={venueOff ? 'opacity:.5' : undefined} onClick={() => removeRow({ venues: form.venues.filter((_, i) => i !== index) })}>
                          <TrashIcon />
                        </button>
                      ) : null}
                    </div>
                    <Input
                      id={`cpf-v${index}-address`}
                      label={ct('venueAddress')}
                      disabled={venueOff}
                      value={venue.address}
                      maxLength={100}
                      error={fieldError(`venues.${index}.address`)}
                      onValueChange={(address) => {
                        patchVenue(index, { address, mapPlaceId: '', mapProvider: address === venue.address ? venue.mapProvider : 'manual' });
                        clearField(`venues.${index}.address`);
                      }}
                    />
                  </div>
                  {/* 狀態與鈕的字照建立活動 locationControlState（已設定／尚未設定地圖座標、設定／重新設定地圖座標） */}
                  <div class="cph-start cph-map">
                    <span class={`cps-sub cps-nowrap${hasPoint(venue) ? ' cph-on' : ''}`}>{ct(hasPoint(venue) ? 'mapSet' : 'mapUnset')}</span>
                    <Button variant="secondary" size="sm" leading={<PinIcon />} disabled={venueOff} onClick={() => setMapIndex(index)}>{ct(hasPoint(venue) ? 'mapRepick' : 'mapPick')}</Button>
                  </div>
                </div>
                );
              })}
              {form.venues.length < 10 ? (
                <div class="cph-start">
                  <Button variant="secondary" size="sm" leading={<PlusIcon />} onClick={() => patch({ venues: [...form.venues, emptyVenue()] })}>{ct('addVenue')}</Button>
                </div>
              ) : null}
              {locks?.venues ? <p class="cps-cap" data-edit-lock="venues">{ct('editVenuesLocked')}</p> : null}
            </div>
          </CpCard>
        </>
      ) : null}

      {step === 2 ? (
        <>
          {locks?.namesOnly ? <p class="cps-note" data-edit-lock="divisions">{ct('editDivLocked')}</p> : null}
          {form.divisions.map((division, index) => {
            // 編輯：名單鎖定只能改名稱；這一組已有報隊不能刪，人制、年齡、實名、報名費也不能改
            // （後端 ROSTERS_LOCKED、DIVISION_HAS_ENTRIES、DIVISION_RULES_LOCKED）；隊數不能少於已核准（DIVISION_BELOW_APPROVED）。
            const taken = edit ? divisionTaken(edit, division.dvId) : null;
            const namesOnly = locks?.namesOnly === true;
            const rulesOff = namesOnly || taken != null;
            return (
            <CpCard key={index}>
              <div class="cps-head-row" style="margin-bottom:12px">
                <h2 class="cp3-sec-h">{ct('divisionN', { n: index + 1 })}</h2>
                {form.divisions.length > 1 ? (
                  <button
                    type="button"
                    class="cps-iconbtn cps-iconbtn--flat cph-trash"
                    aria-label={ct('removeDivision')}
                    disabled={namesOnly || taken != null}
                    style={namesOnly || taken != null ? 'opacity:.5' : undefined}
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
                  required
                  value={division.name}
                  maxLength={30}
                  error={fieldError(`divisions.${index}.name`)}
                  onValueChange={(name) => { patchDivision(index, { name }); clearField(`divisions.${index}.name`); }}
                />
                {taken && !namesOnly ? <p class="cps-cap" data-edit-lock="rules">{ct('reason.DIVISION_RULES_LOCKED')}</p> : null}
                <div>
                  <span class="cps-label">{ct('playersOnField')}</span>
                  <div class="cps-chips cph-five">
                    {FORMATS.map((count) => (
                      <Chip
                        key={count}
                        label={ct('formatN', { n: count })}
                        size="sm"
                        disabled={rulesOff}
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
                <Stepper id={`cpf-d${index}-maxTeams`} label={ct('maxTeams')} value={division.maxTeams} min={Math.max(2, taken?.approvedCount ?? 0)} max={64} disabled={namesOnly} onValueChange={(maxTeams) => { patchDivision(index, { maxTeams }); clearDivisionNumbers(index); }} />
                <Stepper id={`cpf-d${index}-rosterMin`} label={ct('rosterMin')} value={division.rosterMin} min={1} max={division.rosterMax} disabled={namesOnly} onValueChange={(rosterMin) => { patchDivision(index, { rosterMin }); clearDivisionNumbers(index); }} />
                <Stepper
                  id={`cpf-d${index}-rosterMax`}
                  label={ct('rosterMax')}
                  value={division.rosterMax}
                  min={division.playersOnField}
                  max={40}
                  disabled={namesOnly}
                  onValueChange={(rosterMax) => {
                    patchDivision(index, { rosterMax, rosterMin: Math.min(division.rosterMin, rosterMax) });
                    clearDivisionNumbers(index);
                  }}
                />
                <Switch
                  class="cph-switch"
                  label={ct('limitAge')}
                  disabled={rulesOff}
                  checked={division.limitAge}
                  onCheckedChange={(limitAge) => patchDivision(index, {
                    limitAge,
                    requireRealName: limitAge ? true : division.requireRealName,
                  })}
                />
                {division.limitAge ? (
                  <>
                    <Stepper id={`cpf-d${index}-minAge`} label={ct('minAge')} value={division.minAge} min={3} max={99} disabled={rulesOff} onValueChange={(minAge) => { patchDivision(index, { minAge }); clearDivisionNumbers(index); }} />
                    <Stepper id={`cpf-d${index}-maxAge`} label={ct('maxAge')} value={division.maxAge} min={3} max={99} disabled={rulesOff} onValueChange={(maxAge) => { patchDivision(index, { maxAge }); clearDivisionNumbers(index); }} />
                  </>
                ) : null}
                <Switch
                  class="cph-switch"
                  label={ct('requireRealName')}
                  disabled={rulesOff}
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
                    disabled={rulesOff}
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
            );
          })}
          {form.divisions.length < 8 ? (
            <div class="cph-start">
              <Button variant="secondary" size="sm" leading={<PlusIcon />} disabled={locks?.namesOnly} onClick={() => patch({ divisions: [...form.divisions, emptyDivision()] })}>{ct('addDivision')}</Button>
            </div>
          ) : null}
        </>
      ) : null}

      {step === 3 && draftTimes ? (
        <>
          <CpCard>
            {form.cover ? <img class="d2-hero__cover" src={form.cover.src ?? form.cover.url} alt="" width={1200} height={450} /> : null}
            <div class="cps-badges" style="margin-bottom:8px">
              <StatusTag kind="neutral" label={form.hostType === 'club' ? ct('hostClub') : ct('hostPersonal')} />
              {edit ? null : <StatusTag kind="neutral" label={ct('draft')} />}
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
          {edit ? null : <p class="cps-note">{ct('draftNote')}</p>}
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
        {/* 第 1 步「取消｜下一步」；第 2、3 步「上一步｜主鈕」，取消改成下面一行小字（站長 11-21） */}
        {step === 1
          ? <Button variant="secondary" class="cph-narrow" onClick={() => { void leave(); }}>{ct('cancel')}</Button>
          : <Button variant="secondary" class="cph-narrow" disabled={busy} onClick={goPrev}>{ct('prev')}</Button>}
        {step < 3 ? <Button variant="primary" onClick={goNext}>{ct('next')}</Button> : edit ? (
          <Button variant="primary" loading={busy} onClick={() => { void save(); }}>{ct('saveChanges')}</Button>
        ) : (
          <Button variant="primary" loading={busy} onClick={() => { void create(); }}>{ct('createAction')}</Button>
        )}
      </div>
      {waitHint}
      {step > 1 ? (
        <div class="cph-start">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void leave(); }}>{ct(edit ? 'cancelEdit' : 'cancelCreate')}</Button>
        </div>
      ) : null}

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
  // 主辦賽事開關關閉（顧問 §3.612）：角色定案後才判定，不顯示精靈。只在建立模式（編輯走 EditGate，不經這裡）。
  const hostOff = access === 'ok' && actor.canHost === false && !actor.rolePending;
  if (access === 'ok' && !hostOff) return children();
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
        icon={access === 'denied' || hostOff ? <LockIcon /> : <InfoIcon />}
        text={hostOff ? ct('hostDisabled')
          : access === 'login' ? ct('createLoginHint') : access === 'error' ? ct('loadFailed') : ct('createNotOpen')}
        load={hostOff ? 'host-disabled' : access}
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

/** 不能編輯：有合格的 cid 才給「回賽事頁」，否則回賽事列表（不拿網址上的值組路徑）。 */
function EditDenied({ cid }: { cid?: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const { route } = useLocation();
  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  return (
    <CpFrame title={ct('editTitle')}>
      <CpGate icon={<LockIcon />} text={ct('editNotAllowed')} load="edit-denied">
        {cid
          ? <Button variant="primary" onClick={() => route(`/competitions/${cid}`, true)}>{ct('backToCompetition')}</Button>
          : <Button variant="primary" onClick={() => route('/tournaments', true)}>{ct('backToTournaments')}</Button>}
      </CpGate>
    </CpFrame>
  );
}

type EditLoad =
  | { phase: 'loading' | 'missing' | 'hidden' | 'error' }
  | { phase: 'ready'; competition: CompetitionDoc; divisions: DivisionDoc[]; staff: StaffDoc | null };

/**
 * 編輯賽事進頁：讀這場賽事的根文件、組別與我的 staff（報隊管理同一批，不讀報隊），依後端 updateCompetition 決定能不能編輯。
 * 未登入不讀；角色或代表俱樂部還沒定案、而且目前看起來不是主辦時先轉圈，不先說不能編輯。
 * 已結束／已取消、下架（非管理員）、刪到一半：顯示不能編輯的狀態頁（直接開網址也一樣）。
 */
function EditGate({ env, cid }: { env: CpInjectedEnv; cid: string }): JSX.Element {
  const cpDict = useCompetitionsT();
  const ct = ctOrKey(cpDict);
  const preset = env.bundle?.competition;
  const [load, setLoad] = useState<EditLoad>(() => (preset
    ? { phase: 'ready', competition: preset, divisions: env.bundle?.divisions ?? [], staff: env.bundle?.staff ?? null }
    : { phase: 'loading' }));
  const [retry, setRetry] = useState(0);
  const uid = env.actor.uid;

  useEffect(() => {
    if (preset || env.actor.authPending || !uid) return;
    let alive = true;
    setLoad({ phase: 'loading' });
    void (async () => {
      try {
        const [competition, divisions, staff] = await Promise.all([
          env.repo.getCompetition(cid),
          env.repo.listDivisions(cid),
          env.repo.getStaff(cid, uid),
        ]);
        if (alive) setLoad(competition ? { phase: 'ready', competition, divisions, staff } : { phase: 'missing' });
      } catch (err) {
        if (alive) setLoad({ phase: loadFailOf(err) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [cid, uid, env.actor.authPending, env.repo, preset, retry]);

  if (!cpDict.ct) return <CpI18nPending failed={cpDict.failed} retry={cpDict.retry} />;
  const spinner = <div class="cps-root" data-cp-edit="pending"><PageSpinner /></div>;
  if (env.actor.authPending || (uid && load.phase === 'loading')) return spinner;
  if (load.phase === 'hidden' || load.phase === 'error') {
    return <CpLoadFailed title={ct('editTitle')} fail={load.phase} onRetry={() => setRetry((n) => n + 1)} />;
  }
  const isAdmin = isCpAdmin(env.actor.role);
  const ready = load.phase === 'ready' ? load : null;
  const canHost = ready ? canHostOrCo({
    staffRoles: ready.staff?.roles ?? [],
    hostType: ready.competition.hostType,
    hostTeamId: ready.competition.hostTeamId,
    repClubIds: representativeClubs(env.actor).map((club) => club.id),
    isAdmin,
  }) : false;
  // 目前不像主辦，但角色（管理員）或代表俱樂部還在讀：等定案再判斷。
  if (ready && !canHost && (env.actor.rolePending || (ready.competition.hostType === 'club' && env.actor.repClubsPending))) return spinner;
  if (!ready || !canEditCompetition(ready.competition, { canHost, isAdmin })) return <EditDenied cid={cid} />;
  return <WizardView env={env} edit={{ cid, competition: ready.competition, divisions: ready.divisions, isAdmin }} />;
}

export default function NewCompetitionPage(): JSX.Element {
  const injected = useInjectedEnv();
  // 編輯賽事走同一頁：/competitions/new?edit=<cid>（不另加路由，首頁入口的路由表不變大）。
  const editCid = useLocation().query.edit ?? '';
  if (editCid) {
    if (!isCompetitionId(editCid)) return <EditDenied />;
    if (injected) return <EditGate env={injected} cid={editCid} />;
    return (
      <LiveBoundary>
        {(actor, repo) => <EditGate env={{ actor, repo, actions: liveCpActions }} cid={editCid} />}
      </LiveBoundary>
    );
  }
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
