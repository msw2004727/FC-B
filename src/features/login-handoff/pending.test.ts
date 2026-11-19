import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOGIN_HANDOFF_STORAGE_KEY } from './flag';
import { PENDING_DISCARD_MS, clearPending, readPending, writePending } from './pending';

const SECRET = 'ab'.repeat(32);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('pending', () => {
  it('寫入後讀得回', () => {
    const createdAt = Date.now();
    writePending({ secret: SECRET, createdAt });
    expect(readPending()).toEqual({ secret: SECRET, createdAt });
  });

  it('壞格式、secret 不是 64 位小寫 hex、createdAt 非有限數字都刪除', () => {
    localStorage.setItem(LOGIN_HANDOFF_STORAGE_KEY, '{');
    expect(readPending()).toBeNull();
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toBeNull();

    localStorage.setItem(LOGIN_HANDOFF_STORAGE_KEY, JSON.stringify({ secret: 'ZZ', createdAt: 1 }));
    expect(readPending()).toBeNull();
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toBeNull();

    localStorage.setItem(LOGIN_HANDOFF_STORAGE_KEY, JSON.stringify({ secret: 'AB'.repeat(32), createdAt: 1 }));
    expect(readPending()).toBeNull();

    localStorage.setItem(
      LOGIN_HANDOFF_STORAGE_KEY,
      `{"secret":"${SECRET}","createdAt":"1"}`,
    );
    expect(readPending()).toBeNull();
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toBeNull();
  });

  it('超過 6 分鐘丟棄，剛好 6 分鐘還留著', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    writePending({ secret: SECRET, createdAt: Date.now() });
    vi.setSystemTime(Date.now() + PENDING_DISCARD_MS);
    expect(readPending()?.secret).toBe(SECRET);
    vi.setSystemTime(Date.now() + 1);
    expect(readPending()).toBeNull();
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toBeNull();
  });

  it('storage 丟例外不崩', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('get');
    });
    expect(readPending()).toBeNull();
    vi.restoreAllMocks();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('set');
    });
    expect(() => writePending({ secret: SECRET, createdAt: 1 })).not.toThrow();
    vi.restoreAllMocks();

    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('remove');
    });
    expect(() => clearPending()).not.toThrow();
  });
});
