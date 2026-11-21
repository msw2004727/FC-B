/**
 * 站內賽事清單的本機快照（stale-first，顧問 §3.553）：整頁重新整理後先畫上次讀到的清單，背景照常向伺服器讀，
 * 讀回就整份換掉。照活動列表 `events/data/events-snapshot-cache.ts` 的做法與安全約束：
 * - 只存組卡用得到的欄位（list-cards.ts 的 InAppListDoc：名稱、分類、狀態、四個時間、第一個場地名、封面網址、是不是我的），
 *   不存原始文件、工作人員、名單、聯絡文字、說明等；讀回後照同一條 assembleInAppCards 組卡，
 *   所以「招募中／預熱中／進行中／已結束」與距開賽天數都用讀取當下的時間重算，不沿用存的那一刻。
 * - 當日摘要（今天 N 場、下一場）不存：快照畫面上進行中的卡不寫重點句、不放記分板，等讀回再補（照既有「摘要沒結果先不放板」）。
 * - 帳號區隔：記錄存它的帳號（訪客 'guest'）；帳號不符只跳過不用（守門在 InAppSection：登入者要登入模組確認的帳號
 *   與畫面使用者相同才讀才寫；訪客在登入狀態未定或確定是訪客時才讀 guest 快照）。確定登入狀態後發現是別人的快照就刪掉。
 * - 登入者與訪客分兩個鍵（審查 P2-2）：登入者的 'fcb:cp-list:v1' 在主動登出、「清除快取」、被動失效（Auth 狀態變成無人）時
 *   都由 data/auth.ts 清掉（'fcb:cp-list:' 前綴）；訪客的 'fcb:cp-list-guest:v1' 只有公開資料、沒有帳號歸屬（同首頁公開快照），
 *   不跟著清——訪客每次開頁 Auth 都會先通知一次「無人」，訪客快照若用同一個前綴會在讀到之前就被清掉。
 * - 賽事 id 要是 cp_＋20 碼英數（後端 CID_RE，同 pages/edit-competition.ts#isCompetitionId），不合格整筆丟掉。
 * - 閘門判定看不到時，InAppSection 刪掉這位使用者的快照。
 * - 範圍區隔：測試者／管理員讀得到內部賽（scope 'internal'），一般人只有公開（'public'）；範圍不符不用。
 * - 下架（hidden）與刪除中（deletingAt）的賽事寫入時不帶、讀出時再擋一次。訪客快照另外只留公開、狀態是公開狀態、不是「我的」的賽事
 *   （寫入與讀出各過一次）。
 * - 格式版本 `v` 不是目前版本整份不用（卡片欄位改了就把 CP_LIST_SNAPSHOT_FORMAT 加 1）；超過 30 分鐘不用；
 *   超過字數上限不存（並刪掉舊的）、讀取時解析前先擋；讀寫失敗（私密模式、容量滿）一律忽略，退回等伺服器。
 * - 讀出時逐欄重新投影（型別、長度、封面網址同 coverOf 白名單）；這是格式驗證，不是資料真實性驗證。
 */
import { coverOf } from './cover';
import { categoryOf } from './present';
import { firstVenueName, mergeInAppDocs, type InAppListDoc, type InAppListInput } from './list-cards';
import type { CompetitionCover, CompetitionDoc, CompetitionStatus } from './types';

/** 登入者的快照（帳號資料，登出與被動失效時清）。 */
export const CP_LIST_SNAPSHOT_KEY = 'fcb:cp-list:v1';
/** 訪客的快照（只有公開資料，不跟著登出清）。前綴刻意不是 'fcb:cp-list:'。 */
export const CP_LIST_GUEST_SNAPSHOT_KEY = 'fcb:cp-list-guest:v1';
/** 後端 CID_RE（pages/edit-competition.ts#isCompetitionId 同一條）。這裡不 import 那個頁面模組，免得帶進清單分塊。 */
const CID_RE = /^cp_[A-Za-z0-9]{20}$/;
export const CP_LIST_SNAPSHOT_FORMAT = 1;
export const CP_LIST_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
export const CP_LIST_SNAPSHOT_FUTURE_SKEW_MS = 60_000;
/**
 * 一張卡約 250 字（有封面時兩個 Storage 網址再多約 500 字）。公開清單＋主辦＋我的上限合起來約 200 張，
 * 全部有封面約 150KB；上限 200KB，超過就不存。
 */
export const CP_LIST_SNAPSHOT_MAX_CHARS = 200_000;
const MAX_ROWS = 400;
const MAX_NAME_CHARS = 500;

/** 測試者／管理員（listPublic 帶 includeInternal）是 'internal'，其餘是 'public'。 */
export type CpListScope = 'public' | 'internal';

const STATUSES: readonly CompetitionStatus[] = ['draft', 'published', 'postponed', 'cancelled'];
/** 與 cp-repo listPublic 的查詢條件相同。 */
const PUBLIC_STATUSES: readonly CompetitionStatus[] = ['published', 'postponed', 'cancelled'];

