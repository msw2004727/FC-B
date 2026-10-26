import { getFirebaseCore } from '@/data/firebase';

export interface ActivityMapPoint {
  lat: number;
  lng: number;
}

export interface ActivityGeocodeResult {
  geometry?: {
    location?: {
      lat(): number;
      lng(): number;
    };
  };
  formatted_address?: string;
  place_id?: string;
}

export interface ActivityGoogleMaps {
  Geocoder: new () => {
    geocode(
      request: { address: string },
      callback: (
        results: readonly ActivityGeocodeResult[] | null,
        status: string,
      ) => void,
    ): void;
  };
}

interface RuntimeConfig {
  apiKey: string;
  version: string;
}

let runtimeConfig: RuntimeConfig | null = null;
let runtimeRequest: Promise<RuntimeConfig> | null = null;
let featureEnabled: boolean | null = null;
let featureRequest: Promise<boolean> | null = null;
let googleRequest: Promise<boolean> | null = null;

const featureListeners = new Set<() => void>();

function notifyFeatureListeners(): void {
  // 照 A 快取旗標；隔離訂閱者錯誤。
  for (const listener of [...featureListeners]) {
    try {
      listener();
    } catch {
      // 單一訂閱者不影響其他表單。
    }
  }
}

export function subscribeActivityMapFeature(listener: () => void): () => void {
  featureListeners.add(listener);
  return () => {
    featureListeners.delete(listener);
  };
}

export function isActivityMapDiagnosticOverride(): boolean {
  // 照 A isActivityMapDiagnosticOverride。
  try {
    const url = new URL(window.location.href);
    const host = url.hostname;
    return url.searchParams.get('activityMap') === '1'
      && (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local'));
  } catch {
    return false;
  }
}

export function isActivityMapLocationPickerEnabled(): boolean {
  return isActivityMapDiagnosticOverride() || featureEnabled === true;
}

export async function loadActivityMapLocationPickerEnabled(): Promise<boolean> {
  if (isActivityMapDiagnosticOverride()) return true;
  if (featureEnabled !== null) return featureEnabled;
  if (featureRequest) return featureRequest;

  const request = (async (): Promise<boolean> => {
    let enabled = false;
    try {
      // 經 getFirebaseCore() 取 db（T-052）：app 已初始化、Firestore 尚未建立時（登入旗標閘期間），
      // 直接 getFirestore(getApp()) 會繞過 data/firebase.ts 建出沒有持久化設定的實例；
      // SDK 維持動態載入（core 已載入 firebase/firestore，這裡的 import 只是取同一份模組）。
      const { db } = await getFirebaseCore();
      const { doc, getDoc } = await import('firebase/firestore');
      const snapshot = await getDoc(doc(db, 'siteConfig', 'featureFlags'));
      const data: unknown = snapshot.exists() ? snapshot.data() : null;
      enabled = !!data
        && typeof data === 'object'
        && 'activityMapLocationPickerEnabled' in data
        && data.activityMapLocationPickerEnabled === true;
      featureEnabled = enabled;
    } catch {
      // 照 A：讀不到視為 false；不快取失敗，允許下次開表單重試。
      featureEnabled = null;
    }
    notifyFeatureListeners();
    return enabled;
  })();

  featureRequest = request;
  try {
    return await request;
  } finally {
    featureRequest = null;
  }
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (runtimeConfig?.apiKey) return runtimeConfig;
  if (runtimeRequest) return runtimeRequest;

  const request = (async (): Promise<RuntimeConfig> => {
    try {
      const response = await fetch('/runtime-config.json', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data: unknown = response.ok ? await response.json() : null;
      const record = data && typeof data === 'object'
        ? data as Record<string, unknown>
        : {};
      const apiKey = String(record.googleMapsBrowserApiKey || '').trim();
      const version = String(record.googleMapsVersion || '').trim() || 'quarterly';
      const result = { apiKey, version };
      // 照 A getActivityMapGoogleApiKey：只快取取得的金鑰，空值可重試。
      if (apiKey) runtimeConfig = result;
      return result;
    } catch {
      return { apiKey: '', version: 'quarterly' };
    }
  })();

  runtimeRequest = request;
  try {
    return await request;
  } finally {
    runtimeRequest = null;
  }
}

export async function getActivityMapGoogleApiKey(): Promise<string> {
  return (await loadRuntimeConfig()).apiKey;
}

export function getActivityGoogleMaps(): ActivityGoogleMaps | null {
  const root = window as unknown as {
    google?: { maps?: ActivityGoogleMaps };
  };
  const maps = root.google?.maps;
  return maps && typeof maps.Geocoder === 'function' ? maps : null;
}

export async function ensureEventLocationGoogleMapsLoaded(): Promise<boolean> {
  // 照 A _ensureEventLocationGoogleMapsLoaded。
  if (getActivityGoogleMaps()) return true;
  const config = await loadRuntimeConfig();
  if (!config.apiKey) return false;
  if (googleRequest) return googleRequest;

  const request = new Promise<boolean>((resolve, reject) => {
    const script = document.createElement('script');
    const params = new URLSearchParams({
      key: config.apiKey,
      v: config.version,
      auth_referrer_policy: 'origin',
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.referrerPolicy = 'origin';
    const detach = (): void => {
      script.onload = null;
      script.onerror = null;
    };
    script.onload = () => {
      detach();
      resolve(true);
    };
    script.onerror = () => {
      detach();
      script.remove();
      reject(new Error('Google Maps script failed'));
    };
    document.head.appendChild(script);
  });

  googleRequest = request;
  try {
    return await request;
  } finally {
    // 成功由 window.google 判斷；失敗可重新載入。
    googleRequest = null;
  }
}

export function normalizeLocationText(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  } catch {
    return null;
  }
}

export function normalizePoint(input: unknown): ActivityMapPoint | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const lat = toFiniteNumber(record.lat ?? record.latitude);
  const lng = toFiniteNumber(record.lng ?? record.lon ?? record.longitude);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function formatPoint(point: ActivityMapPoint | null): string {
  return point ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` : '';
}
