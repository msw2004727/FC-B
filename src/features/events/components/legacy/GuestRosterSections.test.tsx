import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { DetailEvent } from '../../data/detail-model';
import { GuestRosterSections } from './GuestRosterSections';

afterEach(() => {
  cleanup();
});

const baseEvent = {
  id: 'ce_123',
  participantsWithUid: [{ uid: 'public-user', name: '公開正取' }],
  waitlistWithUid: [{ uid: 'wait-user', name: '公開候補' }],
  waitlistNames: ['公開候補'],
  max: 10,
} as unknown as DetailEvent;

describe('GuestRosterSections（A 訪客名單）', () => {
  it('未展開時顯示 A 摘要卡，正取不顯示膠囊、候補區照 A 直接顯示', () => {
    const onExpand = vi.fn();
    const { container } = render(
      <GuestRosterSections
        event={baseEvent}
        eventId="ce_123"
        expanded={false}
        onExpand={onExpand}
        onOpenProfile={vi.fn()}
        max={10}
        confirmedCount={3}
        waitlistCount={1}
      />,
    );

    const summary = container.querySelector('.detail-attendance-summary');
    expect(summary?.textContent).toContain('出席名單');
    expect(summary?.textContent).toContain('3/10');
    expect(summary?.textContent).toContain('候補 1');
    // 測試同步更新：照 A `_renderGuestWaitlistSection`，候補區不受摘要卡影響。
    expect(container.querySelectorAll('#detail-attendance-table .user-capsule.uc-user').length).toBe(0);
    expect(container.querySelector('#detail-waitlist-container .detail-section-title')?.textContent)
      .toBe(`候補名單 (${container.querySelectorAll('#detail-waitlist-container .user-capsule.uc-user').length})`);

    fireEvent.click(screen.getByRole('button', { name: '查看出席名單' }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('展開後照 A 顯示正取與候補膠囊，點擊有 uid 的膠囊開個人頁', () => {
    const onOpenProfile = vi.fn();
    const { container } = render(
      <GuestRosterSections
        event={baseEvent}
        eventId="ce_123"
        expanded
        onExpand={vi.fn()}
        onOpenProfile={onOpenProfile}
        max={10}
        confirmedCount={3}
        waitlistCount={1}
      />,
    );

    const capsules = Array.from(container.querySelectorAll('.user-capsule.uc-user'));
    expect(capsules.length).toBe(2);
    expect(capsules[0]?.textContent).toBe(' 公開正取');
    expect(capsules[1]?.textContent).toBe(' 公開候補');
    expect(container.querySelector('#detail-waitlist-container .detail-section-title')?.textContent)
      .toBe('候補名單 (1)');

    fireEvent.click(capsules[0]!);
    expect(onOpenProfile).toHaveBeenCalledWith('public-user');
  });

  it('展開後無名單時顯示尚無報名，且候補區不出', () => {
    const emptyEvent = {
      ...baseEvent,
      participantsWithUid: [],
      participants: [],
      waitlistWithUid: [],
      waitlistNames: [],
    } as unknown as DetailEvent;
    const { container } = render(
      <GuestRosterSections
        event={emptyEvent}
        eventId="ce_123"
        expanded
        onExpand={vi.fn()}
        onOpenProfile={vi.fn()}
        max={10}
        confirmedCount={0}
        waitlistCount={0}
      />,
    );

    expect(container.textContent).toContain('尚無報名');
    expect(container.querySelector('#detail-waitlist-container')?.children.length).toBe(0);
  });
});
