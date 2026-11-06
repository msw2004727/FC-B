import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as firestore from 'firebase/firestore';
import { AttendanceRosterTable, type AttendanceRosterTableProps } from './AttendanceRosterTable';
import { TeamInfoCards } from './legacy/TeamSplitSection';
import type { RosterRegistrationInput } from '../data/attendance-roster-model';

vi.mock('@/data/user-roles', () => ({ getCachedUserLevel: () => 0 }));
// 所有 I/O 都攔下；本卡只使用傳入的 event／registrations 與既有角色快取。
vi.mock('firebase/firestore', () => ({
  getDocs: vi.fn(), getDoc: vi.fn(), onSnapshot: vi.fn(),
  setDoc: vi.fn(), updateDoc: vi.fn(), addDoc: vi.fn(), deleteDoc: vi.fn(),
  writeBatch: vi.fn(), runTransaction: vi.fn(),
}));

const teams = [
  { key: 'B', name: '藍', color: '#3B82F6' },
  { key: 'A', name: '白', color: '#FFFFFF' },
];
const event = { id: 'event-one', max: 12, teamSplit: { enabled: true, teams } };
const self = (uid: string, teamKey: string | null = null): RosterRegistrationInput => ({
  _docId: 'reg-' + uid, userId: uid, userName: uid,
  status: 'confirmed', participantType: 'self', teamKey,
});
const baseProps: AttendanceRosterTableProps = {
  event, registrations: [self('alice', 'A'), self('bob', 'B')],
  attendanceRecords: [], roles: {}, onOpenProfile: vi.fn(),
};
const renderTable = (props: Partial<AttendanceRosterTableProps> = {}) =>
  render(<AttendanceRosterTable {...baseProps} {...props} />);
const sortButton = () => screen.getByRole('button', { name: '依球衣顏色排序' });
const userOrder = (container: Element) =>
  [...container.querySelectorAll('tbody .user-capsule')].map(el => el.getAttribute('data-uid'));
const jerseyFor = (container: Element, uid: string) =>
  container.querySelector<SVGSVGElement>('[data-uid="' + uid + '"] .uc-team-jersey')!;

