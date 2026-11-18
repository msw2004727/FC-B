import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import zhTw from '../locales/zh-TW.json';
import TournamentsPage, { externalChipClass } from './TournamentsPage';
import { resetCardsCacheForTest } from '../data/cards-cache';

function flatten(obj: Record<string, unknown>, prefix: string, out: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = `${prefix}.${key}`;
    if (value && typeof value === 'object') flatten(value as Record<string, unknown>, path, out);
    else out[path] = String(value);
  }
  return out;
}
const dict = flatten(zhTw as Record<string, unknown>, 'tournaments');

vi.mock('@/feature-overrides', () => ({
  COMPETITIONS_ENABLED: true,
  FEATURE_OVERRIDES: { competitions: true },
}));

const slot = vi.hoisted(() => ({
  open: true,
  mounts: 0,
}));

vi.mock('@/features/competitions/components/InAppSection', async () => {
  const { useEffect } = await import('preact/hooks');
  const { h } = await import('preact');
  return {
    InAppSection: (props: { tab: string; active: boolean; onGate?: (open: boolean) => void }) => {
      useEffect(() => {
        slot.mounts += 1;
        props.onGate?.(slot.open);
      }, [props.onGate]);
      if (!slot.open) return null;
      return h('div', {
        'data-inapp': 'mock',
        'data-tab': props.tab,
        'data-active': props.active ? '1' : '0',
      });
    },
  };
});

vi.mock('@/i18n/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    let text = dict[key] ?? key;
    for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value));
    return text;
  },
  lt: (_key: string, fallback?: string) => fallback ?? _key,
  useLegacyT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));

const mockUseViewer = vi.hoisted(() => vi.fn<() => ViewerView>());
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: () => mockUseViewer() }));
vi.mock('@/data/auth', () => ({
  getLastKnownAuthUid: () => mockUseViewer().uid ?? null,
}));

const sdk = {
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  collection: vi.fn((_db: unknown, name: string) => ({ collection: name })),
  orderBy: vi.fn((field: string, dir: string) => ({ orderBy: [field, dir] })),
  limit: vi.fn((n: number) => ({ limit: n })),
  query: vi.fn((c: unknown, ...rest: unknown[]) => ({ c, rest })),
};
vi.mock('@/data/firestore-sdk', () => ({ loadFirestoreSdk: async () => sdk }));
vi.mock('@/data/firebase', () => ({
  getFirebase: async () => ({ db: {} }),
  shouldUseEmulator: () => false,
}));

vi.mock('@/ui/AppConfirm', () => ({ appConfirm: async () => true }));
vi.mock('@/ui/Toast', () => ({ toast: { show: () => undefined } }));
vi.mock('@/features/events/components/event-form/ImageCropper', async () => {
  const { h } = await import('preact');
  return { ImageCropper: () => h('div', {}) };
});

const DOCS = [
  { id: 'tc_league', data: { name: '2027 春季聯賽', type: 'league', startDate: '2027-03-06', endDate: '2027-05-29', url: 'https://league.example.com/' } },
  { id: 'tc_feda', data: { name: 'FEDA CUP 2026 飛達盃', type: 'cup', startDate: '2026-10-09', endDate: '2026-10-11', url: 'https://cup.example.com/' } },
  { id: 'tc_friendly', data: { name: '週末友誼賽', type: 'friendly', startDate: '2026-11-15', endDate: '2026-11-15', url: 'https://friendly.example.com/' } },
];

function viewer(): ViewerView {
  return {
    uid: 'u_user',
    role: 'user',
    roleLevel: 0,
    teamIds: new Set(),
    capabilities: [],
    displayName: '用戶',
    pictureUrl: null,
    hasPermission: () => false,
  };
}

function draw(): void {
  render(
    <LocationProvider>
      <TournamentsPage />
    </LocationProvider>,
  );
}

