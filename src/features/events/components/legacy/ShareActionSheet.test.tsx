import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShareActionSheet, showShareActionSheet } from './ShareActionSheet';

const overlay = vi.hoisted(() => ({
  release: vi.fn(),
  onBack: undefined as undefined | (() => boolean),
}));

vi.mock('@/core/overlay-back', () => ({
  pushOverlay: (onBack: () => boolean) => {
    overlay.onBack = onBack;
    return overlay.release;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('照 A 顯示三個分享選項與取消，選擇只回傳一次', () => {
  const onChoice = vi.fn();
  render(<ShareActionSheet canPicker onChoice={onChoice} />);
  expect(screen.getByText('LINE 好友')).toBeTruthy();
  expect(screen.getByText('LINE 社群')).toBeTruthy();
  const copy = screen.getByText('複製連結');
  fireEvent.click(copy);
  fireEvent.click(copy);
  act(() => { vi.advanceTimersByTime(400); });
  expect(onChoice).toHaveBeenCalledExactlyOnceWith('copy');
});

it('沒有 picker 時隱藏好友選項，保留 A 的 R/share 入口', () => {
  render(<ShareActionSheet canPicker={false} onChoice={vi.fn()} />);
  expect(screen.queryByText('LINE 好友')).toBeNull();
  expect(screen.queryByText('LINE 社群')).toBeNull();
  expect(screen.getByText('分享到 LINE')).toBeTruthy();
});

it('賽事分享傳入的文字取代預設中文（活動不傳維持原樣）', () => {
  const labels = {
    friends: 'F', friendsSub: 'FS', community: 'C', communitySub: 'CS',
    toLine: 'L', copy: 'K', copySub: 'KS', cancel: 'X',
  };
  const view = render(<ShareActionSheet canPicker title="T" labels={labels} onChoice={vi.fn()} />);
  for (const text of ['T', 'F', 'FS', 'C', 'CS', 'K', 'KS', 'X']) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.queryByText('LINE 好友')).toBeNull();
  view.unmount();
  render(<ShareActionSheet canPicker={false} labels={labels} onChoice={vi.fn()} />);
  expect(screen.getByText('L')).toBeTruthy();
});

// 測試同步更新：照 A cleanup(choice) 同步回報選擇（Gemini 審查：延遲 400ms 會讓手勢權限過期）。
it('返回鍵當下回報 cancel，卸載會釋放 overlay', () => {
  const onChoice = vi.fn();
  const view = render(<ShareActionSheet canPicker onChoice={onChoice} />);
  act(() => { overlay.onBack?.(); });
  expect(onChoice).toHaveBeenCalledExactlyOnceWith('cancel');
  view.unmount();
  act(() => { vi.runAllTimers(); });
  expect(onChoice).toHaveBeenCalledOnce();
  expect(overlay.release).toHaveBeenCalledOnce();
});

it('遮罩取消且 AbortSignal 立即移除獨立掛載點', async () => {
  const controller = new AbortController();
  let result!: Promise<string>;
  act(() => {
    result = showShareActionSheet(true, controller.signal);
  });
  const sheet = document.querySelector('.share-action-sheet');
  expect(sheet?.closest('.legacy-ui')).toBeTruthy();
  act(() => controller.abort());
  expect(await result).toBe('cancel');
  expect(document.querySelector('.share-action-sheet')).toBeNull();

  const onChoice = vi.fn();
  const view = render(<ShareActionSheet canPicker onChoice={onChoice} />);
  const backdrop = view.container.querySelector('.share-action-sheet');
  if (!backdrop) throw new Error('missing backdrop');
  fireEvent.click(backdrop);
  act(() => { vi.advanceTimersByTime(400); });
  expect(onChoice).toHaveBeenCalledWith('cancel');
});
