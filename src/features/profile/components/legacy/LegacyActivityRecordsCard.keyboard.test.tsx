import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';

// T-048 F6（補強）：用「真實」的 ProfileInfoButton（不 mock）驗證標題列鍵盤行為。
// jsdom 不會把 Enter／Space 變成 click，所以用 press() 照瀏覽器規則補上：
// 按鈕上 Enter 在 keydown 觸發 click、Space 在 keyup 觸發 click；keydown 被 preventDefault 就不會觸發。

vi.mock('@/data/callables', () => ({ callFn: vi.fn() }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('@/features/profile/data/activity-records', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/profile/data/activity-records')>();
  return { ...actual, loadUserStats: vi.fn() };
});
vi.mock('@/features/profile/data/attendance-summary', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/profile/data/attendance-summary')>();
  return { ...actual, loadUserAttendanceSummary: vi.fn() };
});

import { _resetOverlayBackForTest } from '@/core/overlay-back';
import { callFn } from '@/data/callables';
import { loadUserStats } from '@/features/profile/data/activity-records';
import { loadUserAttendanceSummary } from '@/features/profile/data/attendance-summary';

import { LegacyActivityRecordsCard } from './LegacyActivityRecordsCard';

const mockedCallFn = vi.mocked(callFn);

type PressKey = 'Enter' | ' ';

/** 回傳 keydown 是否被 preventDefault；按鈕目標才補瀏覽器的 click 預設行為。 */
function press(target: Element, key: PressKey): { prevented: boolean } {
  const downOk = fireEvent.keyDown(target, { key });
  if (target.tagName === 'BUTTON' && key === 'Enter' && downOk) fireEvent.click(target);
  const upOk = fireEvent.keyUp(target, { key });
  if (target.tagName === 'BUTTON' && key === ' ' && downOk && upOk) fireEvent.click(target);
  return { prevented: !downOk };
}

const header = (): Element => document.querySelector('.profile-collapse-toggle') as Element;
const infoDialog = (): Element | null => document.querySelector('.edu-info-dialog');

describe('LegacyActivityRecordsCard 標題列鍵盤操作（真實 ProfileInfoButton）', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-TW';
    vi.clearAllMocks();
    _resetOverlayBackForTest();
    vi.mocked(loadUserStats).mockResolvedValue({
      uid: 'u1',
      activityRecords: [],
      attendanceRecords: [],
    });
    // summary 讀得到才算整體成功；讀不到會變成「只重讀」的部分失敗（見 races 測試 F2），第二次按就不會再打 Callable
    vi.mocked(loadUserAttendanceSummary).mockResolvedValue({
      uid: 'u1',
      exists: true,
      sourceVersion: 1,
      expectedCount: 3,
      attendedCount: 2,
      completedCount: 2,
      attendRate: 67,
      updatedAt: new Date(2024, 0, 5, 9, 7, 0),
    });
    mockedCallFn.mockResolvedValue({ success: true, created: 0, updated: 0 } as never);
  });

  afterEach(() => {
    cleanup();
    _resetOverlayBackForTest();
  });

  it('「?」按鈕上按 Enter／Space：照常開啟說明視窗，不切換標題列展開狀態', () => {
    render(<LegacyActivityRecordsCard uid="u1" />);
    const info = screen.getByRole('button', { name: '?' });

    for (const key of ['Enter', ' '] as const) {
      // 真實的「?」鈕自己攔下 keydown 冒泡（不 preventDefault），所以瀏覽器的 click 照常發生
      expect(press(info, key).prevented).toBe(false);
      expect(infoDialog()).not.toBeNull();
      expect(header().getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(screen.getByText('了解'));
      expect(infoDialog()).toBeNull();
    }
    expect(vi.mocked(loadUserStats)).not.toHaveBeenCalled();
  });

  it('「重新整理」按鈕上按 Enter／Space：照常觸發重新整理，不切換標題列展開狀態', async () => {
    render(<LegacyActivityRecordsCard uid="u1" />);
    const refresh = document.getElementById('my-records-refresh') as HTMLButtonElement;

    expect(press(refresh, 'Enter').prevented).toBe(false);
    await waitFor(() => expect(mockedCallFn).toHaveBeenCalledTimes(1));
    expect(header().getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(refresh.disabled).toBe(false));

    expect(press(refresh, ' ').prevented).toBe(false);
    await waitFor(() => expect(mockedCallFn).toHaveBeenCalledTimes(2));
    expect(header().getAttribute('aria-expanded')).toBe('false');
  });

  it('標題列本身：Enter 展開、Space 收合（都 preventDefault）', () => {
    render(<LegacyActivityRecordsCard uid="u1" />);

    expect(press(header(), 'Enter').prevented).toBe(true);
    expect(header().getAttribute('aria-expanded')).toBe('true');
    expect(press(header(), ' ').prevented).toBe(true);
    expect(header().getAttribute('aria-expanded')).toBe('false');
  });
});
