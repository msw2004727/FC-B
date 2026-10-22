import { getFirebase } from '@/data/firebase';
import type { EventType } from './event-create';
import type { EventFormState } from './event-form-model';
import type { EventLocationValue } from '../components/event-form/use-event-location';
import { getSportKeySafe } from './sports';
import { normalizeEventSocialLinks } from './event-social-links';

export const MAX_EVENT_TEMPLATES = 30;

type SocialLinks = ReturnType<typeof normalizeEventSocialLinks>;

export interface EventTemplateDoc {
  id: string;
  name: string;
  title: string;
  type: EventType;
  location: string;
  fee: number;
  feeEnabled?: boolean;
  max: number;
  minAge: number;
  notes: string;
  sportTag: string;
  genderRestrictionEnabled: boolean;
  allowedGender: EventFormState['allowedGender'];
  privateEvent: boolean;
  socialLinksEnabled: boolean;
  socialLinks: SocialLinks;
  earlyBirdEnabled: boolean;
  earlyBirdCost: number;
  regionEnabled: boolean;
  region: string;
  cities: string[];
  image?: string | null;
  gpsEnabled?: boolean;
  lat?: number | null;
  lng?: number | null;
  mapAddress?: string | null;
  mapPlaceId?: string | null;
  mapProvider?: EventLocationValue['mapProvider'];
  mapLocationConfirmed?: boolean;
  mapLocationUpdatedAt?: EventLocationValue['mapLocationUpdatedAt'];
  ownerUid: string;
  ownerName: string;
  _docId: string;
  createdAt: unknown;
  updatedAt: unknown;
  templateType?: string;
}

type TemplateInput = Omit<EventTemplateDoc, '_docId' | 'createdAt' | 'updatedAt'>;
type BuiltTemplate = Omit<TemplateInput, 'ownerUid' | 'ownerName'>;

const LOCATION_KEYS = [
  'gpsEnabled',
  'lat',
  'lng',
  'mapAddress',
  'mapPlaceId',
  'mapProvider',
  'mapLocationConfirmed',
  'mapLocationUpdatedAt',
] as const;

/** 照 A loadMyEventTemplates：Timestamp／日期字串皆可排序。 */
function toMillis(value: unknown): number {
  if (!value) return 0;

  if (
    typeof value === 'object'
    && 'toMillis' in value
    && typeof value.toMillis === 'function'
  ) {
    const result: unknown = value.toMillis();
    return typeof result === 'number' && Number.isFinite(result) ? result : 0;
  }

  if (value instanceof Date) {
    const result = value.getTime();
    return Number.isFinite(result) ? result : 0;
  }

  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : 0;
}

/** 照 A ensureAuthReadyForWrite：寫入前確認 Firebase 登入者。 */
async function requireWriter(ownerUid?: string): Promise<void> {
  // ASSUMPTION: getCurrentUser 已等待 B 的登入初始化；附件只提供其使用方式。
  const { getCurrentUser } = await import('@/data/auth');
  const user = await getCurrentUser();

  if (!user?.uid || (ownerUid !== undefined && user.uid !== ownerUid)) {
    throw new Error('EVENT_TEMPLATE_AUTH_REQUIRED');
  }
}

/**
 * 照 A loadMyEventTemplates；不建立跨帳號快取。
 * includeAllTypes：A 儲存前的 30 組上限用 ApiService.getEventTemplates() 全部本人範本計算（不篩類型），PM 修正。
 */
