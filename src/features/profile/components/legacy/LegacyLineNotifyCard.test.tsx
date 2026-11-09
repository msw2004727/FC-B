import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';

vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn() },
}));

vi.mock('@/ui/AppConfirm', () => ({
  appConfirm: vi.fn(),
}));

vi.mock('@/features/events/data/line-notify-bind', () => ({
  bindLineNotify: vi.fn(),
  buildLineNotifyPayload: vi.fn(),
  LINE_BOT_BASIC_ID: '@830utvza',
}));

vi.mock('../../data/line-notify-settings', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../data/line-notify-settings')
  >();
  return {
    ...actual,
    saveLineNotify: vi.fn(),
  };
});

// O-1：只 mock 取得已初始化 LIFF 的入口；line-friendship.ts 的判斷與逾時走真實程式。
vi.mock('@/data/liff-init', () => ({
  getReadyLiff: vi.fn(() => null),
}));

vi.mock('./ProfileInfoButton', () => ({
  ProfileInfoButton: ({ infoKey }: { infoKey: string }) => (
    <button type="button" data-testid={`info-btn-${infoKey}`}>
      ?
    </button>
  ),
}));

import {
  bindLineNotify,
  buildLineNotifyPayload,
} from '@/features/events/data/line-notify-bind';
import { getReadyLiff } from '@/data/liff-init';
import { setLocale } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';

import type { UserProfile } from '../../data/profile-model';
import {
  saveLineNotify,
  type LineNotifyState,
} from '../../data/line-notify-settings';
import { LegacyLineNotifyCard } from './LegacyLineNotifyCard';
import { PROFILE_INFO } from './profile-info';

function makeProfile(overrides: Record<string, unknown> = {}): UserProfile {
  return {
    uid: 'u1',
    name: 'Alice',
    _docId: 'u1',
    lastActive: null,
    displayName: 'Alice',
    ...overrides,
  };
}

const BOUND_PROFILE: UserProfile = makeProfile({
  lineNotify: {
    bound: true,
    boundAt: '2025/01/02',
    settings: { activity: true, system: false, tournament: true },
  },
});

const UNBOUND_PROFILE: UserProfile = makeProfile({
  lineNotify: { bound: false, settings: {} },
});

function expand(container: Element): void {
  const toggle = container.querySelector('.profile-collapse-toggle') as HTMLElement | null;
  if (toggle && !toggle.classList.contains('open')) {
    fireEvent.click(toggle);
  }
}

function findUnbindButton(container: Element): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button'));
  const btn = buttons.find((b) => (b.textContent || '').includes('解除綁定'));
  if (!btn) throw new Error('unbind button not found');
  return btn as HTMLButtonElement;
}

beforeEach(async () => {
  await setLocale('zh-TW');
  document.documentElement.lang = 'zh-TW';
  vi.mocked(saveLineNotify).mockReset();
  vi.mocked(saveLineNotify).mockResolvedValue(undefined);
  vi.mocked(appConfirm).mockReset();
  vi.mocked(appConfirm).mockResolvedValue(false);
  vi.mocked(bindLineNotify).mockReset();
  vi.mocked(bindLineNotify).mockResolvedValue(undefined);
  vi.mocked(buildLineNotifyPayload).mockReset();
  vi.mocked(buildLineNotifyPayload).mockReturnValue({
    lineNotify: {
      bound: true,
      boundAt: '2099/12/31',
      settings: { activity: true, system: true, tournament: false },
    },
  });
  vi.mocked(toast.show).mockReset();
  vi.mocked(getReadyLiff).mockReset();
  vi.mocked(getReadyLiff).mockReturnValue(null);
});

afterEach(() => {
  cleanup();
});

