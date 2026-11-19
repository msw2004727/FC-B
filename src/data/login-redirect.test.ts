import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetAutoLoginSuppressForTest,
  buildCleanLoginRedirectUri,
  carryLoginRedirectParams,
  consumeAutoLoginSuppressed,
  hasLoginCancelParams,
  hasLoginRedirectParams,
  isAutoLoginSuppressedThisPage,
  isLikelyMiniAppUserAgent,
  markAutoLoginSuppressed,
} from './login-redirect';

describe('Mini App UA（預先初始化用，判斷不出就不算）', () => {
  it('要同時有 Line/ 與獨立的 LIFF', () => {
    expect(isLikelyMiniAppUserAgent('Mozilla/5.0 Line/14.18.0 LIFF')).toBe(true);
    expect(isLikelyMiniAppUserAgent('Mozilla/5.0 line/14.18.0 LIFF')).toBe(true);
    expect(isLikelyMiniAppUserAgent('Mozilla/5.0 Line/14.18.0')).toBe(false);
    expect(isLikelyMiniAppUserAgent('Mozilla/5.0 Chrome/130 LIFF')).toBe(false);
    expect(isLikelyMiniAppUserAgent('Mozilla/5.0 Chrome/130')).toBe(false);
    expect(isLikelyMiniAppUserAgent('')).toBe(false);
  });
});

describe('自動登入略過旗標', () => {
  afterEach(() => {
    _resetAutoLoginSuppressForTest();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('寫入 sessionStorage 並設這一頁的記憶體旗標；讀一次就刪', () => {
    markAutoLoginSuppressed('logout');
    expect(sessionStorage.getItem('fcb:suppress-auto-login')).toBe('logout');
    expect(isAutoLoginSuppressedThisPage()).toBe(true);
    expect(consumeAutoLoginSuppressed()).toBe(true);
    expect(sessionStorage.getItem('fcb:suppress-auto-login')).toBeNull();
  });

  it('sessionStorage 寫不進去：退回記憶體旗標，這一頁仍有效（Grok 第三輪 P3）', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    markAutoLoginSuppressed('cancel');
    expect(isAutoLoginSuppressedThisPage()).toBe(true);
    expect(consumeAutoLoginSuppressed()).toBe(true);
  });

  it('沒有旗標：回 false', () => {
    expect(consumeAutoLoginSuppressed()).toBe(false);
  });
});

describe('buildCleanLoginRedirectUri 清掉 liff.state（Grok 交叉審查 P2）', () => {
  it('只有 liff.state 的網址清完後不再算回跳', () => {
    const clean = buildCleanLoginRedirectUri('https://x.test/?liff.state=%2Fevents%2Fabc&tab=2');
    expect(clean).toBe('https://x.test/?tab=2');
    expect(hasLoginRedirectParams(clean)).toBe(false);
  });
});

describe('carryLoginRedirectParams（分享連結改寫保留回跳參數，Grok 交叉審查 P2）', () => {
  it('來源帶 code／liffClientId 時帶到目的網址', () => {
    expect(carryLoginRedirectParams('/?event=abc&code=c&state=s&liffClientId=x', '/events/abc'))
      .toBe('/events/abc?code=c&state=s&liffClientId=x');
  });

  it('來源帶 liff.state 時一併帶過去', () => {
    expect(carryLoginRedirectParams('/?team=t1&liff.state=%2Fx', '/teams/t1'))
      .toBe('/teams/t1?liff.state=%2Fx');
  });

  it('沒有回跳參數：原樣回傳目的網址', () => {
    expect(carryLoginRedirectParams('/?event=abc&utm_source=line', '/events/abc')).toBe('/events/abc');
  });
});

describe('hasLoginCancelParams（在 LINE 授權頁取消）', () => {
  it.each([
    ['https://x.test/?error=access_denied&error_description=x&state=s&liffClientId=c', true],
    ['https://x.test/?error=access_denied', false],
    ['https://x.test/?code=a&liffClientId=c', false],
    ['not a url', false],
  ])('%s → %s', (href, expected) => {
    expect(hasLoginCancelParams(href)).toBe(expected);
  });
});

describe('hasLoginRedirectParams（LINE 授權回跳網址）', () => {
  it.each([
    ['https://x.test/?code=a&state=b&liffClientId=c', true],
    ['https://x.test/events/e1?code=a&liffClientId=c&tab=2', true],
    ['https://x.test/?liff.state=%2Fevents%2Fabc', true],
    ['https://x.test/', false],
    ['https://x.test/?code=a', false],
    ['https://x.test/?event=abc123', false],
    ['https://x.test/?error=access_denied&state=b', false],
    ['not a url', false],
  ])('%s → %s', (href, expected) => {
    expect(hasLoginRedirectParams(href)).toBe(expected);
  });
});
