/**
 * FC-B 活動建立／編輯資料層（A01 / A02 契約對齊）。
 *
 * 決策依據：
 *   - `docs/specs/lite-convergence/p50-event-create/out/analysis2.gemini.md` 第 2、4、5 節。
 *   - `docs/specs/lite-convergence/p50-event-create/mimo-verify.result.md`（衝突以此為準）。
 *   - 卡片決議：單日一般活動；`payloadRevision`/`payloadDigest` 不寫；`clientRequestId = id`；
 *     已有報名/候補時 max 改走 `adjustEventCapacity` Callable。
 *
 * 本檔只做資料層，不碰 UI。Callable 一律經 `@/data/callables.callFn`，不自建
 * `httpsCallable`；`getFirebase()` 只提供 `db`，不得取用 `functions`。
 */

import { getFirebase } from '@/data/firebase';
import { callFn } from '@/data/callables';
import type {
  AdjustEventCapacityRequest,
  AdjustEventCapacityResponse,
} from '@/data/contract/callables';
import {
  createPermissionChecker,
  type CustomRole,
} from '@/features/profile/data/permissions';
import {
  canEditOwnActivityBasic,
  canManageAllActivities,
  canManageEventDelegates,
  canUseActivityAddons,
  hasActivityManageEntry,
  type OperateContext,
} from './operate-permissions';
import {
  pickEventImage,
  resolveEventCoverImage,
  uploadEventImageVariants,
  uploadImageDataUrl,
} from './event-cover-upload';

// 供呼叫端由本模組取得 Callable 契約型別（與 `src/data/contract/callables.ts` 同源）。
export type {
  AdjustEventCapacityRequest,
  AdjustEventCapacityResponse,
} from '@/data/contract/callables';

// ── 可注入的型別 ─────────────────────────────────────

export type EventType = 'friendly' | 'single' | 'camp' | 'play' | 'watch';
export type EventStatus = 'upcoming' | 'open' | 'full' | 'ended' | 'cancelled';
export type AllowedGender = '' | '男' | '女';

export interface DelegationEntry {
  uid: string;
  name: string;
}

export interface SocialLink {
  url: string;
  platform: string;
  label: string;
  host: string;
}

export interface TeamSplitTeam {
  key: string;
  color: string;
  name: string;
}

/** 對齊 A `_tsGetFormData()` 回傳形狀（lockAt 由 buildTeamSplit 依開始時間算）。 */
export interface TeamSplitForm {
  enabled: boolean;
  mode: string;
  balanceCap: boolean;
  /** A：self-select 時為表單小時數（預設 2），其他模式為 0。 */
  selfSelectLockHours: number;
  teams: TeamSplitTeam[];
}

export interface TeamSplitPayload extends TeamSplitForm {
  lockAt: Date | null;
}

export interface EventImageVariants {
  cover?: string;
  homeNext?: string;
}

/**
 * 表單／ctx 對齊 A `handleCreateEvent` 之送表輸入。
 * `mapPickerEnabled` 對應 `isActivityMapLocationPickerEnabled()`（false 時 8 個地圖欄位皆不寫）。
 */
export interface CreateEventForm {
  title: string;
  type: EventType;
  location: string;
  dateVal: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  max: number;
  minAge: number;
  notes: string;
  sportTag: string;
  regOpenTime: string | null;
  image: string;
  imageVariants?: EventImageVariants;
  creatorName: string;
  delegates: DelegationEntry[];
  regionEnabled: boolean;
  region: string;
  cities: string[];
  feeEnabled: boolean;
  fee: number;
  teamOnly: boolean;
  creatorTeamId: string | null;
  creatorTeamName: string | null;
  creatorTeamIds: string[];
  creatorTeamNames: string[];
  genderRestrictionEnabled: boolean;
  allowedGender: AllowedGender;
  privateEvent: boolean;
  socialLinksEnabled: boolean;
  socialLinks: SocialLink[];
  earlyBirdEnabled: boolean;
  earlyBirdCost: number;
  earlyBirdPolicyVersion: 1 | null;
  teamSplit?: TeamSplitForm;
  mapPickerEnabled?: boolean;
  gpsEnabled?: boolean;
  lat?: number | null;
  lng?: number | null;
  mapAddress?: string | null;
  mapPlaceId?: string | null;
  mapProvider?: 'google' | 'manual' | null;
  mapLocationConfirmed?: boolean;
  mapLocationUpdatedAt?: string | null;
}

export interface CreateEventContext {
  uid: string;
  role: string;
  capabilities: readonly string[];
  rolePermissions: readonly string[] | null;
  userGrants: { uid?: string; enabled?: boolean; permissions?: string[] } | null;
  customRoles?: readonly CustomRole[];
  now: Date;
  generateId: (prefix: string) => string;
}

