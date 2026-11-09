// 推播通知設定資料層：與 A／Rules 的 key 清單一致、未設定預設開、讀取失敗丟錯、只寫 notificationToggles（merge）。
import { beforeEach, describe, expect, it } from 'vitest';

import { ALL_FALSE, OTHER_APIS, resetNotifStore, sdk, store } from '../notif-test-utils';
import {
  canEnterNotifSettings,
  canToggleNotifSettings,
  loadNotifToggles,
  NOTIF_TOGGLE_ALLOWED_KEYS,
  NotifWriteError,
  resolveNotifToggles,
  saveNotifToggles,
  validateNotifToggles,
} from './notif-toggles';

const deps = {
  getFirebase: async () => ({ db: {} as never }),
  loadSdk: async () => sdk as never,
};

function actor(codes: string[], uid: string | null = 'U1') {
  return { uid, hasPermission: (c: string) => codes.includes(c) };
}

beforeEach(() => resetNotifStore());

describe('key 清單（照 A NOTIF_TOGGLE_ALLOWED_KEYS 與 Rules notificationToggleAllowedKeys()）', () => {
  it('9 個 key、順序一致', () => {
    expect([...NOTIF_TOGGLE_ALLOWED_KEYS]).toEqual([
      'category_activity',
      'category_system',
      'category_tournament',
      'type_signup_success',
      'type_cancel_signup',
      'type_waitlist_demoted',
      'type_event_relisted',
      'type_role_upgrade',
      'type_welcome',
    ]);
  });
});

describe('resolveNotifToggles（A：currentToggles[key] !== false）', () => {
  it('未設定、非 false 的值都視為開啟；只有 false 是關閉', () => {
    const v = resolveNotifToggles({ category_activity: false, category_system: true, type_welcome: 'no', extra: false });
    expect(v.category_activity).toBe(false);
    expect(v.category_system).toBe(true);
    expect(v.category_tournament).toBe(true);
    expect(v.type_welcome).toBe(true);
    expect(Object.keys(v)).toEqual([...NOTIF_TOGGLE_ALLOWED_KEYS]);
  });

  it('不是物件（null、陣列、字串）＝全部開啟', () => {
    for (const raw of [null, undefined, [], 'x']) {
      expect(Object.values(resolveNotifToggles(raw)).every(Boolean)).toBe(true);
    }
  });
});

describe('loadNotifToggles', () => {
  it('讀 siteConfig/featureFlags.notificationToggles', async () => {
    resetNotifStore({ notificationToggles: { ...ALL_FALSE }, activityMapLocationPickerEnabled: true });
    expect(await loadNotifToggles(deps)).toEqual(ALL_FALSE);
    expect(sdk.doc).toHaveBeenCalledWith({}, 'siteConfig', 'featureFlags');
  });

  it('文件不存在或沒有 notificationToggles：全部預設開', async () => {
    expect(Object.values(await loadNotifToggles(deps)).every(Boolean)).toBe(true);
    resetNotifStore({ other: 1 });
    expect(Object.values(await loadNotifToggles(deps)).every(Boolean)).toBe(true);
  });

  it('讀取失敗丟錯（不可吞掉後回預設值，否則儲存會覆寫真實設定）', async () => {
    store.readErrors.push(new Error('unavailable'));
    await expect(loadNotifToggles(deps)).rejects.toThrow('unavailable');
  });
});

describe('權限判斷', () => {
  it('入口看 admin.notif.entry；修改看 admin.notif.toggle；未登入一律否', () => {
    expect(canEnterNotifSettings(actor(['admin.notif.entry']))).toBe(true);
    expect(canEnterNotifSettings(actor(['admin.notif.toggle']))).toBe(false);
    expect(canToggleNotifSettings(actor(['admin.notif.toggle']))).toBe(true);
    expect(canToggleNotifSettings(actor(['admin.notif.entry']))).toBe(false);
    expect(canEnterNotifSettings(actor(['admin.notif.entry'], null))).toBe(false);
    expect(canToggleNotifSettings(null)).toBe(false);
  });
});

describe('saveNotifToggles', () => {
  it('只寫 notificationToggles（9 個 boolean），用 setDoc merge，其他 API 一律不碰', async () => {
    const values = { ...ALL_FALSE, category_system: true };
    await saveNotifToggles(values, actor(['admin.notif.toggle']), deps);
    expect(sdk.setDoc).toHaveBeenCalledTimes(1);
    const [ref, data, opts] = sdk.setDoc.mock.calls[0]!;
    expect(ref).toEqual({ path: 'siteConfig/featureFlags' });
    expect(Object.keys(data as object)).toEqual(['notificationToggles']);
    expect(data).toEqual({ notificationToggles: values });
    expect(opts).toEqual({ merge: true });
    for (const name of OTHER_APIS) expect(sdk[name]).not.toHaveBeenCalled();
  });

  it('沒有 admin.notif.toggle（只有入口碼）：permission-denied，不寫', async () => {
    await expect(saveNotifToggles({ ...ALL_FALSE }, actor(['admin.notif.entry']), deps)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(sdk.setDoc).not.toHaveBeenCalled();
  });

  it('夾帶未允許的 key 或非 boolean 值：invalid-payload，不寫', async () => {
    const bad = { ...ALL_FALSE, extra: true } as never;
    await expect(saveNotifToggles(bad, actor(['admin.notif.toggle']), deps)).rejects.toBeInstanceOf(NotifWriteError);
    const bad2 = { ...ALL_FALSE, type_welcome: 'off' } as never;
    await expect(saveNotifToggles(bad2, actor(['admin.notif.toggle']), deps)).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(sdk.setDoc).not.toHaveBeenCalled();
    expect(validateNotifToggles([])).toBe(false);
  });

  it('寫入失敗原樣丟出', async () => {
    store.writeError = new Error('permission-denied');
    await expect(saveNotifToggles({ ...ALL_FALSE }, actor(['admin.notif.toggle']), deps)).rejects.toThrow('permission-denied');
  });
});
