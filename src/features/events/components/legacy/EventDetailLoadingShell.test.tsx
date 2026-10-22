import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import {
  EventDetailLoadingShell,
  EventDetailMissing,
  EventDetailToolbarActions,
} from './EventDetailLoadingShell';

const mocks = vi.hoisted(() => ({
  authUid: vi.fn<() => string | null | undefined>(),
  read: vi.fn(),
  visible: vi.fn(() => true),
  toast: vi.fn(),
}));

vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: mocks.authUid }));
vi.mock('../../data/events-snapshot-cache', () => ({ readEventsSnapshot: mocks.read }));
vi.mock('../../data/visibility', () => ({ isEventVisibleToUser: mocks.visible }));
vi.mock('@/ui/Toast', () => ({ toast: { show: mocks.toast } }));
vi.mock('@/i18n/i18n', async (o) => ({
  ...(await o<typeof import('@/i18n/i18n')>()),
  lt: (_key: string, fallback: string) => fallback,
}));

// ASSUMPTION: 本測試只使用 uid；可見性 helper 已獨立 mock。
const viewer = { uid: 'u1' } as ViewerView;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authUid.mockReturnValue('u1');
  mocks.read.mockReturnValue(null);
  mocks.visible.mockReturnValue(true);
});

afterEach(() => cleanup());

it('無快取立即顯示 A 頁首、封面與三列骨架', () => {
  const goBack = vi.fn();
  const view = render(<EventDetailLoadingShell publicId="public-1" viewer={viewer} goBack={goBack} />);
  expect(screen.getByText('活動詳情')).toBeTruthy();
  // 照 A _renderShellImage：無快取無圖時封面佔位顯示「活動封面」。
  expect(view.container.querySelector('#detail-img-placeholder')?.textContent).toBe('活動封面');
  expect(screen.getByText('活動資訊載入中...')).toBeTruthy();
  expect(view.container.querySelectorAll('.reg-loading-skeleton-row')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: '返回' }));
  expect(goBack).toHaveBeenCalledOnce();
});

it('用公開 ID 找同帳號快取並先畫地點、時間、封面', () => {
  mocks.read.mockReturnValue([{
    id: 'public-1',
    title: '快取活動',
    location: '球場',
    date: '今天',
    imageVariants: { cover: 'https://img.test/cover.jpg' },
  }]);
  render(<EventDetailLoadingShell publicId="public-1" viewer={viewer} goBack={vi.fn()} />);
  expect(screen.getByText('快取活動')).toBeTruthy();
  expect(screen.getByText('球場')).toBeTruthy();
  expect(screen.getByText('今天')).toBeTruthy();
  expect(screen.getByRole('img').getAttribute('src')).toBe('https://img.test/cover.jpg');
});

it('帳號未確認或活動不可見時不暴露快取', () => {
  mocks.read.mockReturnValue([{ id: 'public-1', title: '受限活動' }]);
  mocks.authUid.mockReturnValue(undefined);
  const view = render(<EventDetailLoadingShell publicId="public-1" viewer={viewer} goBack={vi.fn()} />);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(screen.queryByText('受限活動')).toBeNull();
  mocks.authUid.mockReturnValue('u1');
  mocks.visible.mockReturnValue(false);
  view.rerender(<EventDetailLoadingShell publicId="public-1" viewer={viewer} goBack={vi.fn()} />);
  expect(screen.queryByText('受限活動')).toBeNull();
});

it('錯誤外框保留重試內容且不繼續顯示載入條', () => {
  render(
    <EventDetailLoadingShell publicId="public-1" viewer={viewer} goBack={vi.fn()} loading={false}>
      <button>重試</button>
    </EventDetailLoadingShell>,
  );
  expect(screen.getByText('重試')).toBeTruthy();
  expect(screen.queryByText('活動資訊載入中...')).toBeNull();
});

it('找不到只在 effect 提示與返回一次', () => {
  const goBack = vi.fn();
  const view = render(<EventDetailMissing goBack={goBack} />);
  view.rerender(<EventDetailMissing goBack={() => goBack()} />);
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({ message: '找不到此活動' });
  expect(goBack).toHaveBeenCalledOnce();
});

it('簽到顯示和 handler 使用同一檢查，權限撤回立即拒絕', () => {
  const canScan = vi.fn(() => true);
  const onScan = vi.fn();
  render(<EventDetailToolbarActions event={{ id: 'public-1' }} loggedIn canScan={canScan} onScan={onScan} />);
  const button = screen.getByText('現場簽到');
  canScan.mockReturnValue(false);
  fireEvent.click(button);
  expect(onScan).not.toHaveBeenCalled();
  canScan.mockReturnValue(true);
  fireEvent.click(button);
  expect(onScan).toHaveBeenCalledOnce();
});
