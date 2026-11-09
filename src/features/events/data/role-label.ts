// 從 event-form-model.ts 原樣搬出（首頁瘦身）：首頁的開團入口只需要角色名稱，
// 不必為它把整份開團表單模型帶進首屏。event-form-model.ts 仍轉出 roleLabelOf，既有呼叫端不受影響。
import type { CustomRole } from '@/features/profile/data/permissions';

/** A `_BASE_ROLES` 的中文名稱；寫進活動 `creator` 欄位的是這個原值，不走翻譯。 */
const BASE_ROLE_LABELS: Readonly<Record<string, string>> = {
  user: '一般用戶',
  coach: '教練',
  captain: '領隊',
  venue_owner: '場主',
  admin: '管理員',
  super_admin: '總管',
};

/** A `ROLES[role]?.label`：內建角色中文名，或自訂角色 label（缺時用 key）；找不到回 null。 */
export function roleLabelOf(role: string, customRoles: readonly CustomRole[] = []): string | null {
  if (Object.prototype.hasOwnProperty.call(BASE_ROLE_LABELS, role)) return BASE_ROLE_LABELS[role]!;
  // A 的 ROLES Proxy：自訂角色 label 缺時用 key（normalizeCustomRoles）
  const custom = customRoles.find((item) => item.key === role);
  if (custom) return custom.label || custom.key;
  return null;
}