/** 快照裡的一張有文件的卡。欄位與 projectRow 的回傳必須一致。 */
interface SnapRow {
  id: string;
  name: string;
  category: string;
  status: CompetitionStatus;
  /** visibility === 'public'。 */
  pub: boolean;
  hidden: boolean;
  deleting: boolean;
  regOpenAt: number;
  regCloseAt: number;
  firstMatchAt: number;
  lastMatchAt: number;
  endedAt: number | null;
  venue: string;
  cover: CompetitionCover | null;
  mine: boolean;
}

/** 只有名稱的「我的賽事」。 */
interface SnapName {
  cid: string;
  name: string;
  category: string;
}

interface Envelope {
  v: number;
  owner: string;
  scope: CpListScope;
  savedAt: number;
  rows: SnapRow[];
  names: SnapName[];
}

/** 快照讀回的組卡來源：直接交給 assembleInAppCards（不帶當日摘要）。 */
export type CpListSnapshot = InAppListInput;

/** 寫入來源：與 InAppSection 組卡的三份來源相同（根文件要有 visibility／deletingAt 才能過濾）。 */
type WriteDoc = InAppListDoc & Pick<CompetitionDoc, 'visibility' | 'deletingAt'>;

function ownerOf(uid: string | null): string {
  return uid ? `uid:${uid}` : 'guest';
}

/**
 * 能不能拿來畫：沒下架、沒在刪除中；訪客另外要公開、公開狀態、不是我的。
 * 寫入與讀出共用（顧問條件 2、5）。
 */
function listable(
  row: { hidden: boolean; deleting: boolean; pub: boolean; status: CompetitionStatus; mine: boolean },
  guest: boolean,
): boolean {
  if (row.hidden || row.deleting) return false;
  if (!guest) return true;
  return row.pub && PUBLIC_STATUSES.includes(row.status) && !row.mine;
}

function str(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 讀出時逐欄重建；任何必要欄位不合格整筆丟掉。 */
function projectRow(raw: unknown): SnapRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' && CID_RE.test(o.id) ? o.id : null;
  const name = str(o.name, MAX_NAME_CHARS);
  const status = STATUSES.find((value) => value === o.status);
  const regOpenAt = num(o.regOpenAt);
  const regCloseAt = num(o.regCloseAt);
  const firstMatchAt = num(o.firstMatchAt);
  const lastMatchAt = num(o.lastMatchAt);
  const endedAt = o.endedAt === null ? null : num(o.endedAt);
  if (!id || !name || !status || regOpenAt == null || regCloseAt == null || firstMatchAt == null || lastMatchAt == null) return null;
  if (endedAt === null && o.endedAt !== null) return null;
  if (typeof o.pub !== 'boolean' || typeof o.hidden !== 'boolean' || typeof o.deleting !== 'boolean' || typeof o.mine !== 'boolean') {
    return null;
  }
  return {
    id,
    name,
    category: categoryOf({ category: o.category }),
    status,
    pub: o.pub,
    hidden: o.hidden,
    deleting: o.deleting,
    regOpenAt,
    regCloseAt,
    firstMatchAt,
    lastMatchAt,
    endedAt,
    venue: str(o.venue, MAX_NAME_CHARS) ?? '',
    cover: coverOf(o.cover),
    mine: o.mine,
  };
}

function projectName(raw: unknown): SnapName | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const cid = typeof o.cid === 'string' && CID_RE.test(o.cid) ? o.cid : null;
  const name = str(o.name, MAX_NAME_CHARS);
  return cid && name ? { cid, name, category: categoryOf({ category: o.category }) } : null;
}

function keyOf(uid: string | null): string {
  return uid ? CP_LIST_SNAPSHOT_KEY : CP_LIST_GUEST_SNAPSHOT_KEY;
}

function removeSnapshot(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

function readEnvelope(key: string): Partial<Envelope> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > CP_LIST_SNAPSHOT_MAX_CHARS) return null;
    const parsed = JSON.parse(raw) as Partial<Envelope> | null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 能不能讀：登入者要登入模組確認的帳號（confirmed）就是畫面使用者；
 * 訪客只在登入狀態未定（undefined）或確定沒登入（null）時讀 guest 快照——已知有登入者時不先畫訪客版。
 */
export function canReadCpListSnapshot(uid: string | null, confirmed: string | null | undefined): boolean {
  if (uid !== null) return confirmed === uid;
  return confirmed === undefined || confirmed === null;
}

/** 能不能寫：登入狀態已確定，而且就是畫面使用者（訪客要確定是訪客）。 */
export function canWriteCpListSnapshot(uid: string | null, confirmed: string | null | undefined): boolean {
  return confirmed !== undefined && confirmed === uid;
}

/**
 * 登入狀態已確定（confirmed 不是 undefined）而快照是別的帳號存的：刪掉，不留到下一位（登出沒重整、被動失效、換帳號）。
 * 未定時不刪（剛開頁 viewer 會先是訪客，不能因此刪掉本人的快照）。
 */
