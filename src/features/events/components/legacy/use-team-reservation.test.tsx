import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { useTeamReservation } from './use-team-reservation';
import { EventDetailPrimaryButton } from './EventDetailPrimaryButton';
import { getSignupButtonState } from '../../data/signup-state';
import { getTeamReservationStaffTeams, type TeamReservationEvent, type TeamReservationViewer } from '../../data/team-reservation';
import { applyReservationPromotions } from './team-reservation-sync';

const mock = vi.hoisted(() => ({ call: vi.fn(), toast: vi.fn(), applied: vi.fn(), chosen: vi.fn(), read: vi.fn() }));
vi.mock('@/data/callables', () => ({ callFn: mock.call, CallableError: class extends Error {} }));
vi.mock('@/data/firebase', () => ({ getFirebase: mock.read }));
vi.mock('@/ui/Toast', () => ({ toast: { show: mock.toast } }));
vi.mock('@/core/overlay-back', () => ({ pushOverlay: () => () => {} }));
const viewer: TeamReservationViewer = {
  uid: 'u1', teamIds: new Set(['t1', 't2']),
  staffTeams: [{ id: 't1', name: '一隊' }, { id: 't2', name: '二隊' }],
};
const event: TeamReservationEvent = {
  id: 'e1', status: 'open', current: 8, max: 10,
  teamReservationSummaries: [
    { teamId: 't1', teamName: '一隊', reservedSlots: 4, usedSlots: 2 },
    { teamId: 't2', teamName: '二隊', reservedSlots: 2, usedSlots: 1 },
  ],
};
const occupancy = {
  current: 7, realCurrent: 4, waitlist: 0, status: 'open',
  participants: [], waitlistNames: [], participantsWithUid: [], waitlistWithUid: [],
  teamReservationSummaries: [{ teamId: 't1', teamName: '一隊', reservedSlots: 3, usedSlots: 3 }],
};
function Harness({ activity = event, who = viewer, loading = false }: {
  activity?: TeamReservationEvent; who?: TeamReservationViewer; loading?: boolean;
}) {
  const [current, setCurrent] = useState(activity);
  const flow = useTeamReservation({ event: current, viewer: who, loading, blocked: false, now: Date.now(),
    onSuccess: result => { mock.applied(result); setCurrent(prev => ({ ...prev, ...result.eventPatch })); } });
  const state = getSignupButtonState({ event: { id: current.id, status: current.status },
    viewer: { ...who, roleLevel: 0, hasPermission: () => false }, registrations: [], now: new Date(),
    profile: null, profileLoading: false, historyFailed: false, viewerTeamIds: who.teamIds });
  return <>
    <EventDetailPrimaryButton state={state} disabled={false} busy={false} flip={null} onClick={() => {}}
      teamReservation={flow.action ? { ...flow.action, busy: flow.busy, onClick: () => flow.open(flow.action?.preferredTeamId) } : null} />
    <button onClick={() => { void flow.chooseSignupTeam(current).then(mock.chosen); }}>測試報名</button>
    {flow.dialogs}
  </>;
}
async function open() { fireEvent.click(await screen.findByRole('button', { name: '調整名額' })); }
function input(value: string) { fireEvent.input(screen.getByLabelText('團隊名額'), { target: { value } }); }
function confirm() { fireEvent.click(screen.getByRole('button', { name: '確認', exact: true })); }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  mock.call.mockResolvedValue({ success: true, event: occupancy, promoted: [] });
});
afterEach(cleanup);

