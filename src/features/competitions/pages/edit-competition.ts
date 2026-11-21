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

/** 前端先鎖的欄位（後端仍是最後防線）。 */
export interface EditLocks {
  /** 首場已過且不是管理員：四個時間停用（後端 COMPETITION_STARTED）。 */
  times: boolean;
  /** 名單已鎖定：組別只能改名稱，增刪與規則停用（後端 ROSTERS_LOCKED）。 */
  namesOnly: boolean;
}

export function editLocks(source: EditSource, now: number): EditLocks {
  return {
    times: !source.isAdmin && now >= source.competition.firstMatchAt,
    namesOnly: source.competition.rostersLockedAt != null,
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
 * divisions（整份清單）落在第一組名稱；divisions.N（某一組的規則）落在那一組名稱。
 */
export function editErrorField(reason: string, field: string | undefined): string | undefined {
  if (field === 'schedule') return reason === 'SCHEDULE_OUT_OF_RANGE' ? 'firstMatchAt' : 'regOpenAt';
  if (field === 'divisions') return 'divisions.0.name';
  const row = field ? /^divisions\.(\d+)$/.exec(field) : null;
  if (row) return `divisions.${row[1]}.name`;
  return field;
}
