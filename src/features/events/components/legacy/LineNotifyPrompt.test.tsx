import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';

import { _resetOverlayBackForTest } from '@/core/overlay-back';
import { setLocale } from '@/i18n/i18n';
import { LineNotifyPrompt } from './LineNotifyPrompt';

vi.mock('../../data/line-notify-bind', () => ({
  dismissLineNotifyPrompt: vi.fn(),
}));

import { dismissLineNotifyPrompt } from '../../data/line-notify-bind';

beforeEach(async () => {
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  _resetOverlayBackForTest();
  vi.clearAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

function getOverlay(): HTMLElement | null {
  return document.getElementById('line-notify-prompt-overlay');
}

describe('LineNotifyPrompt（照 A `_showLineNotifyPrompt`）', () => {
  it('掛載後輸出 A 的 DOM 與文字', async () => {
    render(<LineNotifyPrompt open onBind={() => undefined} onClosed={() => undefined} />);
    await waitFor(() => {
      expect(getOverlay()).toBeTruthy();
    });
    const overlay = getOverlay();
    expect(overlay).toBeTruthy();
    expect(overlay?.id).toBe('line-notify-prompt-overlay');
    expect(overlay?.className).toBe('ln-prompt-overlay');

    const card = overlay?.querySelector('.ln-prompt-card');
    expect(card).toBeTruthy();
    expect(card?.querySelector('.ln-prompt-icon')?.textContent).toBe('🔔');
    // 測試同步更新：11-09 站長預覽核可的新文案（拿掉開場前提醒、關注活動、成就徽章）
    expect(card?.querySelector('.ln-prompt-title')?.textContent).toBe(
      '開啟 LINE 通知，不再錯過！',
    );
    const desc = card?.querySelector('.ln-prompt-desc')?.textContent ?? '';
    expect(desc).toBe('報名成功、候補遞補、活動異動或取消，都會即時通知你。');
    expect(card?.querySelectorAll('.ln-prompt-desc br').length).toBe(1);
    const cardText = card?.textContent ?? '';
    for (const old of ['開場前', '開始前', '成就徽章', '關注活動']) {
      expect(cardText).not.toContain(old);
    }

    const actions = card?.querySelector('.ln-prompt-actions');
    expect(actions).toBeTruthy();
    const dismissBtn = card?.querySelector('#ln-prompt-dismiss');
    expect(dismissBtn?.tagName.toLowerCase()).toBe('button');
    expect(dismissBtn?.textContent).toBe('請別煩我');
    expect((dismissBtn as HTMLElement | null)?.className).toBe('ln-prompt-btn ln-prompt-dismiss');

    const bindBtn = card?.querySelector('#ln-prompt-bind');
    expect(bindBtn?.tagName.toLowerCase()).toBe('button');
    expect((bindBtn as HTMLElement | null)?.className).toBe('ln-prompt-btn ln-prompt-bind');
    expect(bindBtn?.querySelector('.ln-prompt-bind-glow')).toBeTruthy();
    expect(bindBtn?.querySelector('.ln-prompt-bind-text')?.textContent).toBe('立即綁定');
  });

  it('下一個 frame 加上 `open` class', async () => {
    render(<LineNotifyPrompt open onBind={() => undefined} onClosed={() => undefined} />);
    await waitFor(() => {
      expect(getOverlay()?.classList.contains('open')).toBe(true);
    });
  });

  it('open=false 掛載時不輸出', () => {
    render(<LineNotifyPrompt open={false} onBind={() => undefined} onClosed={() => undefined} />);
    expect(getOverlay()).toBeNull();
  });

  it('「請別煩我」先呼叫 dismissLineNotifyPrompt 再關閉，關閉動畫後觸發 onClosed', async () => {
    const onClosed = vi.fn();
    render(<LineNotifyPrompt open onBind={() => undefined} onClosed={onClosed} />);
    await waitFor(() => {
      expect(getOverlay()?.classList.contains('open')).toBe(true);
    });

    fireEvent.click(screen.getByText('請別煩我'));
    expect(dismissLineNotifyPrompt).toHaveBeenCalledTimes(1);
    expect(getOverlay()?.classList.contains('open')).toBe(false);

    await waitFor(
      () => {
        expect(onClosed).toHaveBeenCalledTimes(1);
      },
      { timeout: 1500 },
    );
  });

  it('「立即綁定」先關閉再呼叫 onBind，不動 dismissLineNotifyPrompt', async () => {
    const onBind = vi.fn();
    const onClosed = vi.fn();
    render(<LineNotifyPrompt open onBind={onBind} onClosed={onClosed} />);
    await waitFor(() => {
      expect(getOverlay()?.classList.contains('open')).toBe(true);
    });

    fireEvent.click(screen.getByText('立即綁定'));
    expect(onBind).toHaveBeenCalledTimes(1);
    expect(dismissLineNotifyPrompt).not.toHaveBeenCalled();

    await waitFor(
      () => {
        expect(onClosed).toHaveBeenCalledTimes(1);
      },
      { timeout: 1500 },
    );
  });

  it('點遮罩（target 是 overlay）關閉；點卡片內不會關閉', async () => {
    const onClosed = vi.fn();
    render(<LineNotifyPrompt open onBind={() => undefined} onClosed={onClosed} />);
    await waitFor(() => {
      expect(getOverlay()?.classList.contains('open')).toBe(true);
    });

    const card = document.querySelector('.ln-prompt-card');
    expect(card).toBeTruthy();
    fireEvent.click(card as Element);
    expect(getOverlay()?.classList.contains('open')).toBe(true);
    expect(onClosed).not.toHaveBeenCalled();

    fireEvent.click(getOverlay() as HTMLElement);
    expect(dismissLineNotifyPrompt).not.toHaveBeenCalled();
    expect(getOverlay()?.classList.contains('open')).toBe(false);

    await waitFor(
      () => {
        expect(onClosed).toHaveBeenCalledTimes(1);
      },
      { timeout: 1500 },
    );
  });

  it('open 由 true → false 觸發關閉並呼叫 onClosed', async () => {
    const onClosed = vi.fn();
    const { rerender } = render(
      <LineNotifyPrompt open onBind={() => undefined} onClosed={onClosed} />,
    );
    await waitFor(() => {
      expect(getOverlay()?.classList.contains('open')).toBe(true);
    });

    rerender(<LineNotifyPrompt open={false} onBind={() => undefined} onClosed={onClosed} />);
    expect(getOverlay()?.classList.contains('open')).toBe(false);
    await waitFor(
      () => {
        expect(onClosed).toHaveBeenCalledTimes(1);
      },
      { timeout: 1500 },
    );
  });

  it('返回鍵（popstate）會關閉並觸發 onClosed', async () => {
    const onClosed = vi.fn();
    render(<LineNotifyPrompt open onBind={() => undefined} onClosed={onClosed} />);
    await waitFor(() => {
      expect(getOverlay()?.classList.contains('open')).toBe(true);
    });

    // 模擬實體返回鍵：overlay-back 的 listener 掛在 window 上（capture）
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(dismissLineNotifyPrompt).not.toHaveBeenCalled();

    await waitFor(
      () => {
        expect(onClosed).toHaveBeenCalledTimes(1);
      },
      { timeout: 1500 },
    );
  });

  it('只會觸發一次 onClosed（重複點按不重複呼叫）', async () => {
    const onClosed = vi.fn();
    render(<LineNotifyPrompt open onBind={() => undefined} onClosed={onClosed} />);
    await waitFor(() => {
      expect(getOverlay()?.classList.contains('open')).toBe(true);
    });

    fireEvent.click(screen.getByText('請別煩我'));
    fireEvent.click(getOverlay() as HTMLElement);
    fireEvent.click(screen.getByText('立即綁定'));

    await waitFor(
      () => {
        expect(onClosed).toHaveBeenCalledTimes(1);
      },
      { timeout: 1500 },
    );
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});
