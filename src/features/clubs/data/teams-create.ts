import { callFn } from '@/data/callables';
import { getFirebase } from '@/data/firebase';
import { teams as teamsCollection } from '@/data/paths';
import type { CreateTeamPayload, UpdateTeamPatch } from './team-form-model';
import { invalidateTeams } from './teams-repo';
import type { TeamWriteTarget } from './teams-write';

export type TeamCreatePayload = CreateTeamPayload;
export type TeamBasicPatch = UpdateTeamPatch;

const basicKeys = new Set<string>([
  'name', 'nameEn', 'nationality', 'region', 'founded', 'contact', 'bio',
  'contactLinksEnabled', 'contactLinks',
  'leader', 'leaderUid', 'leaders', 'leaderUids', 'leaderNames',
  'captain', 'captainUid', 'captainName',
  'coaches', 'coachUids', 'coachNames',
  'type', 'sportTag', 'teachingEnabled', 'eduSettings',
  'image', 'imageVariants',
]);

const createKeys = new Set<string>([
  ...basicKeys,
  'id', 'members', 'active', 'pinned', 'pinOrder',
  'wins', 'draws', 'losses', 'gf', 'ga', 'history',
]);

/**
 * T-090：Callable createUserTeam 的 team 只接受基本欄位；幹部欄位（leader*／captain*／coach*）
 * 伺服器會覆寫，B 不送，免得表單看起來能指派他人。
 */
const userCreateKeys = new Set<string>([
  'name', 'nameEn', 'nationality', 'region', 'founded', 'contact', 'bio',
  'contactLinksEnabled', 'contactLinks',
  'type', 'sportTag', 'teachingEnabled', 'eduSettings',
  'image', 'imageVariants',
]);

const USER_TEAM_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

function fail(message: string): never {
  throw new Error(`[teams-create] ${message}`);
}

function assertKeys(value: unknown, allowed: ReadonlySet<string>): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('payload must be an object');
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('payload must be a plain object');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      fail('unexpected field');
    }
  }
}

function resolveDocId(target: TeamWriteTarget): string {
  const docId = typeof target?._docId === 'string' ? target._docId.trim() : '';
  const id = typeof target?.id === 'string' ? target.id.trim() : '';
  if (!docId && !id) fail('team doc id missing');
  return docId || id;
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

/** R-ID-004：新文件 id 與文件路徑一致；setDoc 不帶 merge。 */
export async function createTeamDoc(
  teamId: string,
  payload: TeamCreatePayload,
): Promise<void> {
  if (typeof teamId !== 'string' || !/^tm_\d{13}_[a-z0-9]{1,8}$/.test(teamId)) {
    fail('invalid team id');
  }
  assertKeys(payload, createKeys);
  if (payload.id !== teamId) fail('payload id must match team id');

  const { firestore, ref } = await writeContext(teamId);
  await firestore.setDoc(ref, {
    ...payload,
    createdAt: firestore.serverTimestamp(),
    updatedAt: firestore.serverTimestamp(),
  });
  invalidateTeams();
}

/** 編輯只寫 CONTRACT.md 第二節欄位；eduSettings:null 表示刪除。 */
export async function updateTeamBasicDoc(
  target: TeamWriteTarget,
  // T-090：一般用戶建立後只補寫 image／imageVariants，故接受部分欄位；鍵仍由 basicKeys 白名單把關。
  patch: Partial<TeamBasicPatch>,
): Promise<void> {
  const docId = resolveDocId(target);
  assertKeys(patch, basicKeys);
  if (Reflect.ownKeys(patch).length === 0) fail('patch is empty');

  const { firestore, ref } = await writeContext(docId);
  const { eduSettings, ...fields } = patch;
  await firestore.updateDoc(ref, {
    ...fields,
    ...(eduSettings !== undefined
      ? { eduSettings: eduSettings === null ? firestore.deleteField() : eduSettings }
      : {}),
    updatedAt: firestore.serverTimestamp(),
  });
  invalidateTeams();
}

export interface UserTeamCreateResult {
  teamId: string;
  created: boolean;
}

/** 從建立 payload 只挑 Callable 接受的基本欄位；值為 undefined 或 imageVariants 為 null 的不送。 */
export function pickUserTeamCreateFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const team: Record<string, unknown> = {};
  for (const key of userCreateKeys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    const value = payload[key];
    if (value === undefined) continue;
    if (key === 'imageVariants' && value === null) continue;
    team[key] = value;
  }
  return team;
}

/**
 * T-090：一般用戶建立俱樂部唯一路徑（Callable createUserTeam，asia-east1）。
 * requestId 由表單開啟時產生一次，重送沿用；伺服器以它去重（created:false 回原 teamId）。
 * 錯誤原樣往外拋（CallableError），由呼叫端轉成使用者文案。
 */
export async function createUserTeamViaCallable(
  requestId: string,
  team: Record<string, unknown>,
): Promise<UserTeamCreateResult> {
  if (typeof requestId !== 'string' || !USER_TEAM_REQUEST_ID.test(requestId)) {
    fail('invalid request id');
  }
  assertKeys(team, userCreateKeys);
  const response = await callFn('createUserTeam', { requestId, team });
  const teamId = typeof response?.teamId === 'string' ? response.teamId.trim() : '';
  if (response?.ok !== true || !teamId) fail('unexpected response');
  invalidateTeams();
  return { teamId, created: response.created !== false };
}
