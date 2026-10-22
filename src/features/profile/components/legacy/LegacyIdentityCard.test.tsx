// @vitest-environment jsdom
// 卡 1C-4：`LegacyIdentityCard` 回歸測試。
// - 狀態一律來自 `identity-settings.ts`（mock 控制）。
// - 有權限／無權限都共用 `viewer.hasPermission('profile.secondary_identity')`。

import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserProfile } from '../../data/profile-model';
import type { ViewerView } from '../../data/viewer';
import type { IdentitySettings } from '@/data/identity-resolver';

const mocks = vi.hoisted(() => ({
  useIdentitySettings: vi.fn<() => IdentitySettings | null>(),
  getIdentitySettings: vi.fn<() => IdentitySettings | null>(),
  setIdentitySettingsLocal: vi.fn(),
  commitIdentitySettings: vi.fn(),
  clearSecondaryIdentityAvatar: vi.fn(),
  uploadSecondaryIdentityAvatarDataUrl: vi.fn(),
  toastShow: vi.fn(),
}));

vi.mock('@/i18n/i18n', () => {
  const translate = (key: string, fallback?: string): string => fallback ?? key;
  return {
    lt: translate,
    useLegacyT: () => translate,
    useT: () => () => '',
  };
});

vi.mock('@/ui/Toast', () => ({
  toast: { show: mocks.toastShow },
}));

vi.mock('@/data/identity-settings', () => ({
  useIdentitySettings: mocks.useIdentitySettings,
  getIdentitySettings: mocks.getIdentitySettings,
  setIdentitySettingsLocal: mocks.setIdentitySettingsLocal,
}));

vi.mock('../../data/profile-writes', () => ({
  commitIdentitySettings: mocks.commitIdentitySettings,
  commitSecondaryIdentityAvatar: vi.fn(),
}));

vi.mock('../../data/identity-avatar', () => ({
  clearSecondaryIdentityAvatar: mocks.clearSecondaryIdentityAvatar,
  uploadSecondaryIdentityAvatarDataUrl:
    mocks.uploadSecondaryIdentityAvatarDataUrl,
  isAllowedSecondaryAvatarFile: (file: { name?: string; type?: string }) => {
    const types = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ];
    const exts = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
    const mime = String(file.type || '').toLowerCase();
    const ext = String(file.name || '').split('.').pop()?.toLowerCase() || '';
    return types.includes(mime) || exts.includes(ext);
  },
  SECONDARY_AVATAR_ACCEPT:
    'image/jpeg,image/png,image/webp,image/heic,image/heif',
  SECONDARY_AVATAR_MAX_BYTES: 5 * 1024 * 1024,
}));

vi.mock('@/features/events/components/event-form/ImageCropper', () => ({
  ImageCropper: () => null,
}));

vi.mock('./ProfileInfoButton', () => ({
  ProfileInfoButton: () => <button type="button" class="edu-info-btn">?</button>,
}));

import { LegacyIdentityCard } from './LegacyIdentityCard';

function fakeViewer(hasPermission = true): ViewerView {
  return {
    uid: 'U-me',
    role: 'user',
    roleLevel: 1,
    teamIds: new Set<string>(),
    capabilities: [],
    displayName: null,
    pictureUrl: null,
    hasPermission: () => hasPermission,
  };
}

function fakeProfile(): UserProfile {
  return { uid: 'U-me', _docId: 'U-me', name: '王小明', role: 'user' } as unknown as UserProfile;
}

function buildSettings(opts: {
  enabled: boolean;
  displayName: string;
  avatarUrl?: string;
}): IdentitySettings {
  return {
    _docId: 'settings',
    profileActiveIdentityId: opts.enabled ? 'secondary' : 'main',
    identities: {
      secondary: {
        identityId: 'secondary',
        enabled: opts.enabled,
        displayName: opts.displayName,
        avatarUrl: opts.avatarUrl ?? '',
        avatarStoragePath: '',
        avatarStorageBucket: '',
        displayRoleLabel: '一般用戶',
        isPrimary: false,
        editable: true,
        updatedAt: null,
      },
    },
    updatedAt: null,
    createdAt: null,
  };
}

function expandCard(): void {
  const toggle = document.querySelector(
    '.profile-collapse-toggle',
  ) as HTMLElement;
  fireEvent.click(toggle);
}

function renderCard(permission = true) {
  return render(
    <LegacyIdentityCard
      uid="U-me"
      profile={fakeProfile()}
      viewer={fakeViewer(permission)}
    />,
  );
}

function getEditBtn(): HTMLButtonElement {
  return document.getElementById('profile-identity-edit-btn') as HTMLButtonElement;
}

function getCheckbox(): HTMLInputElement {
  return document.getElementById('profile-secondary-enabled') as HTMLInputElement;
}

function getNameInput(): HTMLInputElement {
  return document.getElementById(
    'profile-secondary-display-name',
  ) as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getIdentitySettings.mockReturnValue(null);
  mocks.useIdentitySettings.mockReturnValue(null);
  mocks.commitIdentitySettings.mockResolvedValue(undefined);
  mocks.clearSecondaryIdentityAvatar.mockResolvedValue(undefined);
  mocks.uploadSecondaryIdentityAvatarDataUrl.mockResolvedValue(
    'https://cdn.example/x.png',
  );
});

