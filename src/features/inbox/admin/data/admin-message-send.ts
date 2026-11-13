/**
 * 站內信管理的投遞與 LINE 推播。對應 A：
 * - `message-admin-compose.js#sendMessage`／`message-admin.js#_processScheduledMessages` 呼叫的
 *   `message-notify.js#_deliverMessageToInbox`（extra：adminMsgId、targetType、targetTeamId、targetRoles）
 * - `message-line-push.js#_queueLinePushByTarget`（source＝`target:<targetType>`，屬強制推播來源，不讀通知開關）
 *
 * 只呼叫既有 Callable（`deliverToInbox`、`enqueuePrivilegedLineNotification`），不改 Functions。
 *
 * LINE 推播（站長 2026-11-02 裁定 Q2）：
 * - 指定用戶：直接推給該 UID（0 讀）。
 * - 指定俱樂部：`users where teamIds array-contains` 與 `users where teamId ==`（A `_isUserInTeam` 兩種都算）各 limit 201。
 * - 角色群發：`users where role in [...]` limit 501。
 * - 多讀 1 筆判斷「真的超過」：剛好 200／500 人照推；超過才整批不推並回報（不挑一部分人送），站內信照送。
 * - 全體用戶：只送站內信，不推 LINE。
 * - 同一人有舊文件＋正本時只推一次、以正本的俱樂部／角色為準（`canonicalRecipientUids`）。
 * 與 A 差異：A 先讀整個 users 集合再逐人推播（讀取與每日推播上限都會爆）。
 */

import type { CollectionReference } from 'firebase/firestore';

import { callFn } from '@/data/callables';
import { getFirebase } from '@/data/firebase';
import { loadFirestoreSdk, type FirestoreSdk } from '@/data/firestore-sdk';
import { deliverInboxMessage, type InboxDeliveryExtra } from '@/data/inbox-delivery';
import { findCanonicalUserIds, isCanonicalUserDoc, userIdentityKey } from '@/data/user-identity-key';

import { CATEGORY_NAMES, ROLE_TARGETS, type AdminMessage, type MsgCategory, type MsgTargetType } from './admin-message-model';

export const LINE_PUSH_TEAM_LIMIT = 200;
export const LINE_PUSH_ROLE_LIMIT = 500;
/** 逐人呼叫 Callable 的同時併發數（避免一次塞爆）。 */
const LINE_PUSH_CONCURRENCY = 10;

export type LinePushOutcome =
  | { status: 'none' }
  | { status: 'overLimit'; limit: number }
  | { status: 'error' }
  | { status: 'queued'; total: number; failed: number };

function categoryNameOf(m: AdminMessage): string {
  return CATEGORY_NAMES[m.category as MsgCategory] ?? m.categoryName ?? '系統';
}

/** 站內信 ID 由 adminMessages 的 id 推導（固定），排程重送時伺服器覆寫同一份或回 already-exists，不會多一封。 */
export function inboxMessageIdOf(m: Pick<AdminMessage, 'id'>): string {
  return `msg_${m.id}`;
}

/**
 * 投遞站內信。失敗往外拋（呼叫端決定提示或退回排程）；5 秒內重複送出回 null。
 */
export async function deliverAdminMessage(
  m: AdminMessage,
  senderUid: string | null,
): Promise<Record<string, unknown> | null> {
  // dedupeKey 綁 adminMsg（同一封 5 秒內只送一次；不同封即使內容相同也照送）。
  const extra: InboxDeliveryExtra = { adminMsgId: m.id, targetType: m.targetType || 'all', dedupeKey: `admin:${m.id}` };
  if (m.targetTeamId) extra.targetTeamId = m.targetTeamId;
  if (Array.isArray(m.targetRoles) && m.targetRoles.length) extra.targetRoles = m.targetRoles;
  return deliverInboxMessage({
    title: m.title,
    body: m.body,
    category: m.category || 'system',
    categoryName: categoryNameOf(m),
    targetUid: m.targetUid || null,
    senderName: m.senderName || '系統',
    senderUid,
    extra,
    messageId: inboxMessageIdOf(m),
  });
}

type RecipientResult = { uids: string[] } | { overLimit: number };

/**
 * 查詢結果 → 收件人 uid（每人一位）。
 * 同一人以 uid → lineUserId → 文件 ID 合併；結果內有正本（文件 ID == 鍵）就直接收。
 * 只命中舊文件的人補查正本：正本存在卻沒被查到＝正本已不屬此俱樂部／角色，不收（舊文件殘留不算數）；
 * 正本不存在＝尚未遷移的人，照 A（`_mapUserDoc` 的 uid＝uid||lineUserId）以鍵收信。
 * 鍵不是合法文件 ID 時不可能有正本，不查、照 A 以鍵收（伺服器依 uid／lineUserId 找不到人就不送）。
 */
