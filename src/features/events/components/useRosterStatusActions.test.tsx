import { useState } from 'preact/hooks';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, registerMock, startRecording, stopRecording, CallableError } from '@/data/callables';
import { useRosterStatusActions } from './useRosterStatusActions';
import { AttendanceRosterTable } from './AttendanceRosterTable';
import { WaitlistRosterTable } from './WaitlistRosterTable';
import { snapshot, translate } from '../data/roster-status-test-fixtures';
import type { RosterStatusSnapshot } from '../data/roster-status';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), toast: vi.fn(), log: vi.fn() }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: mocks.confirm }));
vi.mock('@/ui/Toast', () => ({ toast: { show: mocks.toast } }));
vi.mock('@/data/op-log', () => ({ writeOpLog: mocks.log }));
vi.mock('@/features/profile/data/viewer', () => ({ requestViewerRefresh: vi.fn() }));
vi.mock('@/i18n/i18n', () => ({ useT: () => translate }));
vi.mock('@/ui/UserTag', () => ({ UserTag: ({ name }: { name: string }) => <span>{name}</span> }));

function Harness({ state, reload, flush = async () => {}, isCurrent = () => true, observe }: {
  state: RosterStatusSnapshot; reload: () => Promise<RosterStatusSnapshot>; flush?: () => Promise<void>;
  isCurrent?: () => boolean;
  observe?: (actions: ReturnType<typeof useRosterStatusActions>, submitting: boolean) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const actions = useRosterStatusActions({
    eventId: 'evtA', getLatest: () => state, reload, flush,
    isCurrent, submitting, setSubmitting,
  });
  observe?.(actions, submitting);
  return <>
    <AttendanceRosterTable event={state.event} registrations={state.registrations} attendanceRecords={[]}
      roles={{}} onOpenProfile={() => {}} canManage editing submitting={submitting}
      rosterContext={state.context} demotePendingKeys={actions.demotePendingKeys}
      onDemoteParticipant={person => { actions.perform('demote', { userId: person.uid, name: person.name }).catch(() => {}); }} />
    <WaitlistRosterTable event={state.event} registrations={state.registrations}
      roles={{}} onOpenProfile={() => {}} editing submitting={submitting}
      rosterContext={state.context} promotePendingKeys={actions.promotePendingKeys}
      onPromoteParticipant={item => { actions.perform('promote', { userId: item.userId, name: item.name }).catch(() => {}); }} />
  </>;
}
beforeEach(() => {
  vi.stubEnv('VITE_CALLABLE_MODE', 'mock'); clearMocks(); vi.clearAllMocks();
  mocks.confirm.mockResolvedValue(true); startRecording();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); stopRecording(); });
