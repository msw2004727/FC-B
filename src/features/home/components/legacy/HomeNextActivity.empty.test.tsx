import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import type { EventDoc } from '@/features/events/data/types';
import { createMinimalViewer } from '@/features/profile/data/viewer';

const resolveNextActivity = vi.hoisted(() => vi.fn());

vi.mock('../../data/next-activity', async () => {
  const actual = await vi.importActual<typeof import('../../data/next-activity')>('../../data/next-activity');
  return { ...actual, resolveNextActivity };
});

import { HomeNextActivity } from './HomeNextActivity';

const handlers = {
  onViewAll: vi.fn(),
  onFindActivity: vi.fn(),
  onCreateEvent: vi.fn(),
  onOpenDetail: vi.fn(),
  onAddToCalendar: vi.fn(),
};

function renderCard(uid: string): ReturnType<typeof render> {
  return render(<HomeNextActivity viewer={createMinimalViewer(uid)} {...handlers} />);
}

afterEach(() => {
  cleanup();
  resolveNextActivity.mockReset();
  for (const fn of Object.values(handlers)) fn.mockReset();
});

describe('首頁我的下一場：沒有下一場的空狀態', () => {
  it('訪客：套用銅金空狀態，文案原文保留，兩個動作可點', () => {
    const view = renderCard('');
    const card = view.container.querySelector('.home-next-card');
    expect(card?.classList.contains('is-empty')).toBe(true);
    expect(view.getByText('你目前還沒有報名活動')).toBeTruthy();
    expect(view.getByText('找一場活動，或建立你的第一場活動')).toBeTruthy();
    expect(view.container.querySelector('svg.home-next-empty-art')).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: '找活動' }));
    fireEvent.click(view.getByRole('button', { name: '我要開團' }));
    expect(handlers.onFindActivity).toHaveBeenCalledTimes(1);
    expect(handlers.onCreateEvent).toHaveBeenCalledTimes(1);
  });

  it('已登入但沒有下一場：讀完後才轉成空狀態，載入中不套用', async () => {
    resolveNextActivity.mockResolvedValue({ event: null, registration: null, managedRole: '' });
    const view = renderCard('u1');
    expect(view.container.querySelector('.home-next-card')?.classList.contains('is-empty')).toBe(false);
    await view.findByText('你目前還沒有報名活動');
    expect(view.container.querySelector('.home-next-card')?.classList.contains('is-empty')).toBe(true);
  });

  it('有下一場活動時不套用空狀態樣式', async () => {
    const event: EventDoc = {
      id: 'e1',
      title: '夜跑',
      image: 'https://cdn.example/c.jpg',
      date: '2099/06/01 19:00~21:00',
      location: '公園',
      status: 'active',
    };
    resolveNextActivity.mockResolvedValue({
      event,
      registration: { status: 'confirmed', eventId: 'e1', userId: 'u1' },
      managedRole: '',
    });
    const view = renderCard('u1');
    await view.findByRole('img', { name: '夜跑' });
    expect(view.container.querySelector('.home-next-card')?.classList.contains('is-empty')).toBe(false);
    expect(view.container.querySelector('.home-next-empty')).toBeNull();
  });
});
