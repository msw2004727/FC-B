import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  saveSportPrefs,
  registerSportPrefsMock,
  clearSportPrefsMocks,
  SportPrefsCallError,
} from './callables';

describe('sport-prefs/callables', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
    clearSportPrefsMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    clearSportPrefsMocks();
  });

  it('只送白名單鍵，多餘鍵不會進 mock 收到的 data', async () => {
    let received: Record<string, unknown> | null = null;
    registerSportPrefsMock((data) => {
      received = data;
      return { favSports: ['football'], newEventNotify: true };
    });
    const req = {
      addSports: ['football'],
      removeSport: 'basketball',
      newEventNotify: true,
      promptSeen: true as const,
      // 白名單之外的鍵（以物件轉型傳入）
      extra: 'should-not-leak',
    };
    const result = await saveSportPrefs(req as unknown as Parameters<typeof saveSportPrefs>[0]);
    expect(received).toEqual({
      addSports: ['football'],
      removeSport: 'basketball',
      newEventNotify: true,
      promptSeen: true,
    });
    expect(received).not.toHaveProperty('extra');
    expect(result).toEqual({ favSports: ['football'], newEventNotify: true });
  });

  it('undefined 欄位不會進請求物件', async () => {
    let received: Record<string, unknown> | null = null;
    registerSportPrefsMock((data) => {
      received = data;
      return { favSports: [], newEventNotify: true };
    });
    await saveSportPrefs({ addSports: ['football'] });
    expect(received).toEqual({ addSports: ['football'] });
  });

  it('回應型別不對 → internal', async () => {
    registerSportPrefsMock(() => ({ favSports: 'no', newEventNotify: true }));
    await expect(saveSportPrefs({})).rejects.toMatchObject({ code: 'internal' });
    await expect(saveSportPrefs({})).rejects.toBeInstanceOf(SportPrefsCallError);

    registerSportPrefsMock(() => ({ favSports: [1, 2], newEventNotify: true }));
    await expect(saveSportPrefs({})).rejects.toMatchObject({ code: 'internal' });

    registerSportPrefsMock(() => ({ favSports: [], newEventNotify: 'yes' }));
    await expect(saveSportPrefs({})).rejects.toMatchObject({ code: 'internal' });

    registerSportPrefsMock(() => null);
    await expect(saveSportPrefs({})).rejects.toMatchObject({ code: 'internal' });

    registerSportPrefsMock(() => 'whatever');
    await expect(saveSportPrefs({})).rejects.toMatchObject({ code: 'internal' });
  });

  it('mock 模式呼叫註冊的處理器', async () => {
    const handler = vi.fn(() => ({ favSports: [], newEventNotify: true }));
    registerSportPrefsMock(handler);
    const res = await saveSportPrefs({ addSports: ['football'] });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ favSports: [], newEventNotify: true });
  });

  it('mock 模式沒註冊 → internal', async () => {
    clearSportPrefsMocks();
    await expect(saveSportPrefs({})).rejects.toMatchObject({ code: 'internal' });
  });
});
