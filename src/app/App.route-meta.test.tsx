import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';

vi.mock('@/core/feature-registry', () => ({
  useRegistryVersion: () => 0,
  getActiveRoutes: () => [
    {
      path: '/',
      load: async () => {
        const { useLocation } = await import('preact-iso');
        return {
          default: function HomeProbe() {
            const { route } = useLocation();
            return (
              <button type="button" onClick={() => route('/events/ce_123')}>前往活動</button>
            );
          },
        };
      },
    },
    {
      path: '/events/:id',
      load: async () => {
        const { useLocation } = await import('preact-iso');
        return {
          default: function EventProbe() {
            const { route } = useLocation();
            return (
              <div>
                <p>活動頁</p>
                <button type="button" onClick={() => route('/profile')}>前往個人頁</button>
              </div>
            );
          },
        };
      },
    },
    {
      path: '/profile',
      load: async () => ({ default: () => <p>個人頁</p> }),
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

const MARK = 'data-s2-route-meta';

function seedHead(): void {
  document.head.querySelectorAll(`[${MARK}]`).forEach((el) => el.remove());
  document.head.insertAdjacentHTML(
    'afterbegin',
    `
    <link ${MARK} rel="canonical" href="https://toosterx.com/">
    <link ${MARK} rel="alternate" hreflang="zh-TW" href="https://toosterx.com/">
    <link ${MARK} rel="alternate" hreflang="x-default" href="https://toosterx.com/">
    <meta ${MARK} property="og:url" content="https://toosterx.com">
    <meta ${MARK} property="og:type" content="website">
  `,
  );
}

function headAttr(selector: string, name: string): string | null {
  return document.head.querySelector(selector)?.getAttribute(name) ?? null;
}

beforeEach(() => {
  vi.restoreAllMocks();
  seedHead();
  history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  document.head.querySelectorAll(`[${MARK}]`).forEach((el) => el.remove());
  history.replaceState(null, '', '/');
});

describe('App 換頁 route meta', () => {
  it('換頁後 document.head 的 canonical 跟著變', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '前往活動' });
    await waitFor(() => {
      expect(headAttr('link[rel="canonical"]', 'href')).toBe('https://toosterx.com/');
    });
    expect(headAttr('meta[property="og:url"]', 'content')).toBe('https://toosterx.com/');
    expect(headAttr('meta[property="og:type"]', 'content')).toBe('website');
    if (location.host) {
      expect(headAttr('link[rel="canonical"]', 'href')).not.toContain(location.host);
    }

    fireEvent.click(screen.getByRole('button', { name: '前往活動' }));
    await screen.findByText('活動頁');
    await waitFor(() => {
      expect(headAttr('link[rel="canonical"]', 'href')).toBe('https://toosterx.com/events/ce_123');
    });
    expect(headAttr('link[rel="alternate"][hreflang="zh-TW"]', 'href')).toBe('https://toosterx.com/events/ce_123');
    expect(headAttr('link[rel="alternate"][hreflang="x-default"]', 'href')).toBe('https://toosterx.com/events/ce_123');
    expect(headAttr('meta[property="og:url"]', 'content')).toBe('https://toosterx.com/events/ce_123');
    expect(headAttr('meta[property="og:type"]', 'content')).toBe('event');

    fireEvent.click(screen.getByRole('button', { name: '前往個人頁' }));
    await screen.findByText('個人頁');
    await waitFor(() => {
      expect(headAttr('link[rel="canonical"]', 'href')).toBe('https://toosterx.com/profile');
    });
    expect(headAttr('meta[property="og:type"]', 'content')).toBe('profile');
    expect(headAttr('meta[property="og:url"]', 'content')).toBe('https://toosterx.com/profile');
  });
});