export interface EventForEdit {
  id: string;
  /** Firestore 文件 id；舊活動可能與 public id 不同（R-ID-008／R-ID-010），未給時視為等於 id。 */
  docId?: string;
  title?: string;
  creatorUid?: string;
  ownerUid?: string;
  captainUid?: string;
  delegateUids?: string[];
  privateEvent?: boolean;
  status?: EventStatus;
  current?: number;
  waitlist?: number;
  max?: number;
}

export interface EventCreatePayload {
  id: string;
  clientRequestId: string;
  title: string;
  type: string;
  status: 'open' | 'upcoming';
  location: string;
  date: string;
  startTimestamp: Date;
  endTimestamp: Date;
  max: number;
  minAge: number;
  notes: string;
  sportTag: string;
  regOpenTime: string | null;
  image: string;
  imageVariants?: EventImageVariants;
  gradient: string;
  current: number;
  waitlist: number;
  participants: string[];
  waitlistNames: string[];
  contact: string;
  icon: string;
  countdown: string;
  creator: string;
  creatorUid: string;
  delegates: DelegationEntry[];
  delegateUids: string[];
  regionEnabled: boolean;
  region: string;
  cities: string[];
  feeEnabled: boolean;
  fee: number;
  teamOnly: boolean;
  isPublic: boolean;
  creatorTeamId: string | null;
  creatorTeamName: string | null;
  creatorTeamIds: string[];
  creatorTeamNames: string[];
  genderRestrictionEnabled: boolean;
  allowedGender: AllowedGender;
  privateEvent: boolean;
  socialLinksEnabled: boolean;
  socialLinks: SocialLink[];
  earlyBirdEnabled: boolean;
  earlyBirdCost: number;
  earlyBirdPolicyVersion: 1 | null;
  teamSplit?: TeamSplitPayload;
  gpsEnabled?: boolean;
  lat?: number | null;
  lng?: number | null;
  mapAddress?: string | null;
  mapPlaceId?: string | null;
  mapProvider?: 'google' | 'manual' | null;
  mapLocationConfirmed?: boolean;
  mapLocationUpdatedAt?: string | null;
}

export interface EventEditUpdates {
  title?: string;
  type?: string;
  status?: EventStatus;
  location?: string;
  date?: string;
  startTimestamp?: Date;
  endTimestamp?: Date;
  max?: number;
  minAge?: number;
  notes?: string;
  sportTag?: string;
  regOpenTime?: string | null;
  image?: string;
  imageVariants?: EventImageVariants;
  gradient?: string;
  regionEnabled?: boolean;
  region?: string;
  cities?: string[];
  teamOnly?: boolean;
  creatorTeamId?: string | null;
  creatorTeamName?: string | null;
  creatorTeamIds?: string[];
  creatorTeamNames?: string[];
  delegates?: DelegationEntry[];
  delegateUids?: string[];
  feeEnabled?: boolean;
  fee?: number;
  genderRestrictionEnabled?: boolean;
  allowedGender?: AllowedGender;
  privateEvent?: boolean;
  socialLinksEnabled?: boolean;
  socialLinks?: SocialLink[];
  earlyBirdEnabled?: boolean;
  earlyBirdCost?: number;
  earlyBirdPolicyVersion?: 1 | null;
  teamSplit?: TeamSplitPayload;
  gpsEnabled?: boolean;
  lat?: number | null;
  lng?: number | null;
  mapAddress?: string | null;
  mapPlaceId?: string | null;
  mapProvider?: 'google' | 'manual' | null;
  mapLocationConfirmed?: boolean;
  mapLocationUpdatedAt?: string | null;
}

/**
 * 編輯時表單尚未提供的欄位群組：不寫入、保留原值（T-013 修補）。
 * B 表單還沒有加值／委託人／封面欄位時若照送預設值，會把既有活動的私密、費用、委託人、封面等覆寫成關閉或空白。
 */
export interface EditPreserveOptions {
  addons?: boolean;
  delegates?: boolean;
  image?: boolean;
}

export interface EditResult {
  updates: EventEditUpdates;
  capacityChange: number | null;
  /** true＝無加值權限而略過加值欄位；UI 應顯示 ADDON_UPSELL_MESSAGE（A 同樣照常送出）。 */
  addonsStripped: boolean;
}

/** 可辨識錯誤（供呼叫端 switch code 顯示／降級）。 */
export class EventCreateError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'EventCreateError';
  }
}

// ── 常數與小工具 ─────────────────────────────────────

/** A `_showActivityAddonUpsellToast()` 文案（R-CAP-004）。 */
export const ADDON_UPSELL_MESSAGE = '如需更多功能請聯繫官方Line@';

