// 推播通知設定頁：四身分路由守門、載入中不顯示表單、載入失敗可重試、值對應開關（含未設定預設開）、
// 儲存只寫 notificationToggles、固定送出列不可切換、儲存失敗 toast。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/firestore-sdk', async () => {
  const { sdk } = await import('../notif-test-utils');
  return { loadFirestoreSdk: async () => sdk };
});
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: {} }) }));
const state = vi.hoisted(() => ({ viewer: null as unknown, lastUid: null as string | null }));
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => state.lastUid }));
vi.mock('@/core/back-guard', () => ({ useGoBack: () => vi.fn() }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('@/features/profile/data/viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/profile/data/viewer')>();
  return { createMinimalViewer: actual.createMinimalViewer, useViewer: () => state.viewer };
});

import { setLocale } from '@/i18n/i18n';
import { createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';
import { createPermissionChecker } from '@/features/profile/data/permissions';
import { toast } from '@/ui/Toast';
import { ALL_FALSE, OTHER_APIS, resetNotifStore, sdk, store } from '../notif-test-utils';
import AdminNotifPage from './AdminNotifPage';

function viewer(
  role: string,
  opts: { rolePermissions?: Record<string, readonly string[]>; userGrants?: string[] } = {},
): ViewerView {
  return {
    uid: `U-${role}`,
    displayName: role,
    pictureUrl: null,
    role,
    roleLevel: 0,
    teamIds: new Set<string>(),
    capabilities: [],
    hasPermission: createPermissionChecker({
      role,
      rolePermissions: opts.rolePermissions ?? null,
      userGrants: opts.userGrants ?? null,
    }),
  } as ViewerView;
}

const toastShow = toast.show as unknown as ReturnType<typeof vi.fn>;

beforeAll(async () => {
  await setLocale('zh-TW');
});

beforeEach(() => {
  resetNotifStore({ notificationToggles: { ...ALL_FALSE } });
  state.lastUid = null;
});

afterEach(() => cleanup());

async function openAs(v: ViewerView): Promise<ReturnType<typeof render>> {
  state.viewer = v;
  const utils = render(<AdminNotifPage />);
  await waitFor(() => expect(utils.container.querySelector('[role="status"]')).toBeNull());
  return utils;
}

function toggle(key: string): HTMLInputElement {
  return document.querySelector(`[data-notif-toggle-key="${key}"]`) as HTMLInputElement;
}

describe('路由守門（直接輸入網址也擋；與抽屜同一判斷 admin.notif.entry）', () => {
  it.each(['user', 'coach', 'captain', 'admin'])('%s 預設沒有入口碼：權限不足、0 讀、沒有表單', async (role) => {
    await openAs(viewer(role));
    expect(screen.getByText('權限不足')).toBeTruthy();
    expect(document.querySelector('[data-notif-toggle-key]')).toBeNull();
    expect(document.getElementById('notif-settings-save-btn')).toBeNull();
    expect(sdk.getDoc).not.toHaveBeenCalled();
  });

  it('super_admin：可進、可切換、有儲存', async () => {
    await openAs(viewer('super_admin'));
    expect(screen.getByRole('heading', { name: '推播通知設定' })).toBeTruthy();
    expect(screen.getByText('只影響 LINE 推播，站內信照常送出')).toBeTruthy();
    expect(document.querySelectorAll('[data-notif-toggle-key]')).toHaveLength(9);
    expect(toggle('category_activity').disabled).toBe(false);
    expect(document.getElementById('notif-settings-save-btn')?.textContent).toBe('儲存');
  });

  it('admin 角色層級只持有 admin.notif.entry：可看，開關不可切換、沒有儲存（顯示與寫入同一判斷）', async () => {
    await openAs(viewer('admin', { rolePermissions: { admin: ['admin.notif.entry'] } }));
    expect(document.querySelectorAll('[data-notif-toggle-key]')).toHaveLength(9);
    expect(toggle('category_activity').disabled).toBe(true);
    expect(document.getElementById('notif-settings-save-btn')).toBeNull();
  });

  it('一般 user 個別授權 admin.notif.entry＋admin.notif.toggle：可進也可儲存（同 A hasPermission 含個別授權）', async () => {
    await openAs(viewer('user', { userGrants: ['admin.notif.entry', 'admin.notif.toggle'] }));
    expect(toggle('type_welcome').disabled).toBe(false);
    expect(document.getElementById('notif-settings-save-btn')).toBeTruthy();
  });

  it('權限尚未載入（最小 viewer）：只顯示載入中，不先閃「權限不足」也不讀資料', () => {
    state.viewer = createMinimalViewer('U-super');
    render(<AdminNotifPage />);
    expect(screen.getByRole('status').textContent).toBe('載入中...');
    expect(screen.queryByText('權限不足')).toBeNull();
    expect(sdk.getDoc).not.toHaveBeenCalled();
  });
});

describe('載入', () => {
  it('文件載入完成前不顯示可儲存的表單', async () => {
    let release!: () => void;
    store.readGate = new Promise<void>((r) => { release = r; });
    state.viewer = viewer('super_admin');
    render(<AdminNotifPage />);
    await waitFor(() => expect(sdk.getDoc).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status').textContent).toBe('載入中...');
    expect(document.querySelector('[data-notif-toggle-key]')).toBeNull();
    expect(document.getElementById('notif-settings-save-btn')).toBeNull();
    release();
    await waitFor(() => expect(document.getElementById('notif-settings-save-btn')).toBeTruthy());
  });

  it('載入失敗：不顯示表單，按「重新載入」重讀後出現表單', async () => {
    store.readErrors.push(new Error('unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openAs(viewer('super_admin'));
    expect(screen.getByRole('alert').textContent).toContain('載入失敗');
    expect(document.querySelector('[data-notif-toggle-key]')).toBeNull();
    expect(document.getElementById('notif-settings-save-btn')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    await waitFor(() => expect(document.getElementById('notif-settings-save-btn')).toBeTruthy());
    expect(sdk.getDoc).toHaveBeenCalledTimes(2);
  });

  it('讀到的值對應開關；未設定的 key 預設開', async () => {
    resetNotifStore({ notificationToggles: { category_activity: false, type_signup_success: true, type_welcome: false } });
    await openAs(viewer('super_admin'));
    expect(toggle('category_activity').checked).toBe(false);
    expect(toggle('type_signup_success').checked).toBe(true);
    expect(toggle('type_welcome').checked).toBe(false);
    expect(toggle('category_system').checked).toBe(true);
    expect(toggle('type_role_upgrade').checked).toBe(true);
  });

  it('文件不存在：9 個全部開', async () => {
    resetNotifStore(undefined);
    await openAs(viewer('super_admin'));
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-notif-toggle-key]'));
    expect(inputs).toHaveLength(9);
    expect(inputs.every((i) => i.checked)).toBe(true);
  });

  it('正式站現況（9 個皆 false）：全部關', async () => {
    await openAs(viewer('super_admin'));
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-notif-toggle-key]'));
    expect(inputs.every((i) => !i.checked)).toBe(true);
  });
});

describe('固定送出', () => {
  it('四列只顯示「固定」，沒有任何可切換的輸入', async () => {
    await openAs(viewer('super_admin'));
    const rows = Array.from(document.querySelectorAll('[data-notif-fixed]'));
    expect(rows.map((r) => r.querySelector('.notif-label')?.textContent)).toEqual(['候補遞補', '活動取消', '活動異動', '管理員主動廣播']);
    for (const row of rows) {
      expect(row.querySelector('input, button, [role="switch"]')).toBeNull();
      expect(row.querySelector('.notif-fixed')?.textContent).toBe('固定');
    }
  });
});

describe('儲存', () => {
  it('只寫 notificationToggles（含剛切換的值），merge，成功 toast', async () => {
    await openAs(viewer('super_admin'));
    fireEvent.click(toggle('category_system'));
    expect(toggle('category_system').checked).toBe(true);
    fireEvent.click(document.getElementById('notif-settings-save-btn')!);
    await waitFor(() => expect(sdk.setDoc).toHaveBeenCalledTimes(1));
    const [ref, data, opts] = sdk.setDoc.mock.calls[0]!;
    expect(ref).toEqual({ path: 'siteConfig/featureFlags' });
    expect(data).toEqual({ notificationToggles: { ...ALL_FALSE, category_system: true } });
    expect(opts).toEqual({ merge: true });
    for (const name of OTHER_APIS) expect(sdk[name]).not.toHaveBeenCalled();
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith({ message: '推播通知設定已儲存', tone: 'success' }));
  });

  it('儲存失敗：toast 錯誤，開關保留使用者改的值、可再按', async () => {
    store.writeError = new Error('permission-denied');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openAs(viewer('super_admin'));
    fireEvent.click(toggle('type_welcome'));
    fireEvent.click(document.getElementById('notif-settings-save-btn')!);
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith({ message: '儲存失敗，請稍後再試', tone: 'error' }));
    expect(toggle('type_welcome').checked).toBe(true);
    await waitFor(() => expect((document.getElementById('notif-settings-save-btn') as HTMLButtonElement).disabled).toBe(false));
  });
});
