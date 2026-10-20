import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import type { ViewerView } from '../data/viewer';
import { createGuestViewer, createMinimalViewer } from '../data/viewer';
import QrPage from './QrPage';

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

vi.mock('../data/viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/viewer')>();
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

vi.mock('../data/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/qr')>();
  return {
    ...actual,
    renderQrToCanvas: (canvas: HTMLCanvasElement, text: string) =>
      mockRenderQrToCanvas(canvas, text),
  };
});

beforeEach(() => {
  mockViewerState.current = createGuestViewer();
  mockRolesState.current = {};
  mockRenderQrToCanvas.mockReset();
  mockRenderQrToCanvas.mockImplementation(async (canvas) => {
    canvas.dataset.rendered = '1';
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('QrPage (/profile/qr legacy #page-qrcode DOM, M-028)', () => {
  it('renders legacy #page-qrcode structure and hides raw UID text for regular user', async () => {
    const uid = 'Uuser1234567890abcdef1234567890ab';
    mockViewerState.current = createMinimalViewer(uid);
    mockRolesState.current = { [uid]: 'user' };

    const { container, queryByText } = render(
      <LocationProvider>
        <QrPage />
      </LocationProvider>,
    );

    expect(container.querySelector('.legacy-ui section#page-qrcode')).not.toBeNull();
    expect(container.querySelector('#page-qrcode .page-header .back-btn')).not.toBeNull();
    expect(container.querySelector('#page-qrcode .page-header h2')?.textContent).toBe(
      '我的 QR Code',
    );
    expect(container.querySelector('#page-qr-canvas.qr-box')).not.toBeNull();

    await waitFor(() => {
      expect(mockRenderQrToCanvas).toHaveBeenCalledTimes(1);
    });

    expect(container.querySelector('#page-qr-uid')?.textContent).toBe('簽到 QR Code');
    expect(queryByText('掃碼查看個人資料卡片')).not.toBeNull();
    expect(queryByText(uid)).toBeNull();
  });

  it('shows raw UID in #page-qr-uid for admin role', async () => {
    const uid = 'Uadmin1234567890abcdef1234567890a';
    mockViewerState.current = {
      ...createMinimalViewer(uid),
      role: 'admin',
    };
    mockRolesState.current = { [uid]: 'admin' };

    const { container } = render(
      <LocationProvider>
        <QrPage />
      </LocationProvider>,
    );

    await waitFor(() => {
      expect(mockRenderQrToCanvas).toHaveBeenCalledTimes(1);
    });

    expect(container.querySelector('#page-qr-uid')?.textContent).toBe(uid);
  });

  it('shows guest login prompt and LINE login button when unauthenticated', () => {
    mockViewerState.current = createGuestViewer();

    const { getByText } = render(
      <LocationProvider>
        <QrPage />
      </LocationProvider>,
    );

    expect(getByText('登入後即可顯示簽到 QR Code')).not.toBeNull();
    expect(getByText('LINE 登入')).not.toBeNull();
    expect(mockRenderQrToCanvas).not.toHaveBeenCalled();
  });
});
