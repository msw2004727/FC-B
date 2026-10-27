import { formatTaipei, parseTaipei, taipeiParts } from '@/core/taipei-time';
import type { CreateEventForm, DelegationEntry, EventImageVariants, EventType } from './event-create';
import type { EventDoc } from './types';
import type { CustomRole } from '@/features/profile/data/permissions';
import type { EventFormAddonState } from '../components/event-form/form-types';
import { TEAM_SPLIT_COLORS } from '../components/event-form/TeamJerseyIcon';
import { normalizeEventSocialLinks, normalizeEventSocialUrl } from './event-social-links';
import { getSportKeySafe } from './sports';

/** A `js/config.js#REGION_MAP`：順序（地區與縣市）照 A，表單依此順序顯示。 */
export const REGION_MAP: Readonly<Record<string, readonly string[]>> = {
  '中部': ['台中市', '苗栗縣', '彰化縣', '南投縣', '雲林縣'],
  '北部': ['台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣'],
  '南部': ['高雄市', '台南市', '嘉義市', '嘉義縣', '屏東縣'],
  '東部&外島': ['花蓮縣', '台東縣', '澎湖縣', '金門縣', '連江縣'],
};

export const REGION_KEYS = ['中部', '北部', '南部', '東部&外島'] as const;

/** A `_BASE_ROLES` 的中文名稱；寫進活動 `creator` 欄位的是這個原值，不走翻譯。 */
const BASE_ROLE_LABELS: Readonly<Record<string, string>> = {
  user: '一般用戶',
  coach: '教練',
  captain: '領隊',
  venue_owner: '場主',
  admin: '管理員',
  super_admin: '總管',
};

/**
 * A `_getEventCreatorName()`：有暱稱用暱稱，否則用目前角色名稱（含自訂角色），再不然「一般用戶」。
 * 絕不退回 UID（UID 不得出現在公開欄位，R-SAFE-012）。
 */
export function resolveCreatorName(
  displayName: string | null | undefined,
  role: string,
  customRoles: readonly CustomRole[] = [],
): string {
  // A：`if (user && user.displayName) return user.displayName;`（不 trim）
  if (displayName) return displayName;
  return roleLabelOf(role, customRoles) ?? '一般用戶';
}

/** A `ROLES[role]?.label`：內建角色中文名，或自訂角色 label（缺時用 key）；找不到回 null。 */
export function roleLabelOf(role: string, customRoles: readonly CustomRole[] = []): string | null {
  if (Object.prototype.hasOwnProperty.call(BASE_ROLE_LABELS, role)) return BASE_ROLE_LABELS[role]!;
  // A 的 ROLES Proxy：自訂角色 label 缺時用 key（normalizeCustomRoles）
  const custom = customRoles.find((item) => item.key === role);
  if (custom) return custom.label || custom.key;
  return null;
}

/** A `bindRegionToggle`：只有後台用戶管理／後台入口權限者看得到地區開關，其他人一律開啟。 */
export function canToggleEventRegion(hasPermission: (code: string) => boolean): boolean {
  return hasPermission('admin.users.entry') || hasPermission('admin.entry');
}

/** A `pages/activity.html#ce-type` 的選項與順序：PLAY、教學、觀賽（新表單沒有「友誼」）。 */
export const EVENT_TYPE_OPTIONS: readonly { value: EventType; labelKey: string }[] = [
  { value: 'play', labelKey: 'events.form.typePlay' },
  { value: 'camp', labelKey: 'events.form.typeCamp' },
  { value: 'watch', labelKey: 'events.form.typeWatch' },
];

/** 舊活動可能是 friendly：編輯時保留這個選項，避免下拉選單選不到原值。 */
export const LEGACY_FRIENDLY_TYPE_OPTION = { value: 'friendly' as EventType, labelKey: 'events.form.typeFriendly' };

/** A `_getEventTitleInputLimit` 預設值。 */
export const EVENT_TITLE_LIMIT = 16;

export interface EventFormState extends EventFormAddonState {
  eventId: string | null;
  title: string;
  type: EventType;
  regionEnabled: boolean;
  region: string;
  cities: string[];
  location: string;
  dateVal: string;
  startTime: string;
  endTime: string;
  regOpenEnabled: boolean;
  regOpenDate: string;
  regOpenClock: string;
  regRelDays: string;
  regRelHours: string;
  max: string;
  ageLimitEnabled: boolean;
  minAge: string;
  notes: string;
  sportTag: string;
}

