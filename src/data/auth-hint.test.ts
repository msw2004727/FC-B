import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_HINT_KEY, readAuthHint, writeAuthHint } from './auth-hint';

describe('auth-hint', () => {
  afterEach(() => localStorage.clear());

  it('登入寫入 1、登出移除；不存 UID', () => {
    writeAuthHint(true);
    expect(localStorage.getItem(AUTH_HINT_KEY)).toBe('1');
    expect(readAuthHint()).toBe(true);
    writeAuthHint(false);
    expect(localStorage.getItem(AUTH_HINT_KEY)).toBeNull();
    expect(readAuthHint()).toBe(false);
  });
});
