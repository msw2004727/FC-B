// 寫入欄位守衛。
//
// 用途：
// - 動作層（A02、A55 等）在寫入前呼叫 `assertAllowedFields`，只允許白名單欄位，
//   避免「整包轉寫」把後端同步欄位、衍生統計、feature flag 等一併寫入。
// - 活動的衍生欄位（current / waitlist / participants / waitlistNames / realCurrent）只能由
//   Callable 或 A 版邏輯維護，B 直寫前一律以 `assertNoDerivedFields` 擋下（資料契約 A02）。

/**
 * 檢查 `payload` 中的 key 是否都在 `allowed` 內。
 * - `a.b` 這種點記法：只要「頂層段落」或「完整 key」任一在 allowlist 中即視為允許。
 * - 有不在 allowlist 的 key 就拋錯，錯誤訊息列出全部多出的 key。
 */
export function assertAllowedFields(
  action: string,
  payload: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  const extras: string[] = [];

  for (const key of Object.keys(payload)) {
    if (allowedSet.has(key)) continue;
    const top = key.split('.')[0] ?? key;
    if (allowedSet.has(top)) continue;
    extras.push(key);
  }

  if (extras.length > 0) {
    throw new Error(
      `[write-guard] ${action} 出現未允許欄位: ${extras.join(', ')}`,
    );
  }
}

/** 活動衍生欄位（A02 約定）：只能寫初始常數，不得計算或覆寫。 */
export const FORBIDDEN_DERIVED_FIELDS = [
  'current',
  'waitlist',
  'participants',
  'waitlistNames',
  'realCurrent',
] as const;

export type ForbiddenDerivedField = (typeof FORBIDDEN_DERIVED_FIELDS)[number];

/**
 * 若 payload 中出現任何 `FORBIDDEN_DERIVED_FIELDS` 的 key 就拋錯。
 * 對應資料契約 A02：B 直寫活動時不得自行維護這五個衍生欄位。
 */
export function assertNoDerivedFields(payload: Record<string, unknown>): void {
  const hits: string[] = [];
  for (const field of FORBIDDEN_DERIVED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      hits.push(field);
    }
  }
  if (hits.length > 0) {
    throw new Error(
      `[write-guard] 不得寫入衍生欄位（A02 契約）: ${hits.join(', ')}`,
    );
  }
}