export function dropForeignCpListSnapshot(confirmed: string | null | undefined): void {
  if (confirmed === undefined) return;
  // 只看登入者的鍵；訪客的鍵只有公開資料。
  const parsed = readEnvelope(CP_LIST_SNAPSHOT_KEY);
  if (parsed && parsed.owner !== ownerOf(confirmed)) removeSnapshot(CP_LIST_SNAPSHOT_KEY);
}

/** 刪掉這位使用者（訪客是 null）的快照：閘門判定看不到時用。 */
export function dropCpListSnapshot(uid: string | null): void {
  removeSnapshot(keyOf(uid));
}

/** 讀快照：帳號、範圍、版本不符，過期，或沒有任何一張可畫的卡，回 null。 */
export function readCpListSnapshot(
  uid: string | null,
  scope: CpListScope,
  nowMs: number = Date.now(),
): CpListSnapshot | null {
  const parsed = readEnvelope(keyOf(uid));
  if (!parsed || parsed.v !== CP_LIST_SNAPSHOT_FORMAT) return null;
  if (parsed.owner !== ownerOf(uid) || parsed.scope !== scope) return null;
  if (typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt)) return null;
  if (nowMs - parsed.savedAt > CP_LIST_SNAPSHOT_MAX_AGE_MS || parsed.savedAt > nowMs + CP_LIST_SNAPSHOT_FUTURE_SKEW_MS) return null;
  if (!Array.isArray(parsed.rows) || !Array.isArray(parsed.names)) return null;
  if (parsed.rows.length > MAX_ROWS || parsed.names.length > MAX_ROWS) return null;
  const guest = uid === null;
  const publicDocs: InAppListDoc[] = [];
  const hosted: InAppListDoc[] = [];
  for (const raw of parsed.rows) {
    const row = projectRow(raw);
    if (!row || !listable(row, guest)) continue;
    const doc: InAppListDoc = {
      id: row.id,
      name: row.name,
      category: categoryOf(row),
      status: row.status,
      regOpenAt: row.regOpenAt,
      regCloseAt: row.regCloseAt,
      firstMatchAt: row.firstMatchAt,
      lastMatchAt: row.lastMatchAt,
      endedAt: row.endedAt,
      hidden: false,
      cover: row.cover,
      venues: row.venue ? [{ name: row.venue }] : [],
    };
    // 我的（cpMine 或代表俱樂部主辦）放進 hosted，組卡時一樣標成我的。
    (row.mine ? hosted : publicDocs).push(doc);
  }
  const mine = guest
    ? []
    : parsed.names
      .map(projectName)
      .filter((row): row is SnapName => row != null)
      .map((row) => ({ cid: row.cid, name: row.name, category: categoryOf(row), doc: null }));
  if (publicDocs.length === 0 && hosted.length === 0 && mine.length === 0) return null;
  return { publicDocs, hosted, mine };
}

/** 寫快照（只能拿這次向伺服器讀回的清單）。沒有可存的卡或太大就刪掉舊的；失敗忽略。 */
export function writeCpListSnapshot(
  uid: string | null,
  scope: CpListScope,
  input: InAppListInput<WriteDoc>,
  nowMs: number = Date.now(),
): void {
  const guest = uid === null;
  const merged = mergeInAppDocs(input);
  const rows: SnapRow[] = [];
  for (const { doc, mine } of merged.docs) {
    const row: SnapRow = {
      id: doc.id,
      name: doc.name,
      category: categoryOf(doc),
      status: doc.status,
      pub: doc.visibility === 'public',
      hidden: doc.hidden === true,
      deleting: doc.deletingAt != null,
      regOpenAt: doc.regOpenAt,
      regCloseAt: doc.regCloseAt,
      firstMatchAt: doc.firstMatchAt,
      lastMatchAt: doc.lastMatchAt,
      endedAt: doc.endedAt,
      venue: firstVenueName(doc),
      cover: doc.cover ?? null,
      mine,
    };
    if (listable(row, guest)) rows.push(row);
  }
  const names: SnapName[] = guest ? [] : merged.names.map((row) => ({ cid: row.cid, name: row.name, category: row.category }));
  if ((rows.length === 0 && names.length === 0) || rows.length > MAX_ROWS || names.length > MAX_ROWS) {
    removeSnapshot(keyOf(uid));
    return;
  }
  try {
    const payload: Envelope = { v: CP_LIST_SNAPSHOT_FORMAT, owner: ownerOf(uid), scope, savedAt: nowMs, rows, names };
    const text = JSON.stringify(payload);
    if (text.length > CP_LIST_SNAPSHOT_MAX_CHARS) {
      removeSnapshot(keyOf(uid));
      return;
    }
    localStorage.setItem(keyOf(uid), text);
  } catch {
    // 容量滿或停用：盡量刪掉舊的，免得留著比剛讀回還舊的快照。
    removeSnapshot(keyOf(uid));
  }
}
