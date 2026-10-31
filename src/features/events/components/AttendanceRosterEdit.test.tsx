import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWriteAttendanceOps } = vi.hoisted(() => ({
  mockWriteAttendanceOps: vi.fn(),
}));

vi.mock('../data/attendance-edit', async () => {
  const actual = await vi.importActual<typeof import('../data/attendance-edit')>(
    '../data/attendance-edit',
  );
  return {
    ...actual,
    writeAttendanceOps: mockWriteAttendanceOps,
  };
});

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string, params?: Record<string, unknown>) => {
    const dict: Record<string, string> = {
      'ui.userTag.openProfile': `檢視 ${params?.name ?? ''}`,
      'ui.userTag.unknown': '未知用戶',
    };
    return dict[key] ?? key;
  },
}));

import { useState } from 'preact/hooks';
import { AttendanceRosterTable } from './AttendanceRosterTable';
import {
  CHECKBOX_DEBOUNCE_MS,
  NOTE_DEBOUNCE_MS,
  useAttendanceInstantSave,
} from './useAttendanceInstantSave';
import type {
  RosterAttendanceRecordInput,
  RosterEventInput,
  RosterRegistrationInput,
} from '../data/attendance-roster-model';

const baseEvent: RosterEventInput = {
  id: 'ce_test_1',
  max: 10,
  current: 2,
  teamReservationSummaries: [
    { teamId: 'tm_1', teamName: 'Alpha Club', reservedSlots: 1, usedSlots: 0, remainingSlots: 1 },
  ],
};

const baseRegs: RosterRegistrationInput[] = [
  {
    _docId: 'reg_1',
    userId: 'u_1',
    userName: '王小明',
    status: 'confirmed',
    participantType: 'self',
  },
  // 僅代報：只有 companion 沒有 self
  {
    _docId: 'reg_proxy_comp',
    userId: 'u_proxy',
    userName: '代報主帳號',
    status: 'confirmed',
    participantType: 'companion',
    companionId: 'comp_1',
    companionName: '同行小華',
  },
  // 模糊紀錄列：同一個 uid 同時有一般報名與課程連結報名
  {
    _docId: 'reg_amb_1',
    userId: 'u_amb',
    userName: '模糊學員',
    status: 'confirmed',
    participantType: 'self',
  },
  {
    _docId: 'reg_amb_2',
    userId: 'u_amb',
    userName: '模糊學員',
    status: 'confirmed',
    participantType: 'self',
    courseLinkSource: 'eduCourseLesson',
    courseStudentId: 'stu_1',
  },
];

function Harness({
  initialRecords = [],
  onFailed = vi.fn(),
  onReload = vi.fn(async () => initialRecords),
}: {
  initialRecords?: RosterAttendanceRecordInput[];
  onFailed?: (name: string) => void;
  onReload?: () => Promise<readonly RosterAttendanceRecordInput[]>;
}) {
  const [editing, setEditing] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [records, setRecords] = useState<readonly RosterAttendanceRecordInput[]>(initialRecords);

  const instant = useAttendanceInstantSave({
    event: baseEvent,
    eventDocId: 'event_doc_1',
    publicEventId: 'ce_test_1',
    operatorUid: 'u_admin',
    registrations: baseRegs,
    attendanceRecords: records,
    onReloadAttendance: async () => {
      const next = await onReload();
      setRecords(next);
      return next;
    },
    onSaveFailed: onFailed,
  });

  async function handleClose(): Promise<void> {
    setSubmitting(true);
    await instant.flushInstantSaves();
    instant.resetInstantSave();
    setSubmitting(false);
    setEditing(false);
  }

  return (
    <AttendanceRosterTable
      event={baseEvent}
      registrations={baseRegs}
      attendanceRecords={records}
      roles={{}}
      onOpenProfile={() => undefined}
      canManage={true}
      editing={editing}
      submitting={submitting}
      onStartEdit={() => setEditing(true)}
      onCloseEdit={() => {
        handleClose().catch(() => {});
      }}
      getRowSelection={instant.getRowSelection}
      inFlightKeys={instant.inFlightKeys}
      savedFlashKeys={instant.savedFlashKeys}
      failedFlashKeys={instant.failedFlashKeys}
      onToggleCheckbox={instant.onToggleCheckbox}
      onChangeNote={instant.onChangeNote}
    />
  );
}

