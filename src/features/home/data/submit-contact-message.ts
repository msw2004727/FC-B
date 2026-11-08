import { callFn } from '@/data/callables';

export const CONTACT_NAME_MAX = 30;
export const CONTACT_CONTACT_MAX = 80;
export const CONTACT_CONTENT_MAX = 1000;

export type ContactField = 'name' | 'contact' | 'content';

export interface ContactDraft {
  name: string;
  contact: string;
  content: string;
}

export type ContactSubmitErrorKind = 'rate_limited' | 'unauthenticated' | 'other';

export class ContactValidationError extends Error {
  readonly fields: readonly ContactField[];

  constructor(fields: readonly ContactField[]) {
    super('contact fields invalid');
    this.name = 'ContactValidationError';
    this.fields = fields;
  }
}

/** 碼位數（與後端 `Array.from(text).length` 一致；emoji 算 1 字）。 */
export function contactCharCount(text: string): number {
  return Array.from(text).length;
}

/** 與後端 `stripControlChars` 同範圍：碼位 0–8、11–31（保留 Tab 與換行）。 */
function stripControlChars(text: string): string {
  return Array.from(text)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return !(code <= 8 || (code >= 11 && code <= 31));
    })
    .join('');
}

/** 後端 `CONTACT_BREAKS_RE`：稱呼與聯絡方式不得含 Tab（9）、換行（10）、歸位（13）。 */
function hasLineBreak(text: string): boolean {
  return Array.from(text).some((ch) => {
    const code = ch.codePointAt(0);
    return code === 9 || code === 10 || code === 13;
  });
}

/** 去掉控制字元與前後空白後的送出值（與後端同一套正規化）。 */
function normalizeContactText(text: string): string {
  return stripControlChars(text).trim();
}

/** 與後端 `requireContactText` 同規則：剝控制字元並去掉前後空白後 1～上限碼位；稱呼與聯絡方式不得含 Tab／換行。 */
export function contactFieldErrors(draft: ContactDraft): ContactField[] {
  const errors: ContactField[] = [];
  const check = (field: ContactField, value: string, max: number, rejectBreaks: boolean): void => {
    const length = contactCharCount(normalizeContactText(value));
    if (length < 1 || length > max || (rejectBreaks && hasLineBreak(value))) errors.push(field);
  };
  check('name', draft.name, CONTACT_NAME_MAX, true);
  check('contact', draft.contact, CONTACT_CONTACT_MAX, true);
  check('content', draft.content, CONTACT_CONTENT_MAX, false);
  return errors;
}

function errorParts(err: unknown): string[] {
  if (!err || typeof err !== 'object') return [];
  const e = err as { code?: unknown; message?: unknown; details?: unknown };
  const parts: string[] = [];
  if (typeof e.code === 'string') parts.push(e.code);
  if (typeof e.message === 'string') parts.push(e.message);
  if (typeof e.details === 'string') parts.push(e.details);
  else if (e.details && typeof e.details === 'object') {
    const details = e.details as Record<string, unknown>;
    for (const key of ['code', 'reason', 'message', 'status']) {
      const value = details[key];
      if (typeof value === 'string') parts.push(value);
    }
  }
  return parts;
}

/** 個人頻率（`CONTACT_RATE_LIMITED`）與全站每日上限（`CONTACT_DAILY_LIMIT`）都算太頻繁，優先於 `unauthenticated`。Firebase 的 `functions/` 前綴會去掉。 */
export function classifyContactSubmitError(err: unknown): ContactSubmitErrorKind {
  const parts = errorParts(err);
  if (parts.some((part) => part.includes('CONTACT_RATE_LIMITED') || part.includes('CONTACT_DAILY_LIMIT'))) {
    return 'rate_limited';
  }
  if (parts.some((part) => part.replace(/^functions\//, '').trim().toLowerCase() === 'unauthenticated')) {
    return 'unauthenticated';
  }
  return 'other';
}

const INVALID_FIELD_CODES: ReadonlyArray<readonly [string, ContactField]> = [
  ['INVALID_NAME', 'name'],
  ['INVALID_CONTACT', 'contact'],
  ['INVALID_CONTENT', 'content'],
];

/** 後端欄位驗證錯誤（`INVALID_NAME`／`INVALID_CONTACT`／`INVALID_CONTENT`）對回欄位；不是欄位錯誤回 null。 */
export function contactInvalidField(err: unknown): ContactField | null {
  const parts = errorParts(err);
  for (const [code, field] of INVALID_FIELD_CODES) {
    if (parts.some((part) => part === code)) return field;
  }
  return null;
}

/** 呼叫 Callable `submitContactMessage`。欄位不合法時不送出。 */
export async function submitContactMessage(draft: ContactDraft): Promise<void> {
  const errors = contactFieldErrors(draft);
  if (errors.length > 0) throw new ContactValidationError(errors);
  await callFn('submitContactMessage', {
    name: normalizeContactText(draft.name),
    contact: normalizeContactText(draft.contact),
    content: normalizeContactText(draft.content),
    source: 'fcb',
  });
}
