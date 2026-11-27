// 刪除賽事的顯示條件。只對齊後端 deleteCompetition 會放行的人，寧可少給；擋不住的仍由伺服器拒絕。
// 後端：functions-cp src/cp/host.ts deleteCompetition（489～539）與 src/cp/context.ts isPrimaryHost（272～278）。
// 獨立成檔，不動 access.ts 的 canHostOrCo（cp-open-rep 正在改它）。
// 俱樂部代表沿用 rep-clubs.ts 的 representativeClubs（同一份快取），不另外讀。

import { isCpAdmin } from './access';
import type { HostType, StaffRole } from './data/types';

export interface DeleteAccessInput {
  /** 未登入是 null。後端 callerOf 沒有 uid 一律 SIGN_IN_REQUIRED。 */
  uid: string | null;
  role: string | null | undefined;
  hostType: HostType;
  hostTeamId: string | null;
  /** 自己在這場賽事的 staff 角色（host／coHost）。 */
  staffRoles: readonly StaffRole[];
  /** representativeClubs(actor) 的俱樂部 id（文件路徑 id）。還在讀時是空陣列，等同不顯示。 */
  repClubIds: readonly string[];
  hidden: boolean;
  /** 刪除到一半的封鎖時間。沒有是 null。 */
  deletingAt: number | null;
  /** 已結束（任何結束方式）。後端 host.ts deleteCompetition：非管理員 endedAt 有值回 DELETE_AFTER_START。 */
  endedAt: number | null;
  firstMatchAt: number;
  now: number;
}

/**
 * 主辦（不含共同主辦），對齊 context.ts isPrimaryHost：
 * 俱樂部主辦只認目前代表（cpClubs.repUids；staff 上的 host 不算）；個人主辦＝staff roles 含 host。
 */
export function isPrimaryHostView(input: Pick<DeleteAccessInput, 'hostType' | 'hostTeamId' | 'staffRoles' | 'repClubIds'>): boolean {
  if (input.hostType === 'club') {
    return typeof input.hostTeamId === 'string' && input.hostTeamId !== '' && input.repClubIds.includes(input.hostTeamId);
  }
  return input.staffRoles.includes('host');
}

/**
 * 刪除鈕（含刪除到一半的「繼續刪除」）要不要出現。
 * - 管理員：一律顯示（host.ts 492、500～501；503～504 的限制只對非管理員）。
 * - 主辦：isPrimaryHost（host.ts 500～501），而且
 *   沒有被下架，或下架是因為刪除到一半（host.ts 503：hidden && !deletingAt 拒絕），而且
 *   首場還沒開始（host.ts 504：now >= firstMatchAt 拒絕；續刪也一樣），而且
 *   還沒結束（首場前手動結束也一樣，後端同樣回 DELETE_AFTER_START）。
 * - 共同主辦、一般用戶、未登入：不顯示。
 */
export function canDeleteCompetition(input: DeleteAccessInput): boolean {
  if (!input.uid) return false;
  if (isCpAdmin(input.role)) return true;
  if (!isPrimaryHostView(input)) return false;
  if (input.hidden && input.deletingAt == null) return false;
  if (input.endedAt != null) return false;
  return input.now < input.firstMatchAt;
}