export function createDefaultFormState(_now: Date = new Date()): EventFormState {
  const defaultRegion = '中部';
  const defaultCities = REGION_MAP[defaultRegion] ? [...REGION_MAP[defaultRegion]] : [];
  return {
    eventId: null,
    title: '',
    type: 'play',
    regionEnabled: true,
    region: defaultRegion,
    cities: defaultCities,
    location: '',
    dateVal: '',
    startTime: '14:00',
    endTime: '16:00',
    regOpenEnabled: false,
    regOpenDate: '',
    regOpenClock: '',
    regRelDays: '0',
    regRelHours: '0',
    max: '20',
    ageLimitEnabled: false,
    minAge: '0',
    notes: '',
    sportTag: '',
    feeEnabled: false,
    fee: '0',
    teamOnly: false,
    teamOnlyTeamIds: [],
    genderRestrictionEnabled: false,
    allowedGender: '',
    privateEvent: false,
    teamSplitEnabled: false,
    teamSplitCount: 2,
    teamSplitColorIdx: [0, 1, 2, 3],
    teamSplitBalanceCap: true,
    teamSplitMode: 'random',
    teamSplitLockHours: 2,
    socialLinksEnabled: false,
    socialLinkInputs: [''],
    earlyBirdEnabled: false,
    earlyBirdCost: '10',
    gpsEnabled: false,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseDateField(raw: string | undefined): {
  dateVal: string;
  startTime: string;
  endTime: string;
} {
  if (!raw || typeof raw !== 'string') {
    return { dateVal: '', startTime: '14:00', endTime: '16:00' };
  }
  const trimmed = raw.trim();
  const m = trimmed.match(/^(\d{4})[/-](\d{2})[/-](\d{2})\s+(\d{2}:\d{2})\s*[~～-]\s*(\d{2}:\d{2})$/);
  if (m) {
    return {
      dateVal: `${m[1]}-${m[2]}-${m[3]}`,
      startTime: m[4] ?? '14:00',
      endTime: m[5] ?? '16:00',
    };
  }
  return { dateVal: '', startTime: '14:00', endTime: '16:00' };
}

function parseRegOpenTime(raw: unknown): {
  regOpenEnabled: boolean;
  regOpenDate: string;
  regOpenClock: string;
} {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { regOpenEnabled: false, regOpenDate: '', regOpenClock: '' };
  }
  const str = raw.trim();
  // Try YYYY-MM-DDTHH:mm or ISO
  const localMatch = str.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})$/);
  if (localMatch) {
    return {
      regOpenEnabled: true,
      regOpenDate: localMatch[1] ?? '',
      regOpenClock: localMatch[2] ?? '',
    };
  }
  // 後備不是 datetime-local 純字串。解析與讀欄位必須同一套台北牆鐘，不能只改一半。
  const ms = parseTaipei(str);
  if (ms === null) {
    return { regOpenEnabled: false, regOpenDate: '', regOpenClock: '' };
  }
  const parts = taipeiParts(ms);
  const yyyy = String(parts.year).padStart(4, '0');
  const mm = pad2(parts.month);
  const dd = pad2(parts.day);
  const hh = pad2(parts.hour);
  const min = pad2(parts.minute);
  return {
    regOpenEnabled: true,
    regOpenDate: `${yyyy}-${mm}-${dd}`,
    regOpenClock: `${hh}:${min}`,
  };
}

type ExtendedEventDoc = EventDoc & {
  max?: unknown;
  minAge?: unknown;
  notes?: unknown;
  sportTag?: unknown;
  regOpenTime?: unknown;
  regionEnabled?: unknown;
  region?: unknown;
  cities?: unknown;
};