afterEach(() => {
  cleanup();
});

describe('LegacyIdentityCard', () => {
  it('settings 啟用時顯示勾選、名稱與三項範圍；重新掛載仍來自 settings', () => {
    const enabled = buildSettings({ enabled: true, displayName: '小名' });
    mocks.useIdentitySettings.mockReturnValue(enabled);
    mocks.getIdentitySettings.mockReturnValue(enabled);

    const first = renderCard();
    expandCard();

    expect(getCheckbox().checked).toBe(true);
    expect(getNameInput().value).toBe('小名');
    expect(document.querySelectorAll('.profile-identity-capability-list li').length).toBe(3);
    const statusText =
      document.getElementById('profile-secondary-summary-status')?.textContent ?? '';
    expect(statusText).toContain('目前身份已啟用');
    expect(statusText).toContain('活動留言與回覆');
    expect(statusText).toContain('用戶資料卡片');
    expect(statusText).toContain('右上角與我的資料顯示');

    first.unmount();

    renderCard();
    expandCard();
    expect(getCheckbox().checked).toBe(true);
    expect(getNameInput().value).toBe('小名');
    expect(
      document.getElementById('profile-secondary-summary-status')?.textContent,
    ).toContain('目前身份已啟用');
  });

  it('啟用中按編輯 → toast「請先關閉第二身份才可以編輯」、不進入編輯', () => {
    const enabled = buildSettings({ enabled: true, displayName: '小名' });
    mocks.useIdentitySettings.mockReturnValue(enabled);

    renderCard();
    expandCard();

    fireEvent.click(getEditBtn());

    expect(mocks.toastShow).toHaveBeenCalledWith({
      message: '請先關閉第二身份才可以編輯',
    });
    expect(getEditBtn().textContent).toBe('編輯');
    expect(getEditBtn().classList.contains('is-save-mode')).toBe(false);
  });

  it('未啟用按編輯 → 暱稱可輸入、按鈕變儲存；輸入後儲存送出正確 payload', async () => {
    renderCard();
    expandCard();

    expect(getNameInput().disabled).toBe(true);

    fireEvent.click(getEditBtn());

    await waitFor(() => expect(getNameInput().disabled).toBe(false));
    expect(getEditBtn().textContent).toBe('儲存');
    expect(getEditBtn().classList.contains('is-save-mode')).toBe(true);

    fireEvent.input(getNameInput(), { target: { value: '新暱稱' } });
    fireEvent.click(getEditBtn());

    await waitFor(() =>
      expect(mocks.commitIdentitySettings).toHaveBeenCalledWith({
        secondaryEnabled: false,
        secondaryDisplayName: '新暱稱',
      }),
    );
  });

  it('開關打開 → 立即呼叫 commit、toast「第二身份已啟用」', async () => {
    renderCard();
    expandCard();

    fireEvent.click(getCheckbox());

    await waitFor(() =>
      expect(mocks.commitIdentitySettings).toHaveBeenCalledWith({
        secondaryEnabled: true,
        secondaryDisplayName: '次身份',
      }),
    );
    await waitFor(() =>
      expect(mocks.toastShow).toHaveBeenCalledWith({
        message: '第二身份已啟用',
      }),
    );
  });

  it('commit 失敗 → 開關還原', async () => {
    mocks.commitIdentitySettings.mockRejectedValueOnce(new Error('boom'));

    renderCard();
    expandCard();

    fireEvent.click(getCheckbox());

    await waitFor(() => expect(getCheckbox().checked).toBe(false));
    expect(mocks.setIdentitySettingsLocal).toHaveBeenCalled();
  });

  it('上傳超過 5MB → toast 且不上傳', () => {
    renderCard();
    expandCard();

    const input = document.getElementById(
      'profile-secondary-avatar-input',
    ) as HTMLInputElement;
    const bigFile = new File(
      [new Uint8Array(6 * 1024 * 1024)],
      'big.jpg',
      { type: 'image/jpeg' },
    );
    fireEvent.change(input, { target: { files: [bigFile] } });

    expect(mocks.toastShow).toHaveBeenCalledWith({
      message: '圖片太大，不能超過 5MB',
    });
    expect(mocks.uploadSecondaryIdentityAvatarDataUrl).not.toHaveBeenCalled();
  });

  it('清除 → 只呼叫 clear', async () => {
    renderCard();
    expandCard();

    // 進入編輯模式讓清除鈕可用
    fireEvent.click(getEditBtn());
    await waitFor(() => expect(getNameInput().disabled).toBe(false));

    const clearBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '.profile-identity-actions button',
      ),
    ).find((btn) => btn.textContent === '清除頭像');
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn as HTMLButtonElement);

    await waitFor(() =>
      expect(mocks.clearSecondaryIdentityAvatar).toHaveBeenCalledTimes(1),
    );
    expect(mocks.uploadSecondaryIdentityAvatarDataUrl).not.toHaveBeenCalled();
  });
});
