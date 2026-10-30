/**
 * 活動詳情「報名名單（出席表）」與「候補名單」檢視及管理共用資料模型。
 *
 * 對照舊版 A：
 * - `_buildConfirmedParticipantSummary`（`event-manage-noshow.js`）
 * - `_decorateAttendanceRosterPeople`（`event-manage-attendance.js`）
 * - `_matchAttendanceRecord`、`_getLatestAttendanceRecord`、`_attendanceRecordMs`（`event-manage-attendance.js`）
 * - `_renderGroupedWaitlistSection`（`event-detail.js`）
 *
 * 編輯模式已提供「踢」「候」欄與候補升正取，操作由元件及資料流程處理。
 * 尚未提供的顯示項目與不移植的行為：
 * - 放鴿子欄與出席率染色（R-STAT-000）
 * - 分隊排序與分隊徽章
 * - 載入防抖、效能 log、快速預覽、延遲補畫
 * - 任何以名字比對身分的分支（R-ID-002 刻意不移植）
 */

import type { TeamReservationSummaryInput, RosterParticipantWithUid } from '@/data/contract/roster-projection';

export interface RosterDisplayBadge {
  name?: string;
  image?: string;
}

export type { TeamReservationSummaryInput, RosterParticipantWithUid } from '@/data/contract/roster-projection';

export interface RosterEventInput {
  courseLinked?: unknown;
  courseLinkSource?: unknown;
  id?: unknown;
  max?: unknown;
  current?: unknown;
  realCurrent?: unknown;
  participants?: unknown;
  participantsWithUid?: unknown;
  waitlistNames?: unknown;
  teamReservationSummaries?: unknown;
}

export interface RosterRegistrationInput {
  id?: unknown;
  _docId?: unknown;
  _path?: unknown;
  userId?: unknown;
  uid?: unknown;
  ownerUid?: unknown;
  userName?: unknown;
  name?: unknown;
  status?: unknown;
  participantType?: unknown;
  companionId?: unknown;
  companionName?: unknown;
  registeredAt?: unknown;
  promotionOrder?: unknown;
  displayBadges?: unknown;
  teamKey?: unknown;
  teamReservationTeamId?: unknown;
  teamReservationTeamName?: unknown;
  teamSeatSource?: unknown;
  courseLinkSource?: unknown;
  source?: unknown;
  courseLinkId?: unknown;
  courseStudentId?: unknown;
  courseStudentName?: unknown;
  courseLinkState?: unknown;
  coursePriority?: unknown;
}

export interface RosterAttendanceRecordInput {
  id?: unknown;
  _docId?: unknown;
  uid?: unknown;
  userName?: unknown;
  companionId?: unknown;
  companionName?: unknown;
  type?: unknown;
  time?: unknown;
  status?: unknown;
  note?: unknown;
  createdAt?: unknown;
  data?: Record<string, unknown>;
}

export interface BuildConfirmedRosterOptions {
  /**
   * 對應 A `canUseRegistrationRows`（預設 `true`，代表呼叫端傳入完整 registrations）。
   * 當設為 `false`（例如僅有快取或不完整快照）時，只採用 `participantsWithUid` fallback，
   * 且 `count` 取 `Math.max(countablePeople.length, fallbackCount)`。
   */
  canUseRegistrationRows?: boolean;
  /**
   * 對應 A `this._eventBadgeCache?.[eventId]`，依 uid 補充徽章。
   */
  badgeCache?: Readonly<Record<string, readonly RosterDisplayBadge[]>>;
}

export interface ConfirmedRosterPerson {
  name: string;
  displayName: string;
  uid: string;
  ownerUid?: string;
  isCompanion: boolean;
  hasSelfReg: boolean;
  proxyOnly: boolean;
  isProxyOnly?: boolean;
  uidResolved?: boolean;
  displayBadges: RosterDisplayBadge[];
  teamKey: string | null;
  regDocId: string | null;
  teamReservationTeamId: string | null;
  teamReservationTeamName: string | null;
  teamSeatSource: string | null;
  courseLinkedRegistration?: boolean;
  courseStudentId?: string;
  courseLinkId?: string;
  attendanceAmbiguous?: boolean;
  isTeamHeader?: boolean;
  isTeamPlaceholder?: boolean;
  isTeamGeneralSeparator?: boolean;
  reservedSlots?: number;
  usedSlots?: number;
  remainingSlots?: number;
}

