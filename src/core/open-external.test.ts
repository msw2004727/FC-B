import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXTERNAL_WINDOW_NAME,
  _resetOpenExternalForTest,
  openExternal,
  openHttpAnchor,
  setExternalLiffGetter,
} from './open-external';

const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const LINE_IAB = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari Line/14.18.0';
const LINE_LIFF = `${LINE_IAB} LIFF`;

function stubUa(ua: string): void {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);
}

afterEach(() => {
  _resetOpenExternalForTest();
  vi.restoreAllMocks();
});

describe('openExternal', () => {
  it('一般瀏覽器：具名視窗、不帶 noopener、立刻清 opener', () => {
    stubUa(CHROME);
    const fake = { opener: window } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(fake);
    openExternal('https://example.com/a?b=1#top');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]).toEqual(['https://example.com/a?b=1#top', EXTERNAL_WINDOW_NAME]);
    expect(fake.opener).toBeNull();
    expect(openExternal('https://example.com/a')).toBeUndefined();
  });

  it('http 也開；非 http(s) 不開', () => {
    stubUa(CHROME);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('http://example.com/x');
    expect(open).toHaveBeenCalledWith('http://example.com/x', EXTERNAL_WINDOW_NAME);
    open.mockClear();
    for (const value of ['javascript:alert(1)', 'line://ti/p/abc', 'data:text/html,hi', 'ftp://example.com/a', '', '  ']) {
      openExternal(value);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('清 opener 被瀏覽器拒絕時不把錯誤丟出來', () => {
    stubUa(CHROME);
    const fake = {} as Window;
    Object.defineProperty(fake, 'opener', {
      configurable: true,
      get: () => window,
      set: () => {
        throw new Error('blocked');
      },
    });
    vi.spyOn(window, 'open').mockReturnValue(fake);
    expect(() => openExternal('https://example.com/a')).not.toThrow();
  });

  it('LINE 內建瀏覽器：保留 query／hash，加上 openExternalBrowser=1', () => {
    stubUa(LINE_IAB);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('https://example.com/a?b=1&c=2#top');
    expect(open).toHaveBeenCalledWith(
      'https://example.com/a?b=1&c=2&openExternalBrowser=1#top',
      EXTERNAL_WINDOW_NAME,
    );
  });

  it('Mini App 尚未初始化：即使 UA 含 LIFF 也走內建瀏覽器，不 await', () => {
    stubUa(LINE_LIFF);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('https://example.com/a');
    expect(open).toHaveBeenCalledWith(
      'https://example.com/a?openExternalBrowser=1',
      EXTERNAL_WINDOW_NAME,
    );
  });

  it('Mini App 已初始化且 isInClient：liff.openWindow external，不開窗', () => {
    stubUa(LINE_LIFF);
    const openWindow = vi.fn();
    setExternalLiffGetter(() => ({ isInClient: () => true, openWindow }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('https://example.com/a');
    expect(openWindow).toHaveBeenCalledWith({ url: 'https://example.com/a', external: true });
    expect(open).not.toHaveBeenCalled();
  });

  it('已初始化但不在 Mini App、UA 含 Line/：走內建瀏覽器', () => {
    stubUa(LINE_IAB);
    setExternalLiffGetter(() => ({ isInClient: () => false, openWindow: vi.fn() }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('https://example.com/a#z');
    expect(open).toHaveBeenCalledWith(
      'https://example.com/a?openExternalBrowser=1#z',
      EXTERNAL_WINDOW_NAME,
    );
  });

  it('openWindow 丟錯：退回一般具名視窗，不加 openExternalBrowser', () => {
    stubUa(LINE_LIFF);
    setExternalLiffGetter(() => ({
      isInClient: () => true,
      openWindow: () => {
        throw new Error('not init');
      },
    }));
    const fake = { opener: {} } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(fake);
    expect(() => openExternal('https://example.com/a?b=1')).not.toThrow();
    expect(open).toHaveBeenCalledWith('https://example.com/a?b=1', EXTERNAL_WINDOW_NAME);
    expect(String(open.mock.calls[0]?.[0])).not.toContain('openExternalBrowser');
    expect(fake.opener).toBeNull();
  });

  it('isInClient 丟錯且 UA 含 Line/：當還沒能判斷 Mini App，走內建瀏覽器', () => {
    stubUa(LINE_IAB);
    setExternalLiffGetter(() => ({
      isInClient: () => {
        throw new Error('no');
      },
      openWindow: vi.fn(),
    }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('https://example.com/a');
    expect(open.mock.calls[0]?.[0]).toContain('openExternalBrowser=1');
  });
});

describe('openHttpAnchor', () => {
  it('http(s) 阻止預設並開共用分頁；line: 不攔', () => {
    stubUa(CHROME);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const httpEvent = { preventDefault: vi.fn() };
    openHttpAnchor(httpEvent, 'https://example.com/a');
    expect(httpEvent.preventDefault).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
    const lineEvent = { preventDefault: vi.fn() };
    openHttpAnchor(lineEvent, 'line://ti/p/abc');
    expect(lineEvent.preventDefault).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledOnce();
  });
});