describe('LegacyLineNotifyCard — 初始顯示', () => {
  it('未綁定：徽章顯示「未綁定」且顯示綁定按鈕', () => {
    const { container } = render(
      <LegacyLineNotifyCard
        uid="u1"
        profile={UNBOUND_PROFILE}
        onSaved={() => {}}
      />,
    );
    const badge = container.querySelector('#line-notify-badge');
    expect(badge?.textContent).toBe('未綁定');
    expect(badge?.className).toContain('unbound');
    expand(container);
    expect(container.querySelector('.line-login-btn')).toBeTruthy();
    const boundDiv = container.querySelector('#line-notify-bound') as HTMLElement | null;
    expect(boundDiv?.style.display).toBe('none');
  });

  it('已綁定：徽章、名稱、時間、三個開關狀態都照 lineNotify', () => {
    const { container } = render(
      <LegacyLineNotifyCard
        uid="u1"
        profile={BOUND_PROFILE}
        onSaved={() => {}}
      />,
    );
    const badge = container.querySelector('#line-notify-badge');
    expect(badge?.textContent).toBe('已綁定');
    expect(badge?.className).toContain('bound');
    expand(container);
    expect(container.querySelector('#line-notify-name')?.textContent).toBe('Alice');
    expect(container.querySelector('#line-notify-time')?.textContent).toBe('2025/01/02');
    const cbA = container.querySelector('#line-toggle-activity') as HTMLInputElement;
    const cbS = container.querySelector('#line-toggle-system') as HTMLInputElement;
    const cbT = container.querySelector('#line-toggle-tournament') as HTMLInputElement;
    expect(cbA.checked).toBe(true);
    expect(cbS.checked).toBe(false);
    expect(cbT.checked).toBe(true);
  });

  it('displayName 空白 → LINE 帳號顯示 "-"', () => {
    const profile = makeProfile({
      displayName: '',
      lineNotify: {
        bound: true,
        boundAt: '2025/01/02',
        settings: { activity: true, system: true, tournament: false },
      },
    });
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={profile} onSaved={() => {}} />,
    );
    expand(container);
    expect(container.querySelector('#line-notify-name')?.textContent).toBe('-');
  });
});

describe('LegacyLineNotifyCard — 切換通知開關', () => {
  it('呼叫 saveLineNotify 的 payload 正確、toast「已開啟系統通知」、onSaved 被呼叫', async () => {
    const onSaved = vi.fn();
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={onSaved} />,
    );
    expand(container);
    const cb = container.querySelector('#line-toggle-system') as HTMLInputElement;
    expect(cb.checked).toBe(false);

    fireEvent.click(cb);

    expect(saveLineNotify).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(saveLineNotify).mock.calls[0]!;
    const state = payload as unknown as LineNotifyState;
    expect(state.bound).toBe(true);
    expect(state.boundAt).toBe('2025/01/02');
    expect(state.settings).toEqual({ activity: true, system: true, tournament: true });

    await waitFor(() => {
      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ message: '已開啟系統通知' }),
      );
    });
    expect(onSaved).toHaveBeenCalledWith({
      lineNotify: expect.objectContaining({
        bound: true,
        settings: { activity: true, system: true, tournament: true },
      }),
    });
  });

  it('切換失敗：還原開關、console.warn、不 toast', async () => {
    vi.mocked(saveLineNotify).mockRejectedValue(new Error('boom'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onSaved = vi.fn();
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={onSaved} />,
    );
    expand(container);
    const cb = container.querySelector('#line-toggle-system') as HTMLInputElement;
    expect(cb.checked).toBe(false);

    fireEvent.click(cb);

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });
    expect(cb.checked).toBe(false);
    expect(toast.show).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('重新收到新 profile 後，切換以最新 lineNotify 為基準（不覆寫 system）', () => {
    const first = makeProfile({
      lineNotify: {
        bound: true,
        boundAt: '2025/01/02',
        settings: { activity: true, system: true, tournament: false },
      },
    });
    const second = makeProfile({
      lineNotify: {
        bound: true,
        boundAt: '2025/01/02',
        settings: { activity: true, system: false, tournament: false },
      },
    });
    const onSaved = vi.fn();
    const { container, rerender } = render(
      <LegacyLineNotifyCard uid="u1" profile={first} onSaved={onSaved} />,
    );
    expand(container);

    rerender(
      <LegacyLineNotifyCard uid="u1" profile={second} onSaved={onSaved} />,
    );
    const cb = container.querySelector('#line-toggle-activity') as HTMLInputElement;
    expect(cb.checked).toBe(true);

    fireEvent.click(cb);

    expect(saveLineNotify).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(saveLineNotify).mock.calls[0]!;
    const settings = payload['settings'] as Record<string, unknown>;
    expect(settings['system']).toBe(false);
    expect(settings['activity']).toBe(false);
  });

  it('未綁定時不呼叫 saveLineNotify（防禦性）', async () => {
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={UNBOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    // 照 A DOM：已綁定區仍在 DOM 但隱藏；未綁定時點開關不寫入（A toggleLineNotify 開頭 return）。
    const boundDiv = container.querySelector('#line-notify-bound') as HTMLElement | null;
    expect(boundDiv?.style.display).toBe('none');
    const cb = container.querySelector('#line-toggle-activity') as HTMLInputElement | null;
    if (cb) fireEvent.click(cb);
    expect(saveLineNotify).not.toHaveBeenCalled();
  });
});

