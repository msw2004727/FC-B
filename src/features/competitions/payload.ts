// 送出欄位只含契約列出的鍵。多送一鍵伺服器回 UNKNOWN_FIELD。
// undefined 的選填欄不放進物件（呼叫端的 payload() 也會略過，這裡先不產生）。

import { coverInput } from './data/cover';
import { fromDatetimeLocalValue } from './format';
import type {
  CpAddRosterByRepInput,
  CpHostCreateInput,
  CpHostUpdateInput,
  CpJoinRosterInput,
  CpRegisterEntryInput,
  CpReportInput,
  CpReviewEntryInput,
} from './data/cp-callables';
import type { CompetitionCategory, CompetitionCover, DivisionInput, PaymentStatusWrite, ReportReason, RosterPositionCode, Venue } from './data/types';

export type PositionChoice = 'none' | RosterPositionCode;

export interface VenueDraft {
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  mapPlaceId?: string;
  mapProvider?: 'google' | 'manual';
}

export interface DivisionDraft {
  /** 編輯既有組別才有（送出時保留，後端據此更新而不是新增）。建立時沒有。 */
  dvId?: string;
  name: string;
  playersOnField: 5 | 7 | 8 | 9 | 11;
  maxTeams: number;
  rosterMin: number;
  rosterMax: number;
  limitAge: boolean;
  minAge: number;
  maxAge: number;
  requireRealName: boolean;
  feePerTeam: number;
}

export interface WizardDraft {
  name: string;
  category: CompetitionCategory;
  hostType: 'personal' | 'club';
  hostTeamId: string;
  hostDisplay: string;
  feeNote: string;
  regOpenAt: number;
  regCloseAt: number;
  firstMatchAt: number;
  lastMatchAt: number;
  venues: VenueDraft[];
  divisions: DivisionDraft[];
  /** 公開聯絡文字。空白不送。 */
  contactNote?: string;
  /** 已上傳好的封面；沒選是 null／省略，這時 payload 不帶 cover 鍵（舊 cpHost 會回 UNKNOWN_FIELD）。 */
  cover?: CompetitionCover | null;
}

function venueOf(draft: VenueDraft): Venue {
  const venue: Venue = { name: draft.name.trim() };
  const address = draft.address.trim();
  if (address) venue.address = address;
  // 後端 venuesOf：沒有座標卻帶地點編號或地圖來源，回 FIELD_REQUIRED（venues.N.lat）。
  // 只手打地址時畫面會把來源標成 manual，所以地點編號與來源只跟著座標一起送（11-21 站長建賽被擋的根因）。
  if (draft.lat != null && draft.lng != null && Number.isFinite(draft.lat) && Number.isFinite(draft.lng)) {
    venue.lat = draft.lat;
    venue.lng = draft.lng;
    const place = draft.mapPlaceId?.trim();
    if (place) venue.mapPlaceId = place;
    if (draft.mapProvider) venue.mapProvider = draft.mapProvider;
  }
  return venue;
}

function divisionOf(draft: DivisionDraft): DivisionInput {
  const fee = Math.trunc(Number.isFinite(draft.feePerTeam) ? draft.feePerTeam : 0);
  const row: DivisionInput = {
    name: draft.name.trim(),
    playersOnField: draft.playersOnField,
    maxTeams: draft.maxTeams,
    rosterMin: draft.rosterMin,
    rosterMax: draft.rosterMax,
    requireRealName: draft.requireRealName,
    feePerTeam: fee > 0 ? fee : 0,
  };
  if (draft.limitAge) {
    row.minAge = draft.minAge;
    row.maxAge = draft.maxAge;
  }
  return row;
}

