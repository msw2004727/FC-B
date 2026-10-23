import { callFn } from '@/data/callables';
import { generateId, ID_PREFIX } from '@/data/ids';
import { deliverInboxMessage } from '@/data/inbox-delivery';
import { writeOpLog } from '@/data/op-log';
import {
  DEFAULT_EVENT_COVER_URL,
  uploadImageDataUrl,
} from '@/features/events/data/event-cover-upload';
import { verifyUserDirectorySelection } from '@/features/events/data/user-directory';
import type { DirectoryUser } from '@/features/events/data/user-directory';
import {
  canAssignCoach,
  canCreateTeam,
  canEditTeamSettings,
  canTransferCaptain,
  getTeamLeaderUidList,
} from '../club-policy';
import {
  bestEffort,
  recalculateRole,
} from '../components/legacy/member-management-actions';
import {
  buildCreateTeamPayload,
  buildUpdateTeamPatch,
  diffStaffForNotify,
  validateTeamFormValues,
} from './team-form-model';
import type {
  TeamFormCommonFields,
  TeamFormImageVariants,
  TeamFormStaffMember,
  TeamFormValues,
  TeamStaffSnapshot,
} from './team-form-model';
import { createTeamDoc, updateTeamBasicDoc } from './teams-create';
import type { TeamDoc } from './types';

export type TeamFormImages = {
  coverDataUrl?: string;
  cardDataUrl?: string;
};

export interface TeamFormViewer {
  uid: string | null;
  displayName?: string;
  hasPermission(code: string): boolean;
}

export type SubmitTeamResult =
  | { ok: true; teamId: string; roleSyncOk: boolean }
  | {
    ok: false;
    reason: 'forbidden' | 'invalid' | 'captain-mismatch' | 'verify-failed' | 'write-failed';
    message?: string;
  };

export interface SubmitCreateTeamInput {
  viewer: TeamFormViewer;
  values: TeamFormValues;
  images: TeamFormImages;
  /** 圖片 Storage 時間後綴；ID 仍使用既有 generateId 的演算法。 */
  now?: () => number;
}

export interface SubmitEditTeamInput {
  viewer: TeamFormViewer;
  team: TeamDoc;
  values: TeamFormValues;
  images: TeamFormImages;
}

export const DEFAULT_TEAM_COVER_URL = DEFAULT_EVENT_COVER_URL;

/** 刻意偏離 A：無圖片時直接儲存共用預設封面的 HTTPS URL。 */
export function resolveDefaultTeamCoverImage(): string {
  return DEFAULT_TEAM_COVER_URL;
}

const VERIFY_MESSAGE = '無法確認人員資料，請重新搜尋後再試';

/** 表單所有巢狀資料均為物件、陣列及基本值；同步深拷貝，與 UI 後續修改隔離。 */
function snapshotValues(values: TeamFormValues): TeamFormValues {
  return {
    ...values,
    captain: values.captain ? { ...values.captain } : null,
    leaders: values.leaders.map(member => ({ ...member })),
    coaches: values.coaches.map(member => ({ ...member })),
    unresolvedLeaderNames: [...values.unresolvedLeaderNames],
    unresolvedCoachNames: [...values.unresolvedCoachNames],
    contactLinkDrafts: [...values.contactLinkDrafts],
  };
}

/** 名稱快取沿用原始 UID 陣列索引，不先去重或過濾，以免錯配姓名。 */
function cachedStaffName(
  team: TeamDoc,
  uid: string,
  role: 'captain' | 'leader' | 'coach',
): string {
  const text = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';
  if (role === 'captain') {
    return text(team.captainName) || text(team.captain) || '?';
  }

  const rawUids: unknown = role === 'leader' ? team.leaderUids : team.coachUids;
  const primaryNames: unknown = role === 'leader' ? team.leaderNames : team.coachNames;
  const legacyNames: unknown = role === 'leader' ? team.leaders : team.coaches;
  const index = Array.isArray(rawUids)
    ? (rawUids as unknown[]).findIndex(value => text(value) === uid)
    : -1;
  if (index >= 0) {
    const primary = Array.isArray(primaryNames)
      ? text((primaryNames as unknown[])[index])
      : '';
    const legacy = Array.isArray(legacyNames)
      ? text((legacyNames as unknown[])[index])
      : '';
    if (primary || legacy) return primary || legacy;
  }
  if (role === 'leader' && text(team.leaderUid) === uid) {
    return text(team.leader) || '?';
  }
  return '?';
}

