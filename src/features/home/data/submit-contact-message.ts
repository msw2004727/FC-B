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

/** 必填（去掉前後空白）與長度。空字串或超長都算該欄不通過。 */
export function contactFieldErrors(draft: ContactDraft): ContactField[] {
  const errors: ContactField[] = [];
  const name = draft.name.trim();
  const contact = draft.contact.trim();
  const content = draft.content.trim();
  if (!name || name.length > CONTACT_NAME_MAX || draft.name.length > CONTACT_NAME_MAX) {
    errors.push('name');
  }
  if (!contact || contact.length > CONTACT_CONTACT_MAX || draft.contact.length > CONTACT_CONTACT_MAX) {
    errors.push('contact');
  }
  if (!content || content.length > CONTACT_CONTENT_MAX || draft.content.length > CONTACT_CONTENT_MAX) {
    errors.push('content');
  }
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

/** `CONTACT_RATE_LIMITED` 優先於 `unauthenticated`。Firebase 的 `functions/` 前綴會去掉。 */
export function classifyContactSubmitError(err: unknown): ContactSubmitErrorKind {
  const parts = errorParts(err);
  if (parts.some((part) => part.includes('CONTACT_RATE_LIMITED'))) return 'rate_limited';
  if (parts.some((part) => part.replace(/^functions\//, '').trim().toLowerCase() === 'unauthenticated')) {
    return 'unauthenticated';
  }
  return 'other';
}

/** 呼叫 Callable `submitContactMessage`。欄位不合法時不送出。 */
export async function submitContactMessage(draft: ContactDraft): Promise<void> {
  const errors = contactFieldErrors(draft);
  if (errors.length > 0) throw new ContactValidationError(errors);
  await callFn('submitContactMessage', {
    name: draft.name.trim(),
    contact: draft.contact.trim(),
    content: draft.content.trim(),
    source: 'fcb',
  });
}
