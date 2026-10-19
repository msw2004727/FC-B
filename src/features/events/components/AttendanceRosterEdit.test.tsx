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
      'events.roster.title': `報名名單（${params?.count ?? 0}/${params?.max ?? 0}）`,
      'events.roster.checkin': '簽到',
      'events.roster.checkout': '簽退',
      'events.roster.note': '備註',
      'events.roster.empty': '尚無報名',
      'events.roster.proxyOnly': '僅代報',
      'events.roster.reservedSeat': '保留席位',
      'events.roster.courseRollcall': '請至課程點名',
      'events.roster.generalSection': '一般報名',
      'events.roster.clubBadge': '俱',
      'events.roster.reservedSlots': `佔位: ${params?.count ?? 0}`,
      'events.roster.usedSlots': `已使用: ${params?.count ?? 0}`,
      'events.roster.remainingSlots': `剩餘: ${params?.count ?? 0}`,
      'events.roster.manage': '管理名單',
      'events.roster.closeEdit': '關閉編輯',
      'events.roster.saving': '儲存中...',
      'events.roster.saveFailed': `${params?.name ?? ''} 儲存失敗，已還原`,
      'events.roster.noPermission': '權限不足',
      'events.roster.settleInLegacy': '請在舊版按完成以結算經驗值與放鴿子',
      'events.roster.goLegacy': '前往舊版',
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
        void handleClose();
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

describe('AttendanceRosterTable & useAttendanceInstantSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockWriteAttendanceOps.mockResolvedValue({ addedDocIds: ['d1'], removedDocIds: [] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

  it('編輯模式：顯示「關閉編輯」（不顯示「完成」）與舊版結算提示，且僅代報／保留席位／模糊列不可勾選', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: '關閉編輯' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '完成' })).toBeNull();
    expect(screen.getByText('請在舊版按完成以結算經驗值與放鴿子')).toBeTruthy();
    const link = screen.getByRole('link', { name: '前往舊版' });
    expect(link.getAttribute('href')).toBe('https://toosterx.com/');
    expect(link.getAttribute('target')).toBe('_blank');

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

  it('按下「關閉編輯」會先 flush debounce 中的備註再關閉編輯模式', async () => {
    render(<Harness />);
    const noteInput = document.getElementById('manual-note-u_1') as HTMLInputElement;

    act(() => {
      fireEvent.input(noteInput, { target: { value: '準備收工' } });
    });
    // 尚未滿 1000ms，還沒寫入
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(0);

    const closeBtn = screen.getByRole('button', { name: '關閉編輯' });
    await act(async () => {
      fireEvent.click(closeBtn);
      await vi.advanceTimersByTimeAsync(0);
    });

    // flush 立即寫入備註並退出編輯模式
    expect(mockWriteAttendanceOps).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '管理名單' })).toBeTruthy();
  });
});
