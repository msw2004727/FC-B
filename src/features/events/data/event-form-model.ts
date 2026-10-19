import type { CreateEventForm, EventType } from './event-create';
import type { EventDoc } from './types';
import type { CustomRole } from '@/features/profile/data/permissions';

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
  if (Object.prototype.hasOwnProperty.call(BASE_ROLE_LABELS, role)) return BASE_ROLE_LABELS[role]!;
  // A 的 ROLES Proxy：自訂角色 label 缺時用 key（normalizeCustomRoles）
  const custom = customRoles.find((item) => item.key === role);
  if (custom) return custom.label || custom.key;
  return '一般用戶';
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

export interface EventFormState {
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
    max: '20',
    ageLimitEnabled: false,
    minAge: '0',
    notes: '',
    sportTag: '',
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
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) {
    return { regOpenEnabled: false, regOpenDate: '', regOpenClock: '' };
  }
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const min = pad2(d.getMinutes());
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

export function formStateFromEvent(event: EventDoc): EventFormState {
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
  const sportTag = typeof ext.sportTag === 'string' ? ext.sportTag.trim() : '';

  return {
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
  };
}

export type ValidateEventFormResult =
  | { ok: true }
  | { ok: false; messageKey: string; params?: Record<string, string | number> };

export function validateEventForm(
  state: EventFormState,
  now: Date = new Date(),
): ValidateEventFormResult {
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

  const dateVal = state.dateVal.trim();
  if (!dateVal) {
    return { ok: false, messageKey: 'events.form.error.dateRequired' };
  }

  const startTime = state.startTime.trim();
  const endTime = state.endTime.trim();
  if (!startTime || !endTime) {
    return { ok: false, messageKey: 'events.form.error.timeRequired' };
  }

  if (state.regOpenEnabled) {
    if (!state.regOpenDate.trim() || !state.regOpenClock.trim()) {
      return { ok: false, messageKey: 'events.form.error.regOpenIncomplete' };
    }
  }

  const startTimestamp = new Date(`${dateVal}T${startTime}`);
  const endTimestamp = new Date(`${dateVal}T${endTime}`);

  const isCreate = !state.eventId;
  if (isCreate) {
    if (
      Number.isNaN(startTimestamp.getTime()) ||
      startTimestamp.getTime() < now.getTime()
    ) {
      return { ok: false, messageKey: 'events.form.error.startInPast' };
    }
  }

  if (
    Number.isNaN(startTimestamp.getTime()) ||
    Number.isNaN(endTimestamp.getTime()) ||
    endTimestamp.getTime() <= startTimestamp.getTime()
  ) {
    return { ok: false, messageKey: 'events.form.error.endBeforeStart' };
  }

  if (state.notes.length > 500) {
    return { ok: false, messageKey: 'events.form.error.notesTooLong' };
  }

  if (!state.sportTag.trim()) {
    return { ok: false, messageKey: 'events.form.error.sportRequired' };
  }

  if (state.regionEnabled && !state.region.trim()) {
    return { ok: false, messageKey: 'events.form.error.regionRequired' };
  }

  return { ok: true };
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
    sportTag: state.sportTag.trim(),
    regOpenTime,
    image: '',
    creatorName,
    delegates: [],
    regionEnabled: regionData.regionEnabled,
    region: regionData.region,
    cities: regionData.cities,
    feeEnabled: false,
    fee: 0,
    teamOnly: false,
    creatorTeamId: null,
    creatorTeamName: null,
    creatorTeamIds: [],
    creatorTeamNames: [],
    genderRestrictionEnabled: false,
    allowedGender: '',
    privateEvent: false,
    socialLinksEnabled: false,
    socialLinks: [],
    earlyBirdEnabled: false,
    earlyBirdCost: 0,
    earlyBirdPolicyVersion: null,
  };
}