describe('LegacyLineNotifyCard — 解除綁定', () => {
  it('先 appConfirm；取消則不寫入', async () => {
    vi.mocked(appConfirm).mockResolvedValue(false);
    const onSaved = vi.fn();
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={onSaved} />,
    );
    expand(container);
    const btn = findUnbindButton(container);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(appConfirm).toHaveBeenCalledWith(
        '確定要解除 LINE 綁定嗎？解除後將無法收到推播通知。',
      );
    });
    // 讓 await appConfirm 的微任務有機會完成（若誤寫也不會在半路停下）
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(saveLineNotify).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('確定後寫入 buildUnboundLineNotify payload、toast、onSaved', async () => {
    vi.mocked(appConfirm).mockResolvedValue(true);
    const onSaved = vi.fn();
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={onSaved} />,
    );
    expand(container);
    const btn = findUnbindButton(container);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(saveLineNotify).toHaveBeenCalledTimes(1);
    });
    const [u, payload] = vi.mocked(saveLineNotify).mock.calls[0]!;
    expect(u).toBe('u1');
    expect(payload).toEqual({
      bound: false,
      settings: { activity: true, system: true, tournament: false },
    });
    await waitFor(() => {
      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ message: '已解除 LINE 綁定' }),
      );
    });
    expect(onSaved).toHaveBeenCalledWith({
      lineNotify: {
        bound: false,
        settings: { activity: true, system: true, tournament: false },
      },
    });
  });

  it('失敗 toast「解除綁定失敗，請稍後再試」', async () => {
    vi.mocked(appConfirm).mockResolvedValue(true);
    vi.mocked(saveLineNotify).mockRejectedValue(new Error('boom'));
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    fireEvent.click(findUnbindButton(container));

    await waitFor(() => {
      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ message: '解除綁定失敗，請稍後再試' }),
      );
    });
  });
});

