/**
 * 新站「賽事」卡片的讀寫（T-089）。②a 直寫：FC Functions 沒有對應 Callable，權限由 Rules
 * `match /tournamentCards/{id}` 把關（read 公開；create/update/delete 限 `isSuperAdmin() || hasEffectivePerm('admin.tournaments.entry')`）。
 *
 * - 讀取：進頁只發 1 個查詢（`orderBy('startDate','desc')`＋`limit(100)`），頁籤與開關在前端篩。
 * - 寫入：每個函式最前面都驗 `canManageTournamentCards`（與按鈕同一個判斷，R-IAM-010／011），
 *   再用 `assertAllowedFields` 擋住欄位白名單以外的欄位。
 * - 圖片：Storage `tournamentCards/{id}/cover_{時間}.webp`，依上傳 bucket 順序嘗試（同活動封面）。
 *   換圖、刪卡後舊圖片 best-effort 刪除，失敗只記警告，不影響主結果。
 * - 不讀不寫舊站 `tournaments` 集合。
 */
import type { Firestore } from 'firebase/firestore';
import { getFirebase as defaultGetFirebase } from '@/data/firebase';
import { loadFirestoreSdk, type FirestoreSdk } from '@/data/firestore-sdk';
import { generateId } from '@/data/ids';
import { getStorageUploadTargets } from '@/data/storage';
import { assertAllowedFields } from '@/data/write-guard';
import {
  TOURNAMENT_CARDS_COLLECTION,
  TOURNAMENT_CARDS_LIMIT,
  TOURNAMENT_CARD_ID_PREFIX,
  buildTournamentCardWrite,
  canManageTournamentCards,
  sortTournamentCards,
  toTournamentCard,
  type TournamentCard,
  type TournamentCardActor,
  type TournamentCardWrite,
} from './card-model';

/** 建立時寫入的欄位（Rules 白名單同一份）。 */
export const CREATE_FIELDS = [
  'name',
  'type',
  'startDate',
  'endDate',
  'url',
  'image',
  'imagePath',
  'createdBy',
  'createdAt',
  'updatedAt',
] as const;
/** 編輯時寫入的欄位（createdBy／createdAt 不可改）。 */
export const UPDATE_FIELDS = [
  'name',
  'type',
  'startDate',
  'endDate',
  'url',
  'image',
  'imagePath',
  'updatedAt',
] as const;

/** Storage Rules 上限是嚴格小於 2MB。 */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const CARD_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

export class TournamentCardError extends Error {
  readonly code: 'permission-denied' | 'invalid-id' | 'invalid-payload' | 'image-too-large';

  constructor(code: TournamentCardError['code'], message: string) {
    super(message);
    this.name = 'TournamentCardError';
    this.code = code;
  }
}

export interface UploadedImage {
  url: string;
  path: string;
}

export interface CardsRepoDeps {
  getFirebase?: () => Promise<{ db: Firestore }>;
  loadSdk?: () => Promise<FirestoreSdk>;
  newId?: () => string;
  now?: () => number;
  storage?: {
    upload(dataUrl: string, path: string): Promise<string | null>;
    remove(path: string): Promise<void>;
  };
  warn?: (...args: unknown[]) => void;
}

async function getContext(deps: CardsRepoDeps): Promise<{ db: Firestore; sdk: FirestoreSdk }> {
  const [{ db }, sdk] = await Promise.all([
    (deps.getFirebase ?? defaultGetFirebase)(),
    (deps.loadSdk ?? loadFirestoreSdk)(),
  ]);
  return { db, sdk };
}

function assertCanManage(actor: TournamentCardActor | null | undefined): asserts actor is TournamentCardActor & { uid: string } {
  if (!canManageTournamentCards(actor)) {
    throw new TournamentCardError('permission-denied', 'admin.tournaments.entry required');
  }
}

function assertCardId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !CARD_ID_RE.test(id)) {
    throw new TournamentCardError('invalid-id', 'invalid tournament card id');
  }
}

/** 寫入層再驗一次表單結果（元件漏驗或強轉都進不來）。 */
function validatedWrite(write: TournamentCardWrite): TournamentCardWrite {
  const result = buildTournamentCardWrite(write);
  if (!result.ok) throw new TournamentCardError('invalid-payload', `invalid ${result.error}`);
  return result.write;
}

/** data URL 解碼後的位元組數（由 base64 長度推算）。 */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const body = dataUrl.slice(comma + 1);
  if (!/;base64,/i.test(dataUrl.slice(0, comma + 1))) return body.length;
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

// ── 讀取 ───────────────────────────────────────────────

/** 進頁唯一的查詢：開始日新→舊、最多 100 筆。讀取公開，不需權限。 */
export async function loadTournamentCards(deps: CardsRepoDeps = {}): Promise<TournamentCard[]> {
  const { db, sdk } = await getContext(deps);
  const snap = await sdk.getDocs(
    sdk.query(
      sdk.collection(db, TOURNAMENT_CARDS_COLLECTION),
      sdk.orderBy('startDate', 'desc'),
      sdk.limit(TOURNAMENT_CARDS_LIMIT),
    ),
  );
  const cards: TournamentCard[] = [];
  for (const docSnap of snap.docs) {
    const card = toTournamentCard(docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>);
    if (card) cards.push(card);
  }
  return sortTournamentCards(cards);
}

// ── Storage ────────────────────────────────────────────

