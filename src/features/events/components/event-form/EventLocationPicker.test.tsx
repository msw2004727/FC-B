import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityGeocodeResult } from '../../data/activity-map-config';

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  geocode: vi.fn(),
  release: vi.fn(),
  back: null as null | (() => boolean),
}));

vi.mock('../../data/activity-map-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/activity-map-config')>();
  return {
    ...actual,
    ensureEventLocationGoogleMapsLoaded: mocks.ensure,
    getActivityGoogleMaps: () => ({
      Geocoder: class {
        geocode = mocks.geocode;
      },
    }),
  };
});

vi.mock('@/core/overlay-back', () => ({
  pushOverlay: (callback: () => boolean) => {
    mocks.back = callback;
    return mocks.release;
  },
}));

import { EventLocationPicker } from './EventLocationPicker';

let originalGeolocationDescriptor: PropertyDescriptor | undefined;

function setGeolocation(value: Geolocation): void {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value,
  });
}

function mount(initial = {
  lat: null as number | null,
  lng: null as number | null,
  mapAddress: '',
  mapPlaceId: '',
}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const rendered = render(
    <EventLocationPicker
      locationText="場地"
      initial={initial}
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
  return { ...rendered, onConfirm, onClose };
}

function input(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(id);
  return element;
}

beforeEach(() => {
  originalGeolocationDescriptor = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
  document.documentElement.lang = 'zh-TW';
  vi.resetAllMocks();
  mocks.back = null;
  mocks.ensure.mockResolvedValue(false);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('禁止連網')));
  const host = document.createElement('div');
  host.className = 'legacy-ui';
  host.dataset.testHost = '1';
  document.body.appendChild(host);
});

afterEach(() => {
  try {
    cleanup();
    document.querySelector('[data-test-host]')?.remove();
    document.body.classList.remove('modal-open');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  } finally {
    if (originalGeolocationDescriptor) {
      Object.defineProperty(navigator, 'geolocation', originalGeolocationDescriptor);
    } else {
      Reflect.deleteProperty(navigator, 'geolocation');
    }
  }
});

