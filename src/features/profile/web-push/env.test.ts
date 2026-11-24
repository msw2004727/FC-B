import { describe, expect, it } from 'vitest';
import { isIosStandalone } from '@/data/login-redirect';
import { detectWebPushEnv, isIosStandaloneEnv, isIosUa, type WebPushEnvInput } from './env';

const FULL = { hasNotification: true, hasPushManager: true, hasServiceWorker: true };
const NONE = { hasNotification: false, hasPushManager: false, hasServiceWorker: true };

function input(ua: string, extra: Partial<WebPushEnvInput> = {}): WebPushEnvInput {
  return { ua, standalone: false, maxTouchPoints: 0, ...FULL, ...extra };
}

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  iphone17: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  iphone163: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  iphone164: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1',
  ipadMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  lineAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Line/14.19.1',
  lineIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.19.1',
  liff: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Line/14.19.1 LIFF',
  fbAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0;]',
  criOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
};

describe('E 環境判斷', () => {
  it('支援推播的瀏覽器 → capable', () => {
    for (const ua of [UA.androidChrome, UA.winChrome, UA.winEdge, UA.firefox, UA.macSafari]) {
      expect(detectWebPushEnv(input(ua)), ua).toBe('capable');
    }
  });

  it('iPhone 非主畫面 → ios-home；主畫面 → capable；iOS 16.3 → unsupported；16.4 → ios-home', () => {
    expect(detectWebPushEnv(input(UA.iphone17, { maxTouchPoints: 5, ...NONE }))).toBe('ios-home');
    expect(detectWebPushEnv(input(UA.iphone17, { maxTouchPoints: 5, standalone: true }))).toBe('capable');
    expect(detectWebPushEnv(input(UA.iphone163, { maxTouchPoints: 5, ...NONE }))).toBe('unsupported');
    expect(detectWebPushEnv(input(UA.iphone163, { maxTouchPoints: 5, standalone: true, ...NONE }))).toBe('unsupported');
    expect(detectWebPushEnv(input(UA.iphone164, { maxTouchPoints: 5, ...NONE }))).toBe('ios-home');
  });

  it('iPad 觸控 Mac UA 非主畫面 → ios-home（無觸控的 Mac 照一般桌機）', () => {
    expect(detectWebPushEnv(input(UA.ipadMac, { maxTouchPoints: 5, ...NONE }))).toBe('ios-home');
    expect(detectWebPushEnv(input(UA.ipadMac, { maxTouchPoints: 0 }))).toBe('capable');
  });

  it('LINE Android／Mini App → line-android；LINE iOS → line-ios（即使缺 API）', () => {
    expect(detectWebPushEnv(input(UA.lineAndroid, NONE))).toBe('line-android');
    expect(detectWebPushEnv(input(UA.liff, NONE))).toBe('line-android');
    expect(detectWebPushEnv(input(UA.lineIos, { maxTouchPoints: 5, ...NONE }))).toBe('line-ios');
  });

  it('FB／IG 內建瀏覽器（無 Notification）→ unsupported；iOS Chrome 非主畫面 → ios-home', () => {
    expect(detectWebPushEnv(input(UA.fbAndroid, { hasNotification: false }))).toBe('unsupported');
    expect(detectWebPushEnv(input(UA.criOS, { maxTouchPoints: 5, ...NONE }))).toBe('ios-home');
  });

  it('缺 PushManager 或 serviceWorker → unsupported', () => {
    expect(detectWebPushEnv(input(UA.winChrome, { hasPushManager: false }))).toBe('unsupported');
    expect(detectWebPushEnv(input(UA.winChrome, { hasServiceWorker: false }))).toBe('unsupported');
  });

  it('iOS 判斷與 login-redirect 的 isIosStandalone 同一條規則', () => {
    for (const ua of Object.values(UA)) {
      for (const touch of [0, 5]) {
        expect(isIosUa(ua, touch), ua).toBe(isIosStandalone(ua, true, touch));
      }
    }
    expect(isIosStandaloneEnv(input(UA.iphone17, { standalone: true, maxTouchPoints: 5 }))).toBe(true);
    expect(isIosStandaloneEnv(input(UA.androidChrome, { standalone: true }))).toBe(false);
  });
});
