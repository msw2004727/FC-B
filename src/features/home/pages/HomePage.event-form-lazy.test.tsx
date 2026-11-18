import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/preact';
import { _resetUseEventsForTest } from '@/features/events/data/use-events';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { toast } from '@/ui/Toast';
import { loadActiveAnnouncements } from '../data/announcements';
import { loadActiveBanners } from '../data/banners';
import { resolveNextActivity } from '../data/next-activity';
import HomePage from './HomePage';

// A1：EventFormModal（約 105 KB JS＋activity.css）不在首頁關鍵路徑。
// formModule.loads 是「表單模組工廠被執行幾次」，模組被載入後會留在快取，所以只用在最前面的「還沒載入」案例；
// 之後的案例改看畫面與載入器被呼叫的次數。
const formModule = vi.hoisted(() => ({ loads: 0, props: [] as Array<Record<string, unknown>> }));
const loader = vi.hoisted(() => ({
  loadCalls: 0,
  prefetchScheduled: 0,
  failNext: false,
}));
const entry = vi.hoisted(() => ({
  canCreate: false,
  formOpen: false,
  closeForm: undefined as unknown as () => void,
}));

vi.mock('preact-iso', () => ({
  useLocation: () => ({ url: '/', path: '/', query: {}, route: vi.fn() }),
}));

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string) => key,
}));

vi.mock('@/features/events/data/events-repo', () => ({ getEventsRepo: vi.fn() }));
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: vi.fn() }));
vi.mock('@/features/home/data/next-activity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/home/data/next-activity')>()),
  resolveNextActivity: vi.fn(),
}));
vi.mock('@/features/home/data/banners', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/home/data/banners')>()),
  loadActiveBanners: vi.fn(),
}));
vi.mock('@/features/home/data/announcements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/home/data/announcements')>()),
  loadActiveAnnouncements: vi.fn(),
}));

vi.mock('../data/event-form-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/event-form-loader')>();
  return {
    ...actual,
    loadEventFormModal: () => {
      loader.loadCalls += 1;
      if (loader.failNext) return Promise.reject(new Error('chunk load failed'));
      return actual.loadEventFormModal();
    },
    scheduleEventFormPrefetch: () => {
      loader.prefetchScheduled += 1;
      return () => undefined;
    },
  };
});

vi.mock('@/features/events/components/event-form/use-create-event-entry', () => ({
  useCreateEventEntry: () => ({
    canCreate: entry.canCreate,
    profileLocked: false,
    buttonProps: { lockedClass: '', 'aria-disabled': 'false' },
    onClick: vi.fn(),
    onClickCustom: vi.fn(),
    preset: null,
    formOpen: entry.formOpen,
    closeForm: entry.closeForm,
    overlays: null,
  }),
}));

vi.mock('@/features/events/components/EventFormModal', () => {
  formModule.loads += 1;
  return {
    EventFormModal: (props: Record<string, unknown>) => {
      formModule.props.push(props);
      return props.open ? <div data-testid="event-form-modal">建立活動對話框</div> : null;
    },
  };
});

function makeViewer(uid: string | null): ViewerView {
  return {
    uid,
    teamIds: new Set(),
    roleLevel: 0,
    role: 'user',
    displayName: uid,
    pictureUrl: null,
    capabilities: [],
    hasPermission: () => false,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  formModule.props.length = 0;
  loader.loadCalls = 0;
  loader.prefetchScheduled = 0;
  loader.failNext = false;
  entry.canCreate = false;
  entry.formOpen = false;
  entry.closeForm = vi.fn();
  _resetUseEventsForTest();
  vi.mocked(useViewer).mockReturnValue(makeViewer('u1'));
  vi.mocked(resolveNextActivity).mockResolvedValue(null);
  vi.mocked(loadActiveBanners).mockResolvedValue([]);
  vi.mocked(loadActiveAnnouncements).mockResolvedValue([]);
  vi.mocked(getEventsRepo).mockReturnValue({
    loadEventsStatic: vi.fn().mockResolvedValue(['events']),
    ensureTerminalEventsLoaded: vi.fn().mockResolvedValue(['events']),
    loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
    getSnapshot: () => ({ active: [], terminal: [] }),
  });
});

