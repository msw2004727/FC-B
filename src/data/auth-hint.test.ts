import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTH_HINT_KEY,
  AVATAR_HINT_KEY,
  readAvatarHint,
  readAuthHint,
  writeAuthHint,
  writeAvatarHint,
} from './auth-hint';

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

  it('writeAvatarHint 寫入 https 網址後 readAvatarHint 回同字串', () => {
    writeAvatarHint('https://x/a.png');
    expect(readAvatarHint()).toBe('https://x/a.png');
  });

  it('非 https 網址不寫入；直接 setItem 也讀不到', () => {
    for (const bad of ['http://x/a.png', 'javascript:alert(1)', 'data:image/png;base64,AA']) {
      writeAvatarHint(bad);
      expect(localStorage.getItem(AVATAR_HINT_KEY)).toBeNull();
      localStorage.setItem(AVATAR_HINT_KEY, bad);
      expect(readAvatarHint()).toBeNull();
    }
  });

  it('writeAvatarHint(null) 刪除紀錄', () => {
    writeAvatarHint('https://x/a.png');
    expect(readAvatarHint()).toBe('https://x/a.png');
    writeAvatarHint(null);
    expect(localStorage.getItem(AVATAR_HINT_KEY)).toBeNull();
  });

  it('writeAuthHint(false) 同時刪除頭像紀錄；writeAuthHint(true) 不動頭像紀錄', () => {
    localStorage.setItem(AVATAR_HINT_KEY, 'https://x/a.png');
    writeAuthHint(true);
    expect(localStorage.getItem(AVATAR_HINT_KEY)).toBe('https://x/a.png');
    writeAuthHint(false);
    expect(localStorage.getItem(AVATAR_HINT_KEY)).toBeNull();
  });
});
