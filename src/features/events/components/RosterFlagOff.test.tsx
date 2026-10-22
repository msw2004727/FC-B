import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/callables-deployed', () => ({ CALLABLES_DEPLOYED: false }));

vi.mock('@/features/checkin/data/attendance', () => ({
  removeAttendance: vi.fn(),
}));

vi.mock('@/data/op-log', () => ({
  writeOpLog: vi.fn(),
}));

vi.mock('@/ui/AppConfirm', () => ({
  appConfirm: vi.fn(),
}));

vi.mock('../data/attendance-edit', async () => ({
  ...(await vi.importActual<typeof import('../data/attendance-edit')>(
    '../data/attendance-edit',
  )),
  writeAttendanceOps: vi.fn(),
}));

import { AttendanceRosterTable } from './AttendanceRosterTable';
import { UnregRosterTable } from './UnregRosterTable';

afterEach(() => {
  cleanup();
});

describe('CALLABLES_DEPLOYED=false 回退開關', () => {
  it('正取名單顯示「關閉編輯」與舊版結算提示', () => {
    render(
      <AttendanceRosterTable
        event={{ id: 'ce_1', max: 10 }}
        registrations={[]}
        attendanceRecords={[]}
        roles={{}}
        onOpenProfile={() => undefined}
        canManage={true}
        editing={true}
      />,
    );

    expect(screen.getByRole('button', { name: '關閉編輯' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '完成' })).toBeNull();
    expect(screen.getByText('請在舊版按完成以結算經驗值與放鴿子')).toBeTruthy();
    expect(screen.getByRole('link', { name: '前往舊版' }).getAttribute('href'))
      .toBe('https://toosterx.com/');
  });

  it('未報名單進入編輯後顯示回退提示，關閉時不提示儲存完成', async () => {
    const onToast = vi.fn();
    render(
      <UnregRosterTable
        eventId="ce_1"
        eventDocId="doc_1"
        eventTitle="週五夜球"
        attendanceRecords={[
          {
            _docId: 'att_unreg_1',
            uid: 'u1',
            userName: '陳路人',
            type: 'unreg',
            status: 'active',
          },
        ]}
        canManage={true}
        operatorUid="u_admin"
        onToast={onToast}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(screen.getByRole('button', { name: '關閉編輯' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '完成' })).toBeNull();
    expect(screen.getByText('請在舊版按完成以結算經驗值與放鴿子')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '關閉編輯' }));
    });
    expect(screen.getByRole('button', { name: '編輯' })).toBeTruthy();
    expect(onToast).not.toHaveBeenCalled();
  });
});
