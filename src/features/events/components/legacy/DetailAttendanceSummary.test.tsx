import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { UserRole } from '@/ui/Avatar';
import { ownerInitial } from '../../data/companion-groups';
import {
  DetailAttendanceSummary,
  fitRosterAvatars,
  planRosterAvatars,
  rosterGenderOf,
  splitRosterAvatarCounts,
} from './DetailAttendanceSummary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function wideGrow(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains('detail-attendance-slab__grow') ? 480 : 0;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 20,
      right: width,
      width,
      height: 20,
      toJSON() { return {}; },
    } as DOMRect;
  });
}

const people = [
  { uid: 'coach-m', name: '陳思妤' },
  { uid: 'user-f', name: 'Eric' },
  { uid: 'user-n', name: '王志明' },
];

function genderOf(uid: string): '男' | '女' | '' {
  if (uid === 'coach-m' || uid === 'wl-coach') return '男';
  if (uid === 'user-f' || uid === 'wl-f') return '女';
  return '';
}

const roles: Record<string, UserRole> = {
  'coach-m': 'coach',
  'user-f': 'user',
  'user-n': 'user',
  'wl-coach': 'coach',
  'wl-f': 'user',
  'wl-n': 'user',
};

describe('DetailAttendanceSummary 收合卡', () => {
  it('一般使用者看到新卡：標題、人數、頭像字，點擊與 pointerdown，disabled 不呼叫', async () => {
    wideGrow();
    const onOpen = vi.fn();
    const onPrefetch = vi.fn();
    const view = render(
      <DetailAttendanceSummary
        eventId="ce_1"
        confirmedCount={3}
        waitlistCount={2}
        max={10}
        canManage={false}
        canViewRecords={false}
        onOpen={onOpen}
        onPrefetch={onPrefetch}
        confirmedPeople={people}
        waitlistPeople={[{ uid: 'wl-f', name: '小安' }]}
        roles={roles}
        genderOf={genderOf}
      />,
    );

    const button = screen.getByRole('button', { name: '查看出席名單' });
    expect(button.classList.contains('detail-attendance-slab')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('出席名單，正取 3 人，候補 2 人，點擊展開');
    expect(button.getAttribute('data-detail-attendance-open-button')).toBe('ce_1');
    expect(view.container.querySelector('.detail-attendance-slab__title')?.textContent).toBe('出席名單');
    expect(screen.getByText('3/10')).toBeTruthy();
    await waitFor(() => {
      const avatars = Array.from(view.container.querySelectorAll('.detail-attendance-slab__stack .detail-attendance-av'));
      expect(avatars.map((node) => node.textContent)).toEqual([
        ownerInitial('陳思妤'),
        ownerInitial('Eric'),
        ownerInitial('王志明'),
        ownerInitial('小安'),
      ]);
    });
    for (const avatar of view.container.querySelectorAll('.detail-attendance-av')) {
      expect(avatar.getAttribute('aria-hidden')).toBe('true');
    }

    fireEvent.pointerDown(button);
    expect(onPrefetch).toHaveBeenCalledTimes(1);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);

    view.rerender(
      <DetailAttendanceSummary
        eventId="ce_1"
        confirmedCount={3}
        waitlistCount={2}
        max={10}
        canManage={false}
        canViewRecords={false}
        disabled
        onOpen={onOpen}
        onPrefetch={onPrefetch}
        confirmedPeople={people}
        waitlistPeople={[{ uid: 'wl-f', name: '小安' }]}
        roles={roles}
        genderOf={genderOf}
      />,
    );
    const disabledButton = screen.getByRole('button', { name: '查看出席名單' });
    fireEvent.pointerDown(disabledButton);
    fireEvent.click(disabledButton);
    expect(onPrefetch).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('管理者與可看出席紀錄者維持舊標題與舊按鈕', () => {
    const { container, rerender } = render(
      <DetailAttendanceSummary
        eventId="ce_1"
        confirmedCount={3}
        waitlistCount={1}
        max={10}
        canManage
        canViewRecords={false}
        onOpen={vi.fn()}
      />,
    );
    expect(container.querySelector('.detail-attendance-slab')).toBeNull();
    expect(container.querySelector('.detail-attendance-summary')?.textContent).toContain('出席管理');
    expect(screen.getByRole('button', { name: '管理名單 / 出席紀錄' })).toBeTruthy();

    rerender(
      <DetailAttendanceSummary
        eventId="ce_1"
        confirmedCount={3}
        waitlistCount={1}
        max={10}
        canManage={false}
        canViewRecords
        onOpen={vi.fn()}
      />,
    );
    expect(container.querySelector('.detail-attendance-slab')).toBeNull();
    expect(container.querySelector('.detail-attendance-summary')?.textContent).toContain('出席管理');
    expect(screen.getByRole('button', { name: '查看出席紀錄' })).toBeTruthy();
  });

  it('配色是層級大於性別大於一般，候補同一套', async () => {
    wideGrow();
    const { container } = render(
      <DetailAttendanceSummary
        eventId="ce_1"
        confirmedCount={3}
        waitlistCount={3}
        max={10}
        canManage={false}
        canViewRecords={false}
        onOpen={vi.fn()}
        confirmedPeople={people}
        waitlistPeople={[
          { uid: 'wl-coach', name: '張教練' },
          { uid: 'wl-f', name: '小薇' },
          { uid: 'wl-n', name: '阿明' },
        ]}
        roles={roles}
        genderOf={genderOf}
      />,
    );
    await waitFor(() => expect(container.querySelectorAll('.detail-attendance-av')).toHaveLength(6));
    const classOf = (name: string): string => {
      const node = Array.from(container.querySelectorAll('.detail-attendance-av'))
        .find((avatar) => avatar.textContent === ownerInitial(name));
      return node?.className ?? '';
    };
    expect(classOf('陳思妤')).toContain('detail-attendance-av--coach');
    expect(classOf('陳思妤')).not.toContain('detail-attendance-av--male');
    expect(classOf('Eric')).toContain('detail-attendance-av--female');
    expect(classOf('王志明')).toContain('detail-attendance-av--user');
    expect(classOf('張教練')).toContain('detail-attendance-av--coach');
    expect(classOf('小薇')).toContain('detail-attendance-av--female');
    expect(classOf('阿明')).toContain('detail-attendance-av--user');
  });

  it('沒有候補不畫分隔線，人數用 props 而不是名單長度', async () => {
    wideGrow();
    const { container } = render(
      <DetailAttendanceSummary
        eventId="ce_1"
        confirmedCount={8}
        waitlistCount={0}
        max={12}
        canManage={false}
        canViewRecords={false}
        onOpen={vi.fn()}
        confirmedPeople={[{ uid: 'user-n', name: '王志明' }]}
        waitlistPeople={[{ uid: 'wl-n', name: '不該出現' }]}
      />,
    );
    expect(container.querySelector('.detail-attendance-slab__sep')).toBeNull();
    expect(container.querySelector('.detail-attendance-slab__count--waitlist')).toBeNull();
    expect(container.textContent).toContain('8/12');
    expect(container.textContent).not.toContain('1/12');
    await waitFor(() => {
      const avatars = container.querySelectorAll('.detail-attendance-av');
      expect(avatars).toHaveLength(1);
      expect(avatars[0]?.textContent).toBe(ownerInitial('王志明'));
    });
  });
});

describe('出席名單頭像分配（v6 fill）', () => {
  it('寬度很小時兩組各 1 顆；再更窄就藏標題，只剩 1 顆時給正取', () => {
    expect(splitRosterAvatarCounts(1, 5, 3)).toEqual([1, 0]);
    expect(splitRosterAvatarCounts(1, 0, 3)).toEqual([0, 1]);

    const oneEach = planRosterAvatars({
      freeWithTitle: 70,
      freeWithoutTitle: 70,
      confirmedCount: 9,
      waitlistCount: 4,
    });
    expect(oneEach.hideTitle).toBe(false);
    expect(oneEach.confirmed).toBe(1);
    expect(oneEach.waitlist).toBe(1);

    const hidden = planRosterAvatars({
      freeWithTitle: 40,
      freeWithoutTitle: 200,
      confirmedCount: 8,
      waitlistCount: 3,
    });
    expect(hidden.hideTitle).toBe(true);
    expect(hidden.confirmed).toBeGreaterThanOrEqual(1);
    expect(hidden.waitlist).toBeGreaterThanOrEqual(1);

    const onlyOne = planRosterAvatars({
      freeWithTitle: 40,
      freeWithoutTitle: 40,
      confirmedCount: 5,
      waitlistCount: 3,
    });
    expect(onlyOne.hideTitle).toBe(true);
    expect(onlyOne.confirmed).toBe(1);
    expect(onlyOne.waitlist).toBe(0);
    expect(fitRosterAvatars(40, 5, 3)).toEqual({ confirmed: 1, waitlist: 0, step: 18 });
  });

  it('間距落在 5 到 18，寬度夠就全放、不設上限', () => {
    const compressed = fitRosterAvatars(64, 4, 0);
    expect(compressed.confirmed).toBe(4);
    expect(compressed.waitlist).toBe(0);
    expect(compressed.step).toBeGreaterThanOrEqual(5);
    expect(compressed.step).toBeLessThanOrEqual(18);
    expect(compressed.step).toBeCloseTo(10);

    const dropped = fitRosterAvatars(46, 4, 0);
    expect(dropped.confirmed).toBe(3);
    expect(dropped.step).toBeGreaterThanOrEqual(5);
    expect(dropped.step).toBeLessThanOrEqual(18);

    const all = fitRosterAvatars(5000, 40, 15);
    expect(all).toEqual({ confirmed: 40, waitlist: 15, step: 18 });
  });
});

describe('rosterGenderOf', () => {
  it('沒有快取時回 undefined，不發查詢', () => {
    expect(rosterGenderOf('not-loaded')).toBeUndefined();
  });
});
