import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canUseBannersRest } from './banners-rest-guard';

// T-042c 審查退修 F1：冷啟動 REST 直接連正式 firestore.googleapis.com，會繞過 data/firebase.ts 的「本機只能連 emulator」守門。
// 這裡用真實的 shouldUseEmulator／isLocalOrPrivateHostname（不 mock），驗證 emulator 與本機／區網網址一律不發 REST。

// 不受本機 .env 的 VITE_FIREBASE_EMULATOR 影響：每個案例開始前明確設成「未啟用」。
beforeEach(() => {
  vi.stubEnv('VITE_FIREBASE_EMULATOR', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('canUseBannersRest：只有「非 emulator 且不是本機／區網網址」才可以發 REST', () => {
  it.each(['next.toosterx.com', 'toosterx.com', 'www.toosterx.com', '8.8.8.8', '172.15.0.1', '172.32.0.1', '11.0.0.1'])(
    '正式／內測站網址與公網 IP（%s）可以發',
    (host) => {
      expect(canUseBannersRest(host)).toBe(true);
    },
  );

  it.each([
    'localhost',
    'LOCALHOST',
    '127.0.0.1',
    '::1',
    '[::1]',
    '0.0.0.0',
    'dev.localhost',
    'my-mac.local',
    '10.0.0.8',
    '192.168.1.5',
    '172.16.0.1',
    '172.31.255.1',
  ])('本機與區網網址（%s）不發', (host) => {
    expect(canUseBannersRest(host)).toBe(false);
  });

  it('emulator 模式（VITE_FIREBASE_EMULATOR=1，非 PROD）：即使網址是公網也不發', () => {
    vi.stubEnv('VITE_FIREBASE_EMULATOR', '1');
    expect(canUseBannersRest('next.toosterx.com')).toBe(false);
    expect(canUseBannersRest('localhost')).toBe(false);
  });

  it('emulator 旗標不是 1（0、空字串、未設定）時，公網網址仍可以發', () => {
    for (const value of ['0', '', 'true']) {
      vi.stubEnv('VITE_FIREBASE_EMULATOR', value);
      expect(canUseBannersRest('next.toosterx.com'), value).toBe(true);
    }
  });

  it('沒給網址時讀目前頁面的 location.hostname（jsdom 是 localhost → 不發）', () => {
    expect(location.hostname).toBe('localhost');
    expect(canUseBannersRest()).toBe(false);
  });

  it('空網址（無法判斷）不視為本機：交由 emulator 旗標決定', () => {
    expect(canUseBannersRest('')).toBe(true);
    vi.stubEnv('VITE_FIREBASE_EMULATOR', '1');
    expect(canUseBannersRest('')).toBe(false);
  });
});