describe('LegacyLineNotifyCard — 綁定 LINE', () => {
  it('點擊綁定按鈕時同步呼叫 bindLineNotify（uid、displayName、signal）', () => {
    const onSaved = vi.fn();
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={UNBOUND_PROFILE} onSaved={onSaved} />,
    );
    expand(container);
    const btn = container.querySelector('.line-login-btn') as HTMLButtonElement;
    expect(btn).toBeTruthy();

    fireEvent.click(btn);

    // 同步呼叫（handler 前無 await）
    expect(bindLineNotify).toHaveBeenCalledTimes(1);
    expect(bindLineNotify).toHaveBeenCalledWith(
      'u1',
      'Alice',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('成功後 onSaved 攜帶 buildLineNotifyPayload().lineNotify', async () => {
    const onSaved = vi.fn();
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={UNBOUND_PROFILE} onSaved={onSaved} />,
    );
    expand(container);
    const btn = container.querySelector('.line-login-btn') as HTMLButtonElement;
    fireEvent.click(btn);

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({
        lineNotify: {
          bound: true,
          boundAt: '2099/12/31',
          settings: { activity: true, system: true, tournament: false },
        },
      });
    });
  });

  it('bindLineNotify 失敗 → toast「綁定失敗，請稍後再試」', async () => {
    vi.mocked(bindLineNotify).mockRejectedValue(new Error('boom'));
    const onSaved = vi.fn();
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={UNBOUND_PROFILE} onSaved={onSaved} />,
    );
    expand(container);
    const btn = container.querySelector('.line-login-btn') as HTMLButtonElement;
    fireEvent.click(btn);

    await waitFor(() => {
      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ message: '綁定失敗，請稍後再試' }),
      );
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('displayName 空白時 bindLineNotify 收到 undefined', () => {
    const profile = makeProfile({ displayName: '' });
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={profile} onSaved={() => {}} />,
    );
    expand(container);
    const btn = container.querySelector('.line-login-btn') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(bindLineNotify).toHaveBeenCalledWith(
      'u1',
      undefined,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });
});

describe('LegacyLineNotifyCard — 11-09 文案與「收不到通知？」提示', () => {
  it('已綁定：綁定時間下方、分隔線上方出現提示列與「開啟官方帳號」按鈕', () => {
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    const hint = container.querySelector('#line-notify-friend-hint') as HTMLElement | null;
    expect(hint).toBeTruthy();
    expect(hint?.closest('#line-notify-bound')).toBeTruthy();
    expect(hint?.querySelector('span')?.textContent).toBe('收不到通知？請先加好友');
    const btn = hint?.querySelector('button.line-notify-friend-btn') as HTMLButtonElement | null;
    expect(btn?.type).toBe('button');
    expect(btn?.textContent).toBe('開啟官方帳號');
    // 位置：綁定時間那列之後、分隔線之前
    const timeRow = container.querySelector('#line-notify-time')?.parentElement;
    expect(timeRow?.nextElementSibling).toBe(hint);
    expect((hint?.nextElementSibling as HTMLElement | null)?.style.borderTop).toContain('1px solid');
  });

  it('未綁定：不顯示提示列', () => {
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={UNBOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    const hint = container.querySelector('#line-notify-friend-hint') as HTMLElement | null;
    // 已綁定區整塊隱藏（照 A 用 display:none 切換），提示列在其中
    expect(hint?.closest('#line-notify-bound')).toBeTruthy();
    expect((container.querySelector('#line-notify-bound') as HTMLElement).style.display).toBe('none');
    expect((container.querySelector('#line-notify-unbound') as HTMLElement).style.display).not.toBe('none');
  });

  it('按「開啟官方帳號」開啟加好友網址，不寫任何資料', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onSaved = vi.fn();
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={onSaved} />,
    );
    expand(container);
    fireEvent.click(container.querySelector('.line-notify-friend-btn') as HTMLButtonElement);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('https://line.me/R/ti/p/@830utvza', 'sporthub_line');
    expect(saveLineNotify).not.toHaveBeenCalled();
    expect(bindLineNotify).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('三個開關列文字照新文案，checkbox 的 aria-label 與列文字一致', () => {
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    const expected: Record<string, string> = {
      activity: '活動通知（報名、候補、異動）',
      system: '系統通知（站內信/公告）',
      tournament: '賽事通知（報名/賽程更新）',
    };
    for (const [key, text] of Object.entries(expected)) {
      const cb = container.querySelector(`#line-toggle-${key}`) as HTMLInputElement;
      expect(cb.getAttribute('aria-label')).toBe(text);
      const row = cb.closest('.line-notify-row') as HTMLElement;
      expect(row.firstElementChild?.textContent).toBe(text);
    }
  });

  it('切換活動開關的 toast 用「活動通知」', async () => {
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    fireEvent.click(container.querySelector('#line-toggle-activity') as HTMLInputElement);
    await waitFor(() => {
      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ message: '已關閉活動通知' }),
      );
    });
  });

  it('舊文案（開始前、開場前、成就徽章）不再出現在卡片與「？」說明', () => {
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    const text = container.textContent ?? '';
    const body = PROFILE_INFO.lineNotify.body;
    for (const old of ['開始前', '開場前', '成就徽章']) {
      expect(text).not.toContain(old);
      expect(body).not.toContain(old);
    }
    // 未綁定區說明「即可接收活動提醒與系統通知推播」不在本次預覽範圍，只檢查說明框
    expect(body).not.toContain('活動提醒');
    expect(body).toContain('• <b>活動通知</b> — 報名成功、候補遞補、活動異動或取消<br>');
    expect(body).toContain('• <b>系統通知</b> — 站內信、公告<br>');
    expect(body).toContain('• <b>賽事通知</b> — 賽程更新、對戰結果');
  });
});

