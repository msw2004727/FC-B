// 組別 rules.timeout 的讀取。缺值或不合法的欄位維持預設，不搬 FC 引擎。

export type TimeoutPer = 'half' | 'match';

export interface TimeoutRule {
  stopsClock: boolean;
  enabled: boolean;
  per: TimeoutPer;
  count: number;
  seconds: number;
}

const DEFAULT_RULE: TimeoutRule = {
  enabled: false,
  per: 'half',
  count: 1,
  seconds: 60,
  stopsClock: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function intIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

/** 沒有文件、不是物件、或欄位不合法時，該欄回到預設（不停用次數、停錶）。 */
export function readTimeoutRule(raw: unknown): TimeoutRule {
  const rule: TimeoutRule = { ...DEFAULT_RULE };
  if (!isRecord(raw)) return rule;
  if (typeof raw.enabled === 'boolean') rule.enabled = raw.enabled;
  if (raw.per === 'half' || raw.per === 'match') rule.per = raw.per;
  const count = intIn(raw.count, 0, 5);
  if (count != null) rule.count = count;
  const seconds = intIn(raw.seconds, 30, 180);
  if (seconds != null) rule.seconds = seconds;
  if (typeof raw.stopsClock === 'boolean') rule.stopsClock = raw.stopsClock;
  return rule;
}

export function defaultTimeoutRule(): TimeoutRule {
  return { ...DEFAULT_RULE };
}
