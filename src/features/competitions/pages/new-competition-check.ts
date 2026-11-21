// 建賽精靈每一步的欄位檢查。條件照後端 functions-cp（validate.ts、text.ts、host.ts createCompetition）：
// 文字先 NFKC、去不可見字元、壓空白再以碼位數長度；時間先後、長度上限與「首場須晚於現在」也照抄。
// 回第一個有問題的欄位（畫面由上到下的順序），field 用後端 params.field 的同一套路徑。

import { cleanLine } from '../data/names';
import { fromDatetimeLocalValue } from '../format';
import type { DivisionDraft, VenueDraft } from '../payload';

export interface FieldProblem {
  field: string;
  reason: string;
  params?: Record<string, unknown>;
}

export interface CheckForm {
  name: string;
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

const DAY = 86_400_000;
const TIME_MIN = 1_577_836_800_000; // 2020-01-01
const TIME_MAX = 4_102_444_800_000; // 2100-01-01

function lineLen(value: string): number {
  return [...(cleanLine(value) ?? '')].length;
}

/** 後端 optionalText：保留換行，其餘同單行清理。 */
function textLen(value: string): number {
  const s = value.normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿ᅟᅠㅤﾠ⠀]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return [...s].length;
}

function lineProblem(value: string, field: string, min: number, max: number): FieldProblem | null {
  const len = lineLen(value);
  if (len === 0) return { field, reason: 'FIELD_REQUIRED' };
  if (len < min || len > max) return { field, reason: 'FIELD_LENGTH', params: { min, max } };
  return null;
}

function intProblem(value: number, field: string, min: number, max: number): FieldProblem | null {
  if (!Number.isInteger(value) || value < min || value > max) return { field, reason: 'FIELD_RANGE', params: { min, max } };
  return null;
}

function timesProblem(form: CheckForm, now: number): FieldProblem | null {
  const rows = [
    ['regOpenAt', form.regOpen],
    ['regCloseAt', form.regClose],
    ['firstMatchAt', form.firstMatch],
    ['lastMatchAt', form.lastMatch],
  ] as const;
  const at: number[] = [];
  for (const [field, raw] of rows) {
    if (!raw.trim()) return { field, reason: 'FIELD_REQUIRED' };
    const ms = fromDatetimeLocalValue(raw);
    if (ms == null || ms < TIME_MIN || ms > TIME_MAX) return { field, reason: 'FIELD_TIME' };
    at.push(ms);
  }
  const [regOpenAt = 0, regCloseAt = 0, firstMatchAt = 0, lastMatchAt = 0] = at;
  if (!(regOpenAt < regCloseAt)) return { field: 'regCloseAt', reason: 'SCHEDULE_ORDER' };
  if (!(regCloseAt <= firstMatchAt)) return { field: 'firstMatchAt', reason: 'SCHEDULE_ORDER' };
  if (!(firstMatchAt <= lastMatchAt)) return { field: 'lastMatchAt', reason: 'SCHEDULE_ORDER' };
  if (regCloseAt - regOpenAt > 120 * DAY) return { field: 'regCloseAt', reason: 'SCHEDULE_SPAN', params: { max: 120 } };
  if (lastMatchAt - firstMatchAt > 180 * DAY) return { field: 'lastMatchAt', reason: 'SCHEDULE_SPAN', params: { max: 180 } };
  if (lastMatchAt > now + 730 * DAY) return { field: 'lastMatchAt', reason: 'SCHEDULE_TOO_FAR' };
  // 後端建立草稿不擋，但發布時 publishCompetition 回 REG_CLOSED：精靈建好就發布，報名截止已過等於發布不了，先在第 1 步擋。
  if (regCloseAt <= now) return { field: 'regCloseAt', reason: 'REG_CLOSED' };
  if (firstMatchAt <= now) return { field: 'firstMatchAt', reason: 'SCHEDULE_PAST' };
  return null;
}

