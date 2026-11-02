/**
 * 新站「賽事」卡片的讀寫（T-089）。②a 直寫：FC Functions 沒有對應 Callable，權限由 Rules
 * `match /tournamentCards/{id}` 把關（read 公開；create/update/delete 限 `isSuperAdmin() || hasEffectivePerm('admin.tournaments.manage_all')`）。
 *
 * - 讀取：進頁只發 1 個查詢（`orderBy('startDate','desc')`＋`limit(100)`），頁籤與開關在前端篩。
 * - 寫入：每個函式最前面都驗 `canManageTournamentCards`（與按鈕同一個判斷，R-IAM-010／011），
 *   再用 `assertAllowedFields` 擋住欄位白名單以外的欄位。
 * - 圖片：Storage `images/tournamentCards/{id}/cover_{時間}.webp`，依上傳 bucket 順序嘗試（同活動封面）。
 *   沿用 images/** 規則：登入可上傳、任何人都不能刪（顧問 2026-11-02 裁定 Storage 不讀 Firestore），
 *   所以換圖、刪卡都不刪舊圖。沒有圖片時 image／imagePath 不寫（Rules 要求有就要合格）。
 * - 卡片 ID 用 `generateId('tc_')`（R-ID-006；與舊站 `ct_` 賽事無橋接、不互查）。
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

/** 建立時寫入的欄位（Rules 白名單同一份；image／imagePath 只在有圖片時寫）。 */
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
/** 編輯時寫入的欄位（createdBy／createdAt 不可改；image／imagePath 只在換圖時寫）。 */
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

/** Storage 圖片的資料夾（與 Rules `imagePath.matches('images/tournamentCards/' + cardId + '/[^/]+')` 一致）。 */
export const IMAGE_FOLDER = 'images/tournamentCards';
/** Storage Rules 上限是嚴格小於 2MB。 */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** 與 Rules `cardId.matches('tc_[A-Za-z0-9_]+')` 一致（generateId('tc_') 的產物都符合）。 */
const CARD_ID_RE = /^tc_[A-Za-z0-9_]{1,117}$/;

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
  upload?: (dataUrl: string, path: string) => Promise<string | null>;
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
    throw new TournamentCardError('permission-denied', 'admin.tournaments.manage_all required');
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

/** 上傳後的圖片要與 Rules 一致：網址 https、路徑在本卡的 images/tournamentCards 資料夾下。 */
function assertUploadedImage(id: string, image: UploadedImage): void {
  if (!/^https:\/\/[!-~]+$/.test(image.url) || !image.path.startsWith(`${IMAGE_FOLDER}/${id}/`)) {
    throw new TournamentCardError('invalid-payload', 'invalid uploaded image');
  }
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
  const path = `${IMAGE_FOLDER}/${cardId}/cover_${(deps.now ?? Date.now)()}.webp`;
  const url = await (deps.upload ?? defaultUpload)(dataUrl, path);
  return url ? { url, path } : null;
}

// ── 寫入 ───────────────────────────────────────────────

/** 新卡片 ID：`generateId('tc_')`（`tc_<毫秒時間戳>_<6 碼 base36>`）。 */
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

/** 新增或編輯。成功回寫入後的卡片（頁面直接更新本機清單，不重讀）。 */
export async function saveTournamentCard(
  input: SaveCardInput,
  actor: TournamentCardActor | null | undefined,
  deps: CardsRepoDeps = {},
): Promise<TournamentCard> {
  assertCanManage(actor);
  const id = input.existing ? input.existing.id : input.id;
  assertCardId(id);
  const write = validatedWrite(input.write);
  if (input.image) assertUploadedImage(id, input.image);
  const imageFields: Record<string, unknown> = input.image
    ? { image: input.image.url, imagePath: input.image.path }
    : {};

  const { db, sdk } = await getContext(deps);
  const ref = sdk.doc(db, TOURNAMENT_CARDS_COLLECTION, id);
  if (input.existing) {
    const fields: Record<string, unknown> = {
      ...write,
      ...imageFields,
      updatedAt: sdk.serverTimestamp(),
    };
    assertAllowedFields('tournamentCard.update', fields, UPDATE_FIELDS);
    await sdk.updateDoc(ref, fields);
  } else {
    const fields: Record<string, unknown> = {
      ...write,
      ...imageFields,
      createdBy: actor.uid,
      createdAt: sdk.serverTimestamp(),
      updatedAt: sdk.serverTimestamp(),
    };
    assertAllowedFields('tournamentCard.create', fields, CREATE_FIELDS);
    await sdk.setDoc(ref, fields);
  }

  const image = input.image ?? (input.existing
    ? { url: input.existing.image, path: input.existing.imagePath }
    : { url: '', path: '' });
  return { id, ...write, image: image.url, imagePath: image.path };
}

/** 刪除卡片文件（Storage 圖片不能刪，留在原處）。 */
export async function deleteTournamentCard(
  card: Pick<TournamentCard, 'id'>,
  actor: TournamentCardActor | null | undefined,
  deps: CardsRepoDeps = {},
): Promise<void> {
  assertCanManage(actor);
  assertCardId(card.id);
  const { db, sdk } = await getContext(deps);
  await sdk.deleteDoc(sdk.doc(db, TOURNAMENT_CARDS_COLLECTION, card.id));
}
