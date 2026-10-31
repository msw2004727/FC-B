import { afterEach, describe, expect, it, vi } from 'vitest';
import { blocklistErrorKey, EventBlocklistGuardError } from './event-blocklist-errors';
const emit = vi.hoisted(() => vi.fn());
vi.mock('@/core/events', () => ({ emit }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
describe('黑名單管理', () => {
  it.each(['Missing or insufficient permissions. targetA', 'denied (detail A) uidA'])('T10 T11 拒絕提示', message => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const key = blocklistErrorKey({ code: 'permission-denied', message }, 'add');
    expect(key).toBe('grantMethodUnavailable');
    expect(emit).toHaveBeenCalledWith('viewer:refresh', {});
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/uidA|targetA/);
  });
  it('守衛錯誤對應各自的提示', () => {
    expect(blocklistErrorKey(new EventBlocklistGuardError('COURSE_LINKED'), 'add')).toBe('courseLinked');
    expect(blocklistErrorKey(new EventBlocklistGuardError('EVENT_MISSING'), 'add')).toBe('toastEventMissing');
    expect(blocklistErrorKey(new EventBlocklistGuardError('USER_MISSING'), 'add')).toBe('toastUserMissing');
    expect(blocklistErrorKey(new EventBlocklistGuardError('INVALID_UID'), 'remove')).toBe('toastUserMissing');
  });
  it('其他錯誤依動作回一般失敗提示', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(blocklistErrorKey(new Error('x'), 'add')).toBe('toastWriteFailed');
    expect(blocklistErrorKey(new Error('x'), 'remove')).toBe('toastRemoveFailed');
  });
  it('T11 訊息不單獨決定提示', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(blocklistErrorKey({ message: 'denied (detail A)' }, 'add')).toBe('toastWriteFailed');
    expect(emit).not.toHaveBeenCalled();
  });
});
