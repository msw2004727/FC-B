import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallableError, clearMocks, registerMock, startRecording, stopRecording } from '@/data/callables';
import { adjustRosterStatus, ROSTER_STATUS_TIMEOUT_MS } from './roster-status';
import { demoted, promoted, inputFor, snapshot } from './roster-status-test-fixtures';
import type { RosterStatusAction } from './roster-status-policy';
import { matrix, matrixInput } from './__fixtures__/roster-status-matrix';

const mocks = vi.hoisted(() => ({ log: vi.fn(), enabled: true }));
vi.mock('@/data/op-log', () => ({ writeOpLog: mocks.log }));
vi.mock('@/data/roster-status-deployed', () => ({
  get ROSTER_STATUS_CALLABLES_DEPLOYED() { return mocks.enabled; },
}));
const fail = (code: string) => new CallableError('failed-precondition', 'opaque', { code });
beforeEach(() => {
  mocks.log.mockReset(); mocks.enabled = true;
  vi.stubEnv('VITE_CALLABLE_MODE', 'mock'); clearMocks(); startRecording();
});
afterEach(() => { stopRecording(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('名單狀態調整', () => {
  it.each(matrix)('$id：handler 與按鈕共用矩陣', async row => {
    for (const action of ['demote', 'promote'] as const) {
      startRecording();
      const input = inputFor(action);
      const state = { ...input.getLatest(), ...matrixInput(row) };
      input.getLatest = () => state;
      input.reload = async () => state;
      registerMock('forceDemoteToWaitlist', () => demoted);
      registerMock('forcePromoteWaitlist', () => promoted);
      await adjustRosterStatus(input);
      expect(stopRecording()).toHaveLength(row[action] ? 1 : 0);
    }
  });
  it('U1/U13：精確請求與日誌欄位及回傳人數', async () => {
    const input = inputFor(); input.reload = vi.fn(input.reload);
    registerMock('forceDemoteToWaitlist', () => demoted);
    const result = await adjustRosterStatus(input);
    const calls = stopRecording();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.request).toEqual({ eventId: 'evtA', userId: 'uidB', requestId: expect.any(String) });
    expect(mocks.log).toHaveBeenCalledExactlyOnceWith({
      type: 'force_demote', typeName: '下放候補', content: '活動「週末活動」將 小明 下放至候補',
      eventId: 'evtA', actorUid: 'uidA', operator: '管理員甲',
    });
    expect(result).toEqual({ message: '已將 小明 下放至候補（4/2）', tone: 'success' });
    expect(input.reload).toHaveBeenCalledOnce();
  });
  it('U2/U13/U16：一般正取及同行者姓名', async () => {
    const input = inputFor('promote'); const state = input.getLatest();
    state.registrations = [...state.registrations, { userId: 'uidB', status: 'waitlisted',
      participantType: 'companion', companionName: '小華' }];
    input.confirm = vi.fn();
    registerMock('forcePromoteWaitlist', () => ({ ...promoted, overCapacity: false }));
    const result = await adjustRosterStatus(input);
    expect(stopRecording()[0]?.request).toEqual({ eventId: 'evtA', userId: 'uidB', requestId: expect.any(String) });
    expect(input.confirm).not.toHaveBeenCalled();
    expect(result.message).toBe('已正取（4/2）');
    expect(mocks.log.mock.calls[0]?.[0].content).toBe('活動「週末活動」將 小明、小華 從候補升為正取');
  });
  it('U3：二次確認與每次不同 requestId', async () => {
    const input = inputFor('promote'); const state = input.getLatest();
    state.event.max = 1;
    state.registrations = [...state.registrations, { userId: 'uidA', status: 'confirmed' }];
    input.confirm = vi.fn(async () => true);
    let calls = 0;
    registerMock('forcePromoteWaitlist', () => { if (++calls === 1) throw fail('CAPACITY_EXCEEDED'); return promoted; });
    expect((await adjustRosterStatus(input)).message).toBe('已正取（4/1）\n已超出名額上限');
    expect(input.confirm).toHaveBeenCalledExactlyOnceWith('正取後將超過名額上限（2/1），確定要繼續嗎？');
    const payloads = stopRecording().map(call => call.request as Record<string, unknown>);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).not.toHaveProperty('allowOverCapacity');
    expect(payloads[1]).toHaveProperty('allowOverCapacity', true);
    expect(payloads[1]?.requestId).not.toBe(payloads[0]?.requestId);
  });
  it('U4：delegate 無額外權限不確認', async () => {
    const input = inputFor('promote'); const state = input.getLatest();
    state.context = { ...state.context, role: 'user', rolePermissions: [] };
    state.event = { ...state.event, creatorUid: 'uidB', delegateUids: ['uidA'] };
    input.confirm = vi.fn(async () => true);
    input.reload = vi.fn(input.reload); input.refreshPermissions = vi.fn();
    registerMock('forcePromoteWaitlist', () => { throw fail('CAPACITY_EXCEEDED'); });
    expect((await adjustRosterStatus(input)).message).toBe('權限不足');
    expect(input.reload).toHaveBeenCalledOnce(); expect(input.refreshPermissions).toHaveBeenCalledOnce();
    expect(input.confirm).not.toHaveBeenCalled(); expect(stopRecording()).toHaveLength(1);
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it('U4b：確認框期間降級能力被撤，二次確認後的守衛不送出', async () => {
    const input = inputFor('promote'); const state = input.getLatest();
    input.confirm = vi.fn(async () => {
      state.event = { ...state.event, max: 0 };
      return true;
    });
    registerMock('forcePromoteWaitlist', () => { throw fail('CAPACITY_EXCEEDED'); });
    expect((await adjustRosterStatus(input)).message).toBe('權限不足');
    expect(input.confirm).toHaveBeenCalledOnce();
    expect(stopRecording()).toHaveLength(1); expect(mocks.log).not.toHaveBeenCalled();
  });
  it('U5：取消確認，不再呼叫', async () => {
    const input = inputFor('promote'); input.confirm = vi.fn(async () => false);
    registerMock('forcePromoteWaitlist', () => { throw fail('CAPACITY_EXCEEDED'); });
    expect((await adjustRosterStatus(input)).message).toBe('');
    expect(input.confirm).toHaveBeenCalledWith('正取後將超過名額上限，確定要繼續嗎？');
    expect(stopRecording()).toHaveLength(1); expect(mocks.log).not.toHaveBeenCalled();
  });
  it('U6：第二次拒絕不再重送', async () => {
    const input = inputFor('promote'); input.confirm = vi.fn(async () => true);
    registerMock('forcePromoteWaitlist', () => { throw fail('CAPACITY_EXCEEDED'); });
    expect((await adjustRosterStatus(input)).message).toBe('正取後將超過名額上限');
    expect(stopRecording()).toHaveLength(2); expect(input.confirm).toHaveBeenCalledOnce();
  });
  it.each(['demote', 'promote'] as const)('U7/U8：%s 先重讀再判斷最新狀態', async action => {
    for (const response of ['deduplicated', 'stateError']) {
      for (const state of ['destination', 'original', 'removed', 'mixed']) {
        const input = inputFor(action);
        const fresh = snapshot(action);
        const from = action === 'demote' ? 'confirmed' : 'waitlisted';
        const to = action === 'demote' ? 'waitlisted' : 'confirmed';
        fresh.registrations = state === 'removed' ? [] : [
          { userId: 'uidB', status: state === 'original' ? from : to },
          ...(state === 'mixed' ? [{ userId: 'uidB', status: from }] : []),
        ];
        let release!: () => void;
        input.reload = vi.fn(() => new Promise<typeof fresh>(resolve => { release = () => resolve(fresh); }));
        const handler = () => {
          if (response === 'stateError') throw fail(action === 'demote' ? 'REGISTRATION_NOT_CONFIRMED' : 'REGISTRATION_NOT_WAITLISTED');
          return { success: true as const, deduplicated: true as const };
        };
        if (action === 'demote') registerMock('forceDemoteToWaitlist', handler);
        else registerMock('forcePromoteWaitlist', handler);
        let settled = false;
        const promise = adjustRosterStatus(input).then(value => { settled = true; return value; });
        await vi.waitFor(() => expect(input.reload).toHaveBeenCalledOnce());
        expect(settled).toBe(false); expect(mocks.log).not.toHaveBeenCalled();
        release();
        const actual = await promise;
        expect(actual.message).toBe(state === 'destination' ? (action === 'demote' ? '小明 已是候補' : '小明 已是正取')
          : state === 'removed' ? '找不到報名紀錄' : '儲存失敗，請重試');
        expect(actual.tone).toBe(state === 'destination' ? 'info' : 'error');
      }
    }
  });
  it('U10：35 秒以前不逾時，逾時立即重讀', async () => {
    vi.useFakeTimers();
    expect(ROSTER_STATUS_TIMEOUT_MS).toBeGreaterThanOrEqual(35_000);
    const input = inputFor('promote'); input.reload = vi.fn(input.reload);
    registerMock('forcePromoteWaitlist', () => new Promise(() => {}));
    const promise = adjustRosterStatus(input);
    await vi.advanceTimersByTimeAsync(34_999);
    expect(input.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ROSTER_STATUS_TIMEOUT_MS - 34_999);
    expect((await promise).message).toBe('連線逾時，請檢查網路後重新整理再試');
    expect(input.reload).toHaveBeenCalledOnce(); expect(mocks.log).not.toHaveBeenCalled();
  });
  it('U11：失敗後手動再按產生新 requestId', async () => {
    const input = inputFor();
    registerMock('forceDemoteToWaitlist', () => { throw fail('FORCE_DEMOTE_FAILED'); });
    await adjustRosterStatus(input); await adjustRosterStatus(input);
    const payloads = stopRecording().map(call => call.request as { requestId: string });
    expect(payloads).toHaveLength(2); expect(payloads[0]?.requestId).not.toBe(payloads[1]?.requestId);
  });
  it.each([
    ['max', '此活動無名額上限，無法下放候補'],
    ['companion', '請從主報名者操作下放'],
    ['missing', '找不到正取紀錄'],
    ['course', '請在舊版操作'],
    ['permission', '權限不足'],
    ['flag', '權限不足'],
  ])('U12：前置 %s 顯示對應提示且不呼叫', async (kind, message) => {
    const input = inputFor(); const state = input.getLatest();
    if (kind === 'max') state.event.max = 0;
    if (kind === 'companion') input.target.isCompanion = true;
    if (kind === 'missing') state.registrations = [];
    if (kind === 'course') state.registrations = [{ userId: 'uidB', status: 'confirmed', coursePriority: true }];
    if (kind === 'permission') state.context = { ...state.context, role: 'user', rolePermissions: [] };
    if (kind === 'flag') mocks.enabled = false;
    input.confirm = vi.fn();
    expect(await adjustRosterStatus(input)).toEqual({ message, tone: 'error' });
    expect(stopRecording()).toEqual([]); expect(input.confirm).not.toHaveBeenCalled(); expect(mocks.log).not.toHaveBeenCalled();
  });
  it.each(['demote', 'promote'] as RosterStatusAction[])('確認期間權限變動：%s 重驗', async action => {
    const input = inputFor(action); const state = input.getLatest();
    input.confirm = vi.fn(async () => {
      state.context = { ...state.context, role: 'user', rolePermissions: [] };
      return true;
    });
    registerMock('forcePromoteWaitlist', () => { throw fail('CAPACITY_EXCEEDED'); });
    expect((await adjustRosterStatus(input)).message).toBe('權限不足');
    expect(stopRecording()).toHaveLength(action === 'demote' ? 0 : 1);
    expect(mocks.log).not.toHaveBeenCalled();
  });
});