describe('T-074b 畫面與 T-074a controller 接線', () => {
  it.each([
    ['一般成員', {}, false], ['隊長', { captainUid: 'u1' }, true],
    ['領隊', { leaderUids: ['u1'] }, true], ['教練', { coachUids: ['u1'] }, true],
    ['管理員非職員', { ownerUid: 'u1', creatorUid: 'u1' }, false],
  ])('%s 的入口只看職員 UID', (_name, fields, allowed) => {
    render(<Harness who={{ ...viewer, staffTeams: getTeamReservationStaffTeams('u1', [{ id: 't1', ...fields }]) }} />);
    expect(!!screen.queryByRole('button', { name: '調整名額' })).toBe(allowed);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it.each([
    { who: { ...viewer, uid: null } }, { loading: true },
    { activity: { ...event, status: 'ended' } }, { activity: { ...event, status: 'upcoming' } },
    { activity: { ...event, teamOnly: true, creatorTeamId: 'other' } },
    { activity: { ...event, courseLinked: true, courseLinkSource: 'eduCourseLesson' } },
  ])('不適用時隱藏入口與課程提示：%j', props => {
    render(<Harness {...props} />);
    expect(screen.queryByRole('button', { name: /調整名額|團隊報名/ })).toBeNull();
    expect(document.querySelector('.team-reservation-help')).toBeNull();
  });
  it('新名額顯示團隊報名，localStorage 沿 A key；切隊重設輸入', () => {
    localStorage.setItem('teamReservationSlots:t1', '5');
    render(<Harness activity={{ ...event, teamReservationSummaries: [] }} />);
    fireEvent.click(screen.getByRole('button', { name: '團隊報名' }));
    expect((screen.getByLabelText('團隊名額') as HTMLInputElement).value).toBe('5');
    fireEvent.change(screen.getByLabelText('俱樂部'), { target: { value: 't2' } });
    expect((screen.getByLabelText('團隊名額') as HTMLInputElement).value).toBe('0');
  });
  it.each([
    ['1', '團隊名額不能低於已使用人數'], ['5', '團隊名額超過目前活動可用名額'],
  ])('前端擋下 %s，不送 Callable', async (value, message) => {
    render(<Harness />); await open(); input(value); confirm();
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith({ message }));
    expect(mock.call).not.toHaveBeenCalled();
  });
  it.each([
    ['RESERVED_BELOW_USED', '團隊名額不能低於已使用人數'],
    ['RESERVED_OVER_CAPACITY', '團隊名額超過目前活動可用名額'],
    ['SECRET_STACK', '團隊名額調整失敗，請稍後重試'],
  ])('伺服器 %s 只顯示中文保底', async (code, message) => {
    mock.call.mockRejectedValueOnce(new Error(code));
    render(<Harness />); await open(); input('3'); confirm();
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith({ message }));
    expect(document.body.textContent).not.toContain(code);
    expect(mock.applied).not.toHaveBeenCalled();
  });
  it('連點只送一次，成功套用回傳並記住整數名額，不額外讀取', async () => {
    let resolve!: (value: unknown) => void;
    mock.call.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<Harness />); await open(); input('3.9');
    const button = screen.getByRole('button', { name: '確認', exact: true });
    fireEvent.click(button); fireEvent.click(button);
    expect(mock.call).toHaveBeenCalledTimes(1);
    expect(mock.call).toHaveBeenCalledWith('adjustTeamReservation', {
      eventId: 'e1', teamId: 't1', reservedSlots: 3, requestId: expect.stringMatching(/^team_res_u1_e1_t1_/),
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    resolve({ success: true, event: occupancy, promoted: [] });
    await waitFor(() => expect(mock.applied).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('teamReservationSlots:t1')).toBe('3');
    expect(mock.read).not.toHaveBeenCalled();
  });
  it('取消名額與 localStorage 不可用仍可送出並顯示成功', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage-private'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage-private'); });
    try {
      render(<Harness activity={{ ...event, teamReservationSummaries: [] }} />);
      fireEvent.click(screen.getByRole('button', { name: '團隊報名' }));
      expect((screen.getByLabelText('團隊名額') as HTMLInputElement).value).toBe('0');
      confirm();
      await waitFor(() => expect(mock.toast).toHaveBeenCalledWith({ message: '已取消團隊名額' }));
      expect(mock.call).toHaveBeenCalledTimes(1);
      expect(mock.applied).toHaveBeenCalledTimes(1);
    } finally { get.mockRestore(); set.mockRestore(); }
  });
  it('deduplicated 不覆寫、不關窗、不重讀', async () => {
    mock.call.mockResolvedValueOnce({ success: true, deduplicated: true });
    render(<Harness />); await open(); confirm();
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith({ message: '團隊名額處理中，請稍候' }));
    expect(mock.applied).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mock.read).not.toHaveBeenCalled();
  });
  it('伺服器 course-managed 後移除入口和視窗，不顯示提示', async () => {
    mock.call.mockRejectedValueOnce(new Error('COURSE_LINKED_EVENT_MANAGED_BY_COURSE'));
    render(<Harness />); await open(); confirm();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: '調整名額' })).toBeNull();
    expect(mock.toast).not.toHaveBeenCalled();
  });
  it.each(['關閉重開', '切換活動', '切換帳號', '離頁'])('%s 丟棄過期回應', async mode => {
    let resolve!: (value: unknown) => void;
    mock.call.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(<Harness key="first" />); await open(); confirm();
    if (mode === '關閉重開') {
      fireEvent.click(screen.getByRole('button', { name: '關閉' }));
      // 底層尚未完成前入口仍鎖住，完成後才可重開。
    } else if (mode === '切換活動') view.rerender(<Harness key="second" activity={{ ...event, id: 'e2' }} />);
    else if (mode === '切換帳號') view.rerender(<Harness key="second" who={{ ...viewer, uid: 'u2' }} />);
    else view.unmount();
    resolve({ success: true, event: occupancy, promoted: [] });
    await waitFor(() => expect(mock.call).toHaveBeenCalledTimes(1));
    // 等待 async submit 完成，不能只對未完成的 promise 斷言。
    await new Promise(done => setTimeout(done, 0));
    expect(mock.applied).not.toHaveBeenCalled(); expect(mock.toast).not.toHaveBeenCalled();
    if (mode === '關閉重開') { await open(); expect(screen.getByRole('dialog')).toBeTruthy(); }
  });
  it('多隊選擇第二隊；單隊直接回傳；取消不報名', async () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByText('測試報名'));
    const dialog = screen.getByRole('dialog', { name: '選擇報名俱樂部' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /二隊/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: '確認報名' }));
    await waitFor(() => expect(mock.chosen).toHaveBeenLastCalledWith('t2'));
    fireEvent.click(screen.getByText('測試報名'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(mock.chosen).toHaveBeenLastCalledWith(null));
    view.rerender(<Harness who={{ ...viewer, teamIds: new Set(['t1']) }} />);
    fireEvent.click(screen.getByText('測試報名'));
    await waitFor(() => expect(mock.chosen).toHaveBeenLastCalledWith('t1'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('promoted 僅依 docId／id 更新，保留同行者、其他活動與非空座位來源', () => {
    const rows = [
      { _docId: 'doc1', id: 'r1', eventId: 'e1', userId: 'u1', status: 'waitlisted', teamSeatSource: 'waitlist' },
      { _docId: 'doc2', id: 'r2', eventId: 'e1', userId: 'u1', status: 'waitlisted', teamSeatSource: 'reserved' },
      { _docId: 'doc3', id: 'r1', eventId: 'e2', userId: 'u1', status: 'waitlisted' },
    ];
    const result = applyReservationPromotions(rows, [{ id: 'r1', docId: 'doc1', userId: 'u1', userName: '', teamSeatSource: 'overflow' }], 'e1');
    expect(result[0]).toMatchObject({ status: 'confirmed', teamSeatSource: 'overflow' });
    expect(result[1]).toBe(rows[1]); expect(result[2]).toBe(rows[2]);
    const byId = applyReservationPromotions(rows, [{ id: 'r2', docId: '', userId: '', userName: '', teamSeatSource: null }], 'e1');
    expect(byId[1]).toMatchObject({ status: 'confirmed', teamSeatSource: 'reserved' });
  });
});
