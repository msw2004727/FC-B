/**
 * 俱樂部文件寫入層。
 *
 * 欄位對照（A → B，集合均為 teams）：
 * - 頭像：avatarUrl → avatarUrl。
 * - 封面：image → image。
 * - 封面尺寸：imageVariants.cover → imageVariants.cover；
 *   imageVariants.card → imageVariants.card；
 *   imageVariants.square → imageVariants.square。
 * - 設定：type → type；teachingEnabled → teachingEnabled；
 *   eduSettings → eduSettings（null 轉 deleteField）；
 *   allowMemberInvite → allowMemberInvite；
 *   themeColor → themeColor（null 保留）；
 *   themeOverlayEnabled → themeOverlayEnabled；
 *   detailVisibility → detailVisibility。
 * - 職務：leaderUids → leaderUids；leaders → leaders；
 *   leaderNames → leaderNames；leaderUid → leaderUid；leader → leader；
 *   coachUids → coachUids；coaches → coaches；coachNames → coachNames。
 * - 活動備註：memberActivityData[uid].notes → 同名欄位；
 *   memberActivityData[uid].updatedAt → 同名 ISO 字串欄位。
 * - 課程備註：memberCourseData[uid].notes → 同名欄位；
 *   memberCourseData[uid].updatedAt → 同名 ISO 字串欄位。
 * - 所有動作：文件 updatedAt → updatedAt（serverTimestamp）。
 *
 * 對應 A updateTeam／updateTeamAwait；備註保留現有成員紀錄的其他欄位。
 * 不寫入 coverUrl、captainUid、captainName 或 members。
 * 實際授權由共用 Firestore Rules 判定。
 */

import type { FieldValue } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import { teams as teamsCollection } from '@/data/paths';
import { buildMemberRoleUpdates } from '../club-policy';
import type { MemberRoleKey, MemberRoleUpdates } from '../club-policy';
import { invalidateTeams } from './teams-repo';
import type { TeamDoc } from './types';

/** 對應 A updateTeam 的文件定位；優先使用 _docId，缺少時使用 id。 */
export type TeamWriteTarget = Pick<TeamDoc, 'id' | '_docId'>;

/** 對應 A updateTeam 的 imageVariants，僅開放 cover、card、square。 */
export type TeamImageVariantsWrite = {
  cover?: string;
  card?: string;
  square?: string;
};

/**
 * 對應 A 設定控制項、setTeamCategoryTag 與 clearTeamThemeColor。
 * 僅允許以下七欄；eduSettings 的 null 表示刪除，themeColor 的 null 原樣寫入。
 */
export type TeamSettingsPatch = Partial<{
  type: 'none' | 'competitive' | 'education' | 'leisure';
  teachingEnabled: boolean;
  eduSettings: {
    acceptingStudents: boolean;
    teachingEnabled: true;
  } & Record<string, unknown> | null;
  allowMemberInvite: boolean;
  themeColor: string | null;
  themeOverlayEnabled: boolean;
  detailVisibility: Record<string, boolean>;
}>;

/** 對應 A 經 updateTeam 寫入的 memberActivityData／memberCourseData。 */
export type TeamMemberNoteKind = 'activity' | 'course';

const settingsKeys = new Set<string>([
  'type',
  'teachingEnabled',
  'eduSettings',
  'allowMemberInvite',
  'themeColor',
  'themeOverlayEnabled',
  'detailVisibility',
]);

const visibilityKeys = new Set<string>([
  'events', 'courses', 'matches', 'info', 'bio', 'record', 'members',
]);

const roleKeys = new Set<string>([
  'leaderUids',
  'leaders',
  'leaderNames',
  'leaderUid',
  'leader',
  'coachUids',
  'coaches',
  'coachNames',
]);

type SettingsWrite = Omit<TeamSettingsPatch, 'eduSettings'> & {
  eduSettings?: NonNullable<TeamSettingsPatch['eduSettings']> | FieldValue;
};

function fail(message: string): never {
  throw new Error(`[teams-write] ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      fail('unexpected field');
    }
  }
}

function resolveDocId(team: TeamWriteTarget): string {
  const docId = typeof team?._docId === 'string' ? team._docId.trim() : '';
  const id = typeof team?.id === 'string' ? team.id.trim() : '';
  if (!docId && !id) fail('team doc id missing');
  return docId || id;
}

function httpsUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim().startsWith('https://')) {
    fail(`${field} must start with https://`);
  }
  return value.trim();
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) fail(`${field} must be a string array`);
  const result: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') fail(`${field} must be a string array`);
    result.push(item);
  }
  return result;
}