export interface NormalizedTeamSummary {
  teamId: string;
  teamName: string;
  reservedSlots: number;
  usedSlots: number;
  remainingSlots: number;
}

export interface ConfirmedRosterResult {
  people: ConfirmedRosterPerson[];
  count: number;
  realCount: number;
  teamSummaries: NormalizedTeamSummary[];
}

export interface AttendanceRowState {
  hasCheckin: boolean;
  hasCheckout: boolean;
  noteText: string;
  combinedNote: string;
  attendanceBlocked: boolean;
  ambiguous: boolean;
}

export interface WaitlistCompanionItem {
  name: string;
  companionId: string;
  orphanInfo: string | null;
}

export interface WaitlistRosterItem {
  name: string;
  userId: string;
  courseLinked: boolean;
  registrationId: string;
  companions: WaitlistCompanionItem[];
  selfOrphanInfo: string | null;
}

export interface WaitlistRosterResult {
  items: WaitlistRosterItem[];
  totalCount: number;
}

function str(val: unknown): string {
  return typeof val === 'string' ? val.trim() : val != null && typeof val === 'number' ? String(val) : '';
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function parseBadges(raw: unknown): RosterDisplayBadge[] {
  if (!Array.isArray(raw)) return [];
  const out: RosterDisplayBadge[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      out.push({
        name: str(rec.name),
        image: str(rec.image),
      });
    }
  }
  return out;
}

function regTimeMs(reg: RosterRegistrationInput): number {
  const v = reg?.registeredAt;
  if (!v) return Number.POSITIVE_INFINITY;
  if (typeof v === 'object' && v !== null) {
    const obj = v as { toMillis?: () => number; seconds?: unknown; nanoseconds?: unknown };
    if (typeof obj.toMillis === 'function') {
      try {
        const ms = obj.toMillis();
        if (Number.isFinite(ms)) return ms;
      } catch {
        // ignore
      }
    }
    if (typeof obj.seconds === 'number') {
      const ns = typeof obj.nanoseconds === 'number' ? obj.nanoseconds : 0;
      return obj.seconds * 1000 + Math.floor(ns / 1_000_000);
    }
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}

function isCourseLinkedRegistrationForRoster(reg: RosterRegistrationInput): boolean {
  return str(reg.courseLinkSource || reg.source) === 'eduCourseLesson'
    || Boolean(str(reg.courseLinkId))
    || Boolean(str(reg.courseStudentId));
}

function isCompanionReg(reg: RosterRegistrationInput): boolean {
  return str(reg.participantType) === 'companion';
}

function isSelfReg(reg: RosterRegistrationInput): boolean {
  return str(reg.participantType) === 'self';
}

function regOwnerUid(reg: RosterRegistrationInput): string {
  // R-ID-003: canonical userId, legacy uid / ownerUid
  return str(reg.userId) || str(reg.uid) || str(reg.ownerUid);
}

function regDocIdOf(reg: RosterRegistrationInput): string {
  return str(reg._docId) || str(reg.id);
}

function normalizeTeamSummaries(event: RosterEventInput): NormalizedTeamSummary[] {
  if (!Array.isArray(event.teamReservationSummaries)) return [];
  const out: NormalizedTeamSummary[] = [];
  for (const item of event.teamReservationSummaries) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as TeamReservationSummaryInput;
    const teamId = str(raw.teamId);
    const teamName = str(raw.teamName) || teamId;
    out.push({
      teamId,
      teamName,
      reservedSlots: Math.max(0, num(raw.reservedSlots)),
      usedSlots: Math.max(0, num(raw.usedSlots)),
      remainingSlots: Math.max(0, num(raw.remainingSlots)),
    });
  }
  return out;
}

/**
 * 對應 A `_getEventActualConfirmedCount` / `_getEventProjectedConfirmedCount` 計算出的權威 fallback 正取人數。
 */
