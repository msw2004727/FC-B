import { cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { routeMock, closedToastMock } = vi.hoisted(() => ({
  routeMock: vi.fn(),
  closedToastMock: vi.fn(),
}));
vi.mock('preact-iso', () => ({
  useLocation: () => ({ route: routeMock }),
}));
vi.mock('../availability', () => ({
  showAchievementsClosedToast: closedToastMock,
}));

import AchievementsClosedRedirect from './ClosedRedirect';

describe('AchievementsClosedRedirect（/achievements、/titles 關閉期間的替身頁）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('顯示尚未開放並以 replace 導回我的頁，且不輸出任何畫面', () => {
    const { container } = render(<AchievementsClosedRedirect />);
    expect(closedToastMock).toHaveBeenCalledTimes(1);
    expect(routeMock).toHaveBeenCalledTimes(1);
    expect(routeMock).toHaveBeenCalledWith('/profile', true);
    expect(container.innerHTML).toBe('');
  });
});
