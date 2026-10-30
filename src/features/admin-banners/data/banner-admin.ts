/**
 * 後台「首頁管理—Banner 廣告」的資料層（M-145）。
 *
 * 資料契約（②a 直寫）：FC `functions/**` 對 `banners` 沒有 Callable／trigger；Rules `banners`：
 * `read: if true`、`create,update: if isAdmin() || hasEffectivePerm('admin.banners.entry')`（無欄位白名單）、`delete: if false`。
 * - 一律 `updateDoc`（或 transaction 內的 `tx.update`），**絕不 `deleteDoc`／`setDoc`**：A 的「刪除」其實是清空欄位。
 * - 每個動作一個專用 Write 型別＋欄位 allowlist（L-32），執行期再用 `assertAllowedFields` 擋住強轉夾帶的欄位。
 * - 每個寫入函式內部都驗呼叫者權限（R-IAM-010／011）；元件顯示按鈕用同一個 `canManageBanners`。
 * - `updatedAt` 只套用到下列各動作（A `FirebaseService.updateBanner` 每次更新都寫 `updatedAt: serverTimestamp()`）。
 * - 成功寫入後同一用戶端的首頁橫幅快照失效（`invalidateBannersSnapshot`）。
 * - 成功寫入後寫操作日誌（`recordBannerOpLog`，旗標預設開、best-effort，見 banner-audit.ts）；寫入失敗、權限被拒都不寫。
 */
import type { Firestore } from 'firebase/firestore';
import { getFirebase as defaultGetFirebase } from '@/data/firebase';
import { loadFirestoreSdk, type FirestoreSdk } from '@/data/firestore-sdk';
import { assertAllowedFields } from '@/data/write-guard';
import { BANNERS_COLLECTION } from '@/features/home/data/banners';
import { invalidateBannersSnapshot } from '@/features/home/data/home-snapshot';
import {
  buildBannerOpLogEntry,
  recordBannerOpLog,
  recordBannerTransitionAudit,
  type BannerAuditDeps,
  type BannerOpLogDeps,
} from './banner-audit';
import {
  BANNER_PERMISSION,
  bannerLabel,
  isGeneralBannerDoc,
  isSavableLinkUrl,
  planBannerTransitions,
  remainDays,
  toBannerSlot,
  type BannerRef,
  type BannerSaveWrite,
  type BannerSlot,
  type BannerTransition,
} from './banner-model';

// ── 權限 ───────────────────────────────────────────────

export interface BannerActor {
  uid: string | null;
  displayName?: string | null;
  hasPermission(code: string): boolean;
}

/** 入口與所有寫入動作共用同一個判斷（A 全部是 `hasPermission('admin.banners.entry')`）。 */
export function canManageBanners(actor: BannerActor | null | undefined): boolean {
  return (
    !!actor &&
    typeof actor.uid === 'string' &&
    actor.uid.length > 0 &&
    actor.hasPermission(BANNER_PERMISSION) === true
  );
}

export class BannerWriteError extends Error {
  readonly code: 'permission-denied' | 'invalid-doc-id' | 'invalid-payload' | 'relist-expired';

  constructor(code: BannerWriteError['code'], message: string) {
    super(message);
    this.name = 'BannerWriteError';
    this.code = code;
  }
}

function assertCanManage(actor: BannerActor | null | undefined): asserts actor is BannerActor {
  if (!canManageBanners(actor)) {
    throw new BannerWriteError('permission-denied', 'admin.banners.entry required');
  }
}

/** 特殊文件（射門遊戲／觀賽底圖／首頁資訊／版面設定）不屬於橫幅後台，寫入層直接拒絕。 */
const SPECIAL_DOC_IDS: ReadonlySet<string> = new Set([
  'sga1',
  'watch-party-bg',
  'home-info',
  'home-layout',
]);

function assertBannerDocId(docId: unknown): asserts docId is string {
  const id = typeof docId === 'string' ? docId.trim() : '';
  if (!id || id !== docId || id.includes('/') || SPECIAL_DOC_IDS.has(id)) {
    throw new BannerWriteError('invalid-doc-id', 'invalid banner doc id');
  }
}

// ── Write 型別與欄位 allowlist（L-32）──────────────────────

/** 儲存（編輯／設定）：A `saveBanner` 送出的欄位（`updatedAt` 由寫入層加）。 */
export const SAVE_FIELDS = [
  'title',
  'subtitle',
  'titleColor',
  'subtitleColor',
  'slotName',
  'linkUrl',
  'image',
  'publishAt',
  'unpublishAt',
  'status',
] as const;
export type { BannerSaveWrite };

/** 下架（A `delistAd`）。 */
export interface BannerDelistWrite {
  status: 'expired';
}
/** 重新上架（A `relistAd`）。 */
export interface BannerRelistWrite {
  status: 'active';
}
export const STATUS_FIELDS = ['status'] as const;

