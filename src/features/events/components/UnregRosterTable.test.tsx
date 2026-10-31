import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRemoveAttendance,
  mockWriteAttendanceOps,
  mockWriteOpLog,
  mockAppConfirm,
  mockSettleAttendance,
} = vi.hoisted(() => ({
  mockRemoveAttendance: vi.fn(),
  mockWriteAttendanceOps: vi.fn(),
  mockWriteOpLog: vi.fn(),
  mockAppConfirm: vi.fn(),
  mockSettleAttendance: vi.fn(),
}));

vi.mock('../data/attendance-settle', () => ({
  settleAttendance: mockSettleAttendance,
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
    Reflect.deleteProperty(document, 'visibilityState');
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

  // 測試同步更新：照 A（C-001）
  it('enters edit mode on clicking 編輯, shows 完成 and 踢掉 buttons, and instant-saves checkout', async () => {
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
    expect(screen.getByRole('button', { name: '完成' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '關閉編輯' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: '踢' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '踢掉' })).toBeTruthy();
    expect(screen.queryByText('請在舊版按完成以結算經驗值與放鴿子')).toBeNull();

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

  it('按「完成」等待 flush 後提示儲存完成並退出編輯，不呼叫正取名單結算', async () => {
    const onToast = vi.fn();
    let finishWrite!: () => void;
    mockWriteAttendanceOps.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishWrite = resolve;
    }));

    render(
      <UnregRosterTable
        eventId="ce_1"
        eventDocId="doc_1"
        eventTitle="週五夜球"
        attendanceRecords={sampleUnregRecords}
        canManage={true}
        operatorUid="u_admin"
        onToast={onToast}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    fireEvent.input(screen.getByRole('textbox', { name: '陳路人 備註' }), {
      target: { value: '準備收工' },
    });
    expect(mockWriteAttendanceOps).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '完成' }));
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
    expect(onToast).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '儲存中...' })).toBeTruthy();
    expect(mockSettleAttendance).not.toHaveBeenCalled();

    await act(async () => {
      finishWrite();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onToast).toHaveBeenCalledExactlyOnceWith('儲存完成');
    expect(screen.getByRole('button', { name: '編輯' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '完成' })).toBeNull();
    expect(mockSettleAttendance).not.toHaveBeenCalled();
  });

  function beforeUnloadPrevented(): boolean {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  function renderEditing(): HTMLElement {
    const view = render(
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
    return view.container as HTMLElement;
  }

  it('防抖期間卸載會送出且只送一次', async () => {
    const view = render(
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
    const checkoutBox = document.getElementById('unreg-checkout-u_unreg_1') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(checkoutBox);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(0);

    await act(async () => {
      view.unmount();
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
  });

  it('visibility 仍為 visible 時不送出；變成 hidden 才 flush 一次', async () => {
    renderEditing();
    const checkoutBox = document.getElementById('unreg-checkout-u_unreg_1') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(checkoutBox);
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(0);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
  });

  it('pagehide 會 flush 防抖中的寫入且只送一次', async () => {
    renderEditing();
    const checkoutBox = document.getElementById('unreg-checkout-u_unreg_1') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(checkoutBox);
    });
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
  });

  it('寫入成功後重讀未完成時該列已可再操作', async () => {
    let resolveReload!: (rows: readonly RosterAttendanceRecordInput[]) => void;
    const onReload = vi.fn(
      () => new Promise<readonly RosterAttendanceRecordInput[]>((resolve) => {
        resolveReload = resolve;
      }),
    );
    render(
      <UnregRosterTable
        eventId="ce_1"
        eventDocId="doc_1"
        eventTitle="週五夜球"
        attendanceRecords={sampleUnregRecords}
        canManage={true}
        operatorUid="u_admin"
        onReloadAttendance={onReload}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    const checkoutBox = document.getElementById('unreg-checkout-u_unreg_1') as HTMLInputElement;

    await act(async () => {
      fireEvent.click(checkoutBox);
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });

    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(checkoutBox.disabled).toBe(false);
    expect(checkoutBox.checked).toBe(true);

    await act(async () => {
      fireEvent.click(checkoutBox);
    });
    expect(checkoutBox.disabled).toBe(false);
    expect(checkoutBox.checked).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(2);
    const removes = mockWriteAttendanceOps.mock.calls[1]?.[1] as {
      removes: Array<{ _docId?: string }>;
    };
    expect(removes.removes.map((rec) => rec._docId)).toContain('d1');
    await act(async () => {
      resolveReload([]);
    });
  });

  it('快速連點同一人只寫最後狀態', async () => {
    renderEditing();
    const checkoutBox = document.getElementById('unreg-checkout-u_unreg_1') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(checkoutBox);
    });
    await act(async () => {
      fireEvent.click(checkoutBox);
    });
    await act(async () => {
      fireEvent.click(checkoutBox);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
    const opsArg = mockWriteAttendanceOps.mock.calls[0]?.[1] as {
      adds: Array<{ type: string }>;
    };
    expect(opsArg.adds.map((add) => add.type)).toEqual(['checkout']);
    expect(checkoutBox.checked).toBe(true);
  });

  it('寫入失敗時還原簽退勾選', async () => {
    mockWriteAttendanceOps.mockRejectedValueOnce(new Error('network error'));
    const onToast = vi.fn();
    render(
      <UnregRosterTable
        eventId="ce_1"
        eventDocId="doc_1"
        eventTitle="週五夜球"
        attendanceRecords={sampleUnregRecords}
        canManage={true}
        operatorUid="u_admin"
        onToast={onToast}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    const checkoutBox = document.getElementById('unreg-checkout-u_unreg_1') as HTMLInputElement;
    const checkinBox = document.getElementById('unreg-checkin-u_unreg_1') as HTMLInputElement;

    await act(async () => {
      fireEvent.click(checkoutBox);
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });

    expect(onToast).toHaveBeenCalledWith('陳路人 儲存失敗，已還原');
    expect(checkoutBox.checked).toBe(false);
    expect(checkinBox.checked).toBe(true);
  });

  it('beforeunload 在有待寫入時註冊，清空後解除', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    try {
      renderEditing();
      expect(beforeUnloadPrevented()).toBe(false);
      const checkoutBox = document.getElementById('unreg-checkout-u_unreg_1') as HTMLInputElement;
      await act(async () => {
        fireEvent.click(checkoutBox);
      });
      expect(add.mock.calls.filter((call) => call[0] === 'beforeunload')).toHaveLength(1);
      expect(beforeUnloadPrevented()).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
      });
      expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
      expect(remove.mock.calls.filter((call) => call[0] === 'beforeunload').length).toBeGreaterThan(0);
      expect(beforeUnloadPrevented()).toBe(false);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('寫入成功後背景重讀失敗，頁面傳入新出席資料時改採用新資料', async () => {
    const initialRecords: RosterAttendanceRecordInput[] = [
      {
        _docId: 'targetA',
        uid: 'uidA',
        userName: '甲',
        type: 'unreg',
        status: 'active',
        time: '2026/10/31 10:00',
      },
    ];
    const nextRecords: RosterAttendanceRecordInput[] = [
      ...initialRecords,
      {
        uid: 'uidA',
        userName: '甲',
        type: 'note',
        status: 'active',
        note: '頁面備註',
        time: '2026/10/31 10:01',
      },
    ];
    const onReload = vi.fn(() => Promise.reject(new Error('reload failed')));

    function PageDataUnreg() {
      const [records, setRecords] = useState(initialRecords);
      return (
        <>
          <button type="button" onClick={() => setRecords(nextRecords)}>套用頁面資料</button>
          <UnregRosterTable
            eventId="evtA"
            eventDocId="evtA"
            eventTitle="甲"
            attendanceRecords={records}
            canManage={true}
            operatorUid="uidB"
            onReloadAttendance={onReload}
          />
        </>
      );
    }

    render(<PageDataUnreg />);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    const checkinBox = document.getElementById('unreg-checkin-uidA') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(checkinBox);
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(checkinBox.checked).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '套用頁面資料' }));
    });
    expect((document.getElementById('unreg-checkin-uidA') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('unreg-note-uidA') as HTMLInputElement).value).toBe('頁面備註');
  });
});