type PreviousStaffNames = {
  captain: Map<string, string>;
  leader: Map<string, string>;
  coach: Map<string, string>;
};

/** 在第一個 await 前擷取舊名稱，避免等待期間 team 快取改動影響日誌。 */
function snapshotPreviousNames(
  team: TeamDoc,
  prev: TeamStaffSnapshot,
): PreviousStaffNames {
  const captainUid = prev.captainUid?.trim();
  return {
    captain: new Map(captainUid
      ? [[captainUid, cachedStaffName(team, captainUid, 'captain')]]
      : []),
    leader: new Map((prev.leaderUids ?? []).map(uid =>
      [uid, cachedStaffName(team, uid, 'leader')])),
    coach: new Map((prev.coachUids ?? []).map(uid =>
      [uid, cachedStaffName(team, uid, 'coach')])),
  };
}

function directoryUsersByUid(users: readonly DirectoryUser[]): Map<string, DirectoryUser> {
  const result = new Map<string, DirectoryUser>();
  for (const user of users) {
    const uid = user.uid.trim();
    if (uid) result.set(uid, user);
    // ASSUMPTION: 目錄可能保留 A 的 _docId 別名；不要求 DirectoryUser 宣告此欄位。
    if ('_docId' in user && typeof user._docId === 'string') {
      const docId = user._docId.trim();
      if (docId) result.set(docId, user);
    }
  }
  return result;
}

/**
 * 附件未提供同步目錄讀取 API，沿用已知的目錄驗證介面查舊人員姓名。
 * ASSUMPTION: 此查詢只供寫入成功後的日誌使用；缺漏或失敗不阻擋儲存，
 * 也不把已移除者列為本次表單必須通過驗證的人員。
 */
async function previousDirectoryNames(
  prev: TeamStaffSnapshot,
  fields: TeamFormCommonFields,
): Promise<Map<string, string>> {
  const uids = stringUids([
    ...(prev.captainUid && fields.captainUid
      && prev.captainUid !== fields.captainUid ? [prev.captainUid] : []),
    ...(prev.leaderUids ?? []).filter(uid => !fields.leaderUids.includes(uid)),
    ...(prev.coachUids ?? []).filter(uid => !fields.coachUids.includes(uid)),
  ]);
  const names = new Map<string, string>();
  if (uids.length === 0) return names;

  try {
    const verification = await verifyUserDirectorySelection(uids);
    const users = directoryUsersByUid(verification.users);
    const missing = new Set(verification.missingUids.map(uid => uid.trim()));
    for (const uid of uids) {
      if (missing.has(uid)) continue;
      const user = users.get(uid);
      const name = user?.name?.trim() || user?.displayName?.trim();
      if (name) names.set(uid, name);
    }
  } catch {
    // 姓名查詢失敗仍逐筆寫日誌，由已擷取的 team 名稱快取及 '?' 補位。
  }
  return names;
}

function staffUids(values: TeamFormValues): string[] {
  return [...new Set([
    values.captain?.uid,
    ...values.leaders.map(member => member.uid),
    ...values.coaches.map(member => member.uid),
  ].map(uid => (uid || '').trim()).filter(Boolean))];
}

function stringUids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    (value as unknown[])
      .filter((uid): uid is string => typeof uid === 'string')
      .map(uid => uid.trim())
      .filter(Boolean),
  )];
}

function previousStaff(team: TeamDoc): TeamStaffSnapshot {
  return {
    captainUid: team.captainUid,
    leaderUids: getTeamLeaderUidList(team),
    coachUids: stringUids(team.coachUids),
  };
}

