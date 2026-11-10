// 兩條路由共用的外層：依路徑切換儀表板與參與查詢。
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ path: '/admin/ops' }));
vi.mock('preact-iso', () => ({ useLocation: () => ({ path: state.path }) }));
vi.mock('./OpsDashboardPage', () => ({ default: () => <div data-page="dashboard" /> }));
vi.mock('./OpsParticipantsPage', () => ({ default: () => <div data-page="participants" /> }));

import OpsPage from './OpsPage';

afterEach(() => cleanup());

describe('OpsPage', () => {
  it.each([
    ['/admin/ops', 'dashboard'],
    ['/admin/ops/participants', 'participants'],
  ])('%s → %s', (path, page) => {
    state.path = path;
    const { container } = render(<OpsPage />);
    expect(container.querySelector('[data-page]')!.getAttribute('data-page')).toBe(page);
  });
});