describe('A 選點器', () => {
  it('DOM、初始文字、portal 與沒有金鑰的搜尋提示', async () => {
    mount();
    const overlay = document.getElementById('event-location-picker-overlay');
    expect(overlay?.parentElement?.classList.contains('legacy-ui')).toBe(true);
    expect(overlay?.className).toBe('event-location-picker-overlay open');
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('設定地圖座標');
    expect(screen.getByText('確認後，此活動才會出現在附近活動地圖')).toBeTruthy();
    expect(screen.getByText(
      '輸入座標後即可確認。若已設定 Google Maps key，也可以搜尋地點。',
    )).toBeTruthy();
    expect(input('event-location-lat').value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    await screen.findByText('尚未設定 Google Maps key，可手動輸入座標後確認');
    expect(document.getElementById('event-location-result')?.dataset.state).toBe('muted');
    expect(mocks.geocode).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('沒有金鑰仍能手動確認，使用者地址作為資料而非 HTML', () => {
    const { onConfirm, onClose } = mount();
    fireEvent.input(input('event-location-address'), {
      target: { value: '<img src=x onerror=alert(1)>' },
    });
    fireEvent.input(input('event-location-lat'), { target: { value: '25.026' } });
    fireEvent.input(input('event-location-lng'), { target: { value: '121.543' } });
    fireEvent.click(screen.getByRole('button', { name: '確認此位置' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      lat: 25.026,
      lng: 121.543,
      mapAddress: '<img src=x onerror=alert(1)>',
      mapPlaceId: '',
      mapProvider: 'manual',
    }));
    expect(document.querySelector('img')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('照 A：空白座標先 Number，確認得到 0,0；超出範圍拒絕', () => {
    const first = mount();
    fireEvent.click(screen.getByRole('button', { name: '確認此位置' }));
    expect(first.onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      lat: 0, lng: 0,
    }));
    first.unmount();
    const second = mount();
    fireEvent.input(input('event-location-lat'), { target: { value: '91' } });
    fireEvent.click(screen.getByRole('button', { name: '確認此位置' }));
    expect(screen.getByText('請輸入合法的緯度與經度')).toBeTruthy();
    expect(second.onConfirm).not.toHaveBeenCalled();
  });

  it('搜尋空白不載入 Google', () => {
    mount();
    fireEvent.input(input('event-location-query'), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    expect(screen.getByText('請先輸入地點名稱或地址')).toBeTruthy();
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('地理編碼帶入六位座標與 placeId', async () => {
    mocks.ensure.mockResolvedValue(true);
    mocks.geocode.mockImplementation((
      _request: { address: string },
      callback: (results: ActivityGeocodeResult[], status: string) => void,
    ) => callback([{
      geometry: { location: { lat: () => 25.026, lng: () => 121.543 } },
      formatted_address: '搜尋地址',
      place_id: 'place-1',
    }], 'OK'));
    const { onConfirm } = mount();
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    await screen.findByText('已帶入搜尋結果，請確認位置後儲存');
    expect(input('event-location-lat').value).toBe('25.026000');
    expect(input('event-location-lng').value).toBe('121.543000');
    fireEvent.click(screen.getByRole('button', { name: '確認此位置' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      mapAddress: '搜尋地址',
      mapPlaceId: 'place-1',
      mapProvider: 'google',
    }));
  });

  it('手動編輯地址清除舊 placeId', () => {
    const { onConfirm } = mount({
      lat: 25, lng: 121, mapAddress: '舊地址', mapPlaceId: 'old-place',
    });
    fireEvent.input(input('event-location-address'), { target: { value: '新地址' } });
    fireEvent.click(screen.getByRole('button', { name: '確認此位置' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      mapPlaceId: '', mapProvider: 'manual',
    }));
  });

  it('Google 載入失敗顯示 A 搜尋失敗提示', async () => {
    mocks.ensure.mockRejectedValue(new Error('script failed'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    await screen.findByText('找不到可靠位置，請改用手動座標或目前位置');
  });

  it('較晚返回的舊搜尋不覆蓋新搜尋', async () => {
    mocks.ensure.mockResolvedValue(true);
    const callbacks: ((results: ActivityGeocodeResult[], status: string) => void)[] = [];
    mocks.geocode.mockImplementation((
      _request: { address: string },
      callback: (results: ActivityGeocodeResult[], status: string) => void,
    ) => callbacks.push(callback));
    mount();
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    await waitFor(() => expect(callbacks).toHaveLength(1));
    fireEvent.input(input('event-location-query'), { target: { value: '新場地' } });
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    await waitFor(() => expect(callbacks).toHaveLength(2));

    const result = (address: string): ActivityGeocodeResult[] => [{
      geometry: { location: { lat: () => 25, lng: () => 121 } },
      formatted_address: address,
    }];
    await act(async () => callbacks[1]!(result('新地址'), 'OK'));
    await act(async () => callbacks[0]!(result('舊地址'), 'OK'));
    expect(input('event-location-address').value).toBe('新地址');
  });

  it('卸載後搜尋回覆不影響重新開啟的視窗', async () => {
    mocks.ensure.mockResolvedValue(true);
    let finish!: (results: ActivityGeocodeResult[], status: string) => void;
    mocks.geocode.mockImplementation((
      _request: { address: string },
      callback: typeof finish,
    ) => { finish = callback; });
    const first = mount();
    fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
    await waitFor(() => expect(mocks.geocode).toHaveBeenCalledTimes(1));
    first.unmount();
    mount();
    await act(async () => finish([{
      geometry: { location: { lat: () => 25, lng: () => 121 } },
      formatted_address: '過期地址',
    }], 'OK'));
    expect(input('event-location-address').value).toBe('場地');
  });

  it('目前位置採 A 選項，成功後填入座標', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 24.5, longitude: 120.5 },
      } as GeolocationPosition);
    });
    setGeolocation({
      getCurrentPosition,
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: '用目前位置作為場地' }));
    await screen.findByText('已帶入目前位置，請確認這就是活動場地後儲存');
    expect(input('event-location-lat').value).toBe('24.500000');
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 },
    );
  });

  it('定位拒絕顯示 A 錯誤', async () => {
    setGeolocation({
      getCurrentPosition: vi.fn((
        _success: PositionCallback,
        failure?: PositionErrorCallback | null,
      ) => {
        failure?.({ code: 1, message: 'denied' } as GeolocationPositionError);
      }),
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: '用目前位置作為場地' }));
    await screen.findByText('無法取得目前位置，請手動輸入座標');
  });

  it('返回鍵、取消、外層點擊及卸載釋放 overlay', () => {
    const first = mount();
    act(() => expect(mocks.back?.()).toBe(true));
    expect(first.onClose).toHaveBeenCalledTimes(1);
    first.unmount();
    expect(mocks.release).toHaveBeenCalledTimes(1);

    const second = mount();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(second.onClose).toHaveBeenCalledTimes(1);
    second.unmount();

    const third = mount();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(third.onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.getElementById('event-location-picker-overlay')!);
    expect(third.onClose).toHaveBeenCalledTimes(1);
  });
});
