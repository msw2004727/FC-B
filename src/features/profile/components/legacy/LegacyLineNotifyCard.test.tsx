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
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';

import type { UserProfile } from '../../data/profile-model';
import {
  saveLineNotify,
  type LineNotifyState,
} from '../../data/line-notify-settings';
import { LegacyLineNotifyCard } from './LegacyLineNotifyCard';

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

beforeEach(() => {
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
    const state = payload as LineNotifyState;
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
