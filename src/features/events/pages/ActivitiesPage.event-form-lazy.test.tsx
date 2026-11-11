import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { ACTIVE_SPORT_STORAGE_KEY, _resetSportFilterForTest } from '@/core/sport-filter';
import { _resetUseEventsForTest } from '../data/use-events';
import { _clearEventsSnapshotForTest } from '../data/events-snapshot-cache';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { getEventsRepo, type EventsRepo } from '../data/events-repo';
import { loadViewerRegistrations } from '../data/viewer-registrations';
import { useViewer } from '@/features/profile/data/viewer';
import * as favoritesMod from '../data/favorites';
import ActivitiesPage from './ActivitiesPage';

const loader = vi.hoisted(() => ({
  loadCalls: 0,
  prefetchScheduled: 0,
  failNext: false,
}));
const entry = vi.hoisted(() => ({
  canCreate: false,
  formOpen: false,
  closeForm: vi.fn(),
  onClick: vi.fn(),
}));

vi.mock('@/features/events/data/events-repo', () => ({ getEventsRepo: vi.fn() }));
vi.mock('../data/favorites', () => ({
  loadFavorites: vi.fn(),
  saveFavorites: vi.fn(),
  toggleEventInFavorites: vi.fn(),
}));
vi.mock('../data/viewer-registrations', () => ({ loadViewerRegistrations: vi.fn() }));
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: vi.fn() }));
vi.mock('../components/event-form/use-create-event-entry', () => ({
  useCreateEventEntry: () => ({
    canCreate: entry.canCreate,
    profileLocked: false,
    buttonProps: { lockedClass: '', 'aria-disabled': 'false' as const },
    onClick: () => entry.onClick(),
    onClickCustom: vi.fn(),
    preset: null,
    formOpen: entry.formOpen,
    closeForm: () => entry.closeForm(),
    overlays: null,
  }),
}));
vi.mock('@/features/home/data/event-form-loader', () => ({
  loadEventFormModal: () => {
    loader.loadCalls += 1;
    if (loader.failNext) return Promise.reject(new Error('chunk load failed'));
    return Promise.resolve(function FakeEventFormModal(props: { open?: boolean }) {
      return props.open ? <div data-testid="event-form-modal">建立活動對話框</div> : null;
    });
  },
  scheduleEventFormPrefetch: () => {
    loader.prefetchScheduled += 1;
    return () => undefined;
  },
}));

function mount() {
  return render(
    <LocationProvider>
      <ActivitiesPage />
    </LocationProvider>,
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

beforeEach(async () => {
  try { localStorage.removeItem(ACTIVE_SPORT_STORAGE_KEY); } catch { /* ignore */ }
  _resetSportFilterForTest();
  _resetUseEventsForTest();
  _clearEventsSnapshotForTest();
  vi.clearAllMocks();
  loader.loadCalls = 0;
  loader.prefetchScheduled = 0;
  loader.failNext = false;
  entry.canCreate = false;
  entry.formOpen = false;
  entry.closeForm = vi.fn();
  entry.onClick = vi.fn();
  toast.clear();
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
  history.replaceState(null, '', '/activities');
  vi.mocked(getEventsRepo).mockReturnValue({
    loadEventsStatic: vi.fn<EventsRepo['loadEventsStatic']>().mockResolvedValue(['events']),
    ensureTerminalEventsLoaded: vi.fn().mockResolvedValue(['events']),
    loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
    getSnapshot: () => ({ active: [], terminal: [] }),
  });
  vi.mocked(loadViewerRegistrations).mockResolvedValue([]);
  vi.mocked(favoritesMod.loadFavorites).mockResolvedValue({ events: [], tournaments: [] });
  vi.mocked(favoritesMod.saveFavorites).mockResolvedValue(undefined);
  vi.mocked(useViewer).mockReturnValue({
    uid: 'viewer',
    teamIds: new Set(),
    roleLevel: 0,
    role: 'user',
    displayName: 'Viewer',
    pictureUrl: null,
    capabilities: [],
    hasPermission: () => false,
  });
});

afterEach(() => {
  cleanup();
  toast.clear();
  _setDictLoaderForTest(null);
  history.replaceState(null, '', '/');
});

describe('ActivitiesPage 開團表單 lazy', () => {
  it('原始碼守門：不靜態 import EventFormModal，列表仍直接引入 activity.css', () => {
    const source = readFileSync(resolve('src/features/events/pages/ActivitiesPage.tsx'), 'utf8');
    const staticImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gm)]
      .map((m) => m[1] ?? '');
    expect(staticImports.filter((spec) => /(^|\/)EventFormModal$/.test(spec))).toEqual([]);
    expect(source).toContain('loadEventFormModal');
    expect(source).toContain("import '../legacy/activity.css'");
  });

  it('表單沒打開時不下載；有建立權限只預載，畫面還沒有對話框', async () => {
    const closed = mount();
    await flush();
    expect(loader.loadCalls).toBe(0);
    expect(loader.prefetchScheduled).toBe(0);
    expect(screen.queryByTestId('event-form-modal')).toBeNull();
    closed.unmount();

    entry.canCreate = true;
    mount();
    await flush();
    expect(loader.prefetchScheduled).toBe(1);
    expect(loader.loadCalls).toBe(0);
    expect(screen.queryByTestId('event-form-modal')).toBeNull();
  });

  it('表單打開才下載並掛上；載入失敗則提示並關閉', async () => {
    entry.formOpen = true;
    const view = mount();
    expect(await screen.findByTestId('event-form-modal')).toBeTruthy();
    expect(loader.loadCalls).toBeGreaterThan(0);
    view.unmount();

    const showSpy = vi.spyOn(toast, 'show').mockImplementation(() => undefined as never);
    loader.failNext = true;
    loader.loadCalls = 0;
    entry.formOpen = true;
    mount();
    await flush();
    expect(showSpy).toHaveBeenCalledWith({ message: '活動建立功能載入失敗，請稍後再試' });
    expect(entry.closeForm).toHaveBeenCalled();
    expect(screen.queryByTestId('event-form-modal')).toBeNull();
    showSpy.mockRestore();
  });
});