/** 只驗本次表單的 UID；名稱快取由最新驗證結果更新，未連結舊名原樣保留。 */
async function verifyStaff(values: TeamFormValues): Promise<TeamFormValues | null> {
  const uids = staffUids(values);
  try {
    const verification = await verifyUserDirectorySelection(uids);
    if (!verification.ok) return null;

    const users = directoryUsersByUid(verification.users);
    const missing = new Set(verification.missingUids.map(uid => uid.trim()));
    if (uids.some(uid => missing.has(uid) || !users.has(uid))) return null;

    const refresh = (member: TeamFormStaffMember): TeamFormStaffMember => {
      const uid = member.uid.trim();
      const user = users.get(uid);
      return {
        uid,
        name: user?.name?.trim() || user?.displayName?.trim() || member.name,
      };
    };
    return {
      ...values,
      captain: values.captain ? refresh(values.captain) : null,
      leaders: values.leaders.map(refresh),
      coaches: values.coaches.map(refresh),
      unresolvedLeaderNames: [...values.unresolvedLeaderNames],
      unresolvedCoachNames: [...values.unresolvedCoachNames],
    };
  } catch {
    return null;
  }
}

/** 僅接受本次新圖；失敗不回滾、不把 null 或 data URL 寫進文件。 */
async function uploadImages(
  teamId: string,
  images: TeamFormImages,
  now?: () => number,
): Promise<TeamFormImageVariants | undefined> {
  const variants: TeamFormImageVariants = {};
  for (const key of ['cover', 'card'] as const) {
    const dataUrl = key === 'cover' ? images.coverDataUrl : images.cardDataUrl;
    if (!dataUrl) continue;

    await bestEffort(`uploadTeamImage:${key}`, async () => {
      const path = `teams/${teamId}_${key}`;
      const url = now
        ? await uploadImageDataUrl(dataUrl, path, now)
        : await uploadImageDataUrl(dataUrl, path);
      if (url) variants[key] = url;
    });
  }
  return variants.cover || variants.card ? variants : undefined;
}

type Operation = {
  type: 'team_create' | 'team_edit' | 'team_position';
  typeName: string;
  content: string;
};

function operations(
  fields: TeamFormCommonFields,
  values: TeamFormValues,
  prev: TeamStaffSnapshot | null,
  previousNames?: PreviousStaffNames,
  directoryNames: ReadonlyMap<string, string> = new Map(),
): Operation[] {
  const name = fields.name;
  const result: Operation[] = [{
    type: prev === null ? 'team_create' : 'team_edit',
    typeName: prev === null ? '建立俱樂部' : '編輯俱樂部',
    content: prev === null ? `建立「${name}」` : `編輯「${name}」`,
  }];
  const position = (content: string): void => {
    result.push({ type: 'team_position', typeName: '俱樂部職位變更', content });
  };

  if (prev === null) {
    if (fields.captain) position(`設定「${fields.captain}」為「${name}」俱樂部經理`);
    fields.leaderNames.forEach(label => position(`新增「${label}」為「${name}」領隊`));
    fields.coachNames.forEach(label => position(`新增「${label}」為「${name}」教練`));
    return result;
  }

  const diff = diffStaffForNotify(prev, fields);
  if (diff.notifyCaptain) {
    if (prev.captainUid) {
      const oldUid = prev.captainUid.trim();
      const oldName = directoryNames.get(oldUid)
        || previousNames?.captain.get(oldUid)
        || '?';
      position(`「${name}」俱樂部經理由「${oldName}」轉移至「${fields.captain}」`);
    } else {
      position(`設定「${fields.captain}」為「${name}」俱樂部經理`);
    }
  }
  for (const uid of diff.notifyLeaders) {
    const label = values.leaders.find(member => member.uid === uid)?.name || '?';
    position(`新增「${label}」為「${name}」領隊`);
  }
  for (const uid of prev.leaderUids ?? []) {
    if (fields.leaderUids.includes(uid)) continue;
    const label = directoryNames.get(uid) || previousNames?.leader.get(uid) || '?';
    position(`移除「${label}」的「${name}」領隊職位`);
  }
  for (const uid of diff.notifyCoaches) {
    const label = values.coaches.find(member => member.uid === uid)?.name || '?';
    position(`新增「${label}」為「${name}」教練`);
  }
  for (const uid of prev.coachUids ?? []) {
    if (fields.coachUids.includes(uid)) continue;
    const label = directoryNames.get(uid) || previousNames?.coach.get(uid) || '?';
    position(`移除「${label}」的「${name}」教練職位`);
  }
  // 移除者寫職務日誌及重算，不寄指派通知。
  // 降職預覽、轉移確認對話框屬 UI，本卡不實作。
  return result;
}

