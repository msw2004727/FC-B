import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { emit } from '@/core/events';
import type { ViewerView } from '../../data/viewer';
import { createGuestViewer, createMinimalViewer } from '../../data/viewer';
import { UidQrModal } from './UidQrModal';

const mockViewerState: { current: ViewerView } = {
  current: createGuestViewer(),
};

const mockRolesState: { current: Record<string, string> } = {
  current: {},
};

const mockRenderQrToCanvas = vi.fn<
  (canvas: HTMLCanvasElement, text: string) => Promise<void>
>();

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string) => key,
}));

vi.mock('../../data/viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/viewer')>();
  return {
    ...actual,
    useViewer: () => mockViewerState.current,
  };
});

vi.mock('@/data/user-roles', () => ({
  useUserRoles: () => mockRolesState.current,
  loadUserRoles: vi.fn(async () => mockRolesState.current),
  getCachedUserLevel: vi.fn(() => undefined),
}));

vi.mock('../../data/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/qr')>();
  return {
    ...actual,
    renderQrToCanvas: (canvas: HTMLCanvasElement, text: string) =>
      mockRenderQrToCanvas(canvas, text),
  };
});

beforeEach(() => {
  localStorage.clear();
  mockViewerState.current = createGuestViewer();
  mockRolesState.current = {};
  mockRenderQrToCanvas.mockReset();
  mockRenderQrToCanvas.mockImplementation(async (canvas) => {
    canvas.dataset.rendered = '1';
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('UidQrModal (M-025, M-026, M-029, U-005, U-006)', () => {
  it('opens on qr:open event and hides raw UID + copy button for regular user (M-025, M-026)', async () => {
    const uid = 'U1234567890abcdef1234567890abcdef';
    mockViewerState.current = {
      ...createMinimalViewer(uid),
      role: 'user',
    };
    mockRolesState.current = { [uid]: 'user' };

    const { container, queryByText } = render(<UidQrModal />);
    const modal = container.querySelector<HTMLElement>('#uid-qr-modal');
    expect(modal?.style.display).toBe('none');

    await act(() => {
      emit('qr:open', {});
    });

    expect(modal?.style.display).toBe('flex');
    await waitFor(() => {
      expect(mockRenderQrToCanvas).toHaveBeenCalledTimes(1);
    });
    expect(mockRenderQrToCanvas.mock.calls[0]?.[1]).toBe(uid);

    expect(queryByText('我的簽到 QR Code')).not.toBeNull();
    expect(queryByText('我的 UID QR Code')).toBeNull();
    expect(queryByText(uid)).toBeNull();
    expect(queryByText('複製 UID')).toBeNull();
  });

  it('shows raw UID and copy button for admin role (M-026)', async () => {
    const uid = 'Uadmin999999999999999999999999999';
    mockViewerState.current = {
      ...createMinimalViewer(uid),
      role: 'admin',
    };
    mockRolesState.current = { [uid]: 'admin' };

    const { queryByText } = render(<UidQrModal defaultOpen />);

    await waitFor(() => {
      expect(mockRenderQrToCanvas).toHaveBeenCalledTimes(1);
    });

    expect(queryByText('我的 UID QR Code')).not.toBeNull();
    expect(queryByText(uid)).not.toBeNull();
    expect(queryByText('複製 UID')).not.toBeNull();
  });

  it('shows login prompt and LINE login button for guest instead of invalid UID error (M-029, U-006)', async () => {
    mockViewerState.current = createGuestViewer();
    const onLogin = vi.fn();

    const { getByText, queryByText } = render(
      <UidQrModal user={null} onLogin={onLogin} defaultOpen />,
    );

    expect(getByText('登入後即可顯示簽到 QR Code')).not.toBeNull();
    expect(queryByText('無法生成 QR Code（UID 無效）')).toBeNull();

    const loginBtn = getByText('LINE 登入');
    await act(() => {
      fireEvent.click(loginBtn);
    });
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(mockRenderQrToCanvas).not.toHaveBeenCalled();
  });

  it('displays local error when local QR generation fails and never calls external URLs (R-SHARE-013)', async () => {
    const uid = 'Ufail0000000000000000000000000000';
    mockViewerState.current = createMinimalViewer(uid);
    mockRenderQrToCanvas.mockRejectedValueOnce(new Error('local qr failed'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { container, findByRole } = render(<UidQrModal defaultOpen />);

    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('無法生成 QR Code');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.querySelectorAll('img').length).toBe(0);
    expect(container.innerHTML).not.toContain(uid);
  });

  it('does not close when clicking inside QR content, closes on ✕ button and overlay backdrop (U-005)', async () => {
    const uid = 'Uclick000000000000000000000000000';
    mockViewerState.current = createMinimalViewer(uid);

    const { container, getByLabelText } = render(<UidQrModal defaultOpen />);
    const modal = container.querySelector<HTMLElement>('#uid-qr-modal')!;
    const content = container.querySelector<HTMLElement>('#uid-qr-content')!;
    const qrCanvasWrap = container.querySelector<HTMLElement>('#uid-qr-canvas')!;

    expect(modal.style.display).toBe('flex');

    await act(() => {
      fireEvent.click(content);
      fireEvent.click(qrCanvasWrap);
    });
    expect(modal.style.display).toBe('flex');

    const closeBtn = getByLabelText('關閉');
    await act(() => {
      fireEvent.click(closeBtn);
    });
    expect(modal.style.display).toBe('none');

    await act(() => {
      emit('qr:open', {});
    });
    expect(modal.style.display).toBe('flex');

    await act(() => {
      fireEvent.click(modal);
    });
    expect(modal.style.display).toBe('none');
  });

  it('requests Screen Wake Lock on open and releases on close; gracefully skips when unsupported (U-005)', async () => {
    const uid = 'Uwake0000000000000000000000000000';
    mockViewerState.current = createMinimalViewer(uid);

    const releaseMock = vi.fn(async () => undefined);
    const requestMock = vi.fn(async () => ({ release: releaseMock }));
    const originalWakeLock = (navigator as unknown as { wakeLock?: unknown }).wakeLock;

    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: requestMock },
    });

    try {
      const { getByLabelText } = render(<UidQrModal defaultOpen />);
      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith('screen');
      });

      await act(() => {
        fireEvent.click(getByLabelText('關閉'));
      });
      await waitFor(() => {
        expect(releaseMock).toHaveBeenCalledTimes(1);
      });

      // 移除 wakeLock 驗證不支援時不報錯
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: undefined,
      });

      await act(() => {
        emit('qr:open', {});
      });
    } finally {
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: originalWakeLock,
      });
    }
  });
});
