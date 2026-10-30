import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallableError, clearMocks, registerMock, startRecording, stopRecording } from '@/data/callables';
import { adjustRosterStatus, newRosterStatusRequestId } from './roster-status';
import { rosterStatusErrorCode } from './roster-status-errors';
import { demoted, inputFor } from './roster-status-test-fixtures';
const log = vi.hoisted(() => vi.fn());
vi.mock('@/data/op-log', () => ({ writeOpLog: log }));
beforeEach(() => { vi.stubEnv('VITE_CALLABLE_MODE', 'mock'); clearMocks(); log.mockReset(); startRecording(); });
afterEach(() => { stopRecording(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('名單狀態調整錯誤結果', () => {
  it('名單狀態調整：舊 WebView 的識別值仍每次不同', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const first = newRosterStatusRequestId();
    const second = newRosterStatusRequestId();
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(second).not.toBe(first);
  });
  it.each([
    ['UNAUTHENTICATED', '請重新登入後再試'],
    ['INVALID_ARGUMENT', '儲存失敗，請重試'],
    ['EVENT_NOT_FOUND', '活動不存在'],
    ['REG_NOT_FOUND', '找不到報名紀錄'],
    ['PERMISSION_DENIED', '權限不足'],
    ['COURSE_LINKED_USE_MANAGE_CALLABLE', '請在舊版操作'],
    ['WAITLIST_DISABLED', '此活動無名額上限，無法下放候補'],
    ['COMPANION_CANNOT_DEMOTE_ALONE', '請從主報名者操作下放'],
    ['CAPACITY_EXCEEDED', '正取後將超過名額上限'],
    ['FORCE_DEMOTE_FAILED', '儲存失敗，請重試'],
    ['FORCE_PROMOTE_FAILED', '儲存失敗，請重試'],
    ['UNKNOWN_NEW_CODE', '儲存失敗，請重試'],
  ])('U9：%s 對照提示並重讀', async (code, message) => {
    const input = inputFor(); input.reload = vi.fn(input.reload); input.refreshPermissions = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerMock('forceDemoteToWaitlist', () => { throw new CallableError('internal', 'opaque', { code, note: 'detail text' }); });
    expect(await adjustRosterStatus(input)).toEqual({ message, tone: 'error' });
    expect(warn.mock.calls).toEqual(code === 'UNKNOWN_NEW_CODE' ? [[code]] : []);
    expect(input.reload).toHaveBeenCalledOnce(); expect(log).not.toHaveBeenCalled();
    expect(input.refreshPermissions).toHaveBeenCalledTimes(code === 'PERMISSION_DENIED' ? 1 : 0);
  });
  it('details.code 優先，message 其次，最後採標準 code', () => {
    expect(rosterStatusErrorCode(new CallableError('unauthenticated', 'REG_NOT_FOUND', { code: 'PERMISSION_DENIED' })))
      .toBe('PERMISSION_DENIED');
    expect(rosterStatusErrorCode(new CallableError('internal', 'prefix REG_NOT_FOUND suffix'))).toBe('REG_NOT_FOUND');
    expect(rosterStatusErrorCode(new CallableError('functions/unauthenticated', 'opaque'))).toBe('UNAUTHENTICATED');
  });
  it.each([
    new CallableError('functions/unavailable', 'opaque'),
    new CallableError('deadline-exceeded', 'opaque'),
    new Error('network failed'), new Error('fetch failed'), new Error('timeout'), new Error('逾時'),
  ])('U10：連線結果不明會重讀', async error => {
    const input = inputFor(); input.reload = vi.fn(input.reload);
    registerMock('forceDemoteToWaitlist', () => { throw error; });
    expect((await adjustRosterStatus(input)).message).toBe('連線逾時，請檢查網路後重新整理再試');
    expect(input.reload).toHaveBeenCalledOnce(); expect(log).not.toHaveBeenCalled();
  });
  it('沒有錯誤碼時不顯示原始內容', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const input = inputFor(); input.reload = vi.fn(input.reload);
    registerMock('forceDemoteToWaitlist', () => { throw new Error('untrusted detail'); });
    expect((await adjustRosterStatus(input)).message).toBe('儲存失敗，請重試');
    expect(input.reload).toHaveBeenCalledOnce(); expect(warn).not.toHaveBeenCalled();
  });
  it('重讀失敗不能顯示已完成', async () => {
    const input = inputFor(); input.reload = vi.fn(async () => { throw new Error('offline'); });
    registerMock('forceDemoteToWaitlist', () => ({ success: true, deduplicated: true }));
    expect((await adjustRosterStatus(input)).message).toBe('名單資料同步中，請稍後重試');
    expect(log).not.toHaveBeenCalled();
  });
  it('一般成功後重讀失敗仍保留已完成結果與刷新提示', async () => {
    const input = inputFor(); input.reload = async () => { throw new Error('offline'); };
    registerMock('forceDemoteToWaitlist', () => demoted);
    const actual = await adjustRosterStatus(input);
    expect(actual.tone).toBe('warning');
    expect(actual.message).toBe('已將 小明 下放至候補（4/2）\n名單資料同步中，請稍後重試');
    expect(log).toHaveBeenCalledOnce();
  });
  it('確認框單人及含同行者逐字，取消不 flush', async () => {
    for (const companions of [0, 2]) {
      const input = inputFor(); const state = input.getLatest();
      state.registrations = [...state.registrations, ...Array.from({ length: companions },
        () => ({ userId: 'uidB', status: 'confirmed', participantType: 'companion' }))];
      input.confirm = vi.fn(async () => false); input.flush = vi.fn();
      await adjustRosterStatus(input);
      expect(input.confirm).toHaveBeenCalledWith(companions
        ? '確定將 小明（含 2 位同行者）下放到候補嗎？' : '確定將 小明 下放到候補嗎？');
      expect(input.flush).not.toHaveBeenCalled();
    }
    expect(stopRecording()).toHaveLength(0);
  });
  it('flush 完成前不呼叫，完成後再次驗權限', async () => {
    const input = inputFor(); const state = input.getLatest();
    input.flush = vi.fn(async () => { state.context.uid = null; });
    expect((await adjustRosterStatus(input)).message).toBe('請重新登入後再試');
    expect(stopRecording()).toHaveLength(0);
  });
  it('日誌失敗不重送 Callable，仍重讀名單', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.mockRejectedValue(new Error('offline'));
    const input = inputFor(); input.reload = vi.fn(input.reload);
    registerMock('forceDemoteToWaitlist', () => demoted);
    expect((await adjustRosterStatus(input)).tone).toBe('success');
    expect(stopRecording()).toHaveLength(1); expect(input.reload).toHaveBeenCalledOnce();
  });
});