/**
 * 所有副作用個別 best-effort，且由 allSettled 等待。
 * bestEffort 會吞掉拒絕，因此重算需在其內部另外記錄完成狀態。
 */
async function afterSave(
  viewer: TeamFormViewer,
  teamId: string,
  fields: TeamFormCommonFields,
  values: TeamFormValues,
  prev: TeamStaffSnapshot | null,
  previousNames?: PreviousStaffNames,
): Promise<boolean> {
  const diff = diffStaffForNotify(prev, fields);
  const tasks: Promise<unknown>[] = [];
  const completed = new Set<string>();

  for (const uid of diff.recalcUids) {
    tasks.push(bestEffort('autoPromoteTeamRole', async () => {
      const response = await recalculateRole(uid, teamId);
      if (response && typeof response === 'object' && response.success !== false) {
        completed.add(uid);
      }
    }));
  }

  const notify = (uid: string, key: 'captain' | 'leader' | 'coach'): void => {
    const label = { captain: '俱樂部經理', leader: '領隊', coach: '教練' }[key];
    const title = '俱樂部職位指派';
    const body = `您已被設為「${fields.name}」的${label}。`;
    tasks.push(bestEffort('deliverInboxMessage', () => deliverInboxMessage({
      title,
      body,
      category: 'system',
      categoryName: '系統',
      targetUid: uid,
      senderName: '系統',
      senderUid: viewer.uid,
    })));
    tasks.push(bestEffort('enqueuePrivilegedLineNotification', () =>
      callFn('enqueuePrivilegedLineNotification', {
        uid,
        title,
        body,
        category: 'system',
        source: `team_role_assignment:${key}`,
      })));
  };

  if (diff.notifyCaptain) notify(diff.notifyCaptain, 'captain');
  diff.notifyLeaders.forEach(uid => notify(uid, 'leader'));
  diff.notifyCoaches.forEach(uid => notify(uid, 'coach'));

  tasks.push((async () => {
    const directoryNames = prev
      ? await previousDirectoryNames(prev, fields)
      : new Map<string, string>();
    await Promise.allSettled(
      operations(fields, values, prev, previousNames, directoryNames).map(operation =>
        bestEffort('writeOpLog', () => writeOpLog({
          ...operation,
          actorUid: viewer.uid,
          operator: viewer.displayName || '系統',
        }))),
    );
  })());

  // role_upgrade 站內信及 role 操作日誌不屬本卡範圍。
  await Promise.allSettled(tasks);
  return diff.recalcUids.every(uid => completed.has(uid));
}

function createFailure(error: unknown): SubmitTeamResult {
  const reason = error instanceof Error && error.message
    ? error.message
    : typeof error === 'string' && error ? error : '請稍後再試';
  return { ok: false, reason: 'write-failed', message: `儲存失敗：${reason}` };
}

