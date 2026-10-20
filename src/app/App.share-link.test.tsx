import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/preact';

vi.mock('@/core/feature-registry', () => ({
  useRegistryVersion: () => 0,
  getActiveRoutes: () => [
    { path: '/', load: async () => ({ default: () => <div>home-test</div> }) },
    {
      path: '/events/:id',
      load: async () => ({ default: () => <div>event-test</div> }),
    },
    {
      path: '/teams/:id',
      load: async () => ({ default: () => <div>team-test</div> }),
    },
  ],
}));
vi.mock('@/ui/TopBar', () => ({ TopBar: () => null }));
vi.mock('@/ui/BottomNav', () => ({ BottomNav: () => null }));
vi.mock('@/ui/SideDrawer', () => ({ SideDrawer: () => null }));
vi.mock('@/core/font-size', () => ({ initFontSize: () => undefined }));
vi.mock('@/data/auth', () => ({
  onAuthChanged: () => () => undefined,
  getCurrentUser: async () => null,
  signIn: vi.fn(),
}));

import { App } from './App';
import { resolveShareLink } from './share-link';

beforeEach(() => vi.restoreAllMocks());
afterEach(cleanup);

describe('App share links', () => {
  it('/?event=ce_123_abc 以 replace 導向，沒有 push 歷史', async () => {
    history.replaceState(null, '', '/?event=ce_123_abc');
    const replace = vi.spyOn(history, 'replaceState');
    const push = vi.spyOn(history, 'pushState');
    render(<App />);
    await screen.findByText('event-test');
    await waitFor(() => expect(window.location.pathname).toBe('/events/ce_123_abc'));
    expect(window.location.search).toBe('');
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('team 深連結也使用 replace', async () => {
    history.replaceState(null, '', '/?team=team_123');
    const push = vi.spyOn(history, 'pushState');
    render(<App />);
    await screen.findByText('team-test');
    expect(window.location.pathname).toBe('/teams/team_123');
    expect(push).not.toHaveBeenCalled();
  });

  it('非法 id 保留根網址，不導向', async () => {
    history.replaceState(null, '', '/?event=bad%2Fid');
    const push = vi.spyOn(history, 'pushState');
    const replace = vi.spyOn(history, 'replaceState');
    render(<App />);
    await screen.findByText('home-test');
    expect(window.location.pathname).toBe('/');
    expect(push).not.toHaveBeenCalled();
    // 測試同步更新：照 A（M-045）開站會以同網址 replaceState 標記返回起點，網址不得改變。
    for (const call of replace.mock.calls) {
      expect(String(call[2])).toContain('/?event=bad%2Fid');
    }
  });

  it.each([
    '/?event=',
    '/?event=%3Cscript%3E',
    `/?event=${'a'.repeat(121)}`,
    '/?event=a&event=b',
    '/activities?event=ce_123_abc',
  ])('拒絕 %s', (url) => {
    expect(resolveShareLink(url)).toBeNull();
  });
});
