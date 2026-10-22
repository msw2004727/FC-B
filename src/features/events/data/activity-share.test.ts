import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NEARBY_DISABLED_MSG,
  SHARED_TOAST_FAIL,
  SHARED_TOAST_OK,
  SHARE_TITLE,
  composeActivityRoutePath,
  getActivityShareOrigin,
  getCurrentActivityShareUrl,
  normalizeShareRegion,
  normalizeShareTab,
  normalizeShareType,
  shareCurrentActivityUrl,
} from './activity-share';

function stubKey(target: object, key: string, value: unknown): void {
  try {
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
  } catch {
    // ignore
  }
}

afterEach(() => {
  // 還原 navigator 擴充
  try { delete (navigator as unknown as { share?: unknown }).share; } catch { /* ignore */ }
  try { delete (navigator as unknown as { clipboard?: unknown }).clipboard; } catch { /* ignore */ }
});

describe('activity-share normalizers', () => {
  it('normalizes region slug and label to canonical label', () => {
    expect(normalizeShareRegion('north')).toBe('北部');
    expect(normalizeShareRegion('北部')).toBe('北部');
    expect(normalizeShareRegion('東部&amp;外島')).toBe('東部&外島');
    expect(normalizeShareRegion('unknown')).toBe('全部');
    expect(normalizeShareRegion(null)).toBe('全部');
  });

  it('normalizes tab: ended / empty -> normal; calendar / female kept', () => {
    expect(normalizeShareTab('ended')).toBe('normal');
    expect(normalizeShareTab('female')).toBe('female');
    expect(normalizeShareTab('calendar')).toBe('calendar');
    expect(normalizeShareTab('')).toBe('normal');
  });

  it('normalizes type to allowed set', () => {
    expect(normalizeShareType('play')).toBe('play');
    expect(normalizeShareType('external')).toBe('external');
    expect(normalizeShareType('invalid')).toBe('');
  });
});

describe('composeActivityRoutePath', () => {
  it('returns bare /activities when all filters are default', () => {
    expect(composeActivityRoutePath({ region: '全部', sport: 'all', tab: 'normal', type: '' })).toBe(
      '/activities',
    );
  });

  it('writes region slug + sport + type (no tab when normal)', () => {
    expect(
      composeActivityRoutePath({ region: '北部', sport: 'football', tab: 'normal', type: 'play' }),
    ).toBe('/activities?region=north&sport=football&type=play');
  });

  it('writes tab female alongside other filters', () => {
    expect(
      composeActivityRoutePath({ region: '北部', sport: 'football', tab: 'female', type: '' }),
    ).toBe('/activities?region=north&sport=football&tab=female');
  });

  it('writes tab calendar and defaults when tab is not normal', () => {
    expect(
      composeActivityRoutePath({ region: '全部', sport: 'all', tab: 'calendar', type: '' }),
    ).toBe('/activities?region=all&sport=all&tab=calendar');
  });
});

describe('getActivityShareOrigin / getCurrentActivityShareUrl', () => {
  it('returns current origin when host is local (jsdom default)', () => {
    expect(getActivityShareOrigin()).toBe(window.location.origin);
  });

  it('builds share URL from /activities + origin', () => {
    const url = getCurrentActivityShareUrl({ region: '北部', sport: 'football', tab: 'normal', type: '' });
    expect(url).toBe(`${window.location.origin}/activities?region=north&sport=football`);
  });
});

describe('shareCurrentActivityUrl', () => {
  const baseFilters = { region: '全部', sport: 'all', tab: 'normal', type: '' };

  it('uses navigator.share when available and returns true without toast', async () => {
    const shareFn = vi.fn().mockResolvedValue(undefined);
    stubKey(navigator, 'share', shareFn);
    const showToast = vi.fn();
    const ok = await shareCurrentActivityUrl(baseFilters, { showToast });
    expect(ok).toBe(true);
    expect(shareFn).toHaveBeenCalledWith({
      title: SHARE_TITLE,
      url: expect.stringContaining('/activities'),
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('returns false silently on AbortError (user cancel)', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const shareFn = vi.fn().mockRejectedValue(abortErr);
    stubKey(navigator, 'share', shareFn);
    const showToast = vi.fn();
    const ok = await shareCurrentActivityUrl(baseFilters, { showToast });
    expect(ok).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('falls back to clipboard + OK toast on non-Abort share error', async () => {
    const shareFn = vi.fn().mockRejectedValue(new Error('share failed'));
    stubKey(navigator, 'share', shareFn);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubKey(navigator, 'clipboard', { writeText });
    const showToast = vi.fn();
    const ok = await shareCurrentActivityUrl(baseFilters, { showToast });
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(SHARED_TOAST_OK);
  });

  it('shows fail toast when clipboard and execCommand both fail', async () => {
    stubKey(navigator, 'share', undefined);
    stubKey(navigator, 'clipboard', undefined);

    const originalExec = (document as unknown as { execCommand?: unknown }).execCommand;
    try {
      Object.defineProperty(document, 'execCommand', {
        value: () => { throw new Error('not implemented'); },
        configurable: true,
        writable: true,
      });
      const showToast = vi.fn();
      const ok = await shareCurrentActivityUrl(baseFilters, { showToast });
      expect(ok).toBe(false);
      expect(showToast).toHaveBeenCalledWith(SHARED_TOAST_FAIL);
    } finally {
      try {
        Object.defineProperty(document, 'execCommand', {
          value: originalExec,
          configurable: true,
          writable: true,
        });
      } catch {
        // ignore
      }
    }
  });
});

describe('NEARBY_DISABLED_MSG', () => {
  it('matches A 停用分支原文', () => {
    expect(NEARBY_DISABLED_MSG).toBe('附近活動地圖尚未開啟');
  });
});