export function formStateFromEvent(
  event: EventDoc,
  options?: { canUseAddons?: boolean },
): EventFormState {
  const ext = event as ExtendedEventDoc;
  const eventId = event.id ?? event._docId ?? event.docId ?? null;
  const title = typeof event.title === 'string' ? event.title : '';
  const rawType = typeof event.type === 'string' ? event.type : 'play';
  const validTypes: readonly EventType[] = ['friendly', 'single', 'camp', 'play', 'watch'];
  const type: EventType = (validTypes as readonly string[]).includes(rawType)
    ? (rawType as EventType)
    : 'play';

  const regionEnabled = ext.regionEnabled !== undefined ? Boolean(ext.regionEnabled) : Boolean(ext.region);
  const region = typeof ext.region === 'string' ? ext.region : '';
  let cities: string[] = Array.isArray(ext.cities)
    ? ext.cities.filter((c): c is string => typeof c === 'string')
    : [];
  if (regionEnabled && region && cities.length === 0 && REGION_MAP[region]) {
    cities = [...REGION_MAP[region]!];
  }

  const location = typeof event.location === 'string' ? event.location : '';
  const { dateVal, startTime, endTime } = parseDateField(event.date);
  const { regOpenEnabled, regOpenDate, regOpenClock } = parseRegOpenTime(ext.regOpenTime);

  const maxNum = typeof ext.max === 'number' && Number.isFinite(ext.max) ? ext.max : 20;
  const minAgeNum = typeof ext.minAge === 'number' && Number.isFinite(ext.minAge) ? ext.minAge : 0;
  const ageLimitEnabled = minAgeNum > 0;

  const notes = typeof ext.notes === 'string' ? ext.notes : '';
  // 照 A getSportKeySafe。
  const sportTag = getSportKeySafe(ext.sportTag);

  // 照 A openEditEvent：讀取文件與送出表單分開正規化。
  const addons = event as unknown as Record<string, unknown>;
  const rawSplit = addons.teamSplit;
  const split = rawSplit && typeof rawSplit === 'object'
    ? rawSplit as Record<string, unknown>
    : null;
  const teams: unknown[] = Array.isArray(split?.teams) ? split.teams : [];
  const colorIndices = [0, 1, 2, 3];
  teams.forEach((team, index) => {
    if (!team || typeof team !== 'object') return;
    const color = (team as Record<string, unknown>).color;
    const colorIndex = TEAM_SPLIT_COLORS.findIndex(item => item.hex === color);
    if (colorIndex >= 0) colorIndices[index] = colorIndex;
  });
  const links = normalizeEventSocialLinks(addons.socialLinks);
  const rawEarlyBirdCost = Number(addons.earlyBirdCost || 10);
  const earlyBirdCost = Number.isFinite(rawEarlyBirdCost)
    ? Math.max(10, Math.min(500, Math.floor(rawEarlyBirdCost)))
    : 10;
  const creatorTeamIds = Array.isArray(addons.creatorTeamIds)
    ? addons.creatorTeamIds.filter((id): id is string => typeof id === 'string')
    : [];
  const fee = Number(addons.fee || 0);

  return {
    ...createDefaultFormState(),
    eventId,
    title,
    type,
    regionEnabled,
    region: regionEnabled ? region : '',
    cities: regionEnabled ? cities : [],
    location,
    dateVal,
    startTime,
    endTime,
    regOpenEnabled,
    regOpenDate,
    regOpenClock,
    max: String(maxNum),
    ageLimitEnabled,
    minAge: String(ageLimitEnabled ? minAgeNum : 0),
    notes,
    sportTag,
    // A event-manage-lifecycle.js：`this._isEventFeeEnabled?.(e) ?? Number(e?.fee || 0) > 0`，A 並未定義 _isEventFeeEnabled，
    // 實際只看 fee > 0。刻意改良：文件明確 feeEnabled:false 時尊重它（A 會把這種舊資料的收費開關打開、存檔改成 true）；
    // A 建立的活動不會出現 false＋fee>0，正常資料兩者結果相同（PM 查證）。
    feeEnabled: typeof addons.feeEnabled === 'boolean' ? addons.feeEnabled : fee > 0,
    fee: String(fee > 0 ? fee : 0),
    teamOnly: !!addons.teamOnly,
    teamOnlyTeamIds: creatorTeamIds.length
      ? [...creatorTeamIds]
      : typeof addons.creatorTeamId === 'string' && addons.creatorTeamId
        ? [addons.creatorTeamId]
        : [],
    genderRestrictionEnabled: !!addons.genderRestrictionEnabled,
    allowedGender: addons.allowedGender === '男' || addons.allowedGender === '女'
      ? addons.allowedGender
      : '',
    privateEvent: !!addons.privateEvent,
    teamSplitEnabled: !!split?.enabled,
    teamSplitCount: teams.length || 2,
    teamSplitColorIdx: colorIndices,
    teamSplitBalanceCap: split?.balanceCap !== false,
    teamSplitMode: split?.mode === 'self-select' || split?.mode === 'manual'
      ? split.mode
      : 'random',
    teamSplitLockHours: Number(split?.selfSelectLockHours) || 2,
    socialLinksEnabled: !!addons.socialLinksEnabled && links.length > 0,
    socialLinkInputs: links.length ? links.map(link => link.url) : [''],
    earlyBirdEnabled: !!addons.earlyBirdEnabled,
    earlyBirdCost: String(earlyBirdCost),
    gpsEnabled: !!options?.canUseAddons
      && (!!addons.gpsEnabled || addons.mapLocationConfirmed === true),
  };
}

