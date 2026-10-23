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
  patch: TeamBasicPatch,
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