function getEventFallbackConfirmedCount(
  event: RosterEventInput,
  remainingReservedSlots: number,
): number {
  const realCurrentNum = Number(event.realCurrent);
  if (event.realCurrent != null && event.realCurrent !== '' && Number.isFinite(realCurrentNum) && realCurrentNum >= 0) {
    return Math.max(0, realCurrentNum);
  }
  const projected = Math.max(0, num(event.current));
  return Math.max(0, projected - remainingReservedSlots);
}

/**
 * 對應 A `_projectionUidForReg`（第 132～140 行）。
 */
function projectionUidForReg(reg: RosterRegistrationInput): string {
  const isCompanion = str(reg.participantType) === 'companion' || Boolean(str(reg.companionId));
  if (isCompanion) {
    const ownerUid = regOwnerUid(reg);
    const companionName = str(reg.companionName) || str(reg.userName) || str(reg.name);
    return str(reg.companionId) || (ownerUid && companionName ? `${ownerUid}_${companionName}` : '');
  }
  return regOwnerUid(reg);
}

/**
 * 對應 A `_decorateAttendanceRosterPeople`。
 */
export function decorateAttendanceRosterPeople(
  sourcePeople: readonly ConfirmedRosterPerson[],
  registrations: readonly RosterRegistrationInput[],
): ConfirmedRosterPerson[] {
  const people: ConfirmedRosterPerson[] = sourcePeople.map((person) => ({ ...person }));
  const courseRegs = registrations
    .filter((reg) => str(reg.status) === 'confirmed')
    .filter((reg) => !isCompanionReg(reg))
    .filter((reg) => isCourseLinkedRegistrationForRoster(reg));

  const courseRegById = new Map<string, RosterRegistrationInput>();
  for (const reg of courseRegs) {
    const regDocId = regDocIdOf(reg);
    if (regDocId) courseRegById.set(regDocId, reg);
  }

  const representedRegistrationIds = new Set<string>();
  for (const person of people) {
    const regDocId = str(person.regDocId);
    if (!regDocId) continue;
    representedRegistrationIds.add(regDocId);
    const reg = courseRegById.get(regDocId);
    if (!reg) continue;
    person.courseLinkedRegistration = true;
    person.courseStudentId = str(reg.courseStudentId);
    person.courseLinkId = str(reg.courseLinkId);
  }

  for (const reg of courseRegs) {
    const regDocId = regDocIdOf(reg);
    if (!regDocId || representedRegistrationIds.has(regDocId)) continue;
    const displayName = str(reg.userName) || str(reg.courseStudentName) || '課程學員';
    const uid = regOwnerUid(reg);
    people.push({
      name: displayName,
      uid,
      ownerUid: uid,
      isCompanion: false,
      displayName,
      hasSelfReg: true,
      proxyOnly: false,
      displayBadges: parseBadges(reg.displayBadges),
      teamKey: str(reg.teamKey) || null,
      regDocId,
      courseLinkedRegistration: true,
      courseStudentId: str(reg.courseStudentId),
      courseLinkId: str(reg.courseLinkId),
      teamReservationTeamId: str(reg.teamReservationTeamId) || null,
      teamReservationTeamName: str(reg.teamReservationTeamName) || null,
      teamSeatSource: str(reg.teamSeatSource) || null,
    });
    representedRegistrationIds.add(regDocId);
  }

  const attendanceRowsByUid = new Map<string, ConfirmedRosterPerson[]>();
  for (const person of people) {
    if (
      person.isTeamHeader
      || person.isTeamGeneralSeparator
      || person.isTeamPlaceholder
      || person.proxyOnly
      || person.isProxyOnly
      || person.isCompanion
    ) {
      continue;
    }
    const uid = str(person.uid);
    if (!uid) continue;
    const rows = attendanceRowsByUid.get(uid) ?? [];
    rows.push(person);
    attendanceRowsByUid.set(uid, rows);
  }

  attendanceRowsByUid.forEach((rows) => {
    if (rows.length <= 1 || !rows.some((person) => person.courseLinkedRegistration)) return;
    for (const person of rows) {
      person.attendanceAmbiguous = true;
    }
  });

  return people;
}