/** A `js/config.js#GRADIENT_MAP`；gradient 一律由 type 推導，不吃表單。 */
const GRADIENT_MAP: Record<string, string> = {
  friendly: 'linear-gradient(135deg,#0d9488,#065f46)',
  single: 'linear-gradient(135deg,#0f766e,#115e59)',
  camp: 'linear-gradient(135deg,#ec4899,#be185d)',
  play: 'linear-gradient(135deg,#7c3aed,#4338ca)',
  watch: 'linear-gradient(135deg,#f59e0b,#d97706)',
  external: 'linear-gradient(135deg,#6b7280,#4b5563)',
};

function gradientFor(type: string): string {
  return GRADIENT_MAP[type] || GRADIENT_MAP.friendly!;
}

/** Rules `isUserCreateOwner()` 強制的資料 id 樣式。 */
const EVENT_ID_PATTERN = /^ce_[A-Za-z0-9_-]{1,117}$/;

/** 6 個「全角色禁改」欄位（verify 第 4 條）。 */
const FORBIDDEN_EDIT_FIELDS = [
  'viewCount',
  'id',
  'clientRequestId',
  'creatorUid',
  'payloadRevision',
  'payloadDigest',
] as const;

function toOperateContext(ctx: CreateEventContext): OperateContext {
  return {
    uid: ctx.uid,
    role: ctx.role,
    rolePermissions: ctx.rolePermissions,
    userGrants: ctx.userGrants,
    capabilities: ctx.capabilities,
    customRoles: (ctx.customRoles as readonly CustomRole[]) || [],
  };
}

function hasCapability(ctx: CreateEventContext, code: string): boolean {
  return ctx.capabilities.includes(code);
}

/**
 * A `_isEventTrulyFull` 的等價判斷。
 * // ASSUMPTION: 附件未給出 `_getEventProjectedConfirmedCount` 完整實作；以 current >= max 近似。
 */
function isEventTrulyFull(existing: EventForEdit): boolean {
  const maxCount = Math.max(0, Number(existing.max ?? 0));
  const current = typeof existing.current === 'number' ? existing.current : 0;
  return maxCount > 0 && current >= maxCount;
}

function buildStartEnd(form: CreateEventForm): { startTimestamp: Date; endTimestamp: Date } {
  // 對齊 A：`new Date(`${dateVal}T${time}`)`，走本地時區。
  // ASSUMPTION: 測試需在 TZ=UTC 下跑、或使用與 golden 同 TZ 之環境。
  const startTimestamp = new Date(`${form.dateVal}T${form.startTime}`);
  const endTimestamp = new Date(`${form.dateVal}T${form.endTime}`);
  return { startTimestamp, endTimestamp };
}

function buildDateString(form: CreateEventForm): string {
  // A: `${dateVal.replace(/-/g, '/')} ${tStart}~${tEnd}`
  return `${form.dateVal.replace(/-/g, '/')} ${form.startTime}~${form.endTime}`;
}

function buildTeamSplit(
  form: CreateEventForm,
  startTimestamp: Date,
): TeamSplitPayload | undefined {
  if (!form.teamSplit || !form.teamSplit.enabled) return undefined;
  const ts = form.teamSplit;
  // A `_recalcTeamSplitTimestamps`：self-select 鎖定時間＝開始前 (selfSelectLockHours || 2) 小時。
  return {
    enabled: true,
    mode: ts.mode,
    balanceCap: !!ts.balanceCap,
    selfSelectLockHours: ts.selfSelectLockHours,
    teams: ts.teams.map((t) => ({ key: t.key, color: t.color, name: t.name })),
    lockAt:
      ts.mode === 'self-select'
        ? new Date(startTimestamp.getTime() - (ts.selfSelectLockHours || 2) * 3_600_000)
        : null,
  };
}

/** A `_buildEventLocationPayload('ce')`：GPS 關閉時座標類欄位一律寫 null／false。 */
function buildLocationPayload(form: CreateEventForm): Pick<
  EventCreatePayload,
  'gpsEnabled' | 'lat' | 'lng' | 'mapAddress' | 'mapPlaceId' | 'mapProvider'
  | 'mapLocationConfirmed' | 'mapLocationUpdatedAt'
> {
  if (!form.gpsEnabled) {
    return {
      gpsEnabled: false, lat: null, lng: null, mapAddress: null, mapPlaceId: null,
      mapProvider: null, mapLocationConfirmed: false, mapLocationUpdatedAt: null,
    };
  }
  return {
    gpsEnabled: true,
    lat: form.lat ?? null,
    lng: form.lng ?? null,
    mapAddress: form.mapAddress ?? null,
    mapPlaceId: form.mapPlaceId ?? null,
    mapProvider: form.mapProvider ?? null,
    mapLocationConfirmed: !!form.mapLocationConfirmed,
    mapLocationUpdatedAt: form.mapLocationUpdatedAt ?? null,
  };
}

