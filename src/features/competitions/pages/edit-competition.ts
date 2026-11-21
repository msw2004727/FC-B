// 編輯賽事（站長 11-21：照活動系統，建立與編輯共用建賽精靈同一份表單）。
// 這裡放純函式：讀到的賽事與組別 → 預填表單值、依狀態鎖哪些欄位、後端錯誤欄位 → 畫面欄位。
// 送出只送有變的鍵在 payload.ts#buildUpdateInput；權限與入口在 access.ts#canEditCompetition。

import { shownCover } from '../data/cover';
import type { CompetitionDoc, DivisionDoc } from '../data/types';
import { toDatetimeLocalValue } from '../format';
import type { DivisionDraft, EditDraft, VenueDraft } from '../payload';

/** 編輯頁讀到的資料（報隊管理同一批讀取：賽事根文件＋組別）。 */
export interface EditSource {
  cid: string;
  competition: CompetitionDoc;
  divisions: readonly DivisionDoc[];
  isAdmin: boolean;
}

function venueDraft(venue: CompetitionDoc['venues'][number]): VenueDraft {
  return {
    name: venue.name,
    address: venue.address ?? '',
    ...(venue.lat != null ? { lat: venue.lat } : {}),
    ...(venue.lng != null ? { lng: venue.lng } : {}),
    ...(venue.mapPlaceId ? { mapPlaceId: venue.mapPlaceId } : {}),
    ...(venue.mapProvider ? { mapProvider: venue.mapProvider } : {}),
  };
}

/** 組別文件 → 表單列。年齡沒限制時加減器留建賽預設值（不送）。 */
export function divisionDraft(division: DivisionDoc): DivisionDraft {
  return {
    dvId: division.dvId,
    name: division.name,
    playersOnField: division.playersOnField,
    maxTeams: division.maxTeams,
    rosterMin: division.rosterMin,
    rosterMax: division.rosterMax,
    limitAge: division.minAge != null || division.maxAge != null,
    minAge: division.minAge ?? 8,
    maxAge: division.maxAge ?? 12,
    requireRealName: division.requireRealName,
    feePerTeam: division.feePerTeam,
  };
}

/** 預填值：取消時拿來比對「有沒有改過」，送出時拿來比對要送哪些鍵。 */
export function editDraftOf(source: EditSource): EditDraft & { hostTeamId: string } {
  const c = source.competition;
  return {
    name: c.name,
    category: c.category,
    hostType: c.hostType === 'club' ? 'club' : 'personal',
    hostTeamId: c.hostTeamId ?? '',
    hostDisplay: c.hostDisplay ?? '',
    feeNote: c.feeNote ?? '',
    contactNote: c.contactNote ?? '',
    regOpen: toDatetimeLocalValue(c.regOpenAt),
    regClose: toDatetimeLocalValue(c.regCloseAt),
    firstMatch: toDatetimeLocalValue(c.firstMatchAt),
    lastMatch: toDatetimeLocalValue(c.lastMatchAt),
    venues: c.venues.length > 0 ? c.venues.map(venueDraft) : [{ name: '', address: '' }],
    divisions: source.divisions.map(divisionDraft),
    cover: shownCover(c, source.isAdmin),
  };
}

/** 賽事 id 格式（後端 context.ts CID_RE）。?edit= 不合格直接顯示不能編輯，不拿去讀、也不組網址。 */
export function isCompetitionId(cid: string): boolean {
  return /^cp_[A-Za-z0-9]{20}$/.test(cid);
}

/** 前端先鎖的欄位（後端仍是最後防線）。 */
export interface EditLocks {
  /** 首場已過且不是管理員：四個時間停用（後端 COMPETITION_STARTED）。 */
  times: boolean;
  /** 名單已鎖定：組別只能改名稱，增刪與規則停用（後端 ROSTERS_LOCKED）。 */
  namesOnly: boolean;
  /**
   * 已排賽程：既有場地不能刪、不能改名稱／地址／座標，只能在最後新增（後端 update 不擋）。
   * 場次文件存 venueIdx＋venueName，改期與撞場檢查都用 idx：刪中間場地後面場次會錯位，改名場次仍顯示舊名。
   */
  venues: boolean;
}

/**
 * 這場賽事有沒有已排的場次，不另讀：場次只由 generateSchedule 建立，同一筆交易寫 divisions.schedule（ranking 必填
 * h2hFirst／goalDiffFirst）；clearSchedule 刪場次時同一筆交易刪掉 schedule。所以組別文件 ranking 有值＝這組有場次。
 */
export function hasSchedule(divisions: readonly DivisionDoc[]): boolean {
  return divisions.some((division) => division.ranking != null);
}

export function editLocks(source: EditSource, now: number): EditLocks {
  return {
    times: !source.isAdmin && now >= source.competition.firstMatchAt,
    namesOnly: source.competition.rostersLockedAt != null,
    venues: hasSchedule(source.divisions),
  };
}

/** 這個組別已有報隊（entryCount > 0）：不能刪，人制、年齡、實名、報名費也不能改（後端 DIVISION_HAS_ENTRIES、DIVISION_RULES_LOCKED）。 */
export function divisionTaken(source: EditSource, dvId: string | undefined): DivisionDoc | null {
  if (!dvId) return null;
  const row = source.divisions.find((division) => division.dvId === dvId);
  return row && row.entryCount > 0 ? row : null;
}

/**
 * 後端 update 的欄位 → 畫面欄位（fieldSpot 認得的路徑）。
 * schedule（整段時程）：已開賽落在報名開始（整張時間卡的第一欄）、新賽期沒涵蓋場次落在首場；
 * divisions.N（某一組的規則）落在那一組名稱。divisions（整份清單，例如 ROSTERS_LOCKED、DIVISION_HAS_ENTRIES）不對到
 * 任何一組，照原樣回傳，畫面顯示整頁錯誤（落在第 1 組名稱會誤導成是那一組的問題）。
 */
export function editErrorField(reason: string, field: string | undefined): string | undefined {
  if (field === 'schedule') return reason === 'SCHEDULE_OUT_OF_RANGE' ? 'firstMatchAt' : 'regOpenAt';
  const row = field ? /^divisions\.(\d+)$/.exec(field) : null;
  if (row) return `divisions.${row[1]}.name`;
  return field;
}
