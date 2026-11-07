import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXTERNAL_WINDOW_NAME,
  _resetOpenExternalForTest,
  _setLocationAssignForTest,
  openExternal,
  openHttpAnchor,
  openStaticPage,
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
  try {
    delete (window.navigator as { standalone?: boolean }).standalone;
  } catch {
    /* jsdom 不允許刪時略過 */
  }
  Reflect.deleteProperty(window, 'matchMedia');
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

function anchorClick(extra: {
  defaultPrevented?: boolean;
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
} = {}): {
  preventDefault: ReturnType<typeof vi.fn>;
  defaultPrevented: boolean;
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
} {
  return {
    preventDefault: vi.fn(),
    defaultPrevented: false,
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
  };
}

/** Vitest 的 Mock 帶建構簽章，TypeScript 7 不把它當成 () => void。行為仍是同一個 mock。 */
function openAnchor(event: ReturnType<typeof anchorClick>, href: string): void {
  openHttpAnchor(event as Parameters<typeof openHttpAnchor>[0], href);
}

function spyAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  _setLocationAssignForTest(assign);
  return assign;
}

function stubMatchMedia(matchesStandalone: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matchesStandalone && query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

const LINE_URLS = [
  'https://line.me/R/ti/p/@830utvza',
  'https://liff.line.me/123-abc',
  'https://miniapp.line.me/123',
  'https://page.line.me/abc',
  'https://lin.ee/abc',
];

describe('openHttpAnchor', () => {
  it('http(s) 阻止預設並開共用分頁；line: 不攔', () => {
    stubUa(CHROME);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const httpEvent = anchorClick();
    openAnchor(httpEvent, 'https://example.com/a');
    expect(httpEvent.preventDefault).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
    const lineEvent = anchorClick();
    openAnchor(lineEvent, 'line://ti/p/abc');
    expect(lineEvent.preventDefault).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledOnce();
  });

  it('defaultPrevented、非左鍵、修飾鍵直接返回', () => {
    stubUa(CHROME);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    for (const extra of [
      { defaultPrevented: true },
      { button: 1 },
      { button: 2 },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      const event = anchorClick(extra);
      openAnchor(event, 'https://example.com/a');
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('同源不攔截，留給站內換頁', () => {
    stubUa(CHROME);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const event = anchorClick();
    openAnchor(event, `${location.origin}/events/ce_1`);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('LINE 自家網址留在 LINE', () => {
  it.each([
    ['一般瀏覽器', CHROME],
    ['LINE 內建瀏覽器', LINE_IAB],
    ['Mini App', LINE_LIFF],
  ] as const)('%s：openExternal 整頁 assign，不加 openExternalBrowser、不 openWindow', (_label, ua) => {
    stubUa(ua);
    const openWindow = vi.fn();
    setExternalLiffGetter(() => ({ isInClient: () => ua === LINE_LIFF, openWindow }));
    const assign = spyAssign();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    for (const url of LINE_URLS) openExternal(url);
    expect(assign.mock.calls.map((call) => call[0])).toEqual(LINE_URLS);
    expect(open).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
    for (const url of assign.mock.calls.map((call) => String(call[0]))) {
      expect(url).not.toContain('openExternalBrowser');
    }
  });

  it.each([
    ['一般瀏覽器', CHROME],
    ['LINE 內建瀏覽器', LINE_IAB],
    ['Mini App', LINE_LIFF],
  ] as const)('%s：openHttpAnchor 不 preventDefault', (_label, ua) => {
    stubUa(ua);
    setExternalLiffGetter(() => ({ isInClient: () => true, openWindow: vi.fn() }));
    const assign = spyAssign();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    for (const url of LINE_URLS) {
      const event = anchorClick();
      openAnchor(event, url);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(assign).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('同源不是外連', () => {
  it('輪播連本站活動頁：openExternal 同分頁 assign，不開外連視窗', () => {
    stubUa(LINE_IAB);
    const openWindow = vi.fn();
    setExternalLiffGetter(() => ({ isInClient: () => true, openWindow }));
    const assign = spyAssign();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const href = `${location.origin}/events/ce_1?x=1#go`;
    openExternal(href);
    expect(assign).toHaveBeenCalledWith(href);
    expect(open).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });
});

describe('openExternalBrowser 字串拼接', () => {
  it('保留 %20 與沒有等號的 query，加在 hash 前', () => {
    stubUa(LINE_IAB);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('https://example.com/a?q=hello%20world#top');
    openExternal('https://example.com/a?a#z');
    openExternal('https://example.com/a?b=1&c=2#top');
    expect(open.mock.calls.map((call) => call[0])).toEqual([
      'https://example.com/a?q=hello%20world&openExternalBrowser=1#top',
      'https://example.com/a?a&openExternalBrowser=1#z',
      'https://example.com/a?b=1&c=2&openExternalBrowser=1#top',
    ]);
  });
});

describe('openStaticPage', () => {
  it('一般瀏覽器整頁 assign', () => {
    stubUa(CHROME);
    const assign = spyAssign();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openStaticPage('/manual.html');
    expect(assign).toHaveBeenCalledWith('/manual.html');
    expect(open).not.toHaveBeenCalled();
  });

  it('Mini App 另開並帶 noopener', () => {
    stubUa(LINE_LIFF);
    const assign = spyAssign();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openStaticPage('/roles/');
    expect(open).toHaveBeenCalledWith('/roles/', '_blank', 'noopener,noreferrer');
    expect(assign).not.toHaveBeenCalled();
  });

  it('PWA display-mode standalone 另開', () => {
    stubUa(CHROME);
    stubMatchMedia(true);
    const assign = spyAssign();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openStaticPage('/privacy');
    expect(open).toHaveBeenCalledWith('/privacy', '_blank', 'noopener,noreferrer');
    expect(assign).not.toHaveBeenCalled();
  });

  it('navigator.standalone 另開', () => {
    stubUa(CHROME);
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true });
    const assign = spyAssign();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openStaticPage('/terms');
    expect(open).toHaveBeenCalledWith('/terms', '_blank', 'noopener,noreferrer');
    expect(assign).not.toHaveBeenCalled();
  });
});