async function writeContext(docId: string) {
  const [firestore, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  return {
    firestore,
    ref: firestore.doc(db, teamsCollection, docId),
  };
}

/** 對應 A updateTeamAwait(teamId, { avatarUrl })，另帶文件 updatedAt。 */
export async function saveTeamAvatar(
  team: TeamWriteTarget,
  avatarUrl: string,
): Promise<void> {
  const docId = resolveDocId(team);
  const normalizedUrl = httpsUrl(avatarUrl, 'avatarUrl');
  const { firestore, ref } = await writeContext(docId);
  await firestore.updateDoc(ref, {
    avatarUrl: normalizedUrl,
    updatedAt: firestore.serverTimestamp(),
  });
  invalidateTeams();
}

/**
 * 對應 A updateTeam 的 image／imageVariants／updatedAt。
 * 提供尺寸圖時驗證所有鍵與值；只接受 cover、card、square 的 HTTPS 網址。
 * 空物件視為未提供，不寫 coverUrl。
 */
export async function saveTeamCover(
  team: TeamWriteTarget,
  payload: { image: string; imageVariants?: TeamImageVariantsWrite },
): Promise<void> {
  const docId = resolveDocId(team);
  if (!isRecord(payload)) fail('cover payload must be an object');
  const image = httpsUrl(payload.image, 'image');
  const variants: TeamImageVariantsWrite = {};
  const source: unknown = payload.imageVariants;

  if (source !== undefined) {
    if (!isRecord(source)) fail('imageVariants must be an object');
    assertKeys(source, new Set(['cover', 'card', 'square']));
    for (const key of ['cover', 'card', 'square'] as const) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const value = source[key];
      if (typeof value !== 'string' || !value.startsWith('https://')) {
        fail(`imageVariants.${key} must start with https://`);
      }
      variants[key] = value.trim();
    }
  }

  const { firestore, ref } = await writeContext(docId);
  await firestore.updateDoc(ref, {
    image,
    ...(Object.keys(variants).length > 0 ? { imageVariants: variants } : {}),
    updatedAt: firestore.serverTimestamp(),
  });
  invalidateTeams();
}

/**
 * 對應 A 設定控制項／setTeamCategoryTag／clearTeamThemeColor 經 updateTeam 寫入。
 * 驗證七欄白名單，eduSettings:null 轉刪除，themeColor 正規化為小寫。
 */
export async function saveTeamSettingsPatch(
  team: TeamWriteTarget,
  patch: TeamSettingsPatch,
): Promise<void> {
  const docId = resolveDocId(team);
  if (!isRecord(patch)) fail('settings patch must be an object');
  assertKeys(patch, settingsKeys);
  if (Reflect.ownKeys(patch).length === 0) fail('settings patch is empty');

  const validated: TeamSettingsPatch = {};
  for (const key of Object.getOwnPropertyNames(patch)) {
    const value: unknown = patch[key as keyof TeamSettingsPatch];
    switch (key) {
      case 'type':
        if (
          value !== 'none' && value !== 'competitive'
          && value !== 'education' && value !== 'leisure'
        ) {
          fail('invalid type');
        }
        validated.type = value;
        break;
      case 'teachingEnabled':
      case 'allowMemberInvite':
      case 'themeOverlayEnabled':
        if (typeof value !== 'boolean') fail(`${key} must be boolean`);
        validated[key] = value;
        break;
      case 'themeColor':
        if (value === null) {
          validated.themeColor = null;
        } else {
          if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
            fail('invalid themeColor');
          }
          validated.themeColor = value.toLowerCase();
        }
        break;
      case 'detailVisibility': {
        if (!isRecord(value)) fail('detailVisibility must be an object');
        assertKeys(value, visibilityKeys);
        const visibility: Record<string, boolean> = {};
        for (const visibilityKey of Object.getOwnPropertyNames(value)) {
          const visible = value[visibilityKey];
          if (typeof visible !== 'boolean') {
            fail('detailVisibility values must be boolean');
          }
          visibility[visibilityKey] = visible;
        }
        validated.detailVisibility = visibility;
        break;
      }
      case 'eduSettings':
        if (value === null) {
          validated.eduSettings = null;
        } else {
          if (
            !isRecord(value)
            || typeof value.acceptingStudents !== 'boolean'
            || value.teachingEnabled !== true
          ) {
            fail('invalid eduSettings');
          }
          validated.eduSettings = value as NonNullable<TeamSettingsPatch['eduSettings']>;
        }
        break;
    }
  }

  const { firestore, ref } = await writeContext(docId);
  const { eduSettings, ...otherSettings } = validated;
  const fields: SettingsWrite = { ...otherSettings };
  if (eduSettings !== undefined) {
    fields.eduSettings = eduSettings === null ? firestore.deleteField() : eduSettings;
  }
  await firestore.updateDoc(ref, {
    ...fields,
    updatedAt: firestore.serverTimestamp(),
  });
  invalidateTeams();
}

