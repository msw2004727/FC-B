/**
 * Banner 後台的操作紀錄。
 *
 * 1. 操作日誌 `operationLogs`（顧問 2026-10-27 裁定）：儲存／下架／上架／刪除（清空）每次成功都寫一筆，
 *    惰性狀態轉換**每一筆**成功轉換也寫一筆；轉換 0 寫入（已經正確、別人先轉過）時不寫。
 *    經 B 既有的 `writeOpLog`（`src/data/op-log.ts`，欄位 `{type, typeName, content, actorUid, operator}`，
 *    `actorUid` ＝操作者 UID＝auth.uid；沒有 `uid` 欄位——原資料契約 A63／S01 的衝突是文件 drift）。
 *    對象（廣告位）只放在 content。失敗只 `console.warn`，絕不影響主結果。旗標 `ENABLE_BANNER_OPLOG` 保留，預設開。
 *    A 的 `js/modules/ad-manage/*` 沒有任何橫幅 `_writeOpLog`，所以下面四種 type 都是 B 新增，
 *    命名沿用 A 日誌中心的 `*_edit`／`*_toggle`／`*_delete` 風格（`ann_toggle` 公告上下架、`ach_delete` 刪除成就…）。
 * 2. 稽核日誌 `writeAuditLog` Callable（只用於惰性轉換，best-effort，**旗標預設關閉**，Opus 一審 F3）：
 *    `functions/index.js` 的 `ALLOWED_AUDIT_ACTIONS` 白名單沒有橫幅動作，送白名單外的 action 伺服器會 `invalid-argument`；
 *    借用 `admin_user_edit` 會把橫幅轉換混進「管理員編輯用戶」的稽核軌跡，所以在 Functions 新增專用 action 之前先關掉。
 *    顧問條件「每筆轉換留紀錄」已由上面的 `operationLogs`（`banner_auto`）滿足。Functions 補上專用 action 後，
 *    改 `BANNER_AUDIT_ACTION` 並把 `ENABLE_BANNER_AUDIT_LOG` 打開即可（測試覆蓋開／關兩態）。
 */
import type { BannerTransition } from './banner-model';

/** 旗標：true 時另寫 `operationLogs`（顧問裁定預設開；保留旗標，測試覆蓋開／關兩態）。 */
export const ENABLE_BANNER_OPLOG = true;
/** 旗標：true 時惰性轉換另呼叫 `writeAuditLog`（預設關閉，見上方說明）。 */
export const ENABLE_BANNER_AUDIT_LOG = false;
/** 暫借的白名單內 action；專用 action 上線後改這一行。 */
export const BANNER_AUDIT_ACTION = 'admin_user_edit' as const;
export const BANNER_AUDIT_REASON = 'banner_status_transition';

// ── writeAuditLog（只用於惰性轉換）────────────────────────

export interface BannerAuditDeps {
  /** 覆寫 `ENABLE_BANNER_AUDIT_LOG`（測試用）。 */
  enabled?: boolean;
  callFn?: typeof import('@/data/callables').callFn;
  warn?: (...args: unknown[]) => void;
}

export async function recordBannerTransitionAudit(
  transition: BannerTransition,
  deps: BannerAuditDeps = {},
): Promise<void> {
  if (!(deps.enabled ?? ENABLE_BANNER_AUDIT_LOG)) return;
  const warn = deps.warn ?? ((...args: unknown[]) => console.warn(...args));
  try {
    const callFn = deps.callFn ?? (await import('@/data/callables')).callFn;
    await callFn('writeAuditLog', {
      action: BANNER_AUDIT_ACTION,
      targetType: 'system',
      targetId: transition.docId,
      targetLabel: `banner:${transition.id}`,
      result: 'success',
      source: 'web',
      meta: {
        reasonCode: BANNER_AUDIT_REASON,
        statusFrom: transition.from,
        statusTo: transition.to,
      },
    });
  } catch (err) {
    warn('[banners] writeAuditLog failed', err);
  }
}

// ── operationLogs ───────────────────────────────────────

export interface BannerOpLogEntry {
  type: string;
  typeName: string;
  content: string;
}

export const BANNER_OPLOG_TYPES = {
  edit: { type: 'banner_edit', typeName: '編輯 Banner' },
  toggle: { type: 'banner_toggle', typeName: 'Banner 上下架' },
  delete: { type: 'banner_delete', typeName: '刪除 Banner' },
  auto: { type: 'banner_auto', typeName: 'Banner 自動切換' },
} as const;

export type BannerOpLogInput =
  | { kind: 'edit'; label: string; id: string; scheduled: boolean; publishAt: string }
  | { kind: 'delist' | 'relist' | 'delete'; label: string; id: string }
  | { kind: 'auto'; label: string; id: string; to: 'active' | 'expired' };

/** content 只放廣告位（名稱＋公開 id）與動作；不放 UID、不放連結或圖片網址。 */
export function buildBannerOpLogEntry(input: BannerOpLogInput): BannerOpLogEntry {
  const target = `「${input.label}」(${input.id})`;
  switch (input.kind) {
    case 'edit':
      return {
        ...BANNER_OPLOG_TYPES.edit,
        content: `編輯${target}，${input.scheduled ? `預約 ${input.publishAt} 啟用` : '立即啟用'}`,
      };
    case 'delist':
      return { ...BANNER_OPLOG_TYPES.toggle, content: `下架${target}` };
    case 'relist':
      return { ...BANNER_OPLOG_TYPES.toggle, content: `上架${target}` };
    case 'delete':
      return { ...BANNER_OPLOG_TYPES.delete, content: `刪除${target}，已清空設定` };
    case 'auto':
      return {
        ...BANNER_OPLOG_TYPES.auto,
        content:
          input.to === 'active'
            ? `${target}預約時間已到，自動啟用`
            : `${target}結束時間已到，自動下架`,
      };
  }
}

export interface BannerOpLogActor {
  uid: string | null;
  displayName?: string | null;
}

export interface BannerOpLogDeps {
  opLogEnabled?: boolean;
  writeOpLog?: (input: {
    type: string;
    typeName: string;
    content: string;
    actorUid: string | null;
    operator: string;
  }) => Promise<void>;
  warn?: (...args: unknown[]) => void;
}

/** 寫一筆操作日誌（best-effort）：`actorUid` ＝呼叫者 UID；`operator` ＝顯示名稱，沒有就「系統」（同 B 其他呼叫端）。 */
export async function recordBannerOpLog(
  entry: BannerOpLogEntry,
  actor: BannerOpLogActor,
  deps: BannerOpLogDeps = {},
): Promise<void> {
  if (!(deps.opLogEnabled ?? ENABLE_BANNER_OPLOG)) return;
  const warn = deps.warn ?? ((...args: unknown[]) => console.warn(...args));
  try {
    const writeOpLog = deps.writeOpLog ?? (await import('@/data/op-log')).writeOpLog;
    await writeOpLog({
      type: entry.type,
      typeName: entry.typeName,
      content: entry.content,
      actorUid: actor.uid,
      operator: actor.displayName?.trim() || '系統',
    });
  } catch (err) {
    warn('[banners] writeOpLog failed', err);
  }
}