function buildImageVariants(form: CreateEventForm): EventImageVariants | undefined {
  if (!form.imageVariants) return undefined;
  const variants: EventImageVariants = {};
  if (form.imageVariants.cover) variants.cover = form.imageVariants.cover;
  if (form.imageVariants.homeNext) variants.homeNext = form.imageVariants.homeNext;
  return Object.keys(variants).length > 0 ? variants : undefined;
}

function hasAnyAddon(form: CreateEventForm): boolean {
  return form.feeEnabled || form.teamOnly || form.genderRestrictionEnabled || form.privateEvent
    || !!(form.teamSplit && form.teamSplit.enabled) || form.socialLinksEnabled
    || form.earlyBirdEnabled || !!form.gpsEnabled;
}

/**
 * A `handleCreateEvent` 的加值閘門（R-CAP-004）：無權限卻有勾加值時，清掉加值欄位、
 * 提示 ADDON_UPSELL_MESSAGE，活動照常送出（不是整筆拒絕）。
 */
export function applyAddonGate(
  form: CreateEventForm,
  ctx: CreateEventContext,
  existing: EventForEdit | null,
): { form: CreateEventForm; stripped: boolean } {
  if (canUseActivityAddons(toOperateContext(ctx), existing) || !hasAnyAddon(form)) {
    return { form, stripped: false };
  }
  return {
    stripped: true,
    form: {
      ...form,
      feeEnabled: false,
      fee: 0,
      teamOnly: false,
      genderRestrictionEnabled: false,
      allowedGender: '',
      privateEvent: false,
      teamSplit: undefined,
      socialLinksEnabled: false,
      socialLinks: [],
      earlyBirdEnabled: false,
      earlyBirdCost: 0,
      gpsEnabled: false,
    },
  };
}

/** UI 用：是否顯示「我要開團」入口（與送出時的 assertCreateAllowed 同一套規則）。 */
export function canCreateEvent(ctx: CreateEventContext): boolean {
  try {
    assertCreateAllowed(ctx);
    return true;
  } catch {
    return false;
  }
}

function assertCreateAllowed(ctx: CreateEventContext): void {
  const checker = createPermissionChecker({
    role: ctx.role,
    rolePermissions: ctx.rolePermissions ? { [ctx.role]: ctx.rolePermissions } : {},
    userGrants:
      ctx.userGrants && ctx.userGrants.enabled !== false &&
      String(ctx.userGrants.uid || '').trim() === ctx.uid
        ? (ctx.userGrants.permissions ?? [])
        : [],
    customRoles: (ctx.customRoles as readonly CustomRole[]) || [],
  });
  if (ctx.role === 'user') {
    const hasBasicCreate = hasCapability(ctx, 'user.activity.basic_create');
    const hasCreateGrant = checker('event.create');
    if (!hasBasicCreate && !hasCreateGrant) {
      throw new EventCreateError(
        'BASIC_CREATE_REQUIRED',
        'User lacks user.activity.basic_create capability or event.create grant.',
      );
    }
    return;
  }
  // coach+ / manage entry / event.create grant
  const hasManageEntry = hasActivityManageEntry(toOperateContext(ctx));
  if (!hasManageEntry && !checker('event.create')) {
    throw new EventCreateError(
      'CREATE_NOT_ALLOWED',
      'User lacks activity manage entry or event.create permission.',
    );
  }
}

// ── 純函式：建立 payload ──────────────────────────────