export async function submitCreateTeam(
  input: SubmitCreateTeamInput,
): Promise<SubmitTeamResult> {
  try {
    const { viewer, now } = input;
    const values = snapshotValues(input.values);
    // TeamFormImages 的欄位皆為字串；複製物件即與原輸入完全隔離。
    const images: TeamFormImages = { ...input.images };
    if (!canCreateTeam(viewer)) return { ok: false, reason: 'forbidden' };
    if (
      (values.coaches.length > 0
        || values.unresolvedCoachNames.some(name => name.trim().length > 0))
      && !canAssignCoach(viewer)
    ) {
      return { ok: false, reason: 'forbidden', message: '權限不足' };
    }

    const validation = validateTeamFormValues(values, 'create');
    if (!validation.ok) {
      return { ok: false, reason: 'invalid', message: validation.message };
    }
    if (values.captain?.uid !== viewer.uid) {
      return { ok: false, reason: 'captain-mismatch' };
    }

    const verifiedValues = await verifyStaff(values);
    if (!verifiedValues) {
      return { ok: false, reason: 'verify-failed', message: VERIFY_MESSAGE };
    }

    const teamId = generateId(ID_PREFIX.team);
    const variants = await uploadImages(teamId, images, now);
    const payload = buildCreateTeamPayload({
      teamId,
      values: verifiedValues,
      contactLinks: validation.contactLinks,
      image: resolveDefaultTeamCoverImage(),
      imageVariants: variants ?? null,
    });
    await createTeamDoc(teamId, payload);

    let roleSyncOk = false;
    await bestEffort('afterCreateTeam', async () => {
      roleSyncOk = await afterSave(viewer, teamId, payload, verifiedValues, null);
    });
    return { ok: true, teamId, roleSyncOk };
  } catch (error: unknown) {
    return createFailure(error);
  }
}

export async function submitEditTeam(
  input: SubmitEditTeamInput,
): Promise<SubmitTeamResult> {
  try {
    const { viewer } = input;
    const values = snapshotValues(input.values);
    const images: TeamFormImages = { ...input.images };
    const team = { ...input.team };
    const prev = previousStaff(team);
    const previousNames = snapshotPreviousNames(team, prev);
    // ASSUMPTION: 既有 helper 若接受完整 ClubViewer，補最小 teamIds；
    // 編輯權限仍完全交給 helper 以 owner/captain/creator UID 或 manage_all 判定。
    const policyViewer = {
      ...viewer,
      hasPermission: (code: string) => viewer.hasPermission(code),
      teamIds: new Set<string>(),
    };
    if (!canEditTeamSettings(policyViewer, team)) {
      return { ok: false, reason: 'forbidden', message: '權限不足' };
    }

    const oldCoachUids = new Set(prev.coachUids ?? []);
    const hasNewCoach = values.coaches.some(member => {
      const uid = member.uid.trim();
      return uid.length > 0 && !oldCoachUids.has(uid);
    });
    if (hasNewCoach && !canAssignCoach(viewer)) {
      return { ok: false, reason: 'forbidden', message: '權限不足' };
    }

    const validation = validateTeamFormValues(values, 'edit');
    if (!validation.ok) {
      return { ok: false, reason: 'invalid', message: validation.message };
    }
    if (
      (values.captain?.uid || null) !== (team.captainUid || null)
      && !canTransferCaptain(viewer, team)
    ) {
      return { ok: false, reason: 'forbidden', message: '權限不足' };
    }

    const verifiedValues = await verifyStaff(values);
    if (!verifiedValues) {
      return { ok: false, reason: 'verify-failed', message: VERIFY_MESSAGE };
    }

    const teamId = team.id ?? team._docId ?? '';
    if (!teamId) throw new Error('team id missing');
    const variants = await uploadImages(teamId, images);
    const patch = buildUpdateTeamPatch({
      values: verifiedValues,
      contactLinks: validation.contactLinks,
      ...(variants ? { imageVariants: variants } : {}),
    });
    await updateTeamBasicDoc(team, patch);

    let roleSyncOk = false;
    await bestEffort('afterEditTeam', async () => {
      roleSyncOk = await afterSave(
        viewer, teamId, patch, verifiedValues, prev, previousNames,
      );
    });
    return { ok: true, teamId, roleSyncOk };
  } catch {
    return {
      ok: false,
      reason: 'write-failed',
      message: '俱樂部更新失敗，請重試',
    };
  }
}
