import { describe, expect, it } from 'vitest';
import {
  LoginRedirectingError,
  buildCleanLoginRedirectUri,
  isLoginRedirectingError,
  isMobileExternalBrowser,
} from './auth';

describe('LINE 登入導向（M-036）', () => {
  it('回跳網址照 A 清掉 OAuth 參數、保留其他查詢', () => {
    expect(
      buildCleanLoginRedirectUri('https://x.test/events/e1?code=a&state=b&liffClientId=c&tab=2'),
    ).toBe('https://x.test/events/e1?tab=2');
  });

  it('照 A：不在 LINE App 內的手機才算外部瀏覽器', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari';
    expect(isMobileExternalBrowser(false, iphone)).toBe(true);
    expect(isMobileExternalBrowser(true, iphone)).toBe(false);
    expect(isMobileExternalBrowser(false, 'Mozilla/5.0 (Windows NT 10.0) Chrome')).toBe(false);
  });

  it('重導向中不算登入失敗', () => {
    expect(isLoginRedirectingError(new LoginRedirectingError())).toBe(true);
    expect(isLoginRedirectingError(new Error('x'))).toBe(false);
  });
});
