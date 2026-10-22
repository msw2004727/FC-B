import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { useLegacyT } from '@/i18n/i18n';
import {
  ensureEventLocationGoogleMapsLoaded,
  getActivityGoogleMaps,
  normalizePoint,
  type ActivityGeocodeResult,
  type ActivityMapPoint,
} from '../../data/activity-map-config';

export interface EventLocationSelection extends ActivityMapPoint {
  mapAddress: string;
  mapPlaceId: string;
  mapProvider: 'google' | 'manual';
  mapLocationUpdatedAt: string;
}

export interface EventLocationPickerProps {
  locationText: string;
  initial: {
    lat: number | null;
    lng: number | null;
    mapAddress: string;
    mapPlaceId: string;
  };
  onConfirm(selection: EventLocationSelection): void;
  onClose(): void;
}

const INITIAL_MESSAGE =
  '輸入座標後即可確認。若已設定 Google Maps key，也可以搜尋地點。';

export function EventLocationPicker({
  locationText,
  initial,
  onConfirm,
  onClose,
}: EventLocationPickerProps): JSX.Element {
  const lt = useLegacyT();
  const [query, setQuery] = useState(locationText.trim());
  const [address, setAddress] = useState(initial.mapAddress || locationText);
  // ASSUMPTION: A 對 null 使用 String(null) 後由 number input 清空；
  // 受控輸入直接使用空字串，保留實際畫面與確認時 Number('') 的行為。
  const [lat, setLat] = useState(initial.lat === null ? '' : String(initial.lat));
  const [lng, setLng] = useState(initial.lng === null ? '' : String(initial.lng));
  const placeId = useRef(initial.mapPlaceId);
  const [result, setResult] = useState({ text: INITIAL_MESSAGE, state: '' });
  const alive = useRef(false);
  const operation = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const [portalHost] = useState(() => {
    const existing = document.querySelector<HTMLElement>('.legacy-ui');
    const element = existing || document.createElement('div');
    if (!existing) element.className = 'legacy-ui';
    return { element, owned: !existing };
  });

  useEffect(() => {
    alive.current = true;
    if (portalHost.owned) document.body.appendChild(portalHost.element);
    // 照 A openEventLocationPicker；不移除外層表單已有的鎖捲動狀態。
    const bodyWasOpen = document.body.classList.contains('modal-open');
    document.body.classList.add('modal-open');
    const release = pushOverlay(() => {
      alive.current = false;
      operation.current += 1;
      closeRef.current();
      return true;
    });
    return () => {
      alive.current = false;
      operation.current += 1;
      release();
      if (!bodyWasOpen) document.body.classList.remove('modal-open');
      if (portalHost.owned) portalHost.element.remove();
    };
  }, [portalHost]);

  function close(): void {
    alive.current = false;
    operation.current += 1;
    onClose();
  }

  function manuallyEdited(): void {
    // 照 A _ensureEventLocationPickerRoot：手動編輯清除 placeId。
    placeId.current = '';
    operation.current += 1;
  }

  async function search(): Promise<void> {
    const text = query.trim();
    const request = ++operation.current;
    if (!text) {
      setResult({ text: '請先輸入地點名稱或地址', state: 'error' });
      return;
    }
    setResult({ text: '搜尋中...', state: 'loading' });
    placeId.current = '';
    try {
      const loaded = await ensureEventLocationGoogleMapsLoaded();
      if (!alive.current || request !== operation.current) return;
      const maps = getActivityGoogleMaps();
      if (!loaded || !maps) {
        setResult({
          text: '尚未設定 Google Maps key，可手動輸入座標後確認',
          state: 'muted',
        });
        return;
      }
      const found = await new Promise<ActivityGeocodeResult>((resolve, reject) => {
        new maps.Geocoder().geocode({ address: text }, (results, status) => {
          const first = results?.[0];
          if (status === 'OK' && first) resolve(first);
          else reject(new Error(status || 'NO_RESULTS'));
        });
      });
      if (!alive.current || request !== operation.current) return;
      const location = found.geometry?.location;
      const point = normalizePoint(location
        ? { lat: location.lat(), lng: location.lng() }
        : null);
      if (!point) throw new Error('INVALID_GEOCODE_POINT');
      setLat(point.lat.toFixed(6));
      setLng(point.lng.toFixed(6));
      setAddress(found.formatted_address || text);
      placeId.current = found.place_id || '';
      setResult({ text: '已帶入搜尋結果，請確認位置後儲存', state: 'ready' });
    } catch {
      if (!alive.current || request !== operation.current) return;
      setResult({
        text: '找不到可靠位置，請改用手動座標或目前位置',
        state: 'error',
      });
    }
  }

  async function useCurrentPosition(): Promise<void> {
    const request = ++operation.current;
    if (!navigator.geolocation) {
      setResult({ text: '此裝置不支援定位，請手動輸入座標', state: 'error' });
      return;
    }
    setResult({
      text: '定位只會用來填入活動場地座標，不會儲存你的目前位置紀錄。取得中...',
      state: 'loading',
    });
    try {
      const point = await new Promise<ActivityMapPoint>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const normalized = normalizePoint({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            });
            if (normalized) resolve(normalized);
            else reject(new Error('invalid current location'));
          },
          reject,
          { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 },
        );
      });
      if (!alive.current || request !== operation.current) return;
      setLat(point.lat.toFixed(6));
      setLng(point.lng.toFixed(6));
      // 照 A useCurrentPositionForEventLocation：不額外清除既有 placeId。
      setResult({
        text: '已帶入目前位置，請確認這就是活動場地後儲存',
        state: 'ready',
      });
    } catch {
      if (!alive.current || request !== operation.current) return;
      setResult({ text: '無法取得目前位置，請手動輸入座標', state: 'error' });
    }
  }

  function confirm(): void {
    // 照 A _getEventLocationPickerPoint：先 Number，再驗證範圍。
    const point = normalizePoint({ lat: Number(lat), lng: Number(lng) });
    if (!point) {
      setResult({ text: '請輸入合法的緯度與經度', state: 'error' });
      return;
    }
    onConfirm({
      ...point,
      mapAddress: (address || locationText).trim(),
      mapPlaceId: placeId.current,
      mapProvider: placeId.current ? 'google' : 'manual',
      mapLocationUpdatedAt: new Date().toISOString(),
    });
    placeId.current = '';
    close();
  }

  return createPortal(
    <div
      id="event-location-picker-overlay"
      class="event-location-picker-overlay open"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        class="event-location-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={lt('設定地圖座標', '設定地圖座標')}
      >
        <div class="event-location-picker-header">
          <div>
            <div class="event-location-picker-title">
              {lt('設定地圖座標', '設定地圖座標')}
            </div>
            <div class="event-location-picker-subtitle">
              {lt('確認後，此活動才會出現在附近活動地圖', '確認後，此活動才會出現在附近活動地圖')}
            </div>
          </div>
          <button
            type="button"
            class="event-location-picker-close"
            onClick={close}
            aria-label={lt('關閉', '關閉')}
          >
            {lt('×', '×')}
          </button>
        </div>
        <div class="event-location-picker-body">
          <label class="event-location-picker-field">
            <span>{lt('搜尋地點', '搜尋地點')}</span>
            <div class="event-location-search-row">
              <input
                type="text"
                id="event-location-query"
                placeholder={lt('輸入場地名稱或地址', '輸入場地名稱或地址')}
                value={query}
                onInput={(event) => {
                  operation.current += 1;
                  setQuery(event.currentTarget.value);
                }}
              />
              <button type="button" class="outline-btn small" onClick={search}>
                {lt('搜尋', '搜尋')}
              </button>
            </div>
          </label>
          <label class="event-location-picker-field">
            <span>{lt('確認地址', '確認地址')}</span>
            <input
              type="text"
              id="event-location-address"
              placeholder={lt('例：台北市大安運動中心', '例：台北市大安運動中心')}
              value={address}
              onInput={(event) => {
                manuallyEdited();
                setAddress(event.currentTarget.value);
              }}
            />
          </label>
          <div class="event-location-coordinate-row">
            <label class="event-location-picker-field">
              <span>{lt('緯度', '緯度')}</span>
              <input
                type="number"
                id="event-location-lat"
                inputMode="decimal"
                step="0.000001"
                placeholder={lt('25.026000', '25.026000')}
                value={lat}
                onInput={(event) => {
                  manuallyEdited();
                  setLat(event.currentTarget.value);
                }}
              />
            </label>
            <label class="event-location-picker-field">
              <span>{lt('經度', '經度')}</span>
              <input
                type="number"
                id="event-location-lng"
                inputMode="decimal"
                step="0.000001"
                placeholder={lt('121.543000', '121.543000')}
                value={lng}
                onInput={(event) => {
                  manuallyEdited();
                  setLng(event.currentTarget.value);
                }}
              />
            </label>
          </div>
          <div
            id="event-location-result"
            class="event-location-result"
            aria-live="polite"
            data-state={result.state}
          >
            {lt(result.text, result.text)}
          </div>
          <button
            type="button"
            class="event-location-current-btn"
            onClick={useCurrentPosition}
          >
            {lt('用目前位置作為場地', '用目前位置作為場地')}
          </button>
        </div>
        <div class="event-location-picker-actions">
          <button type="button" class="outline-btn" onClick={close}>
            {lt('取消', '取消')}
          </button>
          <button type="button" class="primary-btn" onClick={confirm}>
            {lt('確認此位置', '確認此位置')}
          </button>
        </div>
      </div>
    </div>,
    portalHost.element,
  );
}
