import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRemoveAttendance,
  mockWriteAttendanceOps,
  mockWriteOpLog,
  mockAppConfirm,
} = vi.hoisted(() => ({
  mockRemoveAttendance: vi.fn(),
  mockWriteAttendanceOps: vi.fn(),
  mockWriteOpLog: vi.fn(),
  mockAppConfirm: vi.fn(),
}));

vi.mock('@/features/checkin/data/attendance', async () => {
  const actual = await vi.importActual<typeof import('@/features/checkin/data/attendance')>(
    '@/features/checkin/data/attendance',
  );
  return {
    ...actual,
    removeAttendance: mockRemoveAttendance,
  };
});

vi.mock('../data/attendance-edit', async () => {
  const actual = await vi.importActual<typeof import('../data/attendance-edit')>(
    '../data/attendance-edit',
  );
  return {
    ...actual,
    writeAttendanceOps: mockWriteAttendanceOps,
  };
});

vi.mock('@/data/op-log', () => ({
  writeOpLog: mockWriteOpLog,
}));

vi.mock('@/ui/AppConfirm', () => ({
  appConfirm: mockAppConfirm,
}));

import { UnregRosterTable } from './UnregRosterTable';
import { CHECKBOX_DEBOUNCE_MS } from './useAttendanceInstantSave';
import type { RosterAttendanceRecordInput } from '../data/attendance-roster-model';

const sampleUnregRecords: RosterAttendanceRecordInput[] = [
  {
    _docId: 'att_u1_unreg',
    uid: 'u_unreg_1',
    userName: '陳路人',
    type: 'unreg',
    status: 'active',
    time: '2026/05/01 19:00',
  },
  // 同一人重複一筆 unreg，應去重只顯示一次
  {
    _docId: 'att_u1_unreg_dup',
    uid: 'u_unreg_1',
    userName: '陳路人',
    type: 'unreg',
    status: 'active',
    time: '2026/05/01 19:01',
  },
  {
    _docId: 'att_u1_in',
    uid: 'u_unreg_1',
    userName: '陳路人',
    type: 'checkin',
    status: 'active',
    time: '2026/05/01 19:02',
  },
  {
    _docId: 'att_u1_note',
    uid: 'u_unreg_1',
    userName: '陳路人',
    type: 'note',
    note: '現場臨打',
    status: 'active',
    time: '2026/05/01 19:03',
  },
  // 已軟刪的 unreg 不應列出
  {
    _docId: 'att_u2_removed',
    uid: 'u_removed',
    userName: '已移除者',
    type: 'unreg',
    status: 'removed',
    time: '2026/05/01 18:00',
  },
];

describe('UnregRosterTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockRemoveAttendance.mockResolvedValue(undefined);
    mockWriteAttendanceOps.mockResolvedValue({ addedDocIds: ['d1'], removedDocIds: [] });
    mockWriteOpLog.mockResolvedValue(undefined);
    mockAppConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('returns null when there are no active unreg records', () => {
    const { container } = render(
      <UnregRosterTable
        eventId="ce_1"
        eventDocId="doc_1"
        eventTitle="週五夜球"
        attendanceRecords={[
          { _docId: 'a1', uid: 'u1', userName: 'A', type: 'checkin', status: 'active' },
          { _docId: 'a2', uid: 'u2', userName: 'B', type: 'unreg', status: 'removed' },
        ]}
        canManage={true}
        operatorUid="u_admin"
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders deduplicated unreg users, combined note「未報名・{note}」, and hides 編輯 button when canManage is false', () => {
    const { rerender } = render(
      <UnregRosterTable
        eventId="ce_1"
        eventDocId="doc_1"
        eventTitle="週五夜球"
        attendanceRecords={sampleUnregRecords}
        canManage={false}
        operatorUid="u_viewer"
      />,
    );

    expect(screen.getByText('未報名單（1）')).toBeTruthy();
    expect(screen.getByText('陳路人')).toBeTruthy();
    expect(screen.queryByText('已移除者')).toBeNull();
    expect(screen.getByText('✓')).toBeTruthy();
    expect(screen.getByText('未報名・現場臨打')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '編輯' })).toBeNull();

    rerender(
      <UnregRosterTable
        eventId="ce_1"
        eventDocId="doc_1"
        eventTitle="週五夜球"
        attendanceRecords={sampleUnregRecords}
        canManage={true}
        operatorUid="u_admin"
      />,
    );
    expect(screen.getByRole('button', { name: '編輯' })).toBeTruthy();
  });

  it('enters edit mode on clicking 編輯, shows 踢掉 button, legacy settle notice, and instant-saves checkout', async () => {
    render(
      <UnregRosterTable
        eventId="ce_1"
        eventDocId="doc_1"
        eventTitle="週五夜球"
        attendanceRecords={sampleUnregRecords}
        canManage={true}
        operatorUid="u_admin"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(screen.getByRole('button', { name: '關閉編輯' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '踢' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '踢掉' })).toBeTruthy();
    expect(screen.getByText('請在舊版按完成以結算經驗值與放鴿子')).toBeTruthy();

    const checkoutBox = document.getElementById('unreg-checkout-u_unreg_1') as HTMLInputElement;
    expect(checkoutBox.checked).toBe(false);

    await act(async () => {
      fireEvent.click(checkoutBox);
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });

    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
    expect(mockWriteAttendanceOps.mock.calls[0]?.[0]).toBe('doc_1');
    expect(mockWriteAttendanceOps.mock.calls[0]?.[2]).toBe('u_admin');
  });

  it('soft-deletes all active attendance records for the user and writes unreg_removed opLog on clicking 踢掉', async () => {
    const onReload = vi.fn(async () => []);
    const onToast = vi.fn();

    render(
      <UnregRosterTable
        eventId="ce_1"
        eventDocId="doc_1"
        eventTitle="週五夜球"
        attendanceRecords={sampleUnregRecords}
        canManage={true}
        operatorUid="u_admin"
        operatorName="王教練"
        onReloadAttendance={onReload}
        onToast={onToast}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    const kickBtn = screen.getByRole('button', { name: '踢掉' });

    await act(async () => {
      fireEvent.click(kickBtn);
    });

    expect(mockAppConfirm).toHaveBeenCalledWith('確定要將 陳路人 從未報名單中移除嗎？');
    // 應將該用戶全部 4 筆 active 記錄軟刪除（逐筆 await，等迴圈跑完再斷言）
    await vi.waitFor(() => expect(mockRemoveAttendance).toHaveBeenCalledTimes(4));
    expect(mockRemoveAttendance).toHaveBeenCalledWith('doc_1', 'att_u1_unreg', 'u_admin');
    expect(mockRemoveAttendance).toHaveBeenCalledWith('doc_1', 'att_u1_unreg_dup', 'u_admin');
    expect(mockRemoveAttendance).toHaveBeenCalledWith('doc_1', 'att_u1_in', 'u_admin');
    expect(mockRemoveAttendance).toHaveBeenCalledWith('doc_1', 'att_u1_note', 'u_admin');

    expect(mockWriteOpLog).toHaveBeenCalledWith({
      type: 'unreg_removed',
      typeName: '移除未報名掃碼',
      content: '從「週五夜球」移除 陳路人',
      actorUid: 'u_admin',
      operator: '王教練',
    });
    await vi.waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(onToast).toHaveBeenCalledWith('已將 陳路人 從未報名單中移除');
  });
});
