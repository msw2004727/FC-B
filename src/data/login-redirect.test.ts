import { describe, expect, it } from 'vitest';
import {
  buildCleanLoginRedirectUri,
  carryLoginRedirectParams,
  hasLoginCancelParams,
  hasLoginRedirectParams,
} from './login-redirect';

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