/**
 * 對應 A `_buildConfirmedParticipantSummary` + `_decorateAttendanceRosterPeople`。
 *
 * R-ID-002 刻意不移植：
 * - A 在 fallback 時用 `_userByName` 依名字反查 `users` 的 UID，以及 `_lookupProjectedRegistration` 以名字匹配；
 *   B 只信任 `participantsWithUid` 的真 UID（且通過 `wuValid` 長度守衛），純名字字串（`event.participants`）不做身分反查。
 */
export function buildConfirmedRoster(
  event: RosterEventInput | null | undefined,
  registrations: readonly RosterRegistrationInput[] = [],
  options?: BuildConfirmedRosterOptions,
): ConfirmedRosterResult {
  if (!event) {
    return { people: [], count: 0, realCount: 0, teamSummaries: [] };
  }

  const canUseRegistrationRows = options?.canUseRegistrationRows ?? true;
  const badgeCache = options?.badgeCache ?? {};

  const cachedConfirmedRegs = registrations.filter(
    (r) => (str(r?.status) || 'confirmed').toLowerCase() === 'confirmed',
  );

  const allActiveRegs = canUseRegistrationRows ? registrations : [];
  const confirmedRegs = allActiveRegs
    .filter((r) => str(r?.status) === 'confirmed')
    .slice()
    .sort((a, b) => {
      const ta = regTimeMs(a);
      const tb = regTimeMs(b);
      if (ta !== tb) return ta - tb;
      const pa = num(a.promotionOrder);
      const pb = num(b.promotionOrder);
      if (pa !== pb) return pa - pb;
      return regDocIdOf(a).localeCompare(regDocIdOf(b));
    });

  const basePeople: ConfirmedRosterPerson[] = [];
  const addedUids = new Set<string>();

  if (confirmedRegs.length > 0) {
    const groups = new Map<string, RosterRegistrationInput[]>();
    confirmedRegs.forEach((r, index) => {
      const isCourseLinked = isCourseLinkedRegistrationForRoster(r);
      const registrationIdentity = regDocIdOf(r) || str(r._path);
      const groupKey = isCourseLinked
        ? `course:${str(r.courseStudentId) || registrationIdentity || `row-${index}`}`
        : `user:${regOwnerUid(r)}`;
      const bucket = groups.get(groupKey);
      if (bucket) {
        bucket.push(r);
      } else {
        groups.set(groupKey, [r]);
      }
    });

    groups.forEach((regs) => {
      // 對照 A `event-manage-noshow.js:68`：嚴格以 participantType === 'self' 判定本人報名
      const selfReg = regs.find((r) => isSelfReg(r));
      const isCourseLinked = regs.some((r) => isCourseLinkedRegistrationForRoster(r));
      const companions = regs.filter((r) => isCompanionReg(r));
      const firstReg = regs[0];
      if (!firstReg) return;
      const mainUid = regOwnerUid(selfReg ?? firstReg);

      if (selfReg) {
        const mainName = str(selfReg.userName) || str(selfReg.name);
        basePeople.push({
          name: mainName,
          uid: mainUid,
          ownerUid: mainUid,
          isCompanion: false,
          displayName: mainName,
          hasSelfReg: true,
          proxyOnly: false,
          displayBadges: parseBadges(selfReg.displayBadges),
          teamKey: str(selfReg.teamKey) || null,
          regDocId: regDocIdOf(selfReg) || null,
          teamReservationTeamId: str(selfReg.teamReservationTeamId) || null,
          teamReservationTeamName: str(selfReg.teamReservationTeamName) || null,
          teamSeatSource: str(selfReg.teamSeatSource) || null,
          courseLinkedRegistration: isCourseLinked,
          courseStudentId: isCourseLinked ? str(selfReg.courseStudentId) : '',
          courseLinkId: isCourseLinked ? str(selfReg.courseLinkId) : '',
        });
        if (mainUid) addedUids.add(mainUid);
      } else {
        const proxyName = str(firstReg.userName) || str(firstReg.name);
        if (mainUid && proxyName) {
          basePeople.push({
            name: proxyName,
            uid: mainUid,
            ownerUid: mainUid,
            isCompanion: false,
            displayName: proxyName,
            hasSelfReg: false,
            proxyOnly: true,
            isProxyOnly: true,
            displayBadges: parseBadges(firstReg.displayBadges),
            teamKey: null,
            regDocId: null,
            teamReservationTeamId: null,
            teamReservationTeamName: null,
            teamSeatSource: null,
          });
        }
      }

      for (const c of companions) {
        const cName = str(c.companionName) || str(c.userName) || str(c.name);
        const cId = str(c.companionId);
        // ASSUMPTION: 當 companionId 缺失時，保留 A 的 fallback key `${mainUid}_${companionName}` 供列 key 區別，但標記 ownerUid 為報名主帳號。
        const cUid = cId || (mainUid && cName ? `${mainUid}_${cName}` : '');
        basePeople.push({
          name: cName,
          uid: cUid,
          ownerUid: mainUid,
          isCompanion: true,
          displayName: cName,
          hasSelfReg: false,
          proxyOnly: false,
          displayBadges: [],
          teamKey: str(c.teamKey) || null,
          regDocId: regDocIdOf(c) || null,
          teamReservationTeamId: str(c.teamReservationTeamId) || null,
          teamReservationTeamName: str(c.teamReservationTeamName) || null,
          teamSeatSource: str(c.teamSeatSource) || null,
        });
        if (cUid) addedUids.add(cUid);
      }
    });
  }

  const teamSummaries = normalizeTeamSummaries(event);
  const remainingReservedSlots = teamSummaries.reduce(
    (sum, s) => sum + Math.max(0, s.remainingSlots),
    0,
  );

  // 對照 A `event-manage-noshow.js:126-178`：`wuValid` 長度一致性守衛 + UID 反查 enrichment（R-ID-002 不移植名字匹配）
  const wu = Array.isArray(event.participantsWithUid) ? event.participantsWithUid : [];
  const expectedLen = num(event.realCurrent) || (num(event.current) - remainingReservedSlots);
  const wuValid = wu.length > 0 && wu.length === expectedLen;
  const useProjectedFallbackPeople = !canUseRegistrationRows || confirmedRegs.length === 0;

  function lookupProjectedRegistrationByUid(uid: string): RosterRegistrationInput | null {
    if (!uid) return null;
    const uidMatches = cachedConfirmedRegs.filter((r) => projectionUidForReg(r) === uid);
    return uidMatches.length === 1 ? (uidMatches[0] ?? null) : null;
  }

  if (useProjectedFallbackPeople && wuValid) {
    for (const raw of wu) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as RosterParticipantWithUid;
      const uid = str(entry.uid);
      const name = str(entry.name) || str(entry.displayName);
      if (!uid || !name || addedUids.has(uid)) continue;
      const matchedReg = lookupProjectedRegistrationByUid(uid);
      const cachedBadges = badgeCache[uid];
      const badges = cachedBadges && cachedBadges.length > 0
        ? cachedBadges.map((b) => ({ name: str(b.name), image: str(b.image) }))
        : parseBadges(matchedReg?.displayBadges);
      basePeople.push({
        name,
        uid,
        ownerUid: uid,
        isCompanion: false,
        displayName: name,
        hasSelfReg: true,
        proxyOnly: false,
        uidResolved: true,
        displayBadges: badges,
        teamKey: str(entry.teamKey) || str(matchedReg?.teamKey) || null,
        regDocId: matchedReg ? (regDocIdOf(matchedReg) || null) : null,
        teamReservationTeamId:
          str(entry.teamReservationTeamId) || str(matchedReg?.teamReservationTeamId) || null,
        teamReservationTeamName:
          str(entry.teamReservationTeamName) || str(matchedReg?.teamReservationTeamName) || null,
        teamSeatSource:
          str(entry.teamSeatSource) || str(matchedReg?.teamSeatSource) || null,
      });
      addedUids.add(uid);
    }
  }

  const teamRows: ConfirmedRosterPerson[] = [];
  const groupedTeamIds = new Set<string>();

  for (const summary of teamSummaries) {
    if (summary.reservedSlots <= 0 && summary.usedSlots <= 0) continue;
    const teamId = summary.teamId;
    if (!teamId) continue;
    const realPeople = basePeople.filter((p) => str(p.teamReservationTeamId) === teamId);
    if (realPeople.length === 0 && summary.remainingSlots <= 0) continue;
    groupedTeamIds.add(teamId);
    teamRows.push({
      isTeamHeader: true,
      uid: `team-header-${teamId}`,
      name: summary.teamName || teamId,
      displayName: summary.teamName || teamId,
      isCompanion: false,
      hasSelfReg: false,
      proxyOnly: false,
      displayBadges: [],
      teamKey: null,
      regDocId: null,
      teamReservationTeamId: teamId,
      teamReservationTeamName: summary.teamName || teamId,
      teamSeatSource: null,
      reservedSlots: summary.reservedSlots,
      usedSlots: summary.usedSlots,
      remainingSlots: summary.remainingSlots,
    });
    for (const p of realPeople) {
      teamRows.push(p);
    }
    for (let i = 0; i < summary.remainingSlots; i += 1) {
      const label = `${summary.teamName || teamId} 保留席位`;
      teamRows.push({
        isTeamPlaceholder: true,
        uid: `team-seat-${teamId}-${i + 1}`,
        name: label,
        displayName: label,
        isCompanion: false,
        hasSelfReg: false,
        proxyOnly: false,
        displayBadges: [],
        teamKey: null,
        regDocId: null,
        teamReservationTeamId: teamId,
        teamReservationTeamName: summary.teamName || teamId,
        teamSeatSource: null,
      });
    }
  }

  const normalRows = basePeople.filter(
    (p) => !p.teamReservationTeamId || !groupedTeamIds.has(str(p.teamReservationTeamId)),
  );
  const orderedPeople: ConfirmedRosterPerson[] =
    teamRows.length > 0 && normalRows.length > 0
      ? [
          ...teamRows,
          {
            isTeamGeneralSeparator: true,
            uid: 'team-reservation-general-separator',
            name: '一般報名',
            displayName: '一般報名',
            isCompanion: false,
            hasSelfReg: false,
            proxyOnly: false,
            displayBadges: [],
            teamKey: null,
            regDocId: null,
            teamReservationTeamId: null,
            teamReservationTeamName: null,
            teamSeatSource: null,
          },
          ...normalRows,
        ]
      : [...teamRows, ...normalRows];

  const decoratedPeople = decorateAttendanceRosterPeople(
    orderedPeople,
    canUseRegistrationRows ? registrations : [],
  );

  const countablePeople = decoratedPeople.filter(
    (p) =>
      !p.isTeamHeader
      && !p.isTeamGeneralSeparator
      && !p.isTeamPlaceholder
      && !p.proxyOnly
      && !p.isProxyOnly,
  );

  // 對照 A `event-manage-noshow.js:258-271`
  const fallbackCount = getEventFallbackConfirmedCount(event, remainingReservedSlots);
  const hasCountSource =
    decoratedPeople.length > 0
    || (Array.isArray(event.participantsWithUid) && event.participantsWithUid.length > 0)
    || (Array.isArray(event.participants) && event.participants.length > 0);
  const count = canUseRegistrationRows
    ? (hasCountSource ? countablePeople.length : fallbackCount)
    : Math.max(countablePeople.length, fallbackCount);
  const realCount = basePeople.filter((p) => !p.proxyOnly && !p.isProxyOnly).length;

  return {
    people: decoratedPeople,
    count,
    realCount,
    teamSummaries,
  };
}