export function buildCreateEventPayload(
  form: CreateEventForm,
  ctx: CreateEventContext,
  eventId: string,
): EventCreatePayload {
  if (!EVENT_ID_PATTERN.test(eventId)) {
    throw new EventCreateError(
      'INVALID_ID',
      `Event ID does not match Rules pattern ^ce_[A-Za-z0-9_-]{1,117}$: ${eventId}`,
    );
  }
  assertCreateAllowed(ctx);
  form = applyAddonGate(form, ctx, null).form;
  // A：沒有委託人管理權時建立一律寫空委託人。
  const delegates = canManageEventDelegates(toOperateContext(ctx), null) ? form.delegates : [];

  const { startTimestamp, endTimestamp } = buildStartEnd(form);
  const dateStr = buildDateString(form);
  const nowMs = ctx.now.getTime();
  const regOpenMs = form.regOpenTime ? new Date(form.regOpenTime).getTime() : 0;
  const status: 'open' | 'upcoming' = regOpenMs > nowMs ? 'upcoming' : 'open';

  const payload: EventCreatePayload = {
    id: eventId,
    clientRequestId: eventId,
    title: form.title,
    type: form.type,
    status,
    location: form.location,
    date: dateStr,
    startTimestamp,
    endTimestamp,
    max: form.max,
    minAge: form.minAge,
    notes: form.notes,
    sportTag: form.sportTag,
    regOpenTime: form.regOpenTime,
    image: form.image,
    gradient: gradientFor(form.type),
    // 初始常數（verify 第 5 條；與 Rules 安全投影一致）
    current: 0,
    waitlist: 0,
    participants: [],
    waitlistNames: [],
    contact: '',
    icon: '',
    countdown: '即將開始',
    // 建立者欄位（creatorUid 必須等於 uid）
    creator: form.creatorName,
    creatorUid: ctx.uid,
    delegates: delegates.map((d) => ({ ...d })),
    delegateUids: delegates.map((d) => d.uid),
    regionEnabled: form.regionEnabled,
    region: form.region,
    cities: [...form.cities],
    // 俱樂部／Addons（未授權時全關）
    feeEnabled: form.feeEnabled,
    fee: form.fee,
    teamOnly: form.teamOnly,
    isPublic: !!form.teamOnly,
    creatorTeamId: form.teamOnly ? form.creatorTeamId : null,
    creatorTeamName: form.teamOnly ? form.creatorTeamName : null,
    creatorTeamIds: form.teamOnly ? [...form.creatorTeamIds] : [],
    creatorTeamNames: form.teamOnly ? [...form.creatorTeamNames] : [],
    genderRestrictionEnabled: form.genderRestrictionEnabled,
    allowedGender: form.genderRestrictionEnabled ? form.allowedGender : '',
    privateEvent: form.privateEvent,
    socialLinksEnabled: form.socialLinksEnabled,
    socialLinks: form.socialLinksEnabled ? [...form.socialLinks] : [],
    earlyBirdEnabled: form.earlyBirdEnabled,
    earlyBirdCost: form.earlyBirdEnabled ? form.earlyBirdCost : 0,
    // 照 A handleCreateEvent：啟用時版本固定為 1。
    earlyBirdPolicyVersion: form.earlyBirdEnabled ? 1 : null,
  };

  const variants = buildImageVariants(form);
  if (variants) payload.imageVariants = variants;

  const teamSplit = buildTeamSplit(form, startTimestamp);
  if (teamSplit) payload.teamSplit = teamSplit;

  if (form.mapPickerEnabled) Object.assign(payload, buildLocationPayload(form));

  return payload;
}

// ── 純函式：編輯 updates ──────────────────────────────

export function buildEditEventUpdates(
  existing: EventForEdit,
  form: CreateEventForm,
  ctx: CreateEventContext,
  preserve: EditPreserveOptions = {},
): EditResult {
  if (!canEditOwnActivityBasic(toOperateContext(ctx), existing)) {
    throw new EventCreateError(
      'EDIT_NOT_ALLOWED',
      'User lacks permission to edit this event (canEditOwnActivityBasic=false).',
    );
  }

  const opCtx = toOperateContext(ctx);
  const gate = applyAddonGate(form, ctx, existing);
  form = gate.form;
  // 對齊 A 編輯分支：加值欄位只在 _canUseActivityAddons(e) 時寫；限定俱樂部另需 event.edit_all；
  // 委託人只在 _canManageEventDelegates(e) 時寫。
  const canUseAddons = canUseActivityAddons(opCtx, existing);
  const canChangeTeamOnly = canUseAddons && canManageAllActivities(opCtx);
  const canChangeDelegates = canManageEventDelegates(opCtx, existing);

  const { startTimestamp, endTimestamp } = buildStartEnd(form);
  const dateStr = buildDateString(form);

  // 基礎欄位（白名單 35/36 個都對應到）
  const updates: EventEditUpdates = {
    title: form.title,
    type: form.type,
    location: form.location,
    date: dateStr,
    startTimestamp,
    endTimestamp,
    minAge: form.minAge,
    notes: form.notes,
    sportTag: form.sportTag,
    regOpenTime: form.regOpenTime,
    gradient: gradientFor(form.type),
    regionEnabled: form.regionEnabled,
    region: form.region,
    cities: [...form.cities],
  };

  if (!preserve.image) {
    updates.image = form.image;
    const variants = buildImageVariants(form);
    if (variants) updates.imageVariants = variants;
  }

  if (canUseAddons && !preserve.addons) {
    updates.feeEnabled = form.feeEnabled;
    updates.fee = form.fee;
    updates.genderRestrictionEnabled = form.genderRestrictionEnabled;
    updates.allowedGender = form.genderRestrictionEnabled ? form.allowedGender : '';
    updates.privateEvent = form.privateEvent;
    updates.socialLinksEnabled = form.socialLinksEnabled;
    updates.socialLinks = form.socialLinksEnabled ? [...form.socialLinks] : [];
    updates.earlyBirdEnabled = form.earlyBirdEnabled;
    updates.earlyBirdCost = form.earlyBirdEnabled ? form.earlyBirdCost : 0;
    // 照 A handleCreateEvent：啟用時版本固定為 1。
    updates.earlyBirdPolicyVersion = form.earlyBirdEnabled ? 1 : null;

    if (form.mapPickerEnabled) Object.assign(updates, buildLocationPayload(form));

    const teamSplit = buildTeamSplit(form, startTimestamp);
    if (teamSplit) updates.teamSplit = teamSplit;
  }

  if (canChangeTeamOnly && !preserve.addons) {
    updates.teamOnly = form.teamOnly;
    updates.creatorTeamId = form.teamOnly ? form.creatorTeamId : null;
    updates.creatorTeamName = form.teamOnly ? form.creatorTeamName : null;
    updates.creatorTeamIds = form.teamOnly ? [...form.creatorTeamIds] : [];
    updates.creatorTeamNames = form.teamOnly ? [...form.creatorTeamNames] : [];
  }

  if (canChangeDelegates && !preserve.delegates) {
    updates.delegates = form.delegates.map((d) => ({ ...d }));
    updates.delegateUids = form.delegates.map((d) => d.uid);
  }

  // 名額：有報名/候補時不得直寫 max；改回傳 capacityChange 由呼叫端走 Callable。
  const hasCapacity = (existing.current ?? 0) > 0 || (existing.waitlist ?? 0) > 0;
  let capacityChange: number | null = null;
  if (hasCapacity) {
    if (form.max !== (existing.max ?? 0)) {
      capacityChange = form.max;
    }
  } else {
    updates.max = form.max;
  }

  // 照 A handleCreateEvent：管理入口或 event.edit_all 均可調整狀態。
  const canChangeStatus = hasActivityManageEntry(opCtx) || canManageAllActivities(opCtx);
  if (
    canChangeStatus &&
    existing.status !== 'ended' &&
    existing.status !== 'cancelled'
  ) {
    const nowMs = ctx.now.getTime();
    const regOpenMs = form.regOpenTime ? new Date(form.regOpenTime).getTime() : 0;
    if (regOpenMs > nowMs) {
      updates.status = 'upcoming';
    } else if (existing.status === 'upcoming') {
      updates.status = isEventTrulyFull(existing) ? 'full' : 'open';
    }
  }

  // 雙重保險：即使以上邏輯誤帶，也不寫入 6 個禁改欄位。
  for (const field of FORBIDDEN_EDIT_FIELDS) {
    if (field in (updates as Record<string, unknown>)) {
      delete (updates as Record<string, unknown>)[field];
    }
  }

  return { updates, capacityChange, addonsStripped: gate.stripped };
}