/** 清空（A `clearAdSlot` 的 emptyData，逐值相同；刪除是清空欄位，不是刪文件）。 */
export interface BannerClearWrite {
  title: '';
  slotName: '';
  linkUrl: '';
  image: null;
  publishAt: null;
  unpublishAt: null;
  status: 'empty';
  clicks: 0;
}
export const CLEAR_FIELDS = [
  'title',
  'slotName',
  'linkUrl',
  'image',
  'publishAt',
  'unpublishAt',
  'status',
  'clicks',
] as const;

export const BANNER_CLEAR_WRITE: Readonly<BannerClearWrite> = Object.freeze({
  title: '',
  slotName: '',
  linkUrl: '',
  image: null,
  publishAt: null,
  unpublishAt: null,
  status: 'empty',
  clicks: 0,
});

// ── 依賴注入（測試用）───────────────────────────────────

export interface BannerDeps {
  getFirebase?: () => Promise<{ db: Firestore }>;
  loadSdk?: () => Promise<FirestoreSdk>;
  now?: () => number;
  /** 惰性轉換的 `writeAuditLog`。 */
  audit?: BannerAuditDeps;
  /** 操作日誌 `operationLogs`（旗標、`writeOpLog` 皆可注入）。 */
  opLog?: BannerOpLogDeps;
  warn?: (...args: unknown[]) => void;
}

async function getContext(deps: BannerDeps): Promise<{ db: Firestore; sdk: FirestoreSdk }> {
  const [{ db }, sdk] = await Promise.all([
    (deps.getFirebase ?? defaultGetFirebase)(),
    (deps.loadSdk ?? loadFirestoreSdk)(),
  ]);
  return { db, sdk };
}

// ── 讀取 ───────────────────────────────────────────────

/** A `_buildCollectionQuery`：banners 集合 limit(200)；只留一般橫幅位（排除特殊文件）。讀取公開，不需權限。 */
export async function loadBannerSlots(deps: BannerDeps = {}): Promise<BannerSlot[]> {
  const { db, sdk } = await getContext(deps);
  const snap = await sdk.getDocs(sdk.query(sdk.collection(db, BANNERS_COLLECTION), sdk.limit(200)));
  const slots: BannerSlot[] = [];
  for (const docSnap of snap.docs) {
    const raw = (docSnap.data() ?? {}) as Record<string, unknown>;
    if (isGeneralBannerDoc(docSnap.id, raw)) slots.push(toBannerSlot(docSnap.id, raw));
  }
  return slots;
}

// ── 寫入 ───────────────────────────────────────────────

/**
 * 驗文件 id、驗 allowlist、`updateDoc`、成功後清首頁快照。呼叫者權限由各個匯出函式在最前面驗（`assertCanManage`）。
 * 寫入失敗會直接丟錯：快照不動、也不會寫操作日誌。
 */
async function updateBannerFields(
  action: string,
  docId: string,
  fields: Record<string, unknown>,
  allowed: readonly string[],
  deps: BannerDeps,
): Promise<void> {
  assertBannerDocId(docId);
  assertAllowedFields(action, fields, allowed);
  const { db, sdk } = await getContext(deps);
  await sdk.updateDoc(sdk.doc(db, BANNERS_COLLECTION, docId), {
    ...fields,
    updatedAt: sdk.serverTimestamp(),
  });
  invalidateBannersSnapshot();
}

/**
 * A `saveBanner` 的最後一步：寫入已驗證的欄位。圖片必須已經是網址（不可把 base64 寫進 Firestore）。
 * 成功後寫一筆 `banner_edit` 操作日誌（對象用新的廣告位名稱）。
 */
export async function saveBanner(
  target: BannerRef,
  write: BannerSaveWrite,
  actor: BannerActor | null | undefined,
  deps: BannerDeps = {},
): Promise<void> {
  assertCanManage(actor);
  if (typeof write.image === 'string' && write.image.startsWith('data:')) {
    throw new BannerWriteError('invalid-payload', 'image must be uploaded before saving');
  }
  if (write.status !== 'active' && write.status !== 'scheduled') {
    throw new BannerWriteError('invalid-payload', 'invalid status');
  }
  // F2：連結也在寫入層擋（元件漏驗或強轉都進不來）：只收 http(s)，且不含空白、引號、角括號、反引號、反斜線。
  if (typeof write.linkUrl !== 'string' || !isSavableLinkUrl(write.linkUrl)) {
    throw new BannerWriteError('invalid-payload', 'invalid link url');
  }
  await updateBannerFields('banner.save', target.docId, { ...write }, SAVE_FIELDS, deps);
  await recordBannerOpLog(
    buildBannerOpLogEntry({
      kind: 'edit',
      label: bannerLabel({ slot: target.slot, slotName: write.slotName }),
      id: target.id,
      scheduled: write.status === 'scheduled',
      publishAt: write.publishAt,
    }),
    actor,
    deps.opLog,
  );
}