const uidEvent: RosterEventInput = { id: 'evtA', max: 10, current: 1 };
const uidRegs: RosterRegistrationInput[] = [
  {
    _docId: 'targetA',
    userId: 'uidA',
    userName: '甲',
    status: 'confirmed',
    participantType: 'self',
  },
];

function UidATable({
  eventDocId,
  onReload,
  onFailed = () => undefined,
  nextRecords,
}: {
  eventDocId: string;
  onReload: () => Promise<readonly RosterAttendanceRecordInput[]>;
  onFailed?: (name: string) => void;
  nextRecords?: readonly RosterAttendanceRecordInput[];
}) {
  const [records, setRecords] = useState<readonly RosterAttendanceRecordInput[]>([]);
  const instant = useAttendanceInstantSave({
    event: uidEvent,
    eventDocId,
    publicEventId: 'evtA',
    operatorUid: 'uidB',
    registrations: uidRegs,
    attendanceRecords: records,
    onReloadAttendance: async () => {
      const next = await onReload();
      setRecords(next);
      return next;
    },
    onSaveFailed: onFailed,
  });

  return (
    <>
      {nextRecords ? (
        <button type="button" onClick={() => setRecords(nextRecords)}>套用頁面資料</button>
      ) : null}
      <AttendanceRosterTable
        event={uidEvent}
        registrations={uidRegs}
        attendanceRecords={records}
        roles={{}}
        onOpenProfile={() => undefined}
        canManage={true}
        editing={true}
        submitting={false}
        onStartEdit={() => undefined}
        onCloseEdit={() => undefined}
        getRowSelection={instant.getRowSelection}
        inFlightKeys={instant.inFlightKeys}
        savedFlashKeys={instant.savedFlashKeys}
        failedFlashKeys={instant.failedFlashKeys}
        onToggleCheckbox={instant.onToggleCheckbox}
        onChangeNote={instant.onChangeNote}
      />
    </>
  );
}