// ── 動作（I/O）────────────────────────────────────────

/**
 * 全部走 `@/data/callables.callFn`：
 *   - 統一 region、mock 模式、emulator 防護與記錄；
 *   - 不在本檔自行 `httpsCallable`，也不從 `getFirebase()` 取 `functions`。
 */
async function callAdjustEventCapacity(
  req: AdjustEventCapacityRequest,
): Promise<AdjustEventCapacityResponse> {
  try {
    return await callFn('adjustEventCapacity', req);
  } catch (err) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err);
    throw new EventCreateError('CAPACITY_ADJUST_FAILED', message);
  }
}

/**
 * 產生新活動 ID。UI 在表單開啟時呼叫一次並存在表單狀態，送出與重試都用同一個 id。
 * B 不寫 A 的 payloadRevision／payloadDigest（Rules 允許兩者都不帶）；冪等改由「id 固定＋已存在即視為成功」保證
 * （2026-10-19 Fable 建議：取代 A 用雜湊偵測重試的做法）。
 */
export function newEventId(ctx: CreateEventContext): string {
  const eventId = ctx.generateId('ce_');
  if (!EVENT_ID_PATTERN.test(eventId)) {
    throw new EventCreateError('INVALID_ID', `Generated ID does not match Rules pattern: ${eventId}`);
  }
  return eventId;
}

/**
 * 重送冪等的內容比對（取代 A 的 payloadRevision／payloadDigest）：既有文件與本次 payload 逐欄相同才算同一請求。
 * 排除重送時本來就可能不同的欄位：圖片（重新上傳網址不同）、依送出時間算的 status／countdown／地圖確認時間、
 * 建立後會被報名改動的統計欄位、伺服器時間。
 */
const CREATE_CONTENT_IGNORED_KEYS = new Set([
  'image', 'imageVariants', 'status', 'countdown', 'mapLocationUpdatedAt',
  'current', 'waitlist', 'participants', 'waitlistNames', 'createdAt', 'updatedAt',
]);
/** buildCreateEventPayload 視條件才寫的建立欄位：本次沒寫時，既有文件也必須沒有實際內容（雙向比對）。 */
const CREATE_OPTIONAL_CONTENT_KEYS = [
  'teamSplit', 'gpsEnabled', 'lat', 'lng', 'mapAddress', 'mapPlaceId', 'mapProvider', 'mapLocationConfirmed',
];

