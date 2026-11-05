import { describe, expect, it } from 'vitest';
import { hasLoginRedirectParams } from './login-redirect';

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