export type ValidateEventFormResult =
  | { ok: true }
  | { ok: false; messageKey: string; params?: Record<string, string | number> }
  | { ok: false; message: string };

export function validateEventForm(
  state: EventFormState,
  now: Date = new Date(),
  // ASSUMPTION: PM 以 options.dates 傳入 hook.dates；既有呼叫不傳時維持單日驗證。
  options?: { canUseAddons?: boolean; dates?: readonly string[] },
): ValidateEventFormResult {
  // 照 A _getEventSocialLinksFormData：先檢查各原始輸入，再正規化及去重。
  if (state.socialLinksEnabled) {
    const values = state.socialLinkInputs.map(value => value.trim()).filter(Boolean);
    if (values.length === 0) {
      return { ok: false, message: '社群連結開啟後，請至少填入 1 個網址' };
    }
    if (values.some(value => !normalizeEventSocialUrl(value))) {
      return { ok: false, message: '社群連結網址格式不正確，請確認後再送出' };
    }
  }

  // 照 A _getEventEarlyBirdFormData：表單取值檢查先於標題及加值權限清除。
  if (state.earlyBirdEnabled) {
    const cost = Number(state.earlyBirdCost);
    if (!Number.isFinite(cost) || cost < 10 || cost > 500) {
      return { ok: false, message: '早鳥報名積分需介於 10～500 分' };
    }
  }

  // 照 A handleCreateEvent：無權限的加值值不參與後續基本欄位驗證。
  const canUseAddons = options?.canUseAddons !== false;
  const title = state.title.trim();
  if (!title) {
    return { ok: false, messageKey: 'events.form.error.titleRequired' };
  }
  if (title.length > EVENT_TITLE_LIMIT) {
    return { ok: false, messageKey: 'events.form.error.titleTooLong', params: { limit: EVENT_TITLE_LIMIT } };
  }

  const location = state.location.trim();
  if (!location) {
    return { ok: false, messageKey: 'events.form.error.locationRequired' };
  }

  // 照 A _isMultiDateMode：編輯模式永遠使用單日。
  const isMultiDate = !state.eventId && (options?.dates?.length ?? 0) >= 2;
  const dates = isMultiDate ? [...(options?.dates ?? [])] : [state.dateVal.trim()];
  const dateVal = dates[0] ?? '';
  if (!dateVal || dates.some(date => !date.trim())) {
    return { ok: false, messageKey: 'events.form.error.dateRequired' };
  }

  const startTime = state.startTime.trim();
  const endTime = state.endTime.trim();
  if (!startTime || !endTime) {
    return { ok: false, messageKey: 'events.form.error.timeRequired' };
  }

  if (state.regOpenEnabled && !isMultiDate) {
    if (!state.regOpenDate.trim() || !state.regOpenClock.trim()) {
      return { ok: false, messageKey: 'events.form.error.regOpenIncomplete' };
    }
  }

  if (canUseAddons && state.earlyBirdEnabled) {
    if (isMultiDate) {
      // 照 A _getRelativeRegOpen：開關關閉時視為 0。
      const days = state.regOpenEnabled ? Number.parseInt(state.regRelDays, 10) || 0 : 0;
      const hours = state.regOpenEnabled ? Number.parseInt(state.regRelHours, 10) || 0 : 0;
      if (!days && !hours) {
        return { ok: false, message: '早鳥報名需先設定活動開始前的開放報名時間' };
      }
    } else {
      const regOpenMs = state.regOpenEnabled
        ? parseTaipei(`${state.regOpenDate.trim()}T${state.regOpenClock.trim()}`)
        : null;
      // null 對應舊的 NaN／非有限數，仍走同一個錯誤訊息，不新增 key。
      if (regOpenMs === null || regOpenMs <= now.getTime()) {
        return { ok: false, message: '早鳥報名需搭配未來的開放報名時間' };
      }
    }
  }

  if (canUseAddons && state.feeEnabled && (Number.parseInt(state.fee, 10) || 0) <= 0) {
    return { ok: false, message: '請輸入活動費用' };
  }

  // 照 A handleCreateEvent：建立時逐場檢查開始時間。
  const timestamps = dates.map(date => ({
    start: parseTaipei(`${date}T${startTime}`) ?? Number.NaN,
    end: parseTaipei(`${date}T${endTime}`) ?? Number.NaN,
  }));
  const isCreate = !state.eventId;
  if (isCreate && timestamps.some(item => Number.isNaN(item.start) || item.start < now.getTime())) {
    return { ok: false, messageKey: 'events.form.error.startInPast' };
  }

  if (timestamps.some(item =>
    Number.isNaN(item.start) || Number.isNaN(item.end) || item.end <= item.start
  )) {
    return { ok: false, messageKey: 'events.form.error.endBeforeStart' };
  }

  if (state.notes.length > 500) {
    return { ok: false, messageKey: 'events.form.error.notesTooLong' };
  }

  if (!state.sportTag.trim()) {
    return { ok: false, messageKey: 'events.form.error.sportRequired' };
  }

  if (canUseAddons && state.genderRestrictionEnabled && !state.allowedGender) {
    return { ok: false, message: '請選擇限定性別' };
  }

  if (state.regionEnabled && !state.region.trim()) {
    return { ok: false, messageKey: 'events.form.error.regionRequired' };
  }

  return { ok: true };
}