// 用公開 UI 還原 App 層布林，避免測試互相污染；不新增 production reset API。
afterEach(() => {
  cleanup();
  const { unmount } = renderTable();
  if (sortButton().getAttribute('aria-pressed') === 'true') fireEvent.click(sortButton());
  unmount();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('T-073c：照 A 球衣徽章與名單排序', () => {
  it.each([
    { canManage: false, publicRosterOnly: false, editing: false },
    { canManage: false, publicRosterOnly: true, editing: false },
    { canManage: true, publicRosterOnly: false, editing: false },
    { canManage: true, publicRosterOnly: false, editing: true },
  ])('所有名單檢視者均可排序：%j', props => {
    const { container } = renderTable(props);
    const button = sortButton();
    expect(button.className).toBe('att-team-sort-btn');
    expect(button.getAttribute('title')).toBe('依球衣顏色排序');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.parentElement?.firstElementChild).toBe(button);
    expect(button.nextSibling?.textContent).toBe('報名名單（2/12）');
    expect(button.querySelector('svg')?.getAttribute('stroke')).toBe('var(--text-secondary)');
    expect(button.querySelectorAll('path')).toHaveLength(2);
    fireEvent.click(button);
    expect(userOrder(container)).toEqual(['bob', 'alice']);
    expect(button.className).toBe('att-team-sort-btn active');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.querySelector('svg')?.getAttribute('stroke')).toBe('#fff');
  });

  it.each([
    undefined,
    { enabled: false, teams },
    { enabled: true, teams: [] },
    { enabled: true },
  ])('無有效分隊設定不顯示排序鈕：%j', teamSplit => {
    renderTable({ event: { ...event, teamSplit } });
    expect(screen.queryByRole('button', { name: '依球衣顏色排序' })).toBeNull();
  });

  it.each([false, true])('空名單不顯示排序鈕（管理者=%s）', canManage => {
    renderTable({ registrations: [], canManage });
    expect(screen.getByText('尚無報名')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '依球衣顏色排序' })).toBeNull();
  });

  it('依 teams 陣列順序穩定排序；同隊與無效／未分隊維持次序，關閉還原且不修改來源', () => {
    const registrations = Object.freeze([
      self('a-first', 'A'), self('unassigned'), self('b-first', 'B'),
      self('invalid', 'Z'), self('b-second', 'B'), self('a-second', 'A'),
    // 明確指定原名單次序；既有模型在時間同值時會依 promotionOrder／文件 ID 排序。
    ].map((reg, index) => Object.freeze({ ...reg, promotionOrder: index })));
    const original = JSON.stringify(registrations);
    const { container } = renderTable({ registrations });
    const before = userOrder(container);
    fireEvent.click(sortButton());
    expect(userOrder(container)).toEqual(['b-first', 'b-second', 'a-first', 'a-second', 'unassigned', 'invalid']);
    fireEvent.click(sortButton());
    expect(userOrder(container)).toEqual(before);
    expect(JSON.stringify(registrations)).toBe(original);
  });

  it('照 A 對整個 people 排序：俱樂部標頭、保留席位、一般報名分隔列都移到分隊者後', () => {
    const { container } = renderTable({
      event: { ...event, teamReservationSummaries: [
        { teamId: 'club', teamName: '測試俱樂部', reservedSlots: 2, usedSlots: 1, remainingSlots: 1 },
      ] },
      registrations: [
        { ...self('club-member', 'A'), teamReservationTeamId: 'club', teamReservationTeamName: '測試俱樂部' },
        self('general-member', 'B'), self('unassigned'), self('invalid', 'Z'),
      ].map((reg, index) => ({ ...reg, promotionOrder: index })),
    });
    const rowOrder = () => [...container.querySelectorAll('tbody tr')].map(row =>
      row.querySelector('.user-capsule')?.getAttribute('data-uid') || row.className);
    const before = ['team-reservation-header-row', 'club-member', 'team-reservation-placeholder-row',
      'team-reservation-general-row', 'general-member', 'unassigned', 'invalid'];
    expect(rowOrder()).toEqual(before);
    fireEvent.click(sortButton());
    expect(rowOrder()).toEqual(['general-member', 'club-member', 'team-reservation-header-row',
      'team-reservation-placeholder-row', 'team-reservation-general-row', 'unassigned', 'invalid']);
    expect(screen.getByText('報名名單（4/12）')).toBeTruthy();
    expect(container.querySelector('.team-reservation-header-cell')?.getAttribute('colspan')).toBe('4');
    fireEvent.click(sortButton());
    expect(rowOrder()).toEqual(before);
  });

  it('跨活動與卸載重掛保留排序；經非分隊活動不清除，依新活動的 teams 順序排列', () => {
    const { rerender, container, unmount } = renderTable();
    fireEvent.click(sortButton());
    rerender(<AttendanceRosterTable {...baseProps} event={{ id: 'no-teams', max: 12 }} />);
    expect(userOrder(container)).toEqual(['alice', 'bob']);
    expect(screen.queryByTitle('依球衣顏色排序')).toBeNull();
    rerender(<AttendanceRosterTable {...baseProps} event={{ ...event, id: 'second' }} />);
    expect(sortButton().getAttribute('aria-pressed')).toBe('true');
    expect(userOrder(container)).toEqual(['bob', 'alice']);
    unmount();
    const next = renderTable({ event: { ...event, id: 'third', teamSplit: { enabled: true, teams: [...teams].reverse() } } });
    expect(sortButton().getAttribute('aria-pressed')).toBe('true');
    expect(userOrder(next.container)).toEqual(['alice', 'bob']);
  });

  it('公開投影名單可直接用既有 teamKey 顯示球衣及排序', () => {
    const { container } = renderTable({
      publicRosterOnly: true, registrations: [],
      event: { ...event, current: 2, participantsWithUid: [
        { uid: 'alice', name: 'alice', teamKey: 'A' },
        { uid: 'bob', name: 'bob', teamKey: 'B' },
      ] },
    });
    expect(jerseyFor(container, 'alice').querySelector('text')?.textContent).toBe('A');
    fireEvent.click(sortButton());
    expect(userOrder(container)).toEqual(['bob', 'alice']);
    expect(screen.queryByRole('columnheader', { name: '簽到' })).toBeNull();
  });

  it('球衣用 A 色碼、字母、標籤與 20×18 大小；無效／未分隊顯示灰色虛線問號空衣', () => {
    const { container } = renderTable({ registrations: [
      self('white', 'A'), self('blue', 'B'), self('invalid', 'Z'), self('unassigned'),
    ] });
    const white = jerseyFor(container, 'white');
    expect(white.getAttribute('aria-label')).toBe('A 隊 - 白');
    expect(white.querySelector('path')?.getAttribute('fill')).toBe('#FFFFFF');
    expect(white.querySelector('path')?.getAttribute('stroke')).toBe('#D1D5DB');
    expect(white.querySelector('text')?.textContent).toBe('A');
    expect(white.querySelector('text')?.getAttribute('fill')).toBe('#1F2937');
    expect(white.style.width).toBe('20px');
    expect(white.style.height).toBe('18px');
    expect(white.style.position).toBe(''); // 不覆蓋既有 CSS 的右上角定位。
    expect(white.getAttribute('role')).toBe('img');
    expect(white.hasAttribute('tabindex')).toBe(false);
    expect(white.classList.contains('clickable')).toBe(false);
    const blue = jerseyFor(container, 'blue');
    expect(blue.querySelector('path')?.getAttribute('fill')).toBe('#3B82F6');
    expect(blue.querySelector('text')?.textContent).toBe('B');
    expect(blue.querySelector('circle')).not.toBeNull();
    for (const uid of ['invalid', 'unassigned']) {
      const empty = jerseyFor(container, uid);
      expect(empty.querySelector('path')?.getAttribute('fill')).toBe('transparent');
      expect(empty.querySelector('path')?.getAttribute('stroke')).toBe('#9CA3AF');
      expect(empty.querySelector('path')?.getAttribute('stroke-dasharray')).toBe('2 1.5');
      expect(empty.querySelector('text')?.textContent).toBe('?');
      expect(empty.querySelector('circle')).toBeNull();
    }
    expect(container.querySelector('.uc-jersey-tap')).toBeNull();
  });

  it('已啟用但尚無 teams 時仍畫空衣，非分隊活動不畫徽章', () => {
    const { container, rerender } = renderTable({ event: { ...event, teamSplit: { enabled: true } } });
    expect(jerseyFor(container, 'alice').querySelector('text')?.textContent).toBe('?');
    rerender(<AttendanceRosterTable {...baseProps} event={{ ...event, teamSplit: { enabled: false, teams } }} />);
    expect(container.querySelector('.uc-team-jersey')).toBeNull();
  });

  it('同行者有 teamKey 仍維持純文字並參與排序；僅代報與保留席位不畫球衣', () => {
    const { container } = renderTable({
      event: { ...event, teamReservationSummaries: [
        { teamId: 'club', teamName: '測試俱樂部', reservedSlots: 1, usedSlots: 0, remainingSlots: 1 },
      ] },
      registrations: [self('alice', 'A'), {
        _docId: 'comp-reg', userId: 'proxy', userName: '僅代報者',
        participantType: 'companion', companionId: 'child', companionName: '同行者',
        status: 'confirmed', teamKey: 'B',
      }],
    });
    expect(container.querySelectorAll('.uc-team-jersey')).toHaveLength(1);
    for (const name of ['↳ 同行者', '僅代報者', '測試俱樂部 保留席位']) {
      expect(screen.getByText(name).closest('tr')?.querySelector('.user-capsule')).toBeNull();
    }
    fireEvent.click(sortButton());
    expect(container.querySelector('tbody tr')?.textContent).toContain('↳ 同行者');
  });

  it('排序後簽到操作仍對正確 UID，管理名單 🕊 欄（放鴿子/計入）與球衣共存，不染色不出泡泡（測試同步更新：站長 11-06 放鴿子／出席率 v2）', () => {
    const onToggleCheckbox = vi.fn();
    const { container } = renderTable({
      canManage: true, editing: true, canViewNoShow: true, onToggleCheckbox,
      noShowData: { counts: new Map([['alice', 2]]), endedCounts: new Map([['alice', 3]]) },
    });
    fireEvent.click(sortButton());
    fireEvent.click(screen.getByRole('checkbox', { name: 'bob 簽到' }));
    expect(onToggleCheckbox).toHaveBeenCalledWith(expect.objectContaining({ uid: 'bob' }), 'checkin', true);
    const capsule = container.querySelector('[data-uid="alice"]')!;
    expect(capsule.classList.contains('uc-att-warn')).toBe(false);
    expect(capsule.querySelector('.uc-recent-noshow')).toBeNull();
    expect(capsule.querySelector('.uc-team-jersey')).toBe(jerseyFor(container, 'alice'));
    expect(screen.getByRole('columnheader', { name: '🕊' })).toBeTruthy();
    expect(capsule.closest('tr')?.querySelectorAll('td')[1]?.textContent).toBe('2/3');
  });

  it('反覆切換不觸發額外 Firestore 讀寫、持久化或父層事件；點球衣沿用 UID 名片', () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const onOpenProfile = vi.fn();
    const parentClick = vi.fn();
    const { container } = render(<div onClick={parentClick}>
      <AttendanceRosterTable {...baseProps} onOpenProfile={onOpenProfile} />
    </div>);
    for (let i = 0; i < 4; i += 1) fireEvent.click(sortButton());
    expect(parentClick).not.toHaveBeenCalled();
    expect(onOpenProfile).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
    for (const operation of Object.values(firestore)) expect(operation).not.toHaveBeenCalled();
    fireEvent.click(jerseyFor(container, 'alice'));
    expect(onOpenProfile).toHaveBeenCalledExactlyOnceWith('alice');
  });

  it('共用 Jersey 匯出後，原分隊資訊卡仍使用行內定位', () => {
    const { container } = render(<TeamInfoCards event={event} registrations={[]} />);
    const jerseys = container.querySelectorAll<SVGSVGElement>('.uc-team-jersey');
    expect(jerseys).toHaveLength(2);
    for (const jersey of jerseys) {
      expect(jersey.style.position).toBe('relative');
      expect(jersey.style.top).toBe('0px');
      expect(jersey.style.right).toBe('0px');
    }
  });
});