async function defaultUpload(dataUrl: string, path: string): Promise<string | null> {
  const [{ ref, uploadString, getDownloadURL }, targets] = await Promise.all([
    import('firebase/storage'),
    getStorageUploadTargets(),
  ]);
  const metadata: { cacheControl: string; contentType?: string } = {
    cacheControl: 'public, max-age=31536000',
  };
  const contentType = /^data:([^;,]+)/.exec(dataUrl)?.[1]?.trim();
  if (contentType) metadata.contentType = contentType;
  for (const target of targets) {
    try {
      const snapshot = await uploadString(ref(target.service, path), dataUrl, 'data_url', metadata);
      return await getDownloadURL(snapshot.ref);
    } catch {
      // 同活動封面：目前 bucket 失敗後試下一個。
    }
  }
  return null;
}

async function defaultRemove(path: string): Promise<void> {
  const [{ ref, deleteObject }, targets] = await Promise.all([
    import('firebase/storage'),
    getStorageUploadTargets(),
  ]);
  let lastError: unknown = null;
  for (const target of targets) {
    try {
      await deleteObject(ref(target.service, path));
      return;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
}

function storageOf(deps: CardsRepoDeps): NonNullable<CardsRepoDeps['storage']> {
  return deps.storage ?? { upload: defaultUpload, remove: defaultRemove };
}

/** 舊圖片 best-effort 刪除：失敗只記警告。 */
async function removeImageQuietly(path: string, deps: CardsRepoDeps): Promise<void> {
  if (!path) return;
  try {
    await storageOf(deps).remove(path);
  } catch (err) {
    (deps.warn ?? ((...args: unknown[]) => console.warn(...args)))(
      '[tournament-cards] image cleanup failed',
      path,
      err,
    );
  }
}

/** 上傳裁切後的圖片；上傳失敗回 null，超過大小丟錯。 */
export async function uploadTournamentCardImage(
  cardId: string,
  dataUrl: string,
  actor: TournamentCardActor | null | undefined,
  deps: CardsRepoDeps = {},
): Promise<UploadedImage | null> {
  assertCanManage(actor);
  assertCardId(cardId);
  if (!/^data:image\//i.test(dataUrl)) {
    throw new TournamentCardError('invalid-payload', 'image must be a data URL');
  }
  if (dataUrlBytes(dataUrl) >= IMAGE_MAX_BYTES) {
    throw new TournamentCardError('image-too-large', 'image exceeds 2MB');
  }
  const path = `${TOURNAMENT_CARDS_COLLECTION}/${cardId}/cover_${(deps.now ?? Date.now)()}.webp`;
  const url = await storageOf(deps).upload(dataUrl, path);
  return url ? { url, path } : null;
}

// ── 寫入 ───────────────────────────────────────────────

export function newTournamentCardId(deps: CardsRepoDeps = {}): string {
  return (deps.newId ?? (() => generateId(TOURNAMENT_CARD_ID_PREFIX)))();
}

export interface SaveCardInput {
  /** 編輯時是既有卡片；新增時 null。 */
  existing: TournamentCard | null;
  /** 新增時先產生好的 id（上傳圖片與寫文件共用）。 */
  id: string;
  write: TournamentCardWrite;
  /** 本次新上傳的圖片；沒換圖時 null。 */
  image: UploadedImage | null;
}

/**
 * 新增或編輯。成功回寫入後的卡片（頁面直接更新本機清單，不重讀）。
 * 文件寫入失敗時，本次新上傳的圖片 best-effort 刪除後再丟錯；換圖成功後才刪舊圖。
 */
export async function saveTournamentCard(
  input: SaveCardInput,
  actor: TournamentCardActor | null | undefined,
  deps: CardsRepoDeps = {},
): Promise<TournamentCard> {
  assertCanManage(actor);
  const id = input.existing ? input.existing.id : input.id;
  assertCardId(id);
  const write = validatedWrite(input.write);
  const image = input.image ?? (input.existing
    ? { url: input.existing.image, path: input.existing.imagePath }
    : { url: '', path: '' });

  try {
    const { db, sdk } = await getContext(deps);
    const ref = sdk.doc(db, TOURNAMENT_CARDS_COLLECTION, id);
    if (input.existing) {
      const fields: Record<string, unknown> = {
        ...write,
        image: image.url,
        imagePath: image.path,
        updatedAt: sdk.serverTimestamp(),
      };
      assertAllowedFields('tournamentCard.update', fields, UPDATE_FIELDS);
      await sdk.updateDoc(ref, fields);
    } else {
      const fields: Record<string, unknown> = {
        ...write,
        image: image.url,
        imagePath: image.path,
        createdBy: actor.uid,
        createdAt: sdk.serverTimestamp(),
        updatedAt: sdk.serverTimestamp(),
      };
      assertAllowedFields('tournamentCard.create', fields, CREATE_FIELDS);
      await sdk.setDoc(ref, fields);
    }
  } catch (err) {
    if (input.image) await removeImageQuietly(input.image.path, deps);
    throw err;
  }

  if (input.image && input.existing?.imagePath && input.existing.imagePath !== input.image.path) {
    await removeImageQuietly(input.existing.imagePath, deps);
  }
  return { id, ...write, image: image.url, imagePath: image.path };
}

/** 刪除卡片；成功後 best-effort 刪除它的圖片。 */
export async function deleteTournamentCard(
  card: Pick<TournamentCard, 'id' | 'imagePath'>,
  actor: TournamentCardActor | null | undefined,
  deps: CardsRepoDeps = {},
): Promise<void> {
  assertCanManage(actor);
  assertCardId(card.id);
  const { db, sdk } = await getContext(deps);
  await sdk.deleteDoc(sdk.doc(db, TOURNAMENT_CARDS_COLLECTION, card.id));
  await removeImageQuietly(card.imagePath, deps);
}