type FakeLiff = {
  isLoggedIn: ReturnType<typeof vi.fn>;
  getFriendship: ReturnType<typeof vi.fn>;
};

function fakeLiff(friendship: () => Promise<{ friendFlag: boolean }>, loggedIn = true): FakeLiff {
  return {
    isLoggedIn: vi.fn(() => loggedIn),
    getFriendship: vi.fn(friendship),
  };
}

function useLiff(liff: FakeLiff | null): void {
  vi.mocked(getReadyLiff).mockReturnValue(
    liff as unknown as ReturnType<typeof getReadyLiff>,
  );
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

function hintOf(container: Element): HTMLElement | null {
  return container.querySelector('#line-notify-friend-hint') as HTMLElement | null;
}

describe('LegacyLineNotifyCard — O-1 自動確認有沒有加好友', () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  it('未加好友：換成警示列＋實心「加入好友」，按下開加好友頁且不寫資料', async () => {
    const liff = fakeLiff(async () => ({ friendFlag: false }));
    useLiff(liff);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onSaved = vi.fn();
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={onSaved} />,
    );
    expand(container);
    await waitFor(() => {
      expect(hintOf(container)?.classList.contains('warn')).toBe(true);
    });
    expect(liff.getFriendship).toHaveBeenCalledTimes(1);
    const hint = hintOf(container) as HTMLElement;
    expect(hint.querySelector('span')?.textContent).toBe('尚未加好友，收不到 LINE 通知');
    const btn = hint.querySelector('button.line-notify-friend-btn') as HTMLButtonElement;
    expect(btn.classList.contains('solid')).toBe(true);
    expect(btn.textContent).toBe('加入好友');
    fireEvent.click(btn);
    expect(openSpy).toHaveBeenCalledWith('https://line.me/R/ti/p/@830utvza', 'sporthub_line');
    expect(saveLineNotify).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('已加好友：整列提示不顯示', async () => {
    const liff = fakeLiff(async () => ({ friendFlag: true }));
    useLiff(liff);
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    await waitFor(() => {
      expect(hintOf(container)).toBeNull();
    });
    expect(liff.getFriendship).toHaveBeenCalledTimes(1);
  });

  it('收合時不查；未綁定時不查', () => {
    const liff = fakeLiff(async () => ({ friendFlag: false }));
    useLiff(liff);
    render(<LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={() => {}} />);
    expect(liff.getFriendship).not.toHaveBeenCalled();
    cleanup();
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={UNBOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    expect(liff.getFriendship).not.toHaveBeenCalled();
  });

  it('不在 LIFF（未初始化）：維持一般提示列', async () => {
    useLiff(null);
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    await waitFor(() => {
      expect(getReadyLiff).toHaveBeenCalled();
    });
    const hint = hintOf(container) as HTMLElement;
    expect(hint.classList.contains('warn')).toBe(false);
    expect(hint.querySelector('span')?.textContent).toBe('收不到通知？請先加好友');
    expect(hint.querySelector('button')?.textContent).toBe('開啟官方帳號');
  });

  it('LIFF 未登入：不呼叫 getFriendship，維持一般提示列', async () => {
    const liff = fakeLiff(async () => ({ friendFlag: false }), false);
    useLiff(liff);
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    await waitFor(() => {
      expect(liff.isLoggedIn).toHaveBeenCalled();
    });
    expect(liff.getFriendship).not.toHaveBeenCalled();
    expect(hintOf(container)?.classList.contains('warn')).toBe(false);
  });

  it('getFriendship 失敗：維持一般提示列，不顯示錯誤', async () => {
    const liff = fakeLiff(async () => {
      throw new Error('bot link missing');
    });
    useLiff(liff);
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    await waitFor(() => {
      expect(liff.getFriendship).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    const hint = hintOf(container) as HTMLElement;
    expect(hint.classList.contains('warn')).toBe(false);
    expect(hint.querySelector('span')?.textContent).toBe('收不到通知？請先加好友');
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('getFriendship 逾時（5 秒）：維持一般提示列', async () => {
    vi.useFakeTimers();
    const liff = fakeLiff(() => new Promise(() => {}));
    useLiff(liff);
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    expect(liff.getFriendship).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    const hint = hintOf(container) as HTMLElement;
    expect(hint.classList.contains('warn')).toBe(false);
    expect(hint.querySelector('span')?.textContent).toBe('收不到通知？請先加好友');
  });

  it('回前景：30 秒內不重查，超過 30 秒才重查；切到背景不查', async () => {
    vi.useFakeTimers();
    const liff = fakeLiff(async () => ({ friendFlag: false }));
    useLiff(liff);
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    await vi.advanceTimersByTimeAsync(0);
    expect(liff.getFriendship).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    setVisibility('hidden');
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(liff.getFriendship).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(21_000);
    setVisibility('hidden');
    expect(liff.getFriendship).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(liff.getFriendship).toHaveBeenCalledTimes(2);
  });

  it('按加好友按鈕後第一次回前景不受節流，查到已加好友就收起提示列', async () => {
    vi.useFakeTimers();
    let flag = false;
    const liff = fakeLiff(async () => ({ friendFlag: flag }));
    useLiff(liff);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { container } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    await vi.advanceTimersByTimeAsync(0);
    expect(hintOf(container)?.classList.contains('warn')).toBe(true);

    fireEvent.click(hintOf(container)?.querySelector('button') as HTMLButtonElement);
    flag = true;
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(3_000);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(liff.getFriendship).toHaveBeenCalledTimes(2);
    expect(hintOf(container)).toBeNull();
    openSpy.mockRestore();
  });

  it('unmount 後移除 visibilitychange listener，進行中的查詢結果不再更新畫面', async () => {
    const pending: { resolve?: (v: { friendFlag: boolean }) => void } = {};
    const liff = fakeLiff(
      () => new Promise<{ friendFlag: boolean }>((resolve) => {
        pending.resolve = resolve;
      }),
    );
    useLiff(liff);
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, unmount } = render(
      <LegacyLineNotifyCard uid="u1" profile={BOUND_PROFILE} onSaved={() => {}} />,
    );
    expand(container);
    expect(liff.getFriendship).toHaveBeenCalledTimes(1);
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    pending.resolve?.({ friendFlag: false });
    await Promise.resolve();
    await Promise.resolve();
    setVisibility('visible');
    expect(liff.getFriendship).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    removeSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
