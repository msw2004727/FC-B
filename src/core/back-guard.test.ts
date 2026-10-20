import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetBackGuardForTest,
  initBackGuard,
  isAuthRequiredRoute,
  markHistoryRoot,
  normalizeRoutePath,
  shouldInstallBootSentinel,
} from './back-guard';

function setUserAgent(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

describe('back-guard（M-034、M-037、M-045、M-046）', () => {
  const originalUa = navigator.userAgent;

  afterEach(() => {
    _resetBackGuardForTest();
    setUserAgent(originalUa);
    history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  it('需要登入的頁面照 A AUTH_REQUIRED_PAGES（個人、訊息）', () => {
    expect(isAuthRequiredRoute('/profile')).toBe(true);
    expect(isAuthRequiredRoute('/inbox?tab=1')).toBe(true);
    expect(isAuthRequiredRoute('page-messages')).toBe(true);
    expect(isAuthRequiredRoute('/profile/abc')).toBe(false);
    expect(isAuthRequiredRoute('/activities')).toBe(false);
  });

  it('normalizeRoutePath 去掉查詢與錨點', () => {
    expect(normalizeRoutePath('/teams?x=1#a')).toBe('/teams');
    expect(normalizeRoutePath('')).toBe('/');
    expect(normalizeRoutePath('teams')).toBe('/teams');
  });

  it('markHistoryRoot 保留原本的 state 並加上起點標記', () => {
    history.replaceState({ keep: 1 }, '', '/activities');
    markHistoryRoot();
    expect(history.state).toEqual({ keep: 1, __fcbRoot: true });
    expect(location.pathname).toBe('/activities');
  });

  it('一般瀏覽器不裝哨兵，只標記起點', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/130');
    const push = vi.spyOn(history, 'pushState');
    history.replaceState(null, '', '/events/e1');
    const stop = initBackGuard();
    expect(push).not.toHaveBeenCalled();
    expect(history.state).toEqual({ __fcbRoot: true });
    stop();
  });

  it('LINE 內照 A 雙寫：第一筆改成首頁哨兵，再推回目前頁；退到哨兵時補推一筆', () => {
    setUserAgent('Mozilla/5.0 (iPhone) Line/14.0.0');
    expect(shouldInstallBootSentinel()).toBe(true);
    history.replaceState(null, '', '/events/e1');
    const replace = vi.spyOn(history, 'replaceState');
    const push = vi.spyOn(history, 'pushState');
    const stop = initBackGuard();
    expect(replace.mock.calls[0]?.[0]).toEqual({ source: 'sportshub', sentinel: true });
    expect(replace.mock.calls[0]?.[2]).toBe('/');
    expect(push.mock.calls[0]?.[2]).toContain('/events/e1');

    window.dispatchEvent(
      new PopStateEvent('popstate', { state: { source: 'sportshub', sentinel: true } }),
    );
    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[1]?.[0]).toEqual({ source: 'sportshub', sentinel: true });

    window.dispatchEvent(new PopStateEvent('popstate', { state: { other: true } }));
    expect(push).toHaveBeenCalledTimes(2);
    stop();
  });
});
