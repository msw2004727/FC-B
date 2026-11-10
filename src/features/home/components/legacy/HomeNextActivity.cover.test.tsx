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

const FALLBACK = 'LOGO/Nocoverimage%20set.png';
const REAL = 'https://cdn.example/next-cover.jpg';

function event(image: string): EventDoc {
  return {
    id: 'e1',
    title: '夜跑',
    image,
    date: '2099/06/01 19:00~21:00',
    location: '公園',
    status: 'active',
  };
}

function renderCard(): ReturnType<typeof render> {
  return render(
    <HomeNextActivity
      viewer={createMinimalViewer('u1')}
      onViewAll={() => undefined}
      onFindActivity={() => undefined}
      onCreateEvent={() => undefined}
      onOpenDetail={() => undefined}
      onAddToCalendar={() => undefined}
    />,
  );
}

afterEach(() => {
  cleanup();
  resolveNextActivity.mockReset();
});

describe('首頁下一場封面', () => {
  it('第一張就用活動圖，不先載預設封面', async () => {
    resolveNextActivity.mockResolvedValue({
      event: event(REAL),
      registration: { status: 'confirmed', eventId: 'e1', userId: 'u1' },
      managedRole: '',
    });
    const view = renderCard();
    expect(view.container.querySelector('img')).toBeNull();
    const img = await view.findByRole('img', { name: '夜跑' });
    expect(img.getAttribute('src')).toBe(REAL);
    expect(img.getAttribute('src')).not.toContain('Nocoverimage');
  });

  it('這張網址載入失敗才換成預設封面', async () => {
    resolveNextActivity.mockResolvedValue({
      event: event(REAL),
      registration: null,
      managedRole: '',
    });
    const view = renderCard();
    const img = await view.findByRole('img', { name: '夜跑' });
    fireEvent.error(img);
    expect(img.getAttribute('src')).toBe(FALLBACK);
  });
});
