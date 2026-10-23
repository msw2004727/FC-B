/**
 * 對應 A `team-detail-invite.js showTeamInviteQR` 的邀請浮層契約測試。
 * 驗證與 A 的差異：本機 QR、fail-closed、Esc／焦點／aria／返回鍵，
 * 以及按鈕 min-height 44px；不依賴第三方 QR 或圖片服務。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { pushOverlay } from '@/core/overlay-back';
import { buildShareUrl } from '@/features/events/data/event-share-builders';
import { renderQrToCanvas } from '@/features/profile/data/qr';
import { toast } from '@/ui/Toast';
import {
  TeamInviteQrOverlay,
  buildTeamInviteShareText,
} from './TeamInviteQrOverlay';

const { release } = vi.hoisted(() => ({
  release: vi.fn<() => void>(),
}));

vi.mock('@/core/overlay-back', () => ({
  pushOverlay: vi.fn(() => release),
}));

vi.mock('@/features/profile/data/qr', () => ({
  renderQrToCanvas: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn() },
}));

const teamId = 'tm_test_1';
const teamName = '測試俱樂部';
const url = buildShareUrl('team', teamId);
const shareText = buildTeamInviteShareText(teamName, url);

let shareDescriptor: PropertyDescriptor | undefined;
let clipboardDescriptor: PropertyDescriptor | undefined;
let execCommandDescriptor: PropertyDescriptor | undefined;
let fetchDescriptor: PropertyDescriptor | undefined;

function restoreProperty(
  target: object,
  key: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
  } else {
    Reflect.deleteProperty(target, key);
  }
}

function setShare(value: unknown): void {
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value,
  });
}

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value,
  });
}

function setExecCommand(value: unknown): void {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value,
  });
}

function mount(onClose = vi.fn()) {
  return {
    ...render(
      <TeamInviteQrOverlay
        teamId={teamId}
        teamName={teamName}
        onClose={onClose}
      />,
    ),
    onClose,
  };
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`找不到測試元素：${selector}`);
  return element;
}

beforeEach(() => {
  shareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'share');
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  execCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
  fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

  vi.clearAllMocks();
  vi.mocked(renderQrToCanvas).mockReset();
  vi.mocked(renderQrToCanvas).mockResolvedValue(undefined);
  vi.mocked(pushOverlay).mockImplementation(() => release);

  setShare(undefined);
  setClipboard(undefined);
  setExecCommand(vi.fn(() => false));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreProperty(navigator, 'share', shareDescriptor);
  restoreProperty(navigator, 'clipboard', clipboardDescriptor);
  restoreProperty(document, 'execCommand', execCommandDescriptor);
  restoreProperty(globalThis, 'fetch', fetchDescriptor);
});

describe('俱樂部邀請分享文案', () => {
  it('有名稱時使用書名號並保留完整招募文案與網址', () => {
    expect(buildTeamInviteShareText(teamName, url)).toBe(
      `「測試俱樂部」正在 ToosterX 招募夥伴，歡迎加入俱樂部，一起運動、揪團、參加活動。\n${url}`,
    );
  });

  it('空名稱與全空白名稱使用這個俱樂部', () => {
    const expected =
      `這個俱樂部正在 ToosterX 招募夥伴，歡迎加入俱樂部，一起運動、揪團、參加活動。\n${url}`;
    expect(buildTeamInviteShareText('', url)).toBe(expected);
    expect(buildTeamInviteShareText('   ', url)).toBe(expected);
  });

  it('移除名稱前後空白', () => {
    expect(buildTeamInviteShareText(`  ${teamName}  `, url)).toBe(shareText);
  });
});

describe('俱樂部邀請 QR 浮層', () => {
  it('渲染對話框、標題、Mini App 網址、換行文案與畫布', () => {
    const { container, getByRole } = mount();
    const dialog = getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('qr-invite-title');
    expect(document.getElementById('qr-invite-title')?.textContent).toBe(
      `${teamName} 邀請加入`,
    );
    expect(url).toMatch(/^https:\/\/miniapp\.line\.me\/[^?]+\?team=/);
    expect(url.endsWith(`?team=${encodeURIComponent(teamId)}`)).toBe(true);

    const preview = Array.from(dialog.querySelectorAll('div')).find(
      (element) => element.firstElementChild?.tagName === 'BR',
    );
    expect(preview?.textContent).toContain('招募夥伴');
    expect(preview?.textContent).toContain(url);
    expect(preview?.querySelectorAll('br').length).toBe(1);
    expect(
      Array.from(dialog.querySelectorAll('div')).some(
        (element) => element.textContent === url,
      ),
    ).toBe(true);
    expect(getByRole('img', { name: 'QR Code' }).tagName).toBe('CANVAS');
    expect(dialog.closest('.legacy-ui')?.parentElement).toBe(document.body);
    expect(container.querySelector('#qr-invite-overlay')).toBeNull();

    for (const button of dialog.querySelectorAll('button')) {
      expect(button.type).toBe('button');
      expect(button.style.minHeight).toBe('44px');
    }
  });

  it('初始焦點落在關閉鈕', async () => {
    const { getByRole } = mount();
    await waitFor(() => {
      expect(document.activeElement).toBe(getByRole('button', { name: '關閉' }));
    });
  });

  it('Esc 只關閉一次並先釋放返回鍵登記', async () => {
    const onClose = vi.fn(() => {
      expect(release).toHaveBeenCalledTimes(1);
    });
    const { getByRole } = mount(onClose);
    await waitFor(() => expect(pushOverlay).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(getByRole('button', { name: '關閉' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('點卡片與標題不關閉，點遮罩本身才關閉', () => {
    const { getByRole, getByText, onClose } = mount();
    fireEvent.click(getByRole('dialog'));
    fireEvent.click(getByText(`${teamName} 邀請加入`));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(requiredElement('#qr-invite-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('點關閉鈕關閉並在卸載時避免重複釋放', () => {
    const { getByRole, onClose, unmount } = mount();
    fireEvent.click(getByRole('button', { name: '關閉' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('返回鍵回呼關閉並回傳 true，重複呼叫不重入', async () => {
    const { onClose } = mount();
    await waitFor(() => expect(pushOverlay).toHaveBeenCalledTimes(1));
    const onBack = vi.mocked(pushOverlay).mock.calls[0]?.[0];
    if (!onBack) throw new Error('未登記返回鍵回呼');

    act(() => {
      expect(onBack()).toBe(true);
      expect(onBack()).toBe(true);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('使用最新的 onClose 且不重新登記返回鍵', async () => {
    const previousClose = vi.fn();
    const nextClose = vi.fn();
    const { rerender } = mount(previousClose);
    await waitFor(() => expect(pushOverlay).toHaveBeenCalledTimes(1));

    rerender(
      <TeamInviteQrOverlay
        teamId={teamId}
        teamName={teamName}
        onClose={nextClose}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(previousClose).not.toHaveBeenCalled();
    expect(nextClose).toHaveBeenCalledTimes(1);
    expect(pushOverlay).toHaveBeenCalledTimes(1);
  });

  it('卸載時釋放登記、移除 Esc 監聽並還原開啟前焦點', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    try {
      const { getByRole, unmount, onClose } = mount();
      await waitFor(() => {
        expect(document.activeElement).toBe(getByRole('button', { name: '關閉' }));
      });
      unmount();
      expect(release).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(opener);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      opener.remove();
    }
  });

  it('Tab 與 Shift+Tab 在兩顆按鈕間循環且阻止預設行為', async () => {
    const { getByRole } = mount();
    const first = getByRole('button', { name: '複製邀請' });
    const last = getByRole('button', { name: '關閉' });
    await waitFor(() => expect(document.activeElement).toBe(last));

    const forward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      last.dispatchEvent(forward);
    });
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    const backward = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      first.dispatchEvent(backward);
    });
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('只呼叫一次本機 QR renderer 並在它清除尺寸後恢復 200px', async () => {
    vi.mocked(renderQrToCanvas).mockImplementation(async (canvas) => {
      canvas.style.removeProperty('width');
      canvas.style.removeProperty('height');
    });
    const { getByRole, queryByRole } = mount();
    const canvas = getByRole('img', { name: 'QR Code' });

    await waitFor(() => {
      expect(renderQrToCanvas).toHaveBeenCalledTimes(1);
      expect(renderQrToCanvas).toHaveBeenCalledWith(canvas, url);
      expect(canvas.style.width).toBe('200px');
      expect(canvas.style.height).toBe('200px');
    });
    expect(queryByRole('alert')).toBeNull();
  });

  it('QR 還在產生時不顯示額外文字', async () => {
    let resolveQr: (() => void) | undefined;
    vi.mocked(renderQrToCanvas).mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveQr = resolve;
      }),
    );
    mount();
    await waitFor(() => expect(renderQrToCanvas).toHaveBeenCalledTimes(1));
    expect(requiredElement('#qr-invite-target').textContent).toBe('');
    await act(async () => {
      resolveQr?.();
    });
  });

  it('本機 QR 拒絕時顯示錯誤警示', async () => {
    vi.mocked(renderQrToCanvas).mockRejectedValueOnce(new Error('產生失敗'));
    const { findByRole } = mount();
    expect((await findByRole('alert')).textContent).toBe('QR Code 載入失敗');
  });

  it('空 teamId 不產生 QR 並顯示錯誤', () => {
    const { getByRole } = render(
      <TeamInviteQrOverlay teamId="" teamName={teamName} onClose={vi.fn()} />,
    );
    expect(getByRole('alert').textContent).toBe('QR Code 載入失敗');
    expect(renderQrToCanvas).not.toHaveBeenCalled();
  });

  it('成功與失敗流程皆無 fetch、圖片、第三方網址或新增 script', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const scriptsBefore = Array.from(document.querySelectorAll('script'));

    const success = mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderQrToCanvas).toHaveBeenCalledTimes(1);
    expect(success.container.ownerDocument.body.querySelector('img')).toBeNull();
    success.unmount();

    vi.mocked(renderQrToCanvas).mockRejectedValueOnce(new Error('本機失敗'));
    const failure = mount();
    await failure.findByRole('alert');
    const body = failure.container.ownerDocument.body;

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(body.querySelector('img')).toBeNull();
    expect(body.innerHTML).not.toMatch(/qrserver|jsdelivr/i);
    expect(
      document.querySelectorAll(
        '[src*="qrserver"], [href*="qrserver"], [src*="jsdelivr"], [href*="jsdelivr"]',
      ).length,
    ).toBe(0);
    expect(Array.from(document.querySelectorAll('script'))).toEqual(scriptsBefore);
  });

  it('卸載後 QR 才拒絕也不新增錯誤 DOM', async () => {
    let rejectQr: ((reason: Error) => void) | undefined;
    vi.mocked(renderQrToCanvas).mockImplementation(
      () => new Promise<void>((_resolve, reject) => {
        rejectQr = reject;
      }),
    );
    const { unmount } = mount();
    await waitFor(() => expect(renderQrToCanvas).toHaveBeenCalledTimes(1));
    unmount();

    await act(async () => {
      rejectQr?.(new Error('延後失敗'));
      await Promise.resolve();
    });
    expect(document.querySelector('#qr-invite-overlay')).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('俱樂部邀請複製與分享', () => {
  it('剪貼簿成功時複製完整文案並顯示成功提示', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const { getByRole } = mount();
    fireEvent.click(getByRole('button', { name: '複製邀請' }));

    await waitFor(() => {
      expect(toast.show).toHaveBeenCalledWith({
        message: '邀請內容已複製',
        tone: 'success',
      });
    });
    expect(writeText).toHaveBeenCalledWith(shareText);
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('剪貼簿拒絕後用隱藏唯讀 textarea 複製並清理', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('拒絕')) });
    const selectSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'select');
    const execCommand = vi.fn(() => {
      const textarea = requiredElement<HTMLTextAreaElement>('textarea');
      expect(textarea.value).toBe(shareText);
      expect(textarea.readOnly).toBe(true);
      expect(textarea.style.position).toBe('fixed');
      expect(textarea.style.left).toBe('-9999px');
      expect(textarea.style.top).toBe('0px');
      expect(textarea.style.opacity).toBe('0');
      return true;
    });
    setExecCommand(execCommand);
    const { getByRole } = mount();
    fireEvent.click(getByRole('button', { name: '複製邀請' }));

    await waitFor(() => {
      expect(toast.show).toHaveBeenCalledWith({
        message: '邀請內容已複製',
        tone: 'success',
      });
    });
    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('剪貼簿與 fallback 都失敗時顯示失敗提示', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('拒絕')) });
    setExecCommand(vi.fn(() => false));
    const { getByRole } = mount();
    fireEvent.click(getByRole('button', { name: '複製邀請' }));

    await waitFor(() => {
      expect(toast.show).toHaveBeenCalledWith({
        message: '複製失敗',
        tone: 'error',
      });
    });
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('沒有剪貼簿且 execCommand 拋錯時仍清理並顯示失敗', async () => {
    setExecCommand(vi.fn(() => {
      throw new Error('不支援');
    }));
    const { getByRole } = mount();
    fireEvent.click(getByRole('button', { name: '複製邀請' }));

    await waitFor(() => {
      expect(toast.show).toHaveBeenCalledWith({
        message: '複製失敗',
        tone: 'error',
      });
    });
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('支援原生分享時顯示分享邀請並只分享完整文案', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setShare(share);
    setClipboard({ writeText });
    const { getByRole } = mount();

    await act(async () => {
      fireEvent.click(getByRole('button', { name: '分享邀請' }));
    });
    expect(share).toHaveBeenCalledWith({ text: shareText });
    expect(writeText).not.toHaveBeenCalled();
    expect(document.execCommand).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('使用者取消原生分享時靜默返回且不複製', async () => {
    const share = vi.fn().mockRejectedValue(
      new DOMException('取消分享', 'AbortError'),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    setShare(share);
    setClipboard({ writeText });
    const { getByRole } = mount();

    await act(async () => {
      fireEvent.click(getByRole('button', { name: '分享邀請' }));
    });
    expect(share).toHaveBeenCalledWith({ text: shareText });
    expect(writeText).not.toHaveBeenCalled();
    expect(document.execCommand).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('原生分享發生其他錯誤時繼續複製', async () => {
    setShare(vi.fn().mockRejectedValue(new Error('分享失敗')));
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const { getByRole } = mount();
    fireEvent.click(getByRole('button', { name: '分享邀請' }));

    await waitFor(() => {
      expect(toast.show).toHaveBeenCalledWith({
        message: '邀請內容已複製',
        tone: 'success',
      });
    });
    expect(writeText).toHaveBeenCalledWith(shareText);
  });
});