/**
 * 對應 A 經 updateTeam 寫入的八個領隊／教練欄位及 updatedAt。
 * 拒絕額外欄位，不寫 captainUid、captainName 或伺服器維護的 members。
 */
export async function saveTeamRoleUpdates(
  team: TeamWriteTarget,
  updates: MemberRoleUpdates,
): Promise<void> {
  const docId = resolveDocId(team);
  if (!isRecord(updates)) fail('role updates must be an object');
  assertKeys(updates, roleKeys);
  for (const key of roleKeys) {
    if (!Object.prototype.hasOwnProperty.call(updates, key)) {
      fail(`missing role field: ${key}`);
    }
  }
  if (updates.leaderUid !== null && typeof updates.leaderUid !== 'string') {
    fail('leaderUid must be string or null');
  }
  if (typeof updates.leader !== 'string') fail('leader must be a string');

  const fields: MemberRoleUpdates = {
    leaderUids: stringArray(updates.leaderUids, 'leaderUids'),
    leaders: stringArray(updates.leaders, 'leaders'),
    leaderNames: stringArray(updates.leaderNames, 'leaderNames'),
    leaderUid: updates.leaderUid,
    leader: updates.leader,
    coachUids: stringArray(updates.coachUids, 'coachUids'),
    coaches: stringArray(updates.coaches, 'coaches'),
    coachNames: stringArray(updates.coachNames, 'coachNames'),
  };
  const { firestore, ref } = await writeContext(docId);
  await firestore.updateDoc(ref, {
    ...fields,
    updatedAt: firestore.serverTimestamp(),
  });
  invalidateTeams();
}

/**
 * 在交易內以最新文件重驗目標並計算八個角色欄位。
 * 不寫 members、captainUid 或 captainName；交易失敗直接往外拋。
 */
export async function saveTeamRoleChange(
  team: TeamWriteTarget,
  targetUid: string,
  targetKey: MemberRoleKey,
  displayName: string,
  guard?: (fresh: TeamDoc) => boolean,
): Promise<MemberRoleUpdates | null> {
  const docId = resolveDocId(team);
  const [firestore, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  const ref = firestore.doc(db, teamsCollection, docId);
  const result = await firestore.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) fail('team document not found');

    const data = snap.data();
    const fresh = {
      ...data,
      _docId: snap.id,
      id: data.id ?? snap.id,
    } as TeamDoc;
    if (guard && !guard(fresh)) return null;

    const updates = buildMemberRoleUpdates(fresh, targetUid, targetKey, displayName);
    if (!updates) return null;

    tx.update(ref, {
      ...updates,
      updatedAt: firestore.serverTimestamp(),
    });
    return updates;
  });
  if (result !== null) invalidateTeams();
  return result;
}

/**
 * 使用 FieldPath 單點更新指定成員的 notes 與 updatedAt。
 * 紀錄 updatedAt 保留 ISO 字串，文件 updatedAt 使用 serverTimestamp，
 * 頂層符合領隊／教練欄位白名單。
 * @param existingRecord 保留相容，已不使用：改用巢狀欄位路徑單點更新，不再重建整筆紀錄
 */
export async function saveTeamMemberNote(
  team: TeamWriteTarget,
  kind: TeamMemberNoteKind,
  memberKey: string,
  record: { notes: string; updatedAt: string },
  existingRecord?: Record<string, unknown> | null,
): Promise<void> {
  const docId = resolveDocId(team);
  if (kind !== 'activity' && kind !== 'course') fail('invalid member note kind');
  if (typeof memberKey !== 'string') fail('invalid memberKey');
  const key = memberKey.trim();
  if (!key || /[/.~*\[\]]/.test(key)) fail('invalid memberKey');
  if (!isRecord(record) || typeof record.notes !== 'string') {
    fail('notes must be a string');
  }
  if (record.notes.length > 120) fail('notes must not exceed 120 characters');

  // ASSUMPTION: 紀錄時間採 A new Date().toISOString() 的標準 UTC 格式。
  if (
    typeof record.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(record.updatedAt))
    || new Date(record.updatedAt).toISOString() !== record.updatedAt
  ) {
    fail('record updatedAt must be an ISO string');
  }
  const fieldName = kind === 'activity' ? 'memberActivityData' : 'memberCourseData';
  const { firestore, ref } = await writeContext(docId);
  await firestore.updateDoc(
    ref,
    new firestore.FieldPath(fieldName, key, 'notes'),
    record.notes,
    new firestore.FieldPath(fieldName, key, 'updatedAt'),
    record.updatedAt,
    'updatedAt',
    firestore.serverTimestamp(),
  );
  invalidateTeams();
}