/**
 * 照 A `_calcRegOpenForDate`：以 dateVal＋startTime（台北牆鐘）為基準，逐日、逐時往前推，
 * 回傳 `YYYY-MM-DDTHH:mm`。
 * 取代本地 `new Date`＋`setDate`／`setHours`：非 UTC+8 裝置的本地推算會寫出偏移的 regOpenTime。
 * 台北無夏令，減 relDays×24h 與 relHours×1h 與本地逐日逐時等價。
 */
export function calcRegOpenForDate(
  dateVal: string,
  startTime: string,
  relDays: number,
  relHours: number,
): string | null {
  if (relDays === 0 && relHours === 0) return null;
  if (!Number.isInteger(relDays) || !Number.isInteger(relHours)
    || relDays < 0 || relDays > 30 || relHours < 0 || relHours > 23) return null;
  // 未補零（`2026-2-3`）與改前一樣先被正則擋下，不進解析。
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal) || !/^\d{2}:\d{2}$/.test(startTime)) return null;

  const startMs = parseTaipei(`${dateVal}T${startTime}`);
  if (startMs === null) return null;
  // 照本單非法日期契約：parseTaipei 對不存在的日期回 null；再比對補零後的牆鐘字串。
  const parts = taipeiParts(startMs);
  const normalizedDate = `${String(parts.year).padStart(4, '0')}-${pad2(parts.month)}-${pad2(parts.day)}`;
  const normalizedTime = `${pad2(parts.hour)}:${pad2(parts.minute)}`;
  if (normalizedDate !== dateVal || normalizedTime !== startTime) return null;

  const ms = startMs - relDays * 24 * 3_600_000 - relHours * 3_600_000;
  const formatted = formatTaipei(ms, 'YYYY-MM-DDTHH:mm');
  return formatted || null;
}

/** 照 A _buildMultiDateEvents：其他欄位沿用，每場獨立換日期與報名時間。 */
export function buildMultiDateForms(
  base: CreateEventForm,
  dates: readonly string[],
  state: EventFormState,
): CreateEventForm[] {
  const days = Number.parseInt(state.regRelDays, 10) || 0;
  const hours = Number.parseInt(state.regRelHours, 10) || 0;
  return dates.map(dateVal => ({
    ...base,
    dateVal,
    regOpenTime: state.regOpenEnabled
      ? calcRegOpenForDate(dateVal, base.startTime, days, hours)
      : null,
  }));
}

/** A `_regionGetFormData`：關閉送空值；開啟時縣市原樣送出（A 不回填，空縣市由 UI「至少保留一個」避免）。 */
export function resolveRegionPayload(
  regionEnabled: boolean,
  region: string,
  cities: readonly string[],
): { regionEnabled: boolean; region: string; cities: string[] } {
  if (!regionEnabled) {
    return { regionEnabled: false, region: '', cities: [] };
  }
  return {
    regionEnabled: true,
    region: region.trim(),
    cities: [...cities],
  };
}