export async function delistBanner(
  target: BannerRef,
  actor: BannerActor | null | undefined,
  deps: BannerDeps = {},
): Promise<void> {
  assertCanManage(actor);
  const write: BannerDelistWrite = { status: 'expired' };
  await updateBannerFields('banner.delist', target.docId, { ...write }, STATUS_FIELDS, deps);
  await recordBannerOpLog(
    buildBannerOpLogEntry({ kind: 'delist', label: bannerLabel(target), id: target.id }),
    actor,
    deps.opLog,
  );
}

/**
 * B 統一用 `admin.banners.entry`（A 的 `relistAd` 沒有前端守衛，Rules 才擋）。
 * F5：寫入前用「現在」重檢結束時間（A 的按鈕規則 `!unpublishAt || 剩餘天數 > 0`）；結束時間已過就拒絕（`relist-expired`），
 * 要先編輯結束時間。頁面開很久之後按下去，不會把已經過期的橫幅又掛回去。
 */
export async function relistBanner(
  target: BannerRef & Pick<BannerSlot, 'unpublishAt'>,
  actor: BannerActor | null | undefined,
  deps: BannerDeps = {},
): Promise<void> {
  assertCanManage(actor);
  if (target.unpublishAt && remainDays(target.unpublishAt, (deps.now ?? Date.now)()) <= 0) {
    throw new BannerWriteError('relist-expired', 'unpublishAt has passed');
  }
  const write: BannerRelistWrite = { status: 'active' };
  await updateBannerFields('banner.relist', target.docId, { ...write }, STATUS_FIELDS, deps);
  await recordBannerOpLog(
    buildBannerOpLogEntry({ kind: 'relist', label: bannerLabel(target), id: target.id }),
    actor,
    deps.opLog,
  );
}

export async function clearBannerSlot(
  target: BannerRef,
  actor: BannerActor | null | undefined,
  deps: BannerDeps = {},
): Promise<void> {
  assertCanManage(actor);
  await updateBannerFields('banner.clear', target.docId, { ...BANNER_CLEAR_WRITE }, CLEAR_FIELDS, deps);
  await recordBannerOpLog(
    buildBannerOpLogEntry({ kind: 'delete', label: bannerLabel(target), id: target.id }),
    actor,
    deps.opLog,
  );
}

// ── 惰性狀態轉換（D1 採 (b)）─────────────────────────────

/**
 * 只在管理員開 Banner 後台頁時呼叫（首頁公開路徑絕不寫）。transaction 內重讀文件，狀態與時間欄位都沒變才寫，
 * 所以重複執行、兩位管理員同時開頁都只會寫一次（冪等）。回傳是否真的寫了。
 */
export async function applyBannerTransition(
  transition: BannerTransition,
  actor: BannerActor | null | undefined,
  deps: BannerDeps = {},
): Promise<boolean> {
  assertCanManage(actor);
  assertBannerDocId(transition.docId);
  const fields: Record<string, unknown> = { status: transition.to };
  assertAllowedFields('banner.transition', fields, STATUS_FIELDS);
  const { db, sdk } = await getContext(deps);
  const ref = sdk.doc(db, BANNERS_COLLECTION, transition.docId);
  return sdk.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;
    const current = (snap.data() ?? {}) as Record<string, unknown>;
    if (current.status !== transition.from) return false;
    if (
      String(current.publishAt ?? '') !== transition.publishAt ||
      String(current.unpublishAt ?? '') !== transition.unpublishAt
    ) {
      return false;
    }
    tx.update(ref, { ...fields, updatedAt: sdk.serverTimestamp() });
    return true;
  });
}

export interface AppliedTransitions {
  applied: BannerTransition[];
  failed: number;
}

/**
 * 計畫＋逐筆套用；單筆失敗不影響其他筆。每筆**成功寫入**的轉換各記一筆稽核（`writeAuditLog`）與一筆操作日誌（`banner_auto`），
 * 兩者都是 best-effort；0 寫入（已經正確、別人先轉過）不記。
 */
export async function applyDueBannerTransitions(
  slots: readonly BannerSlot[],
  actor: BannerActor | null | undefined,
  deps: BannerDeps = {},
): Promise<AppliedTransitions> {
  assertCanManage(actor);
  const warn = deps.warn ?? ((...args: unknown[]) => console.warn(...args));
  const plan = planBannerTransitions(slots, (deps.now ?? Date.now)());
  const applied: BannerTransition[] = [];
  let failed = 0;
  for (const transition of plan) {
    try {
      if (await applyBannerTransition(transition, actor, deps)) {
        applied.push(transition);
        await recordBannerTransitionAudit(transition, deps.audit);
        await recordBannerOpLog(
          buildBannerOpLogEntry({
            kind: 'auto',
            label: transition.label,
            id: transition.id,
            to: transition.to,
          }),
          actor,
          deps.opLog,
        );
      }
    } catch (err) {
      failed += 1;
      warn('[banners] lazy transition failed', transition.id, err);
    }
  }
  if (applied.length > 0) invalidateBannersSnapshot();
  return { applied, failed };
}