function normalizeForCompare(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(normalizeForCompare);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown> & { toMillis?: () => number };
    if (typeof record.toMillis === 'function') return record.toMillis();
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) out[key] = normalizeForCompare(record[key]);
    }
    return out;
  }
  return value;
}

export function createContentMatches(
  existing: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  const sameWritten = Object.keys(payload).every((key) => {
    if (CREATE_CONTENT_IGNORED_KEYS.has(key) || payload[key] === undefined) return true;
    return JSON.stringify(normalizeForCompare(existing[key] ?? null))
      === JSON.stringify(normalizeForCompare(payload[key]));
  });
  // 例：首次含地圖座標已寫入、重送時關掉地圖 → 既有座標仍在，不能當成同一請求。
  const noDroppedOptional = CREATE_OPTIONAL_CONTENT_KEYS.every((key) => (
    payload[key] !== undefined
    || existing[key] === undefined || existing[key] === null || existing[key] === false
  ));
  return sameWritten && noDroppedOptional;
}

/** 呼叫端掛勾：onWriteStart 在權限檢查與圖片上傳都通過、即將進入 transaction 時呼叫（之後失敗才是「結果未確認」）。 */
export interface CreateWriteHooks {
  onWriteStart?: () => void;
}

/**
 * 建立活動（R-ID-007：events.doc(eventId)，不用 add）。以 transaction 做 create 語意：
 * 文件不存在才寫入；已存在且是本人建立的（前一次送出其實成功、只是回應沒收到）→ 視為成功，回傳既有文件。
 */
export async function createEvent(
  form: CreateEventForm,
  ctx: CreateEventContext,
  eventId: string,
  hooks: CreateWriteHooks = {},
): Promise<{
  eventId: string;
  payload: EventCreatePayload;
  alreadyExisted: boolean;
  addonsStripped: boolean;
}> {
  if (!EVENT_ID_PATTERN.test(eventId)) {
    throw new EventCreateError('INVALID_ID', `Event ID does not match Rules pattern: ${eventId}`);
  }
  // 照 A addEvent：先檢查權限，再上傳；transaction 內不做 Storage I/O。
  assertCreateAllowed(ctx);
  const imageVariants = await uploadEventImageVariants(eventId, form.imageVariants);
  let image = pickEventImage(form.image, imageVariants);
  if (image.startsWith('data:')) {
    image = (await uploadImageDataUrl(image, `events/${eventId}`)) || '';
  }
  image = resolveEventCoverImage(image);
  const payload = buildCreateEventPayload({ ...form, image, imageVariants }, ctx, eventId);
  const [{ doc, runTransaction, serverTimestamp }, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  const ref = doc(db, 'events', eventId);
  hooks.onWriteStart?.();
  const alreadyExisted = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      const existing = snap.data() as Record<string, unknown>;
      if (existing.creatorUid !== ctx.uid) {
        throw new EventCreateError('ID_TAKEN', `Event ID already used by another creator: ${eventId}`);
      }
      // 前一次其實已建立但回應遺失：內容相同才視為成功，改過內容不得宣稱已儲存。
      if (!createContentMatches(existing, payload as unknown as Record<string, unknown>)) {
        throw new EventCreateError('CONTENT_CONFLICT', `Existing event differs from this request: ${eventId}`);
      }
      return true;
    }
    tx.set(ref, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return false;
  });
  return {
    eventId,
    payload,
    alreadyExisted,
    addonsStripped: applyAddonGate(form, ctx, null).stripped,
  };
}