export async function loadEventTemplates(
  ownerUid: string,
  options: { includeAllTypes?: boolean } = {},
): Promise<EventTemplateDoc[]> {
  if (!ownerUid || ownerUid === 'unknown') return [];

  const [{ collection, query, where, limit, getDocs }, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  const snapshot = await getDocs(query(
    collection(db, 'eventTemplates'),
    where('ownerUid', '==', ownerUid),
    limit(100),
  ));

  return snapshot.docs
    .map((document) => ({
      ...document.data(),
      _docId: document.id,
    } as EventTemplateDoc))
    .filter((template) => options.includeAllTypes || (
      !template.templateType
      || template.templateType === 'event'
      || template.templateType === 'normal'
    ))
    .sort((a, b) => (
      (toMillis(b.updatedAt) || toMillis(b.createdAt))
      - (toMillis(a.updatedAt) || toMillis(a.createdAt))
    ));
}

/** 照 A addEventTemplate；明列允許寫入欄位，避免表單一次性欄位滲入。 */
export async function saveEventTemplate(input: {
  template: TemplateInput;
  ownerUid: string;
  ownerName: string;
}): Promise<EventTemplateDoc> {
  await requireWriter(input.ownerUid);

  const template = input.template;
  const writeData: TemplateInput = {
    id: template.id,
    name: template.name,
    title: template.title,
    type: template.type,
    location: template.location,
    fee: template.fee,
    max: template.max,
    minAge: template.minAge,
    notes: template.notes,
    sportTag: template.sportTag,
    genderRestrictionEnabled: template.genderRestrictionEnabled,
    allowedGender: template.allowedGender,
    privateEvent: template.privateEvent,
    socialLinksEnabled: template.socialLinksEnabled,
    socialLinks: normalizeEventSocialLinks(template.socialLinks),
    earlyBirdEnabled: template.earlyBirdEnabled,
    earlyBirdCost: template.earlyBirdCost,
    regionEnabled: template.regionEnabled,
    region: template.region,
    cities: [...template.cities],
    ownerUid: input.ownerUid,
    ownerName: input.ownerName,
  };

  if (template.feeEnabled !== undefined) writeData.feeEnabled = template.feeEnabled;
  if (template.image !== undefined) writeData.image = template.image;
  if (template.templateType !== undefined) writeData.templateType = template.templateType;

  // 照 A _buildEventLocationTemplatePayload：旗標關閉時完全不寫地圖欄位。
  for (const key of LOCATION_KEYS) {
    const value = template[key];
    if (value !== undefined) Object.assign(writeData, { [key]: value });
  }

  if (writeData.image?.startsWith('data:')) {
    let uploaded: string | null = null;
    try {
      const { uploadImageDataUrl } = await import('./event-cover-upload');
      uploaded = await uploadImageDataUrl(
        writeData.image,
        `eventTemplates/${input.ownerUid || template.id}`,
      );
    } catch {
      // 照 A addEventTemplate：上傳失敗仍儲存文字欄位。
    }

    if (uploaded) writeData.image = uploaded;
    else delete writeData.image;
  }

  // 上傳期間可能切換帳號，送出 Firestore 寫入前再驗一次。
  await requireWriter(input.ownerUid);

  const [{ collection, addDoc, serverTimestamp }, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  const createdAt = serverTimestamp();
  const updatedAt = serverTimestamp();

  const reference = await addDoc(collection(db, 'eventTemplates'), {
    ...writeData,
    createdAt,
    updatedAt,
  });

  return {
    ...writeData,
    _docId: reference.id,
    createdAt,
    updatedAt,
  };
}

/** 照 A deleteEventTemplate：文件鍵只使用 _docId。 */
export async function deleteEventTemplate(template: EventTemplateDoc): Promise<void> {
  if (!template._docId) throw new Error('EVENT_TEMPLATE_NOT_FOUND');
  await requireWriter();

  const [{ doc, deleteDoc }, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  await deleteDoc(doc(db, 'eventTemplates', template._docId));
}

/** 照 A _buildCurrentTemplate。 */
export function buildTemplateFromForm(input: {
  name: string;
  state: EventFormState;
  image: string | null;
  location: EventLocationValue;
  canUseAddons: boolean;
  generateId(prefix: string): string;
  now: Date;
}): BuiltTemplate {
  const { state, location, canUseAddons } = input;
  const feeEnabled = canUseAddons && state.feeEnabled;
  const genderRestrictionEnabled = canUseAddons && state.genderRestrictionEnabled;
  const socialLinksEnabled = canUseAddons && state.socialLinksEnabled;
  const earlyBirdEnabled = canUseAddons && state.earlyBirdEnabled;

  // ASSUMPTION: 未附 A 社群 getter；沿用 B 既有正規化函式及字串輸入陣列。
  const socialLinks = socialLinksEnabled
    ? normalizeEventSocialLinks(state.socialLinkInputs)
    : normalizeEventSocialLinks([]);

  // ASSUMPTION: 未附 A 年齡／早鳥 getter；依表單開關及非負整數還原。
  const minAge = state.ageLimitEnabled
    ? Math.max(0, Number.parseInt(state.minAge, 10) || 0)
    : 0;
  const earlyBirdCost = earlyBirdEnabled
    ? Math.max(0, Number.parseInt(state.earlyBirdCost, 10) || 10)
    : 0;

  const result: BuiltTemplate = {
    id: input.generateId('tpl_'),
    name: input.name.trim(),
    title: state.title.trim(),
    type: state.type || 'play',
    location: state.location.trim(),
    fee: feeEnabled ? Number.parseInt(state.fee, 10) || 0 : 0,
    feeEnabled,
    max: Number.parseInt(state.max, 10) || 20,
    minAge,
    notes: state.notes.trim(),
    sportTag: getSportKeySafe(state.sportTag || '') || '',
    genderRestrictionEnabled,
    allowedGender: genderRestrictionEnabled ? state.allowedGender : '',
    privateEvent: canUseAddons && state.privateEvent,
    socialLinksEnabled,
    socialLinks,
    earlyBirdEnabled,
    earlyBirdCost,
    regionEnabled: state.regionEnabled,
    region: state.region,
    cities: [...state.cities],
    image: input.image || null,
  };

  if (!location.mapPickerEnabled) return result;

  // ASSUMPTION: collect 的 EventLocationValue 已清除文字異動後的過期定位；
  // 寫死介面沒有 sourceLocationText，這裡無法再次比較草稿來源文字。
  const gpsEnabled = canUseAddons && location.gpsEnabled;
  const pointValid = (
    typeof location.lat === 'number'
    && Number.isFinite(location.lat)
    && Math.abs(location.lat) <= 90
    && typeof location.lng === 'number'
    && Number.isFinite(location.lng)
    && Math.abs(location.lng) <= 180
  );
  const confirmed = gpsEnabled && location.mapLocationConfirmed && pointValid;

  return {
    ...result,
    gpsEnabled,
    lat: confirmed ? location.lat : null,
    lng: confirmed ? location.lng : null,
    mapAddress: confirmed ? location.mapAddress || result.location || null : null,
    mapPlaceId: confirmed ? location.mapPlaceId || null : null,
    mapProvider: confirmed ? location.mapProvider || 'manual' : null,
    mapLocationConfirmed: confirmed,
    mapLocationUpdatedAt: confirmed
      ? location.mapLocationUpdatedAt || input.now.toISOString()
      : null,
  };
}

/** 照 A _loadEventTemplate；一次性欄位不產生 patch。 */
export function templateToFormPatch(
  template: EventTemplateDoc,
  canUseAddons: boolean,
): {
  patch: Partial<EventFormState>;
  image: string | null;
  locationTemplate: Record<string, unknown> | null;
  upsell: boolean;
} {
  const templateGpsEnabled = !!template.gpsEnabled || template.mapLocationConfirmed === true;
  const feeEnabled = typeof template.feeEnabled === 'boolean'
    ? template.feeEnabled
    : Number(template.fee || 0) > 0;
  const minAge = Number(template.minAge || 0);

  const patch: Partial<EventFormState> = {
    gpsEnabled: canUseAddons && templateGpsEnabled,
    feeEnabled: canUseAddons && feeEnabled,
    fee: String(canUseAddons && Number(template.fee || 0) > 0 ? template.fee : 0),
    ageLimitEnabled: minAge > 0,
    minAge: String(minAge),
    sportTag: template.sportTag || '',
    genderRestrictionEnabled: canUseAddons && !!template.genderRestrictionEnabled,
    allowedGender: canUseAddons ? template.allowedGender || '' : '',
    privateEvent: canUseAddons && !!template.privateEvent,
    socialLinksEnabled: canUseAddons && !!template.socialLinksEnabled,
    // 照 A _setEventSocialLinksFormData：輸入框為各筆 url；沒有時保留一個空列（PM 修正：normalize 回傳物件）。
    socialLinkInputs: (() => {
      const urls = canUseAddons ? normalizeEventSocialLinks(template.socialLinks || []).map((link) => link.url) : [];
      return urls.length > 0 ? urls : [''];
    })(),
    earlyBirdEnabled: canUseAddons && !!template.earlyBirdEnabled,
    earlyBirdCost: String(canUseAddons ? template.earlyBirdCost || 10 : 10),
    regionEnabled: template.regionEnabled !== false,
    region: template.region || '',
    cities: [...(template.cities || [])],
  };

  // 照 A setVal：空字串、null、undefined 不覆寫現有值。
  if (template.title !== undefined && template.title !== null && template.title !== '') {
    patch.title = template.title;
  }
  if (template.type !== undefined && template.type !== null && (template.type as string) !== '') {
    patch.type = template.type;
  }
  if (template.location !== undefined && template.location !== null && template.location !== '') {
    patch.location = template.location;
  }
  if (template.notes !== undefined && template.notes !== null && template.notes !== '') {
    patch.notes = template.notes;
  }
  if (template.max !== undefined && template.max !== null) {
    patch.max = String(template.max);
  }

  return {
    patch,
    // 照 A：沒有範本圖片時回 null；接線端必須保留目前封面。
    image: template.image || null,
    locationTemplate: canUseAddons && templateGpsEnabled
      ? {
        location: template.location,
        gpsEnabled: template.gpsEnabled,
        lat: template.lat,
        lng: template.lng,
        mapAddress: template.mapAddress,
        mapPlaceId: template.mapPlaceId,
        mapProvider: template.mapProvider,
        mapLocationConfirmed: template.mapLocationConfirmed,
        mapLocationUpdatedAt: template.mapLocationUpdatedAt,
      }
      : { location: template.location, mapLocationConfirmed: false },
    upsell: !canUseAddons && !!(
      template.feeEnabled
      || Number(template.fee || 0) > 0
      || template.genderRestrictionEnabled
      || template.privateEvent
      || template.socialLinksEnabled
      || template.earlyBirdEnabled
      || templateGpsEnabled
    ),
  };
}