/** A `_getEventMinAgeFormValue`：Number(value)，有限且 > 0 才取 floor，否則 0。 */
export function parseMinAge(value: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return 0;
  return Math.floor(normalized);
}

export function toCreateEventForm(
  state: EventFormState,
  creatorName: string,
  extras?: {
    image?: string;
    imageVariants?: EventImageVariants;
    delegates?: DelegationEntry[];
    teamOnlySelection?: { ids: string[]; names: string[] };
  },
): CreateEventForm {
  // A：parseInt 是有限數就照用，否則 20。
  const maxParsed = Number.parseInt(state.max, 10);
  const max = Number.isFinite(maxParsed) ? maxParsed : 20;

  const minAge = state.ageLimitEnabled ? parseMinAge(state.minAge) : 0;

  let regOpenTime: string | null = null;
  if (state.regOpenEnabled && state.regOpenDate.trim() && state.regOpenClock.trim()) {
    regOpenTime = `${state.regOpenDate.trim()}T${state.regOpenClock.trim()}`;
  }

  const regionData = resolveRegionPayload(state.regionEnabled, state.region, state.cities);
  const socialLinks = state.socialLinksEnabled
    ? normalizeEventSocialLinks(state.socialLinkInputs.map(url => ({ url })))
    : [];
  const rawEarlyBirdCost = Number(state.earlyBirdCost);
  const earlyBirdCost = Number.isFinite(rawEarlyBirdCost)
    ? Math.max(10, Math.min(500, Math.floor(rawEarlyBirdCost)))
    : 10;
  const creatorTeamIds = state.teamOnly ? [...(extras?.teamOnlySelection?.ids ?? [])] : [];
  const creatorTeamNames = state.teamOnly ? [...(extras?.teamOnlySelection?.names ?? [])] : [];

  // 照 A _tsGetFormData：無效色票索引退回第一色，lockAt 留給資料層計算。
  const teamSplit: CreateEventForm['teamSplit'] = state.teamSplitEnabled
    ? {
      enabled: true,
      mode: state.teamSplitMode,
      balanceCap: state.teamSplitBalanceCap,
      selfSelectLockHours: state.teamSplitMode === 'self-select'
        ? (state.teamSplitLockHours || 2)
        : 0,
      teams: ['A', 'B', 'C', 'D'].slice(0, state.teamSplitCount || 2).map((key, index) => {
        const color = TEAM_SPLIT_COLORS[state.teamSplitColorIdx[index] ?? index]
          ?? TEAM_SPLIT_COLORS[0];
        // ASSUMPTION: 2A 契約固定提供 8 色；缺失時中止，避免寫入錯誤色票。
        if (!color) throw new Error('TEAM_SPLIT_COLORS is empty');
        return { key, color: color.hex, name: color.name };
      }),
    }
    : undefined;

  return {
    title: state.title.trim(),
    type: state.type,
    location: state.location.trim(),
    dateVal: state.dateVal.trim(),
    startTime: state.startTime.trim(),
    endTime: state.endTime.trim(),
    max,
    minAge,
    notes: state.notes.trim(),
    sportTag: getSportKeySafe(state.sportTag),
    regOpenTime,
    image: extras?.image ?? '',
    ...(extras?.imageVariants !== undefined ? { imageVariants: extras.imageVariants } : {}),
    creatorName,
    delegates: extras?.delegates ?? [],
    regionEnabled: regionData.regionEnabled,
    region: regionData.region,
    cities: regionData.cities,
    feeEnabled: state.feeEnabled,
    fee: state.feeEnabled ? (Number.parseInt(state.fee, 10) || 0) : 0,
    teamOnly: state.teamOnly,
    creatorTeamId: creatorTeamIds[0] ?? null,
    creatorTeamName: creatorTeamNames[0] ?? null,
    creatorTeamIds,
    creatorTeamNames,
    genderRestrictionEnabled: state.genderRestrictionEnabled,
    allowedGender: state.genderRestrictionEnabled ? state.allowedGender : '',
    privateEvent: state.privateEvent,
    teamSplit,
    socialLinksEnabled: state.socialLinksEnabled && socialLinks.length > 0,
    socialLinks,
    earlyBirdEnabled: state.earlyBirdEnabled,
    earlyBirdCost: state.earlyBirdEnabled ? earlyBirdCost : 0,
    earlyBirdPolicyVersion: state.earlyBirdEnabled ? 1 : null,
    gpsEnabled: state.gpsEnabled,
  };
}