describe('AttendanceRosterTable & useAttendanceInstantSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockWriteAttendanceOps.mockResolvedValue({ addedDocIds: ['d1'], removedDocIds: [] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('非編輯模式：無管理權限時不顯示管理名單按鈕；有權限時顯示「管理名單」', () => {
    const { rerender } = render(
      <AttendanceRosterTable
        event={baseEvent}
        registrations={baseRegs}
        attendanceRecords={[]}
        roles={{}}
        onOpenProfile={() => undefined}
        canManage={false}
      />,
    );
    expect(screen.queryByRole('button', { name: '管理名單' })).toBeNull();

    rerender(
      <AttendanceRosterTable
        event={baseEvent}
        registrations={baseRegs}
        attendanceRecords={[]}
        roles={{}}
        onOpenProfile={() => undefined}
        canManage={true}
        editing={false}
      />,
    );
    expect(screen.getByRole('button', { name: '管理名單' })).toBeTruthy();
  });

  // 測試同步更新：照 A（C-001）
  it('編輯模式：顯示「完成」且不顯示舊版結算提示，僅代報／保留席位／模糊列不可勾選', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: '完成' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '關閉編輯' })).toBeNull();
    expect(screen.queryByText('請在舊版按完成以結算經驗值與放鴿子')).toBeNull();
    expect(screen.queryByRole('link', { name: '前往舊版' })).toBeNull();

    // 一般列與同行者列有 checkbox
    expect(document.getElementById('manual-checkin-u_1')).toBeTruthy();
    expect(document.getElementById('manual-checkin-comp_1')).toBeTruthy();

    // 僅代報、保留席位、模糊列不可勾選
    expect(document.getElementById('manual-checkin-u_proxy')).toBeNull();
    expect(document.getElementById('manual-checkin-u_amb')).toBeNull();
    expect(screen.getByText('僅代報')).toBeTruthy();
    expect(screen.getByText('保留席位')).toBeTruthy();
    expect(screen.getAllByText('請至課程點名').length).toBeGreaterThan(0);
  });

  it('勾選簽退連帶勾選簽到，300ms 後寫入（A _onAttendanceCheckboxChange）；該列閃綠 att-row-saved', async () => {
    // 寫入成功後重讀：回傳剛寫入的簽到與簽退紀錄。
    const saved: RosterAttendanceRecordInput[] = [
      { _docId: 'd1', id: 'att_1', uid: 'u_1', type: 'checkin', status: 'active' },
      { _docId: 'd2', id: 'att_2', uid: 'u_1', type: 'checkout', status: 'active' },
    ];
    render(<Harness onReload={vi.fn(async () => saved)} />);
    const checkinBox = document.getElementById('manual-checkin-u_1') as HTMLInputElement;
    const checkoutBox = document.getElementById('manual-checkout-u_1') as HTMLInputElement;
    expect(checkinBox.checked).toBe(false);
    expect(checkoutBox.checked).toBe(false);

    await act(async () => {
      fireEvent.click(checkoutBox);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });

    expect(checkinBox.checked).toBe(true);
    expect(checkoutBox.checked).toBe(true);
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
    const opsArg = mockWriteAttendanceOps.mock.calls[0]?.[1] as {
      adds: Array<{ type: string }>;
    };
    expect(opsArg.adds.map((a) => a.type)).toEqual(['checkin', 'checkout']);

    const row = document.querySelector('tr[data-attendance-key="u_1"]');
    expect(row?.classList.contains('att-row-saved')).toBe(true);
  });

  it('寫入失敗時還原 checkbox 為實際狀態並回報「{name} 儲存失敗，已還原」', async () => {
    mockWriteAttendanceOps.mockRejectedValueOnce(new Error('network error'));
    const onFailed = vi.fn();
    render(<Harness onFailed={onFailed} />);

    const checkinBox = document.getElementById('manual-checkin-u_1') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(checkinBox);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });

    expect(onFailed).toHaveBeenCalledWith('王小明');
    expect(checkinBox.checked).toBe(false);
  });

  it('同一人寫入中再次變更會排隊（queued），第一筆完成後自動再寫一次', async () => {
    let resolveFirst!: (val: { addedDocIds: string[]; removedDocIds: string[] }) => void;
    mockWriteAttendanceOps
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ addedDocIds: ['d2'], removedDocIds: [] });

    let currentRecords: RosterAttendanceRecordInput[] = [];
    const onReload = vi.fn(async () => currentRecords);

    render(<Harness onReload={onReload} />);
    const checkinBox = document.getElementById('manual-checkin-u_1') as HTMLInputElement;
    const noteInput = document.getElementById('manual-note-u_1') as HTMLInputElement;

    // 第一次點擊簽到 → 進入 in-flight
    await act(async () => {
      fireEvent.click(checkinBox);
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);

    // 寫入中修改備註並觸發 debounce → 應排入 queue
    await act(async () => {
      fireEvent.input(noteInput, { target: { value: '遲到五分鐘' } });
      await vi.advanceTimersByTimeAsync(NOTE_DEBOUNCE_MS + CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);

    // 第一筆完成後，自動觸發排隊的第二筆寫入
    currentRecords = [{ _docId: 'd1', id: 'att_1', uid: 'u_1', type: 'checkin', status: 'active' }];
    await act(async () => {
      resolveFirst({ addedDocIds: ['d1'], removedDocIds: [] });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(2);
  });

  // 測試同步更新：照 A（C-001）
  it('按下「完成」會先 flush debounce 中的備註再關閉編輯模式', async () => {
    render(<Harness />);
    const noteInput = document.getElementById('manual-note-u_1') as HTMLInputElement;

    act(() => {
      fireEvent.input(noteInput, { target: { value: '準備收工' } });
    });
    // 尚未滿 1000ms，還沒寫入
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(0);

    const closeBtn = screen.getByRole('button', { name: '完成' });
    await act(async () => {
      fireEvent.click(closeBtn);
      await vi.advanceTimersByTimeAsync(0);
    });

    // flush 立即寫入備註並退出編輯模式
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '管理名單' })).toBeTruthy();
  });

  function beforeUnloadPrevented(): boolean {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('防抖期間卸載會送出且只送一次', async () => {
    const view = render(<Harness />);
    const checkinBox = document.getElementById('manual-checkin-u_1') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(checkinBox);
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
    render(<Harness />);
    const checkinBox = document.getElementById('manual-checkin-u_1') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(checkinBox);
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
    render(<Harness />);
    const checkinBox = document.getElementById('manual-checkin-u_1') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(checkinBox);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(0);

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
  });

  it('寫入成功後重讀未完成時該列已可再操作，下一筆刪除剛寫入的文件', async () => {
    let resolveReload!: (rows: readonly RosterAttendanceRecordInput[]) => void;
    const onReload = vi.fn(
      () => new Promise<readonly RosterAttendanceRecordInput[]>((resolve) => {
        resolveReload = resolve;
      }),
    );
    render(<Harness onReload={onReload} />);
    const checkinBox = document.getElementById('manual-checkin-u_1') as HTMLInputElement;

    await act(async () => {
      fireEvent.click(checkinBox);
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });

    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(checkinBox.disabled).toBe(false);
    expect(checkinBox.checked).toBe(true);

    await act(async () => {
      fireEvent.click(checkinBox);
    });
    expect(checkinBox.checked).toBe(false);
    expect(checkinBox.disabled).toBe(false);

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

  it('快速連點同一人只寫最後一次，最終為已簽到', async () => {
    const saved: RosterAttendanceRecordInput[] = [
      { _docId: 'd1', id: 'att_1', uid: 'u_1', type: 'checkin', status: 'active' },
    ];
    render(<Harness onReload={vi.fn(async () => saved)} />);
    const checkinBox = document.getElementById('manual-checkin-u_1') as HTMLInputElement;

    await act(async () => {
      fireEvent.click(checkinBox);
    });
    await act(async () => {
      fireEvent.click(checkinBox);
    });
    await act(async () => {
      fireEvent.click(checkinBox);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });

    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
    const opsArg = mockWriteAttendanceOps.mock.calls[0]?.[1] as {
      adds: Array<{ type: string }>;
    };
    expect(opsArg.adds.map((add) => add.type)).toEqual(['checkin']);
    expect(checkinBox.checked).toBe(true);
  });

  it('beforeunload 在有待寫入時註冊一次，寫完後解除', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    try {
      render(<Harness />);
      expect(beforeUnloadPrevented()).toBe(false);
      const checkinBox = document.getElementById('manual-checkin-u_1') as HTMLInputElement;
      const checkoutBox = document.getElementById('manual-checkout-u_1') as HTMLInputElement;
      await act(async () => {
        fireEvent.click(checkinBox);
      });
      expect(add.mock.calls.filter((call) => call[0] === 'beforeunload')).toHaveLength(1);
      expect(beforeUnloadPrevented()).toBe(true);

      await act(async () => {
        fireEvent.click(checkoutBox);
      });
      expect(add.mock.calls.filter((call) => call[0] === 'beforeunload')).toHaveLength(1);

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

  it('寫入中又改動會排隊，重送時刪除剛拿到的文件', async () => {
    let resolveFirst!: (value: { addedDocIds: string[]; removedDocIds: string[] }) => void;
    mockWriteAttendanceOps.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    render(<UidATable eventDocId="evtA" onReload={async () => []} />);
    const checkinBox = document.getElementById('manual-checkin-uidA') as HTMLInputElement;

    await act(async () => {
      fireEvent.click(checkinBox);
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(checkinBox);
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({ addedDocIds: ['targetA'], removedDocIds: [] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(2);
    const removes = mockWriteAttendanceOps.mock.calls[1]?.[1] as {
      removes: Array<{ _docId?: string }>;
    };
    expect(removes.removes.map((rec) => rec._docId)).toContain('targetA');
  });

  it('較舊的背景重讀晚回來，不能覆蓋較新的本地勾選', async () => {
    const pending: Array<(rows: readonly RosterAttendanceRecordInput[]) => void> = [];
    const onReload = vi.fn(
      () => new Promise<readonly RosterAttendanceRecordInput[]>((resolve) => {
        pending.push(resolve);
      }),
    );
    render(<UidATable eventDocId="evtA" onReload={onReload} />);
    const checkinBox = document.getElementById('manual-checkin-uidA') as HTMLInputElement;
    const checkoutBox = document.getElementById('manual-checkout-uidA') as HTMLInputElement;

    await act(async () => {
      fireEvent.click(checkinBox);
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(checkinBox.checked).toBe(true);

    await act(async () => {
      fireEvent.click(checkoutBox);
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(checkoutBox.checked).toBe(true);
    expect(onReload).toHaveBeenCalledTimes(1);

    const resolveStale = pending[0];
    if (!resolveStale) throw new Error('缺少背景重讀');
    await act(async () => {
      resolveStale([]);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect((document.getElementById('manual-checkout-uidA') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('manual-checkin-uidA') as HTMLInputElement).checked).toBe(true);
  });

  it('重讀失敗後保留本地勾選，且不當成寫入失敗', async () => {
    const onFailed = vi.fn();
    const onReload = vi.fn(() => Promise.reject(new Error('reload failed')));
    render(<UidATable eventDocId="evtA" onReload={onReload} onFailed={onFailed} />);
    const checkinBox = document.getElementById('manual-checkin-uidA') as HTMLInputElement;

    await act(async () => {
      fireEvent.click(checkinBox);
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onFailed).not.toHaveBeenCalled();
    expect(checkinBox.checked).toBe(true);
  });

  it('寫入成功後背景重讀失敗，頁面傳入新出席資料時改採用新資料', async () => {
    const onFailed = vi.fn();
    const onReload = vi.fn(() => Promise.reject(new Error('reload failed')));
    const nextRecords: RosterAttendanceRecordInput[] = [
      {
        _docId: 'targetA',
        uid: 'uidA',
        userName: '甲',
        type: 'note',
        status: 'active',
        note: '頁面備註',
        time: '2026/10/31 10:01',
      },
    ];
    render(
      <UidATable
        eventDocId="evtA"
        onReload={onReload}
        onFailed={onFailed}
        nextRecords={nextRecords}
      />,
    );
    const checkinBox = document.getElementById('manual-checkin-uidA') as HTMLInputElement;

    await act(async () => {
      fireEvent.click(checkinBox);
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(checkinBox.checked).toBe(true);
    expect(onFailed).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '套用頁面資料' }));
    });
    expect((document.getElementById('manual-checkin-uidA') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('manual-note-uidA') as HTMLInputElement).value).toBe('頁面備註');
  });

  it('寫入中改備註並排隊後切換活動，寫完仍送出該備註', async () => {
    let resolveFirst!: (value: { addedDocIds: string[]; removedDocIds: string[] }) => void;
    mockWriteAttendanceOps.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const view = render(<UidATable eventDocId="evtA" onReload={async () => []} />);
    const checkinBox = document.getElementById('manual-checkin-uidA') as HTMLInputElement;
    const noteInput = document.getElementById('manual-note-uidA') as HTMLInputElement;

    await act(async () => {
      fireEvent.click(checkinBox);
      await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.input(noteInput, { target: { value: 'B' } });
      await vi.advanceTimersByTimeAsync(NOTE_DEBOUNCE_MS + CHECKBOX_DEBOUNCE_MS);
    });
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(<UidATable eventDocId="evtB" onReload={async () => []} />);
    });
    await act(async () => {
      resolveFirst({ addedDocIds: ['targetA'], removedDocIds: [] });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(2);
    const second = mockWriteAttendanceOps.mock.calls[1];
    expect(second?.[0]).toBe('evtA');
    const ops = second?.[1] as { adds: Array<{ type: string; note?: string }> };
    expect(ops.adds.some((add) => add.type === 'note' && add.note === 'B')).toBe(true);
  });

  it('卸載後寫入結束不會再掛上 beforeunload', async () => {
    let resolveFirst!: (value: { addedDocIds: string[]; removedDocIds: string[] }) => void;
    mockWriteAttendanceOps
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({ addedDocIds: ['targetA'], removedDocIds: [] });
    const add = vi.spyOn(window, 'addEventListener');
    try {
      const view = render(<UidATable eventDocId="evtA" onReload={async () => []} />);
      const checkinBox = document.getElementById('manual-checkin-uidA') as HTMLInputElement;
      await act(async () => {
        fireEvent.click(checkinBox);
        await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
      });
      await act(async () => {
        fireEvent.click(checkinBox);
        await vi.advanceTimersByTimeAsync(CHECKBOX_DEBOUNCE_MS);
      });
      expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);

      await act(async () => {
        view.unmount();
      });
      const before = add.mock.calls.filter((call) => call[0] === 'beforeunload').length;
      await act(async () => {
        resolveFirst({ addedDocIds: ['targetA'], removedDocIds: [] });
        await vi.advanceTimersByTimeAsync(0);
      });
      const after = add.mock.calls.filter((call) => call[0] === 'beforeunload').length;
      expect(after).toBe(before);
      expect(beforeUnloadPrevented()).toBe(false);
    } finally {
      add.mockRestore();
    }
  });
});
