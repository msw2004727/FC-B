import { describe, expect, it } from 'vitest';
import { hasLoginCancelParams, hasLoginRedirectParams } from './login-redirect';

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
