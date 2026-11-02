import { describe, expect, it, vi } from 'vitest';
import { isLineUserAgent, openCardLinkInLine, shouldHandleCardLink } from './open-card-link';

const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const LINE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari Line/14.18.0';

describe('shouldHandleCardLink', () => {
  it('一般瀏覽器交給 <a target=_blank>（不攔）', () => {
    expect(isLineUserAgent(CHROME)).toBe(false);
    expect(shouldHandleCardLink('https://cup.toosterx.com/', CHROME)).toBe(false);
  });

  it('LINE 內要攔下改用 LIFF 外部瀏覽器', () => {
    expect(isLineUserAgent(LINE)).toBe(true);
    expect(shouldHandleCardLink('https://cup.toosterx.com/', LINE)).toBe(true);
  });

  it('非 https 連結一律攔下（不讓預設行為開）', () => {
    expect(shouldHandleCardLink('javascript:alert(1)', CHROME)).toBe(true);
    expect(shouldHandleCardLink('http://a.com/', CHROME)).toBe(true);
  });
});

describe('openCardLinkInLine', () => {
  it('LINE 內：liff.openWindow external:true', async () => {
    const openWindow = vi.fn();
    const fallback = vi.fn();
    await openCardLinkInLine('https://cup.toosterx.com/', {
      loadLiff: async () => ({ isInClient: () => true, openWindow }),
      openWindow: fallback,
    });
    expect(openWindow).toHaveBeenCalledWith({ url: 'https://cup.toosterx.com/', external: true });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('LIFF 載入失敗或不在 LINE 客戶端：退回 window.open', async () => {
    const fallback = vi.fn();
    await openCardLinkInLine('https://cup.toosterx.com/', {
      loadLiff: async () => {
        throw new Error('no liff');
      },
      openWindow: fallback,
    });
    await openCardLinkInLine('https://cup.toosterx.com/', {
      loadLiff: async () => ({ isInClient: () => false, openWindow: vi.fn() }),
      openWindow: fallback,
    });
    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it('openWindow 丟錯（LIFF 未初始化）：退回 window.open', async () => {
    const fallback = vi.fn();
    await openCardLinkInLine('https://cup.toosterx.com/', {
      loadLiff: async () => ({
        isInClient: () => true,
        openWindow: () => {
          throw new Error('not init');
        },
      }),
      openWindow: fallback,
    });
    expect(fallback).toHaveBeenCalledWith('https://cup.toosterx.com/');
  });

  it('非 https 連結什麼都不開', async () => {
    const openWindow = vi.fn();
    const fallback = vi.fn();
    await openCardLinkInLine('javascript:alert(1)', {
      loadLiff: async () => ({ isInClient: () => true, openWindow }),
      openWindow: fallback,
    });
    expect(openWindow).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });
});
