import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { AttendanceRosterTable } from './AttendanceRosterTable';
import { WaitlistRosterTable } from './WaitlistRosterTable';
import { RosterStatusCell } from './RosterStatusControls';
import { snapshot, translate } from '../data/roster-status-test-fixtures';
import { matrix, matrixInput } from '../data/__fixtures__/roster-status-matrix';
import type { RosterRegistrationInput } from '../data/attendance-roster-model';

const flag = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/data/roster-status-deployed', () => ({
  get ROSTER_STATUS_CALLABLES_DEPLOYED() { return flag.enabled; },
}));
vi.mock('@/i18n/i18n', () => ({ useT: () => translate }));
vi.mock('@/ui/UserTag', () => ({ UserTag: ({ name }: { name: string }) => <span>{name}</span> }));
afterEach(cleanup);
beforeEach(() => { flag.enabled = true; });
const regs: RosterRegistrationInput[] = [
  { _docId: 'regA', userId: 'uidB', userName: '小明', participantType: 'self', status: 'confirmed' },
  { _docId: 'regB', userId: 'uidB', companionId: 'compA', companionName: '小華', participantType: 'companion', status: 'confirmed' },
];
function Tables({ editing = true, state = snapshot(), registrations = regs }: {
  editing?: boolean; state?: ReturnType<typeof snapshot>; registrations?: readonly RosterRegistrationInput[];
}) {
  return <>
    <AttendanceRosterTable event={state.event} registrations={registrations} attendanceRecords={[]}
      roles={{}} onOpenProfile={() => {}} canManage editing={editing} rosterContext={state.context} />
    <WaitlistRosterTable event={state.event} registrations={registrations.map(reg => ({ ...reg, status: 'waitlisted' }))}
      roles={{}} onOpenProfile={() => {}} editing={editing} rosterContext={state.context} />
  </>;
}
describe('名單狀態調整元件', () => {
  it('C1/C2：編輯模式與欄位順序', () => {
    const view = render(<Tables editing={false} />);
    expect(screen.queryByRole('columnheader', { name: '候' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '正取' })).toBeNull();
    view.rerender(<Tables />);
    expect(screen.getByRole('columnheader', { name: '候' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '正取' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '將 小明 下放到候補' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '將 小華 下放到候補' })).toBeNull();
    const state = snapshot(); state.event.max = 0;
    view.rerender(<Tables state={state} />);
    expect(screen.queryByRole('columnheader', { name: '候' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: '正取' })).toBeTruthy();
  });
  it.each([false, true])('C6：旗標 %s', enabled => {
    flag.enabled = enabled;
    render(<Tables />);
    expect(!!screen.queryByRole('button', { name: '將 小明 下放到候補' })).toBe(enabled);
    expect(!!screen.queryByRole('button', { name: '將 小明 正取' })).toBe(enabled);
  });
  it('C4：活動連動隱藏整欄並說明', () => {
    const state = snapshot();
    state.event = { ...state.event, courseLinked: true, courseLinkSource: 'eduCourseLesson' };
    render(<Tables state={state} />);
    expect(screen.queryByRole('columnheader', { name: '候' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '正取' })).toBeNull();
    expect(screen.getAllByRole('note')).toHaveLength(2);
    expect(screen.getAllByText('請在舊版操作')).toHaveLength(2);
  });
  it.each(['courseLinkState', 'coursePriority', 'courseStudentId'])('C5：報名連動 %s', key => {
    const registrations = regs.map(reg => ({ ...reg, [key]: key === 'courseLinkState'
      ? 'priority_overlay' : key === 'coursePriority' ? true : 'studentA' }));
    render(<Tables registrations={registrations} />);
    expect(screen.queryByRole('button', { name: '將 小明 下放到候補' })).toBeNull();
    expect(screen.queryByRole('button', { name: '將 小明 正取' })).toBeNull();
    expect(screen.getAllByTitle('請在舊版操作').length).toBeGreaterThan(0);
  });
  it.each(matrix)('$id：按鈕與權限矩陣一致', row => {
    const state = { ...snapshot(), ...matrixInput(row) };
    render(<Tables state={state} />);
    expect(!!screen.queryByRole('button', { name: '將 小明 下放到候補' })).toBe(row.demote);
    expect(!!screen.queryByRole('button', { name: '將 小明 正取' })).toBe(row.promote);
  });
  it('C3：表格欄數與保留席位、同行者對齊', () => {
    const state = snapshot();
    state.event.teamReservationSummaries = [{ teamId: 'teamA', teamName: '俱樂部甲', reservedSlots: 2, usedSlots: 1, remainingSlots: 1 }];
    const registrations = [...regs, { _docId: 'regProxy', userId: 'uidA', userName: '代理人',
      companionId: 'compB', companionName: '同行者乙', participantType: 'companion', status: 'confirmed' }]
      .map(reg => ({ ...reg, teamReservationTeamId: 'teamA', teamReservationTeamName: '俱樂部甲' }));
    const { container } = render(<Tables state={state} registrations={registrations} />);
    for (const table of container.querySelectorAll('table')) {
      const columns = table.querySelectorAll('thead th').length;
      for (const row of table.querySelectorAll('tbody tr')) {
        const cells = [...row.querySelectorAll('td')];
        expect(cells.reduce((sum, td) => sum + td.colSpan, 0)).toBe(columns);
      }
    }
    expect(screen.getAllByRole('button', { name: /下放到候補/ })).toHaveLength(1);
  });
  it('C3：無身分、同行者、代理與點名空格不放按鈕', () => {
    const { container } = render(<table><tbody><tr>
      <RosterStatusCell action="demote" userId="" name="小明" registrations={regs} onClick={() => {}} />
      <RosterStatusCell action="demote" userId="uidB" name="小明" registrations={regs} empty onClick={() => {}} />
    </tr></tbody></table>);
    expect(container.querySelectorAll('td')).toHaveLength(2);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
  it('C7/C10：按鈕名稱、點擊、處理中文字與鎖定', () => {
    const state = snapshot(); const click = vi.fn();
    const props = { event: state.event, registrations: regs, attendanceRecords: [], roles: {},
      onOpenProfile: () => {}, canManage: true, editing: true, rosterContext: state.context,
      onDemoteParticipant: click };
    const view = render(<AttendanceRosterTable {...props} />);
    const button = screen.getByRole('button', { name: '將 小明 下放到候補' }) as HTMLButtonElement;
    expect(button.type).toBe('button'); button.focus(); expect(document.activeElement).toBe(button);
    fireEvent.click(button); expect(click).toHaveBeenCalledOnce();
    view.rerender(<AttendanceRosterTable {...props} submitting demotePendingKeys={{ uidB: true }} />);
    expect(button.disabled).toBe(true); expect(button.textContent).toBe('...');
    fireEvent.click(button); expect(click).toHaveBeenCalledOnce();
    for (const control of view.container.querySelectorAll('input, button')) {
      expect((control as HTMLInputElement).disabled).toBe(true);
    }
  });
});