/** 個人不送 hostTeamId／feeNote；俱樂部不送 hostDisplay。liveLinks 這期畫面沒有，送空陣列。 */
export function buildCreateInput(draft: WizardDraft): CpHostCreateInput {
  const contactNote = draft.contactNote?.trim() ?? '';
  const common = {
    name: draft.name.trim(),
    sport: 'football' as const,
    timezone: 'Asia/Taipei' as const,
    regOpenAt: draft.regOpenAt,
    regCloseAt: draft.regCloseAt,
    firstMatchAt: draft.firstMatchAt,
    lastMatchAt: draft.lastMatchAt,
    venues: draft.venues.map(venueOf),
    liveLinks: [] as string[],
    divisions: draft.divisions.map(divisionOf),
    category: draft.category,
    ...(contactNote ? { contactNote } : {}),
    ...(draft.cover ? { cover: coverInput(draft.cover) } : {}),
  };
  if (draft.hostType === 'club') {
    const feeNote = draft.feeNote.trim();
    return feeNote
      ? { ...common, hostType: 'club', hostTeamId: draft.hostTeamId, feeNote }
      : { ...common, hostType: 'club', hostTeamId: draft.hostTeamId };
  }
  // 個人主辦不送 hostDisplay。後端用主站顯示名，並自己處理長度與禁用字。
  // 報名費只限俱樂部主辦（顧問 §3.257）：個人主辦一律送 0
  return { ...common, hostType: 'personal', divisions: common.divisions.map((d) => ({ ...d, feePerTeam: 0 })) };
}

/** 編輯賽事比對用的表單值（建賽精靈同一份表單）。時間是 datetime-local 字串。 */
export interface EditDraft {
  name: string;
  category: CompetitionCategory;
  hostType: 'personal' | 'club';
  /** 個人主辦的顯示名稱；俱樂部主辦不送。 */
  hostDisplay: string;
  feeNote: string;
  contactNote: string;
  regOpen: string;
  regClose: string;
  firstMatch: string;
  lastMatch: string;
  venues: VenueDraft[];
  divisions: DivisionDraft[];
  cover: CompetitionCover | null;
}

function divisionRow(draft: DivisionDraft, club: boolean): DivisionInput {
  // 報名費只限俱樂部主辦（同 buildCreateInput）：個人主辦一律 0
  return { ...(draft.dvId ? { dvId: draft.dvId } : {}), ...divisionOf(draft), ...(club ? {} : { feePerTeam: 0 }) };
}

const coverKey = (cover: CompetitionCover | null): string => (cover ? `${cover.url} ${cover.thumb} ${cover.card ?? ''}` : '');

/**
 * 編輯賽事只送有變的鍵（後端 updateCompetition 的 UPDATE_KEYS）；完全沒變回 null，不打後端。
 * 四個時間任一個變就四個一起送（後端 SCHEDULE_ALL_REQUIRED）；組別有變送完整清單並保留 dvId（清單外＝刪除）。
 * 前提：呼叫前已過 step1Problem（時間都解析得了）；解析不了的時間不送。
 */
export function buildUpdateInput(cid: string, before: EditDraft, after: EditDraft): CpHostUpdateInput | null {
  const out: CpHostUpdateInput = { cid };
  const club = after.hostType === 'club';
  const name = after.name.trim();
  if (name !== before.name.trim()) out.name = name;
  if (after.category !== before.category) out.category = after.category;
  if (!club) {
    const hostDisplay = after.hostDisplay.trim();
    if (hostDisplay !== before.hostDisplay.trim()) out.hostDisplay = hostDisplay;
  } else {
    const feeNote = after.feeNote.trim();
    if (feeNote !== before.feeNote.trim()) out.feeNote = feeNote;
  }
  const contactNote = after.contactNote.trim();
  if (contactNote !== before.contactNote.trim()) out.contactNote = contactNote || null;
  const times = [after.regOpen, after.regClose, after.firstMatch, after.lastMatch];
  const oldTimes = [before.regOpen, before.regClose, before.firstMatch, before.lastMatch];
  if (times.some((value, i) => value !== oldTimes[i])) {
    const [regOpenAt, regCloseAt, firstMatchAt, lastMatchAt] = times.map(fromDatetimeLocalValue);
    if (regOpenAt != null && regCloseAt != null && firstMatchAt != null && lastMatchAt != null) {
      out.schedule = { regOpenAt, regCloseAt, firstMatchAt, lastMatchAt };
    }
  }
  const venues = after.venues.map(venueOf);
  if (JSON.stringify(venues) !== JSON.stringify(before.venues.map(venueOf))) out.venues = venues;
  const divisions = after.divisions.map((row) => divisionRow(row, club));
  if (JSON.stringify(divisions) !== JSON.stringify(before.divisions.map((row) => divisionRow(row, club)))) out.divisions = divisions;
  if (coverKey(after.cover) !== coverKey(before.cover)) {
    out.cover = after.cover ? coverInput(after.cover) : null;
  }
  return Object.keys(out).length > 1 ? out : null;
}

