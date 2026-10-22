import { h } from 'preact';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventLocationPickerProps } from './EventLocationPicker';

const state = vi.hoisted(() => ({
  enabled: true,
  failPicker: false,
  listeners: new Set<() => void>(),
  showToast: vi.fn(),
}));

vi.mock('@/ui/Toast', () => ({
  toast: {
    show: state.showToast,
  },
}));

vi.mock('../../data/activity-map-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/activity-map-config')>();
  return {
    ...actual,
    isActivityMapLocationPickerEnabled: () => state.enabled,
    loadActivityMapLocationPickerEnabled: async () => state.enabled,
    subscribeActivityMapFeature: (listener: () => void) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
  };
});

vi.mock('./EventLocationPicker', () => ({
  get EventLocationPicker() {
    if (state.failPicker) throw new Error('chunk unavailable');
    return (props: EventLocationPickerProps) => h('button', {
      type: 'button',
      onClick: () => {
        props.onConfirm({
          lat: 25,
          lng: 121,
          mapAddress: '場地',
          mapPlaceId: '',
          mapProvider: 'manual',
          mapLocationUpdatedAt: '2026-10-22T00:00:00.000Z',
        });
        props.onClose();
      },
    }, 'mock-picker');
  },
}));

import {
  buildEventLocationValue,
  emptyDraft,
  locationControlState,
  markLocationStale,
  resetLocationDraft,
  useEventLocation,
  type EventLocationDraft,
} from './use-event-location';

const now = new Date('2026-10-22T01:02:03.000Z');

function confirmed(): EventLocationDraft {
  return {
    ...emptyDraft('場地'),
    lat: 25,
    lng: 121,
    mapLocationConfirmed: true,
  };
}

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  state.enabled = true;
  state.failPicker = false;
  state.showToast.mockReset();
});

afterEach(() => {
  cleanup();
  state.listeners.clear();
  vi.restoreAllMocks();
});

