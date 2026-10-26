import { cleanup } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebase = vi.hoisted(() => ({
  getApp: vi.fn(),
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getFirebaseCore: vi.fn(),
  /** getFirebaseCore() 給的 db；斷言 doc() 拿到的就是它（不是另外 getFirestore() 建的）。 */
  coreDb: { name: 'core-db' },
}));

vi.mock('firebase/app', () => ({ getApp: firebase.getApp }));
vi.mock('firebase/firestore', () => ({
  getFirestore: firebase.getFirestore,
  doc: firebase.doc,
  getDoc: firebase.getDoc,
}));
vi.mock('@/data/firebase', () => ({ getFirebaseCore: firebase.getFirebaseCore }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  document.documentElement.lang = 'zh-TW';
  history.replaceState(null, '', '/');
  firebase.getApp.mockReturnValue({});
  firebase.getFirestore.mockReturnValue({ name: 'direct-db' });
  firebase.doc.mockReturnValue({});
  firebase.getFirebaseCore.mockResolvedValue({ app: {}, db: firebase.coreDb });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('禁止連網')));
  vi.stubGlobal('google', undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

describe('runtime-config', () => {
  it('只讀同網域設定，合併進行中的請求並快取成功金鑰', async () => {
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      finish = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);
    const config = await import('./activity-map-config');
    const first = config.getActivityMapGoogleApiKey();
    const second = config.getActivityMapGoogleApiKey();
    finish({
      ok: true,
      json: async () => ({
        googleMapsBrowserApiKey: ' test-key ',
        googleMapsVersion: 'weekly',
        unrelated: 'ignored',
      }),
    } as Response);
    expect(await first).toBe('test-key');
    expect(await second).toBe('test-key');
    expect(await config.getActivityMapGoogleApiKey()).toBe('test-key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/runtime-config.json', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
  });

  it('失敗後可重試，空金鑰不新增 Google script', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ swEnabled: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ googleMapsBrowserApiKey: 'later' }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const append = vi.spyOn(document.head, 'appendChild');
    const config = await import('./activity-map-config');
    expect(await config.getActivityMapGoogleApiKey()).toBe('');
    expect(await config.ensureEventLocationGoogleMapsLoaded()).toBe(false);
    expect(append).not.toHaveBeenCalled();
    expect(await config.getActivityMapGoogleApiKey()).toBe('later');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('HTTP 與 JSON 失敗都回空字串', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new Error('invalid json'); },
      }));
    const config = await import('./activity-map-config');
    expect(await config.getActivityMapGoogleApiKey()).toBe('');
    expect(await config.getActivityMapGoogleApiKey()).toBe('');
  });

  it('script 參數照 A，失敗後重新建立且不連網', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        googleMapsBrowserApiKey: 'mock-key',
        googleMapsVersion: 'weekly',
      }),
    }));
    const scripts: HTMLScriptElement[] = [];
    vi.spyOn(document.head, 'appendChild').mockImplementation(
      <T extends Node>(node: T): T => {
        scripts.push(node as unknown as HTMLScriptElement);
        return node;
      },
    );
    const config = await import('./activity-map-config');
    const first = config.ensureEventLocationGoogleMapsLoaded();
    const failed = expect(first).rejects.toThrow('Google Maps script failed');
    await vi.waitFor(() => expect(scripts).toHaveLength(1));
    const script = scripts[0]!;
    const url = new URL(script.src);
    expect(url.origin).toBe('https://maps.googleapis.com');
    expect(url.searchParams.get('key')).toBe('mock-key');
    expect(url.searchParams.get('v')).toBe('weekly');
    expect(url.searchParams.get('auth_referrer_policy')).toBe('origin');
    expect(script.referrerPolicy).toBe('origin');
    expect(script.async).toBe(true);
    script.dispatchEvent(new Event('error'));
    await failed;
    expect(script.onerror).toBeNull();

    const second = config.ensureEventLocationGoogleMapsLoaded();
    const concurrent = config.ensureEventLocationGoogleMapsLoaded();
    await vi.waitFor(() => expect(scripts).toHaveLength(2));
    scripts[1]!.dispatchEvent(new Event('load'));
    expect(await second).toBe(true);
    expect(await concurrent).toBe(true);
  });

  it('已有 Geocoder 時不讀 runtime-config', async () => {
    vi.stubGlobal('google', { maps: { Geocoder: class {} } });
    const config = await import('./activity-map-config');
    expect(await config.ensureEventLocationGoogleMapsLoaded()).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('featureFlags', () => {
  // 設定讀取失敗可重試（core 已成功）：getDoc 第一次丟錯 → false 且不快取，第二次成功 → true 並快取。
  it('讀失敗為 false，下一次成功可恢復並快取', async () => {
    firebase.getDoc
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ activityMapLocationPickerEnabled: true }),
      });
    const config = await import('./activity-map-config');
    const listener = vi.fn();
    const unsubscribe = config.subscribeActivityMapFeature(listener);
    expect(await config.loadActivityMapLocationPickerEnabled()).toBe(false);
    expect(config.isActivityMapLocationPickerEnabled()).toBe(false);
    expect(await config.loadActivityMapLocationPickerEnabled()).toBe(true);
    expect(await config.loadActivityMapLocationPickerEnabled()).toBe(true);
    expect(firebase.getDoc).toHaveBeenCalledTimes(2);
    expect(firebase.doc).toHaveBeenCalledWith(firebase.coreDb, 'siteConfig', 'featureFlags');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  // T-052：db 一律經 getFirebaseCore()（data/firebase.ts 的單例），不自己 getFirestore(getApp())。
  it('db 來自 getFirebaseCore()：不直接呼叫 getApp／getFirestore，core 還沒好時不查詢', async () => {
    let resolveCore!: (value: { app: object; db: object }) => void;
    firebase.getFirebaseCore.mockReturnValue(new Promise((resolve) => {
      resolveCore = resolve;
    }));
    firebase.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ activityMapLocationPickerEnabled: true }),
    });
    const config = await import('./activity-map-config');
    const loading = config.loadActivityMapLocationPickerEnabled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    // 旗標閘期間 core 還沒好：不能先繞過去建出沒有持久化設定的 Firestore
    expect(firebase.getFirebaseCore).toHaveBeenCalledOnce();
    expect(firebase.getFirestore).not.toHaveBeenCalled();
    expect(firebase.getApp).not.toHaveBeenCalled();
    expect(firebase.getDoc).not.toHaveBeenCalled();

    resolveCore({ app: {}, db: firebase.coreDb });
    expect(await loading).toBe(true);
    expect(firebase.doc).toHaveBeenCalledWith(firebase.coreDb, 'siteConfig', 'featureFlags');
    expect(firebase.getFirestore).not.toHaveBeenCalled();
    expect(firebase.getApp).not.toHaveBeenCalled();
  });

  // 注意兩種失敗不同：
  // - 「設定讀取失敗」（core 已成功、getDoc 丟錯）：不快取，下次開表單可重試——見上面「讀失敗為 false，下一次成功可恢復並快取」。
  // - 「core 初始化失敗」：真實的 getFirebaseCore() 失敗後，後續呼叫拿到的是同一個已 reject 的 Promise（data/firebase.ts 的
  //   _corePromise 不清除，T-041 §10-6），本頁不會重新初始化，也就沒有「下次成功」。這裡只釘住 map-config 自己的契約：
  //   每次都視為 false、不發出任何查詢、不快取（沒有半套的旗標狀態）。
  it('core 初始化失敗（每次都是同一個已 reject 的 Promise）：連續呼叫都回 false、不發任何查詢，本頁不會自行恢復', async () => {
    const failedCore = Promise.reject(new Error('firebase target blocked'));
    failedCore.catch(() => undefined); // 單例 Promise 一開始就是 rejected 的；先接住，避免被當成未處理的拒絕
    firebase.getFirebaseCore.mockReturnValue(failedCore);
    firebase.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ activityMapLocationPickerEnabled: true }),
    });
    const config = await import('./activity-map-config');

    expect(await config.loadActivityMapLocationPickerEnabled()).toBe(false);
    expect(await config.loadActivityMapLocationPickerEnabled()).toBe(false);
    expect(await config.loadActivityMapLocationPickerEnabled()).toBe(false);
    expect(config.isActivityMapLocationPickerEnabled()).toBe(false);
    // 每次呼叫都重新問 core（拿到同一個失敗），但從未走到查詢
    expect(firebase.getFirebaseCore).toHaveBeenCalledTimes(3);
    expect(firebase.doc).not.toHaveBeenCalled();
    expect(firebase.getDoc).not.toHaveBeenCalled();
    expect(firebase.getFirestore).not.toHaveBeenCalled();
    expect(firebase.getApp).not.toHaveBeenCalled();
  });

  it.each([false, 'true', 1, undefined])('只接受嚴格 true：%s', async (value) => {
    firebase.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ activityMapLocationPickerEnabled: value }),
    });
    const config = await import('./activity-map-config');
    expect(await config.loadActivityMapLocationPickerEnabled()).toBe(false);
    expect(await config.loadActivityMapLocationPickerEnabled()).toBe(false);
    expect(firebase.getDoc).toHaveBeenCalledTimes(1);
  });

  it('文件不存在為 false', async () => {
    firebase.getDoc.mockResolvedValue({ exists: () => false });
    const config = await import('./activity-map-config');
    expect(await config.loadActivityMapLocationPickerEnabled()).toBe(false);
  });

  it.each([
    ['http://localhost/?activityMap=1', true],
    ['http://127.0.0.1/?activityMap=1', true],
    ['http://demo.local/?activityMap=1', true],
    ['https://next.toosterx.com/?activityMap=1', false],
    ['http://localhost/?activityMap=0', false],
    ['http://localhost/', false],
  ])('診斷覆寫 %s → %s', async (href, expected) => {
    vi.stubGlobal('window', { location: { href } });
    const config = await import('./activity-map-config');
    expect(config.isActivityMapDiagnosticOverride()).toBe(expected);
    if (expected) {
      expect(await config.loadActivityMapLocationPickerEnabled()).toBe(true);
      expect(firebase.getDoc).not.toHaveBeenCalled();
    }
  });

  it('通知隔離例外，採 listener 快照', async () => {
    firebase.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ activityMapLocationPickerEnabled: true }),
    });
    const config = await import('./activity-map-config');
    const second = vi.fn();
    const late = vi.fn();
    let removeSecond = (): void => undefined;
    config.subscribeActivityMapFeature(() => {
      removeSecond();
      config.subscribeActivityMapFeature(late);
      throw new Error('listener');
    });
    removeSecond = config.subscribeActivityMapFeature(second);
    await config.loadActivityMapLocationPickerEnabled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();
  });
});

describe('A 座標工具', () => {
  it('正規化別名、範圍與文字', async () => {
    const config = await import('./activity-map-config');
    expect(config.normalizePoint({ latitude: '25', longitude: '121' }))
      .toEqual({ lat: 25, lng: 121 });
    expect(config.normalizePoint({ lat: 0, lon: 0 })).toEqual({ lat: 0, lng: 0 });
    expect(config.normalizePoint({ lat: 91, lng: 0 })).toBeNull();
    expect(config.normalizePoint({ lat: 0, lng: -181 })).toBeNull();
    expect(config.normalizePoint({ lat: '', lng: 0 })).toBeNull();
    expect(config.normalizePoint(null)).toBeNull();
    expect(config.toFiniteNumber(Infinity)).toBeNull();
    expect(config.toFiniteNumber(Symbol('invalid'))).toBeNull();
    expect(config.normalizeLocationText('  台北 \n 場地  ')).toBe('台北 場地');
    expect(config.formatPoint({ lat: 25, lng: 121 })).toBe('25.000000, 121.000000');
    expect(config.formatPoint(null)).toBe('');
  });
});