async function canonicalRecipientUids(
  fs: FirestoreSdk,
  users: CollectionReference,
  docs: ReadonlyArray<{ id: string; data: () => unknown }>,
): Promise<string[]> {
  const hasCanonical = new Map<string, boolean>();
  for (const d of docs) {
    const key = userIdentityKey(d.id, d.data());
    if (!key) continue;
    hasCanonical.set(key, hasCanonical.get(key) === true || isCanonicalUserDoc(d.id, key));
  }
  const legacyOnly = [...hasCanonical].filter(([, c]) => !c).map(([key]) => key);
  const leftElsewhere = await findCanonicalUserIds(fs, users, legacyOnly);
  return [...hasCanonical.keys()].filter((key) => !leftElsewhere.has(key));
}

async function loadTeamRecipientUids(teamId: string): Promise<RecipientResult> {
  const [fs, { db }] = await Promise.all([loadFirestoreSdk(), getFirebase()]);
  const users = fs.collection(db, 'users');
  const [byTeamIds, byTeamId] = await Promise.all([
    fs.getDocs(fs.query(users, fs.where('teamIds', 'array-contains', teamId), fs.limit(LINE_PUSH_TEAM_LIMIT + 1))),
    fs.getDocs(fs.query(users, fs.where('teamId', '==', teamId), fs.limit(LINE_PUSH_TEAM_LIMIT + 1))),
  ]);
  if (byTeamIds.docs.length > LINE_PUSH_TEAM_LIMIT || byTeamId.docs.length > LINE_PUSH_TEAM_LIMIT) {
    return { overLimit: LINE_PUSH_TEAM_LIMIT };
  }
  const uids = await canonicalRecipientUids(fs, users, [...byTeamIds.docs, ...byTeamId.docs]);
  if (uids.length > LINE_PUSH_TEAM_LIMIT) return { overLimit: LINE_PUSH_TEAM_LIMIT };
  return { uids };
}

async function loadRoleRecipientUids(roles: readonly string[]): Promise<RecipientResult> {
  const [fs, { db }] = await Promise.all([loadFirestoreSdk(), getFirebase()]);
  const users = fs.collection(db, 'users');
  const snap = await fs.getDocs(fs.query(users, fs.where('role', 'in', [...roles]), fs.limit(LINE_PUSH_ROLE_LIMIT + 1)));
  if (snap.docs.length > LINE_PUSH_ROLE_LIMIT) return { overLimit: LINE_PUSH_ROLE_LIMIT };
  return { uids: await canonicalRecipientUids(fs, users, snap.docs) };
}

/** 依對象決定 LINE 推播名單；全體用戶回空名單（不推）。 */
export async function resolveLinePushRecipients(m: AdminMessage): Promise<RecipientResult> {
  const targetType = (m.targetType || 'all') as MsgTargetType;
  if (targetType === 'individual') return { uids: m.targetUid ? [m.targetUid] : [] };
  if (targetType === 'team') return m.targetTeamId ? loadTeamRecipientUids(m.targetTeamId) : { uids: [] };
  const roles = ROLE_TARGETS[targetType];
  if (roles) return loadRoleRecipientUids(roles);
  return { uids: [] };
}

/**
 * A `_queueLinePushByTarget`：逐人呼叫 `enqueuePrivilegedLineNotification`。
 * 單人失敗只記錄（A fire-and-forget），整體不往外拋。
 */
export async function queueLinePushByTarget(m: AdminMessage): Promise<LinePushOutcome> {
  let recipients: RecipientResult;
  try {
    recipients = await resolveLinePushRecipients(m);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[LINE Push] recipients lookup failed:', err);
    return { status: 'error' };
  }
  if ('overLimit' in recipients) return { status: 'overLimit', limit: recipients.overLimit };
  if (recipients.uids.length === 0) return { status: 'none' };

  const source = `target:${m.targetType || 'all'}`;
  const category = m.category || 'system';
  let failed = 0;
  for (let i = 0; i < recipients.uids.length; i += LINE_PUSH_CONCURRENCY) {
    const chunk = recipients.uids.slice(i, i + LINE_PUSH_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((uid) => callFn('enqueuePrivilegedLineNotification', { uid, category, title: m.title, body: m.body, source })),
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        failed += 1;
        // eslint-disable-next-line no-console
        console.error('[LINE Push] callable enqueue failed:', r.reason);
      }
    }
  }
  return { status: 'queued', total: recipients.uids.length, failed };
}
