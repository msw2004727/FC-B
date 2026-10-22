import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import type { PmThread } from '../data/pm-repo';
import { closePmDialog, subscribePmDialog } from './pm-dialog-store';
import { PmBubbleHost } from './PmBubbleHost';

const subscribeThreads = vi.hoisted(() => vi.fn());

vi.mock('../data/pm-repo', () => ({
  subscribeThreads,
  PM_MAX_BODY_LENGTH: 300,
  PM_MESSAGE_LIMIT: 50,
  PM_THREAD_LIMIT: 50,
}));

type SubscribeFn = (
  uid: string,
  onChange: (threads: PmThread[]) => void,
  onError: (err: unknown) => void,
) => () => void;

let lastOnChange: ((threads: PmThread[]) => void) | null = null;
let lastUnsub: ReturnType<typeof vi.fn> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  subscribeThreads.mockReset();
  lastOnChange = null;
  lastUnsub = null;
  subscribeThreads.mockImplementation(
    ((_uid: string, onChange: (threads: PmThread[]) => void) => {
      lastOnChange = onChange;
      const unsub = vi.fn();
      lastUnsub = unsub;
      return unsub;
    }) as unknown as SubscribeFn,
  );
  document.documentElement.lang = 'zh-TW';
});

afterEach(() => {
  cleanup();
  closePmDialog();
  vi.useRealTimers();
  lastOnChange = null;
  lastUnsub = null;
});

function makeThread(overrides: Partial<PmThread> = {}): PmThread {
  return {
    id: 'c1',
    conversationId: 'c1',
    peerUid: 'peer1',
    peerName: 'Peer',
    peerAvatar: '',
    unreadCount: 0,
    lastMessageBody: 'Hello',
    ...overrides,
  };
}

describe('PmBubbleHost — 訂閱生命週期（項目 1）', () => {
  it('uid 為 null 時不呼叫 subscribeThreads', () => {
    render(<PmBubbleHost uid={null} />);
    expect(subscribeThreads).not.toHaveBeenCalled();
  });

  it('uid 有值時呼叫訂閱一次', () => {
    render(<PmBubbleHost uid="me" />);
    expect(subscribeThreads).toHaveBeenCalledTimes(1);
    expect(subscribeThreads).toHaveBeenCalledWith(
      'me',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('uid 改成 null 時退訂', () => {
    const { rerender } = render(<PmBubbleHost uid="me" />);
    expect(subscribeThreads).toHaveBeenCalledTimes(1);
    const unsub = lastUnsub;
    expect(unsub).not.toBeNull();
    rerender(<PmBubbleHost uid={null} />);
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});

describe('PmBubbleHost — 泡泡行為（項目 2）', () => {
  it('首次快照不提醒，之後新訊息才提醒', () => {
    const { container } = render(<PmBubbleHost uid="me" />);
    // 首次快照：已有未讀
    act(() => { lastOnChange?.([makeThread({ unreadCount: 1 })]); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(container.querySelector('#pm-incoming-bubble')).toBeNull();
    // 第二次快照：未讀增加
    act(() => { lastOnChange?.([makeThread({ unreadCount: 2 })]); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(container.querySelector('#pm-incoming-bubble')).not.toBeNull();
  });

  it('6.5 秒後仍未讀 → 轉為可關閉的未讀提醒', () => {
    const { container } = render(<PmBubbleHost uid="me" />);
    act(() => { lastOnChange?.([makeThread({ unreadCount: 0 })]); });
    act(() => { lastOnChange?.([makeThread({ unreadCount: 1 })]); });
    act(() => { vi.advanceTimersByTime(400); });
    const bubble = container.querySelector('#pm-incoming-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble?.classList.contains('is-reminder')).toBe(false);

    act(() => { vi.advanceTimersByTime(6500); });
    expect(bubble?.classList.contains('is-reminder')).toBe(true);
    expect(bubble?.querySelector('.pm-incoming-close')).not.toBeNull();
  });

  it('6.5 秒內已讀 → 收起泡泡', () => {
    const { container } = render(<PmBubbleHost uid="me" />);
    act(() => { lastOnChange?.([makeThread({ unreadCount: 0 })]); });
    act(() => { lastOnChange?.([makeThread({ unreadCount: 1 })]); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(container.querySelector('#pm-incoming-bubble')).not.toBeNull();
    act(() => { lastOnChange?.([makeThread({ unreadCount: 0 })]); });
    act(() => { vi.advanceTimersByTime(6500); });
    expect(container.querySelector('#pm-incoming-bubble')).toBeNull();
  });

  it('未讀提醒的關閉按鈕可關閉，且不觸發 openPmDialog', () => {
    const { container } = render(<PmBubbleHost uid="me" />);
    act(() => { lastOnChange?.([makeThread({ unreadCount: 0 })]); });
    act(() => { lastOnChange?.([makeThread({ unreadCount: 1 })]); });
    act(() => { vi.advanceTimersByTime(400); });
    act(() => { vi.advanceTimersByTime(6500); });
    const close = container.querySelector('.pm-incoming-close') as HTMLElement | null;
    expect(close).not.toBeNull();
    if (!close) return;
    const targetSpy = vi.fn();
    const userUnsub = subscribePmDialog(targetSpy);
    fireEvent.click(close);
    expect(targetSpy).not.toHaveBeenCalled();
    expect(container.querySelector('#pm-incoming-bubble')).toBeNull();
    userUnsub();
  });

  it('點泡泡呼叫 openPmDialog 並收起泡泡（項目 2、5(d)）', () => {
    const { container } = render(<PmBubbleHost uid="me" />);
    act(() => { lastOnChange?.([makeThread({ unreadCount: 0 })]); });
    act(() => { lastOnChange?.([makeThread({ unreadCount: 1 })]); });
    act(() => { vi.advanceTimersByTime(400); });
    const bubble = container.querySelector('#pm-incoming-bubble') as HTMLElement | null;
    expect(bubble).not.toBeNull();
    if (!bubble) return;

    const targetSpy = vi.fn();
    const userUnsub = subscribePmDialog(targetSpy);
    fireEvent.click(bubble);
    const calls = targetSpy.mock.calls;
    const last = calls[calls.length - 1]?.[0];
    expect(last).toEqual(expect.objectContaining({ uid: 'peer1' }));
    expect(container.querySelector('#pm-incoming-bubble')).toBeNull();
    userUnsub();
  });

  it('壞圖退首字：peerAvatar 空字串時顯示首字', () => {
    const { container } = render(<PmBubbleHost uid="me" />);
    act(() => { lastOnChange?.([makeThread({ unreadCount: 0, peerName: 'Alice' })]); });
    act(() => { lastOnChange?.([makeThread({ unreadCount: 1, peerName: 'Alice' })]); });
    act(() => { vi.advanceTimersByTime(400); });
    const avatar = container.querySelector('.pm-incoming-avatar');
    expect(avatar?.querySelector('img')).toBeNull();
    expect(avatar?.textContent).toBe('A');
  });

  it('有 peerAvatar 時渲染 lazy / async / no-referrer 圖', () => {
    const { container } = render(<PmBubbleHost uid="me" />);
    act(() => {
      lastOnChange?.([makeThread({ unreadCount: 0, peerAvatar: 'https://x/avatar.png' })]);
    });
    act(() => {
      lastOnChange?.([makeThread({ unreadCount: 1, peerAvatar: 'https://x/avatar.png' })]);
    });
    act(() => { vi.advanceTimersByTime(400); });
    const img = container.querySelector('.pm-incoming-avatar img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    if (!img) return;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });
});