describe('名單狀態調整互動', () => {
  it.each(['deduplicated', 'REGISTRATION_NOT_CONFIRMED', 'REGISTRATION_NOT_WAITLISTED'])('%s 只在刷新完成後提示', async code => {
    const promote = code === 'REGISTRATION_NOT_WAITLISTED';
    const state = snapshot(promote ? 'promote' : 'demote');
    const handler = () => {
      if (code !== 'deduplicated') throw new CallableError('failed-precondition', code);
      return { success: true as const, deduplicated: true as const };
    };
    if (promote) registerMock('forcePromoteWaitlist', handler);
    else registerMock('forceDemoteToWaitlist', handler);
    let resolve!: (fresh: RosterStatusSnapshot) => void;
    const reload = vi.fn(() => new Promise<RosterStatusSnapshot>(done => { resolve = done; }));
    render(<Harness state={state} reload={reload} />);
    fireEvent.click(screen.getByRole('button', { name: promote ? '將 小明 正取' : '將 小明 下放到候補' }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(mocks.toast).not.toHaveBeenCalled(); expect(mocks.log).not.toHaveBeenCalled();
    const fresh = { ...state, registrations: [{ userId: 'uidB', status: promote ? 'confirmed' : 'waitlisted' }] };
    await act(async () => { resolve(fresh); });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      message: promote ? '小明 已是正取' : '小明 已是候補', tone: 'info',
    }));
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it('確認期間連點只送一次，取消後可重新操作', async () => {
    const state = snapshot(); const reload = vi.fn(async () => state);
    let resolve!: (ok: boolean) => void;
    mocks.confirm.mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    render(<Harness state={state} reload={reload} />);
    const button = screen.getByRole('button', { name: '將 小明 下放到候補' });
    fireEvent.click(button); fireEvent.click(button);
    expect(mocks.confirm).toHaveBeenCalledOnce();
    await act(async () => { resolve(false); });
    await waitFor(() => expect(button).toHaveProperty('disabled', false));
    fireEvent.click(button);
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    await act(async () => { resolve(false); });
    expect(stopRecording()).toHaveLength(0);
  });
  it('操作期間快照暫不可用，完成後清除送出狀態並可再次操作', async () => {
    const state = snapshot(); const reload = vi.fn(async () => state);
    let current = true;
    const isCurrent = () => current;
    let actions!: ReturnType<typeof useRosterStatusActions>;
    let submitting = false;
    const observe = (value: typeof actions, busy: boolean) => { actions = value; submitting = busy; };
    let release!: () => void;
    const flush = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const view = render(<Harness state={state} reload={reload} flush={flush} isCurrent={isCurrent} observe={observe} />);
    const button = screen.getByRole('button', { name: '將 小明 下放到候補' });
    fireEvent.click(button);
    await waitFor(() => expect(flush).toHaveBeenCalledOnce());
    expect(actions.busy()).toBe(true); expect(submitting).toBe(true);
    expect(actions.demotePendingKeys).toEqual({ uidB: true });
    expect(button).toHaveProperty('disabled', true);
    current = false;
    view.rerender(<Harness state={state} reload={reload} flush={flush} isCurrent={isCurrent} observe={observe} />);
    await act(async () => { release(); });
    await waitFor(() => {
      expect(actions.busy()).toBe(false); expect(submitting).toBe(false);
      expect(actions.demotePendingKeys).toEqual({}); expect(actions.promotePendingKeys).toEqual({});
    });
    expect(mocks.toast).not.toHaveBeenCalled();
    current = true;
    view.rerender(<Harness state={state} reload={reload} flush={flush} isCurrent={isCurrent} observe={observe} />);
    expect(button).toHaveProperty('disabled', false);
    mocks.confirm.mockResolvedValueOnce(false);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(actions.busy()).toBe(false));
    expect(stopRecording()).toHaveLength(0);
  });
  it('35 秒逾時後立即重讀且不記錄', async () => {
    vi.useFakeTimers();
    const state = snapshot('promote'); const reload = vi.fn(async () => state);
    registerMock('forcePromoteWaitlist', () => new Promise(() => {}));
    render(<Harness state={state} reload={reload} />);
    fireEvent.click(screen.getByRole('button', { name: '將 小明 正取' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(34_999); });
    expect(reload).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(reload).toHaveBeenCalledOnce(); expect(mocks.log).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith({
      message: '連線逾時，請檢查網路後重新整理再試', tone: 'error',
    });
  });
  it('確認中權限更新會使用最新 context', async () => {
    const state = snapshot(); const reload = vi.fn(async () => state);
    let resolve!: (ok: boolean) => void;
    mocks.confirm.mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    const view = render(<Harness state={state} reload={reload} />);
    fireEvent.click(screen.getByRole('button', { name: '將 小明 下放到候補' }));
    const updated = { ...state, context: { ...state.context, role: 'user', rolePermissions: [] } };
    view.rerender(<Harness state={updated} reload={reload} />);
    await act(async () => { resolve(true); });
    expect(stopRecording()).toHaveLength(0);
    expect(mocks.toast).toHaveBeenCalledWith({ message: '權限不足', tone: 'error' });
  });
});