/**
 * 對應 A `_attendanceRecordMs`（第 485～508 行）。
 */
export function attendanceRecordMs(
  record: RosterAttendanceRecordInput | null | undefined,
  fallbackOrder = 0,
): number {
  if (!record) return fallbackOrder;
  const createdAt = record.createdAt ?? record.data?.createdAt;
  if (createdAt && typeof createdAt === 'object') {
    const obj = createdAt as {
      toDate?: () => Date;
      seconds?: unknown;
      nanoseconds?: unknown;
    };
    if (typeof obj.toDate === 'function') {
      try {
        const ms = obj.toDate().getTime();
        if (Number.isFinite(ms)) return ms;
      } catch {
        // ignore
      }
    }
    if (typeof obj.seconds === 'number') {
      const ns = typeof obj.nanoseconds === 'number' ? obj.nanoseconds : 0;
      return obj.seconds * 1000 + Math.floor(ns / 1e6);
    }
  }
  if (typeof createdAt === 'string') {
    const ms = Date.parse(createdAt);
    if (Number.isFinite(ms)) return ms;
  }
  const time = str(record.time ?? record.data?.time);
  if (time) {
    const ms = Date.parse(time.replace(/\//g, '-'));
    if (Number.isFinite(ms)) return ms;
  }
  const id = str(record.id ?? record.data?.id ?? record._docId);
  const m = id.match(/(\d{10,13})/);
  if (m && Number.isFinite(Number(m[1]))) return Number(m[1]);
  return fallbackOrder;
}

/**
 * 對照 A `api-service.js#getAttendanceRecords`（第 2077 行）：
 * `r.status !== 'removed' && r.status !== 'cancelled'`。
 */
function isActiveAttendanceRecord(record: RosterAttendanceRecordInput): boolean {
  const status = str(record.status ?? record.data?.status) || 'active';
  return status !== 'removed' && status !== 'cancelled';
}

/**
 * 對應 A `_matchAttendanceRecord`（第 467～483 行）。
 *
 * R-ID-002 刻意不移植：
 * - A 有 `|| (!!personName && recordUserName === personName)` 及 `recordCompanionName === personName` 的名字比對分支；
 *   B 一律只以 `uid` / `companionId` 精確比對，不以名字比對身分。
 */
export function matchAttendanceRecord(
  record: RosterAttendanceRecordInput | null | undefined,
  person: Pick<
    ConfirmedRosterPerson,
    'uid' | 'ownerUid' | 'isCompanion' | 'isTeamPlaceholder' | 'isTeamHeader' | 'isTeamGeneralSeparator'
  > | null | undefined,
): boolean {
  if (!record || !person) return false;
  if (person.isTeamPlaceholder || person.isTeamHeader || person.isTeamGeneralSeparator) return false;
  if (!isActiveAttendanceRecord(record)) return false;

  const recordUid = str(record.uid);
  const recordCompanionId = str(record.companionId ?? record.data?.companionId);
  const personUid = str(person.uid);
  const ownerUid = str(person.ownerUid);

  if (!personUid) return false;

  if (person.isCompanion) {
    if (!recordCompanionId) return false;
    if (ownerUid && recordUid !== ownerUid) return false;
    // R-ID-002 刻意不移植：不做 recordCompanionName === personName 比對
    return recordCompanionId === personUid;
  }

  // R-ID-002 刻意不移植：不做 recordUserName === personName 比對
  return recordUid === personUid && !recordCompanionId;
}

/**
 * 對應 A `_getLatestAttendanceRecord`（第 510～523 行）。
 */
export function getLatestAttendanceRecord(
  records: readonly RosterAttendanceRecordInput[],
  person: ConfirmedRosterPerson,
  type: string,
): RosterAttendanceRecordInput | null {
  let latest: RosterAttendanceRecordInput | null = null;
  let latestMs = -Infinity;
  records.forEach((r, idx) => {
    if (!isActiveAttendanceRecord(r)) return;
    if (str(r.type) !== type) return;
    if (!matchAttendanceRecord(r, person)) return;
    const ms = attendanceRecordMs(r, idx);
    if (ms >= latestMs) {
      latestMs = ms;
      latest = r;
    }
  });
  return latest;
}

/**
 * 計算單一正取列的簽到／簽退／備註／模糊狀態（對照 A `_doRenderAttendanceTable` 非編輯模式）。
 */
export function attendanceStateFor(
  person: ConfirmedRosterPerson,
  records: readonly RosterAttendanceRecordInput[] = [],
  autoProxyLabel = '僅代報',
): AttendanceRowState {
  const isPlaceholder = Boolean(person.isTeamPlaceholder);
  const isProxyOnly = Boolean(person.proxyOnly || person.isProxyOnly);
  const ambiguous = person.attendanceAmbiguous === true;
  const attendanceBlocked = isPlaceholder || isProxyOnly || ambiguous;

  const activeRecords = records.filter(isActiveAttendanceRecord);
  const hasCheckin = attendanceBlocked
    ? false
    : activeRecords.some((r) => str(r.type) === 'checkin' && matchAttendanceRecord(r, person));
  const hasCheckout = attendanceBlocked
    ? false
    : activeRecords.some((r) => str(r.type) === 'checkout' && matchAttendanceRecord(r, person));
  const noteRec = attendanceBlocked ? null : getLatestAttendanceRecord(activeRecords, person, 'note');
  const noteText = noteRec ? str(noteRec.note ?? noteRec.data?.note) : '';
  const autoNote = isProxyOnly ? autoProxyLabel : '';
  const combinedNote = [autoNote, noteText].filter(Boolean).join('・');

  return {
    hasCheckin,
    hasCheckout,
    noteText,
    combinedNote,
    attendanceBlocked,
    ambiguous,
  };
}

/**
 * 對照 A `event-detail.js#_renderGroupedWaitlistSection`（第 1726～1772 行）。
 *
 * 排序：`registeredAt` → `promotionOrder` → `_docId/id` → `userName`。
 * 分組：依 `userId`（`regOwnerUid`）分組。
 * R-ID-002 刻意不移植：不移植 `_getWaitlistFallbackNames` 與 `event.waitlistNames` 名字重排。
 */
export function buildWaitlistRoster(
  _event: RosterEventInput | null | undefined,
  registrations: readonly RosterRegistrationInput[] = [],
): WaitlistRosterResult {
  const activeRegs = registrations.filter((r) => {
    const status = str(r?.status);
    return status === 'confirmed' || status === 'waitlisted';
  });

  const waitlistedRegs = activeRegs
    .filter((r) => str(r.status) === 'waitlisted')
    .slice()
    .sort((a, b) => {
      const ta = regTimeMs(a);
      const tb = regTimeMs(b);
      if (ta !== tb) return ta - tb;
      const pa = num(a.promotionOrder);
      const pb = num(b.promotionOrder);
      if (pa !== pb) return pa - pb;
      const ida = regDocIdOf(a);
      const idb = regDocIdOf(b);
      if (ida !== idb) return ida.localeCompare(idb);
      return str(a.userName).localeCompare(str(b.userName));
    });

  const items: WaitlistRosterItem[] = [];

  if (waitlistedRegs.length > 0) {
    const groups = new Map<string, RosterRegistrationInput[]>();
    for (const r of waitlistedRegs) {
      const userId = regOwnerUid(r);
      const bucket = groups.get(userId);
      if (bucket) {
        bucket.push(r);
      } else {
        groups.set(userId, [r]);
      }
    }

    groups.forEach((regs, userId) => {
      const selfReg = regs.find((r) => isSelfReg(r));
      const isCourseLinked = regs.some((r) => isCourseLinkedRegistrationForRoster(r));
      const firstReg = regs[0];
      if (!firstReg) return;
      const companions = regs.filter((r) => isCompanionReg(r));
      const mainName = str((selfReg ?? firstReg).userName) || str((selfReg ?? firstReg).name);

      const selfConfirmed = activeRegs.find(
        (r) =>
          regOwnerUid(r) === userId
          && isSelfReg(r)
          && str(r.status) === 'confirmed',
      );
      const selfConfirmedName = selfConfirmed
        ? (str(selfConfirmed.userName) || str(selfConfirmed.name) || null)
        : null;

      const companionItems: WaitlistCompanionItem[] = companions.map((c) => {
        const cName = str(c.companionName) || str(c.userName) || str(c.name);
        return {
          name: cName,
          companionId: str(c.companionId) || regDocIdOf(c),
          orphanInfo: selfConfirmedName,
        };
      });

      const selfOrphanInfo = !selfReg ? selfConfirmedName : null;

      items.push({
        name: mainName,
        userId,
        courseLinked: isCourseLinked,
        registrationId: selfReg ? regDocIdOf(selfReg) : '',
        companions: companionItems,
        selfOrphanInfo,
      });
    });
  }

  const totalCount = items.reduce((sum, it) => sum + 1 + it.companions.length, 0);
  return { items, totalCount };
}