afterEach(() => {
  cleanup();
});

describe('HomePage 開團表單延遲載入（A1）', () => {
  // 必須排第一：模組一旦載入就留在快取，之後無法再觀察「尚未載入」。
  it('沒有開團意圖時，表單模組完全沒被載入，也沒有預載排程', async () => {
    render(<HomePage />);
    await flush();
    expect(formModule.loads).toBe(0);
    expect(loader.loadCalls).toBe(0);
    expect(loader.prefetchScheduled).toBe(0);
    expect(screen.queryByTestId('event-form-modal')).toBeNull();
  });

  it('只有「有建立權限」的人才排空閒預載', async () => {
    entry.canCreate = true;
    render(<HomePage />);
    await flush();
    expect(loader.prefetchScheduled).toBe(1);
    expect(loader.loadCalls).toBe(0);
    expect(screen.queryByTestId('event-form-modal')).toBeNull();
  });

  it('formOpen 變 true 才載入並顯示表單，且以 mode=create 開啟', async () => {
    const { rerender } = render(<HomePage />);
    await flush();
    expect(loader.loadCalls).toBe(0);

    entry.canCreate = true;
    entry.formOpen = true;
    rerender(<HomePage />);

    expect(await screen.findByTestId('event-form-modal')).toBeTruthy();
    expect(loader.loadCalls).toBeGreaterThanOrEqual(1);
    expect(formModule.props.at(-1)).toMatchObject({ open: true, mode: 'create' });
  });

  it('表單關閉後元件仍保持掛載（open=false），再開啟不再呼叫載入器', async () => {
    entry.canCreate = true;
    entry.formOpen = true;
    const { rerender } = render(<HomePage />);
    expect(await screen.findByTestId('event-form-modal')).toBeTruthy();
    const callsAfterFirstOpen = loader.loadCalls;

    entry.formOpen = false;
    rerender(<HomePage />);
    await flush();
    expect(screen.queryByTestId('event-form-modal')).toBeNull();
    expect(formModule.props.at(-1)).toMatchObject({ open: false });

    entry.formOpen = true;
    rerender(<HomePage />);
    expect(await screen.findByTestId('event-form-modal')).toBeTruthy();
    expect(loader.loadCalls).toBe(callsAfterFirstOpen);
  });

  it('載入失敗：提示並關閉表單，不顯示對話框', async () => {
    const showSpy = vi.spyOn(toast, 'show').mockImplementation(() => undefined as never);
    loader.failNext = true;
    entry.canCreate = true;
    entry.formOpen = true;
    render(<HomePage />);
    await flush();

    expect(showSpy).toHaveBeenCalledWith({ message: '活動建立功能載入失敗，請稍後再試' });
    expect(entry.closeForm).toHaveBeenCalled();
    expect(screen.queryByTestId('event-form-modal')).toBeNull();
    showSpy.mockRestore();
  });

  it('原始碼守門：HomePage 與開團入口 hook 不得靜態 import 表單元件', () => {
    const sources = import.meta.glob(
      [
        './HomePage.tsx',
        '../data/event-form-loader.ts',
        '../../events/components/event-form/use-create-event-entry.tsx',
        '../../events/components/event-form/use-event-form-post-save.ts',
      ],
      { query: '?raw', import: 'default', eager: true },
    ) as Record<string, string>;
    expect(Object.keys(sources).length).toBe(4);
    for (const [file, source] of Object.entries(sources)) {
      const staticImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gm)]
        .map((m) => m[1] ?? '');
      const offending = staticImports.filter((spec) => /(^|\/)EventFormModal$/.test(spec));
      expect(offending, `${file} 靜態 import 了 EventFormModal`).toEqual([]);
    }
  });
});
