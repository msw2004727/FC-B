import { emit } from '@/core/events';

export type BlocklistErrorCode = 'permission-denied' | 'COURSE_LINKED' | 'EVENT_MISSING' | 'USER_MISSING' | 'INVALID_UID';
export class EventBlocklistGuardError extends Error {
  constructor(readonly code: BlocklistErrorCode) {
    super('黑名單管理');
    this.name = 'EventBlocklistGuardError';
  }
}

export function blocklistErrorKey(error: unknown, action: 'add' | 'remove'): string {
  const raw = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  const code = typeof raw === 'string' ? raw.replace(/^(firestore|functions)\//, '') : '';
  if (code === 'permission-denied') {
    console.error('[黑名單管理]', { code: 'permission-denied', message: 'Operation unavailable' });
    emit('viewer:refresh', {});
    return 'grantMethodUnavailable';
  }
  if (error instanceof EventBlocklistGuardError) {
    if (code === 'COURSE_LINKED') return 'courseLinked';
    if (code === 'EVENT_MISSING') return 'toastEventMissing';
    if (code === 'USER_MISSING' || code === 'INVALID_UID') return 'toastUserMissing';
  }
  console.error('[黑名單管理]', { code: 'operation-failed', message: 'Operation failed' });
  return action === 'add' ? 'toastWriteFailed' : 'toastRemoveFailed';
}
