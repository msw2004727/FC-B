/**
 * 排程信件自動發送（站長 2026-11-02 裁定 Q3：照舊站，管理員開著新站時前端每分鐘檢查到點就送）。
 * 對應 A `js/modules/message/message-admin.js#_processScheduledMessages`（`app.js` 每 60 秒呼叫）。
 *
 * - 搶占用 transaction（欄位照 A：processing／processingBy／processingAt），A 與 B 同時開著也不會重送。
 * - 與 A 差異：A 的站內信投遞是 fire-and-forget、一律標 sent；B 等投遞結果，失敗就退回 scheduled 並寫 lastError，下一輪再試；
 *   連續失敗 3 次改 cancelled。站內信 ID 固定（msg_<adminMsg id>），重送覆寫同一份、不會多一封。
 * - 順序：投遞成功 → 標 sent（transaction，只在仍是自己搶占中才寫）→ 標成功才推 LINE。
 *   標記失敗或已被取消時不推 LINE：卡住的信之後被退回重送時，才不會重複推播。
 * - 讀取：每輪 `where status == 'scheduled' limit 20`；只有 admin 以上身分會跑（見 canRunScheduledMessages）。
 */

import { isScheduledDue, type AdminMessage } from './admin-message-model';
import {
  claimScheduledMessage,
  loadScheduledAdminMessages,
  markScheduledMessageSent,
  releaseScheduledMessageClaim,
} from './admin-messages-repo';
import { deliverAdminMessage, queueLinePushByTarget } from './admin-message-send';

export const SCHEDULE_CHECK_INTERVAL_MS = 60_000;

export interface ScheduledStatusChange {
  docId: string;
  status: 'sent' | 'scheduled' | 'cancelled';
}

type Listener = (change: ScheduledStatusChange) => void;
const listeners = new Set<Listener>();
let processing = false;

/** 站內信管理頁訂閱：排程送出或退回時就地更新畫面（0 讀）。 */
export function subscribeScheduledChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(change: ScheduledStatusChange): void {
  for (const listener of listeners) {
    try {
      listener(change);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Schedule] listener failed:', err);
    }
  }
}

export interface ProcessScheduledOptions {
  processorId: string;
  senderUid: string | null;
  now?: () => number;
}

/** 回傳本輪成功送出的封數。同一時間只跑一輪（A `_scheduledMessageProcessing`）。 */
export async function processScheduledMessages(options: ProcessScheduledOptions): Promise<number> {
  if (processing) return 0;
  processing = true;
  const now = options.now ?? Date.now;
  let sent = 0;
  try {
    const nowMs = now();
    const due = (await loadScheduledAdminMessages()).filter((m) => isScheduledDue(m, nowMs));
    for (const m of due) {
      let claimed = false;
      try {
        claimed = await claimScheduledMessage(m._docId, options.processorId, (data) =>
          isScheduledDue({ status: String(data['status'] ?? ''), scheduledAt: (data['scheduledAt'] as string | null) ?? m.scheduledAt ?? null }, nowMs),
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[Schedule] claim failed:', m.id, err);
      }
      if (!claimed) continue;
      try {
        await deliverAdminMessage(m, options.senderUid);
      } catch (sendErr) {
        // eslint-disable-next-line no-console
        console.error('[Schedule] send failed:', m.id, sendErr);
        try {
          const status = await releaseScheduledMessageClaim(m._docId, options.processorId, sendErr);
          if (status) notify({ docId: m._docId, status });
        } catch (releaseErr) {
          // eslint-disable-next-line no-console
          console.error('[Schedule] release failed:', m.id, releaseErr);
        }
        continue;
      }
      // 站內信已送出：之後的步驟失敗都不退回 scheduled，避免下一輪重送。
      let marked = false;
      try {
        marked = await markScheduledMessageSent(m._docId, options.processorId);
      } catch (markErr) {
        // 標記失敗時信件留在「處理中」，不重送、不推 LINE；超過 10 分鐘可在畫面上退回或取消。
        // eslint-disable-next-line no-console
        console.error('[Schedule] mark sent failed:', m.id, markErr);
      }
      if (!marked) {
        // eslint-disable-next-line no-console
        console.warn('[Schedule] not marked sent, skip LINE:', m.id);
        continue;
      }
      sent += 1;
      notify({ docId: m._docId, status: 'sent' });
      await pushLineBestEffort(m);
    }
  } finally {
    processing = false;
  }
  return sent;
}

/** LINE 推播是 best-effort（A fire-and-forget），不影響站內信已送出的結果。 */
async function pushLineBestEffort(m: AdminMessage): Promise<void> {
  try {
    const line = await queueLinePushByTarget(m);
    if (line.status === 'overLimit' || line.status === 'error') {
      // eslint-disable-next-line no-console
      console.warn('[Schedule] LINE push skipped:', m.id, line);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Schedule] LINE push failed:', m.id, err);
  }
}

/** 測試用。 */
export function _resetScheduledRunnerForTest(): void {
  processing = false;
  listeners.clear();
}