/** 第 1 步：賽事名稱、俱樂部、繳費說明、聯絡文字、四個時間、場地。 */
export function step1Problem(form: CheckForm, now: number): FieldProblem | null {
  const name = lineProblem(form.name, 'name', 2, 60);
  if (name) return name;
  if (form.hostType === 'club' && !form.hostTeamId) return { field: 'hostTeamId', reason: 'FIELD_REQUIRED' };
  if (form.hostType === 'club' && textLen(form.feeNote) > 500) {
    return { field: 'feeNote', reason: 'FIELD_LENGTH', params: { min: 0, max: 500 } };
  }
  if (/[\r\n]/.test(form.contactNote)) return { field: 'contactNote', reason: 'FIELD_FORMAT' };
  if (lineLen(form.contactNote) > 60) return { field: 'contactNote', reason: 'FIELD_LENGTH', params: { min: 0, max: 60 } };
  const times = timesProblem(form, now);
  if (times) return times;
  if (form.venues.length < 1 || form.venues.length > 10) return { field: 'venues', reason: 'FIELD_RANGE', params: { min: 1, max: 10 } };
  for (const [i, venue] of form.venues.entries()) {
    const venueName = lineProblem(venue.name, `venues.${i}.name`, 1, 40);
    if (venueName) return venueName;
    if (lineLen(venue.address) > 100) return { field: `venues.${i}.address`, reason: 'FIELD_LENGTH', params: { min: 0, max: 100 } };
  }
  return null;
}

/** 第 2 步：每個組別的名稱（不可重複）、隊數、名單人數、年齡、報名費。 */
export function step2Problem(form: CheckForm): FieldProblem | null {
  if (form.divisions.length < 1 || form.divisions.length > 8) {
    return { field: 'divisions', reason: 'FIELD_RANGE', params: { min: 1, max: 8 } };
  }
  const seen = new Set<string>();
  for (const [i, d] of form.divisions.entries()) {
    const p = `divisions.${i}`;
    const name = lineProblem(d.name, `${p}.name`, 1, 30);
    if (name) return name;
    const key = cleanLine(d.name) ?? '';
    if (seen.has(key)) return { field: `${p}.name`, reason: 'DIVISION_NAME_DUPLICATE' };
    seen.add(key);
    const range = intProblem(d.maxTeams, `${p}.maxTeams`, 2, 64)
      ?? intProblem(d.rosterMax, `${p}.rosterMax`, d.playersOnField, 40)
      ?? intProblem(d.rosterMin, `${p}.rosterMin`, 1, d.rosterMax);
    if (range) return range;
    if (d.limitAge) {
      const age = intProblem(d.minAge, `${p}.minAge`, 3, 99) ?? intProblem(d.maxAge, `${p}.maxAge`, 3, 99);
      if (age) return age;
      if (d.minAge > d.maxAge) return { field: `${p}.maxAge`, reason: 'FIELD_RANGE', params: { min: d.minAge, max: 99 } };
    }
    if (form.hostType === 'club') {
      const fee = intProblem(d.feePerTeam, `${p}.feePerTeam`, 0, 1_000_000);
      if (fee) return fee;
    }
  }
  return null;
}

/**
 * 後端的欄位路徑 → 畫面上的欄位。地圖座標、地點編號、地圖來源都落在那個場地的地址欄（選點在地址下面）。
 * 回 null：畫面上沒有對應欄位（例如 hostDisplay、整個 venues／divisions 陣列），由呼叫端顯示整頁錯誤。
 */
export function fieldSpot(field: string | undefined): { step: 1 | 2; field: string; id: string } | null {
  if (!field) return null;
  const fixed: Record<string, string> = {
    name: 'cpf-name',
    hostTeamId: 'cpf-club',
    feeNote: 'cpf-fee-note',
    contactNote: 'cpf-contact',
    regOpenAt: 'cp-reg-open',
    regCloseAt: 'cp-reg-close',
    firstMatchAt: 'cp-first',
    lastMatchAt: 'cp-last',
  };
  const id = fixed[field];
  if (id) return { step: 1, field, id };
  const venue = /^venues\.(\d+)\.(name|address|lat|lng|mapPlaceId|mapProvider)$/.exec(field);
  if (venue) {
    const kind = venue[2] === 'name' ? 'name' : 'address';
    return { step: 1, field: `venues.${venue[1]}.${kind}`, id: `cpf-v${venue[1]}-${kind}` };
  }
  const division = /^divisions\.(\d+)\.(name|playersOnField|maxTeams|rosterMin|rosterMax|minAge|maxAge|feePerTeam)$/.exec(field);
  if (division) {
    const kind = division[2] === 'playersOnField' ? 'name' : (division[2] ?? 'name');
    return { step: 2, field: `divisions.${division[1]}.${kind}`, id: `cpf-d${division[1]}-${kind}` };
  }
  return null;
}

/** 後端 DIVISION_NAME_DUPLICATE 只標 divisions：找出第一個重複名稱的組別。 */
export function duplicateDivisionField(divisions: readonly DivisionDraft[]): string | null {
  const seen = new Set<string>();
  for (const [i, d] of divisions.entries()) {
    const key = cleanLine(d.name) ?? '';
    if (seen.has(key)) return `divisions.${i}.name`;
    seen.add(key);
  }
  return null;
}