describe('草稿與 payload', () => {
  it('建立、編輯、座標別名與未確認資料', () => {
    expect(emptyDraft('  場地  ').sourceLocationText).toBe('場地');
    expect(resetLocationDraft(null, '場地')).toEqual(emptyDraft('場地'));
    expect(resetLocationDraft({
      location: ' 舊場地 ',
      latitude: '25',
      longitude: '121',
      mapLocationConfirmed: true,
      mapPlaceId: ' p ',
      mapProvider: 'google',
    }, '場地')).toMatchObject({
      lat: 25,
      lng: 121,
      mapAddress: '舊場地',
      sourceLocationText: '舊場地',
      mapPlaceId: 'p',
      mapProvider: 'google',
      mapLocationUpdatedAt: null,
    });
    expect(resetLocationDraft({ lat: 25, lng: 121 }, '場地'))
      .toEqual(emptyDraft('場地'));
    expect(resetLocationDraft({
      lat: 100, lng: 121, mapLocationConfirmed: true,
    }, '場地')).toEqual(emptyDraft('場地'));
  });

  it('照 A 原樣保留 ISO 字串與 Timestamp，空值維持 null', () => {
    const timestamp = {
      toDate: vi.fn(() => new Date('2026-01-01T00:00:00.000Z')),
    };
    const values = [
      '2026-01-01T00:00:00.000Z',
      timestamp,
    ];
    for (const value of values) {
      const draft = resetLocationDraft({
        location: '場地',
        lat: 25,
        lng: 121,
        mapLocationConfirmed: true,
        mapLocationUpdatedAt: value,
      }, '場地');
      expect(draft.mapLocationUpdatedAt).toBe(value);
      expect(buildEventLocationValue(
        draft, '場地', true, true, now,
      ).mapLocationUpdatedAt).toBe(value);
    }
    expect(timestamp.toDate).not.toHaveBeenCalled();

    for (const value of [undefined, null, '']) {
      const draft = resetLocationDraft({
        location: '場地',
        lat: 25,
        lng: 121,
        mapLocationConfirmed: true,
        mapLocationUpdatedAt: value,
      }, '場地');
      expect(draft.mapLocationUpdatedAt).toBeNull();
      expect(buildEventLocationValue(
        draft, '場地', true, true, now,
      ).mapLocationUpdatedAt).toBe(now.toISOString());
    }
  });

  it('快取序列化的 Timestamp（只剩 seconds）讀入時轉成原時間的 ISO 字串（Codex 第二審 P1）', () => {
    const draft = resetLocationDraft({
      location: '場地',
      lat: 25,
      lng: 121,
      mapLocationConfirmed: true,
      mapLocationUpdatedAt: { seconds: 1767225600, nanoseconds: 0 },
    }, '場地');
    expect(draft.mapLocationUpdatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('stale 不因文字改回而恢復；空白正規化不造成 stale', () => {
    const draft = confirmed();
    expect(markLocationStale(draft, ' 場地 ')).toBe(draft);
    const stale = markLocationStale(draft, '新場地');
    expect(stale).toMatchObject({
      mapLocationConfirmed: false,
      isStale: true,
      sourceLocationText: '場地',
    });
    expect(markLocationStale(stale, '場地')).toBe(stale);
  });

  it('feature 關、GPS 關、無點與 stale 都清空七欄', () => {
    const cases: [EventLocationDraft, string, boolean, boolean][] = [
      [confirmed(), '場地', true, false],
      [confirmed(), '場地', false, true],
      [emptyDraft('場地'), '場地', true, true],
      [confirmed(), '新場地', true, true],
      [markLocationStale(confirmed(), '新場地'), '場地', true, true],
    ];
    for (const [draft, text, gps, feature] of cases) {
      expect(buildEventLocationValue(draft, text, gps, feature, now)).toEqual({
        mapPickerEnabled: feature,
        gpsEnabled: gps,
        lat: null,
        lng: null,
        mapAddress: null,
        mapPlaceId: null,
        mapProvider: null,
        mapLocationConfirmed: false,
        mapLocationUpdatedAt: null,
      });
    }
  });

  it('三個後備值及空地址後備 null', () => {
    expect(buildEventLocationValue(confirmed(), ' 場地 ', true, true, now)).toEqual({
      mapPickerEnabled: true,
      gpsEnabled: true,
      lat: 25,
      lng: 121,
      mapAddress: '場地',
      mapPlaceId: null,
      mapProvider: 'manual',
      mapLocationConfirmed: true,
      mapLocationUpdatedAt: now.toISOString(),
    });
    expect(buildEventLocationValue({
      ...confirmed(), sourceLocationText: '',
    }, '', true, true, now).mapAddress).toBeNull();
  });

  it('保留已有地址、provider、placeId 與時間', () => {
    expect(buildEventLocationValue({
      ...confirmed(),
      mapAddress: '地址',
      mapProvider: 'google',
      mapPlaceId: 'p',
      mapLocationUpdatedAt: '2026-01-01T00:00:00.000Z',
    }, '場地', true, true, now)).toMatchObject({
      mapAddress: '地址',
      mapPlaceId: 'p',
      mapProvider: 'google',
      mapLocationUpdatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('view', () => {
  it.each([
    [false, false, 'GPS功能未開啟', 'disabled'],
    [true, false, 'GPS功能未開啟', 'disabled'],
    [false, true, '地圖定位未開啟', 'disabled'],
    [true, true, '尚未設定地圖座標', 'empty'],
  ])('feature=%s gps=%s', (feature, gps, text, status) => {
    expect(locationControlState(emptyDraft(''), feature, gps)).toEqual({
      statusText: text,
      statusState: status,
      buttonText: '設定地圖座標',
      buttonDisabled: !feature,
      buttonLooksDisabled: !(feature && gps),
      summary: '',
      showClear: false,
    });
  });

  it('ready、formatPoint、地址、stale 與 disabled 的優先順序', () => {
    expect(locationControlState(confirmed(), true, true)).toMatchObject({
      statusText: '已設定地圖座標',
      statusState: 'ready',
      buttonText: '重新設定地圖座標',
      summary: '25.000000, 121.000000',
      showClear: true,
    });
    expect(locationControlState({
      ...confirmed(), mapAddress: '地址',
    }, true, true).summary).toBe('地址');
    expect(locationControlState(confirmed(), true, false)).toMatchObject({
      statusText: 'GPS功能未開啟',
      buttonText: '重新設定地圖座標',
      summary: '',
      showClear: false,
    });
    expect(locationControlState(
      markLocationStale(confirmed(), '新地點'), true, true,
    )).toMatchObject({
      statusText: '地點文字已變更，請重新確認',
      statusState: 'stale',
      buttonText: '設定地圖座標',
      showClear: false,
    });
  });
});

describe('hook', () => {
  it.each([
    [false, '', true, false, '請先至【進階功能】開啟GPS功能'],
    [true, ' ', true, false, '請先輸入地點文字'],
    [true, '場地', false, false, '地圖定位功能尚未開啟'],
    [true, '場地', true, true, '地圖定位工具載入失敗'],
  ])('入口提示：%s %s', async (gps, text, feature, fail, message) => {
    state.enabled = feature;
    state.failPicker = fail;
    const { result } = renderHook(() => useEventLocation({
      locationText: text, gpsEnabled: gps,
    }));
    await act(async () => {
      result.current.view.onOpenPicker();
    });
    await waitFor(() => {
      expect(state.showToast).toHaveBeenCalledWith({ message });
    });
    expect(result.current.picker).toBeNull();
  });

  it('開啟、確認、清除與重設', async () => {
    let current: ReturnType<typeof useEventLocation> | undefined;

    function Harness() {
      const location = useEventLocation({
        locationText: '場地',
        gpsEnabled: true,
      });
      current = location;
      return h('div', null,
        h('button', {
          type: 'button',
          onClick: location.view.onOpenPicker,
        }, 'open-picker'),
        location.picker,
      );
    }

    function getCurrent(): ReturnType<typeof useEventLocation> {
      if (!current) throw new Error('hook 尚未渲染');
      return current;
    }

    // 與正式呼叫端一樣在同一棵樹渲染 picker，讓非同步 state 更新同步到 DOM。
    render(h(Harness, null));
    fireEvent.click(screen.getByRole('button', { name: 'open-picker' }));
    const picker = await screen.findByRole('button', { name: 'mock-picker' });
    fireEvent.click(picker);

    await waitFor(() => {
      expect(getCurrent().view.statusText).toBe('已設定地圖座標');
    });
    expect(getCurrent().buildValue(now).mapProvider).toBe('manual');
    expect(state.showToast).toHaveBeenCalledWith({
      message: '已設定活動地圖座標',
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'mock-picker' })).toBeNull();
    });

    act(() => getCurrent().view.onClear());
    expect(getCurrent().view.statusText).toBe('尚未設定地圖座標');
    act(() => getCurrent().reset({
      location: '場地', lat: 25, lng: 121, mapLocationConfirmed: true,
    }));
    expect(getCurrent().view.statusText).toBe('已設定地圖座標');
    act(() => getCurrent().reset(null));
    expect(getCurrent().buildValue(now).mapLocationConfirmed).toBe(false);
  });

  it('文字改變立即 stale，改回仍需重新確認', () => {
    const { result, rerender } = renderHook(
      (props: { locationText: string; gpsEnabled: boolean }) => useEventLocation(props),
      { initialProps: { locationText: '場地', gpsEnabled: true } },
    );
    act(() => result.current.reset({
      location: '場地', lat: 25, lng: 121, mapLocationConfirmed: true,
    }));
    rerender({ locationText: '新場地', gpsEnabled: true });
    expect(result.current.view.statusState).toBe('stale');
    expect(result.current.buildValue(now).lat).toBeNull();
    rerender({ locationText: '場地', gpsEnabled: true });
    expect(result.current.view.statusState).toBe('stale');
  });

  it('訂閱旗標並在卸載清除', () => {
    const { result, unmount } = renderHook(() => useEventLocation({
      locationText: '場地', gpsEnabled: true,
    }));
    act(() => {
      state.enabled = false;
      for (const listener of state.listeners) listener();
    });
    expect(result.current.view.buttonDisabled).toBe(true);
    expect(result.current.buildValue(now).mapPickerEnabled).toBe(false);
    unmount();
    expect(state.listeners.size).toBe(0);
  });
});