/** 照 A addEventsAtomic：先全部讀取及判斷，再全部寫入。 */
export async function createEventsBatch(
  forms: readonly CreateEventForm[],
  ctx: CreateEventContext,
  eventIds: readonly string[],
  batchGroupId: string,
  hooks: CreateWriteHooks = {},
): Promise<{ eventIds: string[]; alreadyExisted: boolean; addonsStripped: boolean }> {
  if (forms.length < 2 || forms.length > 30 || eventIds.length !== forms.length) {
    throw new EventCreateError('BATCH_SIZE_INVALID', 'Event batch must contain 2 to 30 forms and matching IDs.');
  }
  if (eventIds.some(id => !EVENT_ID_PATTERN.test(id))) {
    throw new EventCreateError('INVALID_ID', 'Invalid event document ID.');
  }
  if (new Set(eventIds).size !== eventIds.length) {
    throw new EventCreateError('ID_TAKEN', 'Duplicate event document IDs.');
  }
  if (!ctx.uid.trim() || ctx.uid === 'unknown') {
    throw new EventCreateError('CREATOR_UID_REQUIRED', 'Creator UID is required.');
  }
  if (!batchGroupId.trim()) {
    throw new EventCreateError('BATCH_GROUP_INVALID', 'Batch group ID is required.');
  }

  assertCreateAllowed(ctx);
  // 照 A addEventsAtomic：固定本次輸入，避免上傳期間呼叫端改動陣列。
  const ids = [...eventIds];
  const prepared = forms.map((form, index) => {
    const id = ids[index];
    if (!id) {
      throw new EventCreateError('INVALID_ID', 'Missing event document ID.');
    }
    return {
      ...buildCreateEventPayload(form, ctx, id),
      batchGroupId,
    };
  });
  const creatorUid = ctx.uid;
  const addonsStripped = forms.some(form => applyAddonGate(form, ctx, null).stripped);

  // 照 A addEventsAtomic：每場各自上傳，transaction callback 不做 Storage I/O。
  for (const payload of prepared) {
    const imageVariants = await uploadEventImageVariants(payload.id, payload.imageVariants);
    let image = pickEventImage(payload.image, imageVariants);
    if (image.startsWith('data:')) {
      image = (await uploadImageDataUrl(image, `events/${payload.id}`)) || '';
    }
    payload.image = resolveEventCoverImage(image);
    if (imageVariants) payload.imageVariants = imageVariants;
    else delete payload.imageVariants;
  }

  const [{ doc, runTransaction, serverTimestamp }, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  const entries = prepared.map(payload => ({
    payload,
    ref: doc(db, 'events', payload.id),
  }));

  hooks.onWriteStart?.();
  const alreadyExisted = await runTransaction(db, async tx => {
    // 照 A addEventsAtomic：同一個 transaction 先讀全部，再判斷冪等或衝突，最後全部寫入。
    const snapshots: Array<Awaited<ReturnType<typeof tx.get>>> = [];
    for (const entry of entries) snapshots.push(await tx.get(entry.ref));

    const existingCount = snapshots.filter(snapshot => snapshot.exists()).length;
    if (existingCount > 0) {
      const matches = existingCount === entries.length && entries.every((entry, index) => {
        const snapshot = snapshots[index];
        if (!snapshot?.exists()) return false;
        const existing = snapshot.data() as Record<string, unknown>;
        return existing.id === entry.payload.id
          && existing.clientRequestId === entry.payload.id
          && existing.creatorUid === creatorUid
          && existing.batchGroupId === batchGroupId;
      });
      if (!matches) {
        throw new EventCreateError('ID_TAKEN', 'Batch IDs are partially present or belong to another request.');
      }
      if (!entries.every((entry, index) => createContentMatches(
        snapshots[index]?.data() as Record<string, unknown>,
        entry.payload as unknown as Record<string, unknown>,
      ))) {
        throw new EventCreateError('CONTENT_CONFLICT', 'Existing batch differs from this request.');
      }
      return true;
    }

    for (const entry of entries) {
      tx.set(entry.ref, {
        ...entry.payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return false;
  });

  return { eventIds: ids, alreadyExisted, addonsStripped };
}

export async function updateEventBasics(
  existing: EventForEdit,
  form: CreateEventForm,
  ctx: CreateEventContext,
  preserve: EditPreserveOptions = {},
): Promise<EditResult> {
  const result = buildEditEventUpdates(existing, form, ctx, preserve);
  const { updates, capacityChange } = result;

  if (!preserve.image) {
    // 照 A handleCreateEvent／updateEvent：先選主圖，再處理 variants。
    let image = pickEventImage(form.image, form.imageVariants);
    const imageVariants = await uploadEventImageVariants(existing.id, form.imageVariants);
    if (imageVariants) updates.imageVariants = imageVariants;
    else delete updates.imageVariants;

    // 照 A _uploadEventImageVariants：成功的 cover 取代空主圖或 data URL。
    if (imageVariants?.cover && (!image || image.startsWith('data:'))) {
      image = imageVariants.cover;
    }
    if (image.startsWith('data:')) {
      const uploaded = await uploadImageDataUrl(image, `events/${existing.id}`);
      if (uploaded) updates.image = uploaded;
      else delete updates.image;
    } else {
      updates.image = image;
    }
  }

  if (Object.keys(updates).length > 0) {
    const [{ doc, updateDoc, serverTimestamp }, { db }] = await Promise.all([
      import('firebase/firestore'),
      getFirebase(),
    ]);
    await updateDoc(doc(db, 'events', existing.docId ?? existing.id), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  }

  if (capacityChange !== null) {
    await callAdjustEventCapacity({ eventId: existing.id, newMax: capacityChange });
  }

  return result;
}

export async function changeEventCapacity(
  eventId: string,
  newMax: number,
): Promise<AdjustEventCapacityResponse> {
  return callAdjustEventCapacity({ eventId, newMax });
}

// TODO(B-1)：課程連結活動編輯（updateCourseLinkedEvent Callable）本版不做。
