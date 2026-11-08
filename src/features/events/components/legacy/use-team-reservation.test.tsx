import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
// @ts-expect-error 純 JS 建置工具，與 vite.config.ts 使用同一個 scope 外掛。
import { legacyCssScope, scopeSelector } from '../../../../../scripts/legacy-css-scope.mjs';
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
    onSuccess: result => { setCurrent(prev => ({ ...prev, ...result.eventPatch })); return mock.applied(result); } });
  const state = getSignupButtonState({ event: { id: current.id, status: current.status },
    viewer: { ...who, roleLevel: 0, hasPermission: () => false }, registrations: [], now: new Date(),
    profile: null, profileLoading: false, historyFailed: false, viewerTeamIds: who.teamIds });
  // 測試同步更新：11-09 翻牌改進度環，元件已無 flip 屬性，拿掉原本的 flip={null}。
  return <>
    <EventDetailPrimaryButton state={state} disabled={false} busy={false} onClick={() => {}}
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
    ['團隊報名', 'light'], ['團隊報名', 'dark'],
    ['選擇報名俱樂部', 'light'], ['選擇報名俱樂部', 'dark'],
  ])('%s portal 在 %s 主題能匹配實際 scope 後的 activity.css', async (title, theme) => {
    const previousTheme = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', theme);
    try {
      const view = render(<Harness />);
      if (title === '團隊報名') await open();
      else fireEvent.click(screen.getByText('測試報名'));
      const dialog = screen.getByRole('dialog', { name: title });
      expect(view.container.contains(dialog)).toBe(false);
      const cssPath = resolve('src/features/events/legacy/activity.css');
      const css = postcss([legacyCssScope()]).process(readFileSync(cssPath, 'utf8'), { from: cssPath }).sync().root;
      const actualSelectors = new Set<string>();
      css.walkRules(rule => { rule.selectors.forEach(selector => actualSelectors.add(selector)); });
      const selectors = [
        '.team-reservation-overlay', '.team-reservation-overlay.open',
        '.team-reservation-dialog', '.team-reservation-overlay.open .team-reservation-dialog',
        '.team-reservation-dialog-header', '.team-reservation-dialog-header h3',
        '.team-reservation-close', '.team-reservation-dialog-body', '.team-reservation-note',
        '.team-reservation-dialog-actions', '.team-reservation-dialog-actions button',
        ...(title === '團隊報名' ? [
          '.team-reservation-label', '.team-reservation-control', '.team-reservation-help',
        ] : [
          '.team-reservation-choice-list', '.team-reservation-choice-card',
          '.team-reservation-choice-card.is-selected', '.team-reservation-choice-mark',
          '.team-reservation-choice-card.is-selected .team-reservation-choice-mark',
          '.team-reservation-choice-main', '.team-reservation-choice-name', '.team-reservation-choice-meta',
        ]),
        ...(theme === 'dark' ? [
          '[data-theme="dark"] .team-reservation-dialog',
          ...(title === '團隊報名' ? [] : [
            '[data-theme="dark"] .team-reservation-choice-card',
            '[data-theme="dark"] .team-reservation-choice-card.is-selected',
            '[data-theme="dark"] .team-reservation-choice-card.is-selected .team-reservation-choice-mark',
          ]),
        ] : []),
      ];
      for (const selector of selectors) {
        const scoped = scopeSelector(selector);
        expect(actualSelectors.has(scoped), scoped).toBe(true);
        const elements = document.querySelectorAll(selector);
        expect(elements.length, selector).toBeGreaterThan(0);
        for (const element of elements) expect(element.matches(scoped), scoped).toBe(true);
      }
    } finally {
      if (previousTheme === null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', previousTheme);
    }
  });
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
    // preact testing-library 的 fireEvent.change 在 compat 下會改送 input；select 需原生 change。
    const select = screen.getByLabelText('俱樂部') as HTMLSelectElement;
    select.value = 't2';
    fireEvent(select, new Event('change', { bubbles: true }));
    expect((screen.getByLabelText('團隊名額') as HTMLInputElement).value).toBe('0');
  });
  // t1 的上限 = 2 + (10 - (8 - 2)) = 6；7 才是超額，5 仍合法。
  it.each([
    ['1', '團隊名額不能低於已使用人數'], ['7', '團隊名額超過目前活動可用名額'],
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
      eventId: 'e1', teamId: 't1', reservedSlots: 3, requestId: expect.stringMatching(/^team_res_\d+_[a-z0-9]{0,3}_u1_e1_t1$/),
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    resolve({ success: true, event: occupancy, promoted: [] });
    await waitFor(() => expect(mock.applied).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('teamReservationSlots:t1')).toBe('3');
    expect(mock.read).not.toHaveBeenCalled();
  });
  it.each(['成功', '失敗', '離頁'] as const)('成功後等待刷新期間仍鎖住連點，刷新%s不重送寫入', async mode => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    mock.applied.mockImplementationOnce(() => new Promise<void>((done, fail) => { resolve = done; reject = fail; }));
    const view = render(<Harness />);
    await open(); input('3'); confirm();
    await waitFor(() => expect(mock.applied).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mock.toast).toHaveBeenCalledWith({ message: '已更新團隊名額' });
    // 測試同步更新：寫入期間按鈕縮成進度環、文字拿掉，無障礙名稱改為忙碌標籤（同一顆按鈕）。
    const button = screen.getByRole('button', { name: '調整團隊名額中' }) as HTMLButtonElement;
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
    fireEvent.click(button); fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mock.call).toHaveBeenCalledTimes(1);
    if (mode === '離頁') view.unmount();
    if (mode === '成功') resolve();
    else reject(new Error('SECRET_REFRESH_STACK'));
    await new Promise(done => setTimeout(done, 0));
    if (mode !== '離頁') await waitFor(() => expect(button.disabled).toBe(false));
    expect(mock.toast).toHaveBeenCalledTimes(mode === '失敗' ? 2 : 1);
    if (mode === '失敗') expect(mock.toast).toHaveBeenLastCalledWith({ message: '團隊名額已更新，但名單更新失敗，請重新整理' });
    expect(JSON.stringify(mock.toast.mock.calls)).not.toContain('SECRET_REFRESH_STACK');
    expect(mock.toast).not.toHaveBeenCalledWith({ message: '團隊名額調整失敗，請稍後重試' });
    expect(mock.call).toHaveBeenCalledTimes(1);
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
  it('先按報名 ID 遞補，再按唯一的本人 UID 投影補歸屬；同名、同 UID 同行者與其他活動隔離', () => {
    const self = { id: 'self', _docId: 'self-doc', eventId: 'e1', userId: 'u1', userName: '同名',
      participantType: 'self', status: 'waitlisted' };
    const companion = { ...self, id: 'companion', _docId: 'companion-doc', participantType: 'companion' };
    const otherUser = { ...self, id: 'other', _docId: 'other-doc', userId: 'u2' };
    const otherEvent = { ...self, eventId: 'e2' };
    const rows = [self, companion, otherUser, otherEvent];
    const promotion = { id: 'self', docId: 'self-doc', userId: 'u1', userName: '同名', teamSeatSource: 'reserved' as const };
    const projection = [{ uid: 'u1', name: '同名', teamReservationTeamId: 't1', teamReservationTeamName: '一隊' }];
    const next = applyReservationPromotions(rows, [promotion], 'e1', projection);
    expect(next[0]).toMatchObject({ status: 'confirmed', teamSeatSource: 'reserved',
      teamReservationTeamId: 't1', teamReservationTeamName: '一隊' });
    for (const index of [1, 2, 3]) expect(next[index]).toBe(rows[index]);
    expect(self).not.toHaveProperty('teamReservationTeamId');
    expect(self.status).toBe('waitlisted');
    // 同行者自己獲得遞補，也不能拿主報名人的 UID 投影補團隊。
    const companionNext = applyReservationPromotions(rows,
      [{ ...promotion, id: 'companion', docId: 'companion-doc' }], 'e1', projection);
    expect(companionNext[1]).toMatchObject({ status: 'confirmed', teamSeatSource: 'reserved' });
    expect(companionNext[1]).not.toHaveProperty('teamReservationTeamId');
    expect(companionNext[0]).toBe(self);
    expect(applyReservationPromotions(rows, [{ ...promotion, id: '', docId: '' }], 'e1', projection)).toEqual(rows);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it.each([
    [], [null, [], 'private/raw'],
    [{ uid: 'u2', name: '同名', teamReservationTeamId: 't1', teamReservationTeamName: '一隊' }],
    [{ uid: 'u1', teamReservationTeamId: 1, teamReservationTeamName: '一隊' }],
    [{ uid: 'u1', teamReservationTeamId: ' ', teamReservationTeamName: '一隊' }],
    [{ uid: 'u1', teamReservationTeamId: 't1', teamReservationTeamName: {} }],
    [
      { uid: 'u1', teamReservationTeamId: 't1', teamReservationTeamName: '一隊' },
      { uid: 'u1', teamReservationTeamId: 't2', teamReservationTeamName: '二隊' },
    ],
    [
      { uid: 'u1', teamReservationTeamId: 't1', teamReservationTeamName: '一隊' },
      { uid: 'u1' },
    ],
  ].map(projection => ({ projection })))('缺少、損壞或歧義投影只同步遞補，不猜團隊：$projection', ({ projection }) => {
    const row = { id: 'r1', eventId: 'e1', userId: 'u1', userName: '同名', participantType: 'self',
      status: 'waitlisted', teamReservationTeamId: 'existing', teamReservationTeamName: '既有隊名' };
    const next = applyReservationPromotions([row], [{ id: 'r1', docId: '', userId: 'u1', userName: '同名',
      teamSeatSource: 'reserved' }], 'e1', projection);
    expect(next[0]).toEqual({ ...row, status: 'confirmed', teamSeatSource: 'reserved' });
    expect(row.status).toBe('waitlisted');
    expect(mock.read).not.toHaveBeenCalled();
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