beforeEach(() => {
  resetCardsCacheForTest();
  slot.open = true;
  slot.mounts = 0;
  history.replaceState(null, '', '/tournaments');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T04:00:00Z'));
  sdk.getDocs.mockClear();
  sdk.getDocs.mockResolvedValue({ docs: DOCS.map((doc) => ({ id: doc.id, data: () => doc.data })) });
  mockUseViewer.mockReturnValue(viewer());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

describe('開關打開時的來源與讀取', () => {
  it('?src= 用 replace 記在目前這筆歷史；切來源、分類都不重讀，站內區不重掛', async () => {
    draw();
    await waitFor(() => expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('true'));
    expect(document.querySelector('[data-inapp="mock"]')?.getAttribute('data-active')).toBe('1');
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
    expect(slot.mounts).toBe(1);

    const replace = vi.spyOn(history, 'replaceState');
    const push = vi.spyOn(history, 'pushState');
    fireEvent.click(screen.getByRole('tab', { name: '外部賽事' }));
    expect(location.search).toBe('?src=ext');
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: '外部賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('2027 春季聯賽')).toBeTruthy();
    expect(document.querySelector('[data-active]')?.getAttribute('data-active')).toBe('0');
    expect(document.querySelector('[data-card-id="tc_league"] .tc-chip')?.className).toContain('cpl-chip--league');
    replace.mockRestore();
    push.mockRestore();

    fireEvent.click(screen.getByRole('tab', { name: '盃賽' }));
    expect(screen.getByText('FEDA CUP 2026 飛達盃')).toBeTruthy();
    expect(screen.queryByText('2027 春季聯賽')).toBeNull();
    expect(document.querySelector('[data-tab]')?.getAttribute('data-tab')).toBe('cup');

    fireEvent.click(screen.getByRole('tab', { name: '站內賽事' }));
    expect(location.search).toBe('');
    expect(document.querySelector('[data-active]')?.getAttribute('data-active')).toBe('1');
    expect(document.querySelector('[data-tab]')?.getAttribute('data-tab')).toBe('cup');
    expect(screen.queryByText('FEDA CUP 2026 飛達盃')).toBeNull();
    expect(slot.mounts).toBe(1);
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });

  it('不認得的 src 回到預設，其他參數留著', async () => {
    history.replaceState(null, '', '/tournaments?src=nope&keep=1');
    draw();
    await waitFor(() => expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('true'));
    expect(location.search).toBe('?src=nope&keep=1');
    fireEvent.click(screen.getByRole('tab', { name: '外部賽事' }));
    expect(location.search).toBe('?src=ext&keep=1');
    fireEvent.click(screen.getByRole('tab', { name: '站內賽事' }));
    expect(location.search).toBe('?keep=1');
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });

  it('模擬返回（popstate）後仍停在 ?src=ext', async () => {
    draw();
    await waitFor(() => expect(screen.getByRole('tab', { name: '站內賽事' }).getAttribute('aria-selected')).toBe('true'));
    fireEvent.click(screen.getByRole('tab', { name: '外部賽事' }));
    expect(location.search).toBe('?src=ext');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(location.search).toBe('?src=ext');
    expect(screen.getByRole('tab', { name: '外部賽事' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('2027 春季聯賽')).toBeTruthy();
  });

  it('非法 type 不產生 cpl-chip--*', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const span = document.createElement('span');
    host.append(span);
    for (const type of ['playoff', 'league cup', '"><img', 'cpl-chip--x', '']) {
      span.className = externalChipClass(type, true);
      expect(span.className).not.toMatch(/cpl-chip--/);
      expect(host.querySelector('[class*="cpl-chip--"]')).toBeNull();
    }
    span.className = externalChipClass('cup', true);
    expect(span.classList.contains('cpl-chip--cup')).toBe(true);
    expect(externalChipClass('league', true)).toBe('tc-chip cpl-chip cpl-chip--league');
    expect(externalChipClass('friendly', false)).toBe('tc-chip');
    host.remove();
  });

  it('直接打開 ?src=ext 停在外部，進頁仍只查一次', async () => {
    history.replaceState(null, '', '/tournaments?src=ext');
    draw();
    await waitFor(() => expect(screen.getByRole('tab', { name: '外部賽事' }).getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByText('週末友誼賽')).toBeTruthy();
    expect(document.querySelector('[data-active]')?.getAttribute('data-active')).toBe('0');
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
    expect(slot.mounts).toBe(1);
  });

  it('閘門沒過不畫切換，外部小標維持原 class', async () => {
    slot.open = false;
    draw();
    await waitFor(() => expect(screen.getByText('2027 春季聯賽')).toBeTruthy());
    await waitFor(() => expect(slot.mounts).toBe(1));
    const root = document.querySelector('.tournaments-root');
    expect(root?.hasAttribute('data-v2')).toBe(false);
    expect(document.querySelector('.cpl-src')).toBeNull();
    expect(document.querySelector('.cpl-chip')).toBeNull();
    expect(document.querySelector('[data-inapp]')).toBeNull();
    expect(root?.textContent ?? '').not.toContain('站內賽事');
    expect(document.querySelector('.tc-chip')?.className).toBe('tc-chip');
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });
});