function positionFields(choice: PositionChoice, positionText: string): {
  position?: RosterPositionCode;
  positionText?: string;
} {
  if (choice === 'none') return {};
  if (choice === 'custom') {
    const text = positionText.trim();
    return text ? { position: 'custom', positionText: text } : { position: 'custom' };
  }
  return { position: choice };
}

export interface JoinDraft {
  cid: string;
  enId: string;
  number: number;
  position: PositionChoice;
  positionText: string;
  minor: boolean;
  nickname: string;
  realName: string;
  guardianConsent: boolean;
}

export function buildJoinInput(draft: JoinDraft): CpJoinRosterInput {
  const base: CpJoinRosterInput = {
    cid: draft.cid,
    enId: draft.enId,
    number: draft.number,
    ...positionFields(draft.position, draft.positionText),
    privacyAck: true,
  };
  if (draft.minor) {
    // 未成年公開名由後端遮字，不送 publicName、不送暱稱。
    const realName = draft.realName.trim();
    return {
      ...base,
      ...(realName ? { realName } : {}),
      ...(draft.guardianConsent ? { guardianConsent: true } : {}),
    };
  }
  // 成年公開名仍是暱稱或主站顯示名。真名只在有填時才送（組別不要求時呼叫端傳空字串）。
  const nickname = draft.nickname.trim();
  const realName = draft.realName.trim();
  return {
    ...base,
    ...(nickname ? { nickname } : {}),
    ...(realName ? { realName } : {}),
  };
}

export interface AddDraft extends JoinDraft {
  birthday: string;
}

export function buildAddInput(draft: AddDraft): CpAddRosterByRepInput {
  const joined = buildJoinInput({
    ...draft,
    nickname: draft.minor ? '' : draft.nickname,
    guardianConsent: draft.minor ? draft.guardianConsent : false,
  });
  return {
    ...joined,
    realName: draft.realName.trim(),
    birthday: draft.birthday.trim(),
  };
}

export function buildRegisterInput(input: {
  cid: string;
  dvId: string;
  teamId: string;
}): CpRegisterEntryInput {
  return { cid: input.cid, dvId: input.dvId, teamId: input.teamId };
}

export function buildReviewInput(input: {
  cid: string;
  enId: string;
  decision: 'approve' | 'reject';
  reason?: string;
}): CpReviewEntryInput {
  if (input.decision === 'reject') {
    return { cid: input.cid, enId: input.enId, decision: 'reject', reason: (input.reason ?? '').trim() };
  }
  return { cid: input.cid, enId: input.enId, decision: 'approve' };
}

export function buildReportInput(input: {
  cid: string;
  reason: ReportReason;
  detail: string;
}): CpReportInput {
  const detail = input.detail.trim();
  if (input.reason === 'other') return { cid: input.cid, reason: 'other', detail };
  return detail ? { cid: input.cid, reason: input.reason, detail } : { cid: input.cid, reason: input.reason };
}

export function buildPaymentInput(input: {
  cid: string;
  enId: string;
  paid: boolean;
}): { cid: string; enId: string; paymentStatus: PaymentStatusWrite } {
  return { cid: input.cid, enId: input.enId, paymentStatus: input.paid ? 'paid' : 'none' };
}
