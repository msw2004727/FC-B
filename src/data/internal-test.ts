// 內測模式（next.toosterx.com 真機內測期間的三道防護之一、三）。
//
// - 正式建置預設就是內測模式；只有建置變數 `VITE_PUBLIC_LAUNCH=1` 才關閉，忘了設也不會對外開放。
//   `vite dev`／測試預設不套用，需要時設 `VITE_INTERNAL_TEST=1`。
// - 白名單 `VITE_INTERNAL_TEST_UID_HASHES`：SHA-256(uid) 十六進位、逗號分隔。前端設定一律會出現在
//   公開 JS，所以不放明文 UID（R-SAFE-012）；清單空白＝沒有人能進（fail closed）。
// - 內測期間活動寫入只限標題以「[內測]」開頭的活動，避免污染正式報名、簽到統計（R-SAFE-014）。
// - 活動以外會碰到別人的寫入（俱樂部、私訊、收件匣、LINE 通知）：這次寫入影響到的每一位使用者都在
//   白名單內才放行；影響對象不明時一律擋（2026-10-19 Fable 建議）。俱樂部不採用「[內測]」名稱豁免：
//   MiMo 複查發現豁免會讓核准流程改到真人的 users 文件、通知卻被擋，留下半套資料（取代 Fable 原案的 labeled 放行）。
// 這是資料污染防護與體驗閘門，不是安全邊界；權限仍由 Firestore Rules 與 Callable 把關，與 A 相同。

export const INTERNAL_TEST_EVENT_PREFIX = '[內測]';

export function isInternalTestMode(): boolean {
  if (import.meta.env.DEV) return import.meta.env.VITE_INTERNAL_TEST === '1';
  return import.meta.env.VITE_PUBLIC_LAUNCH !== '1';
}

function allowedHashes(): Set<string> {
  const raw = String(import.meta.env.VITE_INTERNAL_TEST_UID_HASHES ?? '');
  return new Set(
    raw.split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => /^[0-9a-f]{64}$/.test(item)),
  );
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 非內測模式一律 true；內測模式只有白名單內的 uid 為 true。 */
export async function isInternalTester(uid: string | null): Promise<boolean> {
  if (!isInternalTestMode()) return true;
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) return false;
  const hashes = allowedHashes();
  if (hashes.size === 0) return false;
  return hashes.has(await sha256Hex(safeUid));
}

export type InternalTestWriteKind = 'event' | 'team' | 'pm' | 'inbox' | 'line';

export class InternalTestBlockedError extends Error {
  readonly code: 'INTERNAL_TEST_EVENT_ONLY' | 'INTERNAL_TEST_BLOCKED';
  /** 對應核心字典的提示文案。 */
  readonly messageKey: 'internalTest.eventOnly' | 'internalTest.blocked';
  constructor(readonly kind: InternalTestWriteKind = 'event') {
    super(kind === 'event'
      ? `內測期間只能操作標題以「${INTERNAL_TEST_EVENT_PREFIX}」開頭的活動`
      : `內測期間不能對內測名單以外的使用者操作（${kind}）`);
    this.name = 'InternalTestBlockedError';
    this.code = kind === 'event' ? 'INTERNAL_TEST_EVENT_ONLY' : 'INTERNAL_TEST_BLOCKED';
    this.messageKey = kind === 'event' ? 'internalTest.eventOnly' : 'internalTest.blocked';
  }
}

/** 活動標題或俱樂部名稱是否以「[內測]」開頭。 */
export function isInternalTestLabel(title: unknown): boolean {
  return typeof title === 'string' && title.trim().startsWith(INTERNAL_TEST_EVENT_PREFIX);
}

/**
 * 活動以外的寫入守衛：`labeled`（目標名稱以「[內測]」開頭）或 `affectedUids` 全在白名單才放行。
 * affectedUids 要列出這次寫入會影響或通知到的所有人（含自己）；空清單或含空值一律擋。
 */
export async function assertInternalTestWritable(input: {
  kind: Exclude<InternalTestWriteKind, 'event'>;
  labeled?: boolean;
  affectedUids: readonly unknown[];
}): Promise<void> {
  if (!isInternalTestMode() || input.labeled) return;
  const uids = input.affectedUids.map((uid) => String(uid ?? '').trim());
  if (uids.length === 0 || uids.some((uid) => !uid)) throw new InternalTestBlockedError(input.kind);
  for (const uid of new Set(uids)) {
    if (!(await isInternalTester(uid))) throw new InternalTestBlockedError(input.kind);
  }
}

/** 內測模式下，活動標題不是「[內測]」開頭就擲出 InternalTestBlockedError。 */
export function assertInternalTestEventTitle(title: unknown): void {
  if (isInternalTestMode() && !isInternalTestLabel(title)) {
    throw new InternalTestBlockedError();
  }
}

/** 只有活動文件 id 時使用：內測模式下先讀 `events/{eventDocId}` 的標題再判斷。 */
export async function assertInternalTestEventDocWritable(eventDocId: string): Promise<void> {
  if (!isInternalTestMode()) return;
  const [{ doc, getDoc }, { getFirebase }] = await Promise.all([
    import('firebase/firestore'),
    import('./firebase'),
  ]);
  const { db } = await getFirebase();
  const snap = await getDoc(doc(db, 'events', eventDocId));
  assertInternalTestEventTitle(snap.exists() ? (snap.data() as { title?: unknown }).title : undefined);
}
