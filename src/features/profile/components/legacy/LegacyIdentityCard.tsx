// 卡 1C-1／1C-2：第二身份卡（照 A `pages/profile.html#90-119` +
// `profile-data-render.js#159-560` 的狀態機）。
// - 狀態一律從 `identity-settings.ts` 讀（不再讀 users 文件上的欄位）。
// - 寫入：設定用 `commitIdentitySettings`（Callable）；頭像用
//   `identity-avatar.ts`（Storage + `commitSecondaryIdentityAvatar`）。
// - legacy 畫面：inline style 與 A 一致；可見文字走 `lt()`。

import type { ComponentType, JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { useLegacyT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import {
  getIdentitySettings,
  setIdentitySettingsLocal,
  useIdentitySettings,
} from '@/data/identity-settings';
import type {
  IdentitySettings,
  SecondaryIdentitySettings,
} from '@/data/identity-resolver';
import { commitIdentitySettings } from '../../data/profile-writes';
import type { UserProfile } from '../../data/profile-model';
import type { ViewerView } from '../../data/viewer';
import {
  SECONDARY_AVATAR_ACCEPT,
  SECONDARY_AVATAR_MAX_BYTES,
  clearSecondaryIdentityAvatar as clearAvatar,
  isAllowedSecondaryAvatarFile,
  uploadSecondaryIdentityAvatarDataUrl,
} from '../../data/identity-avatar';
import type {
  ImageCropperOptions,
  ImageCropperProps,
} from '@/features/events/components/event-form/ImageCropper';
import { LegacyAvatar } from './LegacyProfileHeader';
import { ProfileInfoButton } from './ProfileInfoButton';

const SECONDARY_DEFAULT_NAME = '次身份';
const MAX_NAME_LENGTH = 40;

// 裁圖元件只載入一次（照 B `use-cover-upload.tsx` 的 lazy loader 寫法）。
let cropperModule: Promise<
  typeof import('@/features/events/components/event-form/ImageCropper')
> | null = null;
function loadImageCropper(): Promise<
  typeof import('@/features/events/components/event-form/ImageCropper')
> {
  cropperModule ??= import('@/features/events/components/event-form/ImageCropper').catch(
    (error: unknown) => {
      cropperModule = null;
      throw error;
    },
  );
  return cropperModule;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string' && result) resolve(result);
      else reject(new Error('Image data URL unavailable'));
    };
    reader.onerror = () => reject(new Error('Image file read failed'));
    reader.onabort = () => reject(new Error('Image file read aborted'));
    try {
      reader.readAsDataURL(file);
    } catch (err) {
      reject(err);
    }
  });
}

interface BaselineState {
  enabled: boolean;
  displayName: string;
}

interface CropState {
  src: string;
  Component: ComponentType<ImageCropperProps>;
}

/** 樂觀寫回本地 cache（照 A `_mergeSecondaryIdentityLocalCache`）。 */
function mergeSecondaryLocal(patch: Partial<SecondaryIdentitySettings>): void {
  const previous = getIdentitySettings();
  if (!previous) return;
  const existing = previous.identities.secondary ?? {
    identityId: 'secondary' as const,
    enabled: false,
    displayName: '',
    avatarUrl: '',
    avatarStoragePath: '',
    avatarStorageBucket: '',
    displayRoleLabel: '一般用戶',
    isPrimary: false as const,
    editable: true,
    updatedAt: null,
  };
  setIdentitySettingsLocal({
    ...previous,
    identities: {
      secondary: { ...existing, ...patch },
    },
  });
}

/** 照 A `saveIdentitySettings` 的樂觀值；只動 secondary 與 activeIdentityId。 */
function buildOptimisticSettings(
  previous: IdentitySettings | null,
  enabled: boolean,
  displayName: string,
): IdentitySettings {
  const fallback: IdentitySettings = {
    _docId: 'settings',
    profileActiveIdentityId: 'main',
    identities: { secondary: null },
    updatedAt: null,
    createdAt: null,
  };
  const base = previous ?? fallback;
  const existingSecondary = base.identities.secondary ?? {
    identityId: 'secondary' as const,
    enabled: false,
    displayName: '',
    avatarUrl: '',
    avatarStoragePath: '',
    avatarStorageBucket: '',
    displayRoleLabel: '一般用戶',
    isPrimary: false as const,
    editable: true,
    updatedAt: null,
  };
  return {
    ...base,
    profileActiveIdentityId: enabled ? 'secondary' : 'main',
    identities: {
      secondary: {
        ...existingSecondary,
        enabled,
        displayName,
      },
    },
  };
}

export function LegacyIdentityCard(props: {
  uid: string;
  profile: UserProfile;
  viewer: ViewerView;
}): JSX.Element {
  // profile 為 API 契約保留，本卡不讀 users 文件上的身份欄位。
  const { uid, viewer } = props;
  const lt = useLegacyT();

  const settings = useIdentitySettings();
  const secondary = settings?.identities?.secondary ?? null;
  const secEnabled = secondary?.enabled === true;
  const secDisplayName = (secondary?.displayName ?? '').trim();
  const secAvatarUrl = (secondary?.avatarUrl ?? '').trim();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [formEnabled, setFormEnabled] = useState<boolean>(secEnabled);
  const [formName, setFormName] = useState<string>(secDisplayName);
  const [baseline, setBaseline] = useState<BaselineState>({
    enabled: secEnabled,
    displayName: secDisplayName,
  });
  const [togglePending, setTogglePending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [crop, setCrop] = useState<CropState | null>(null);

  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 照 A `renderIdentitySettings`：非編輯時同步表單與 baseline。
  useEffect(() => {
    if (editing) return;
    setFormEnabled(secEnabled);
    setFormName(secDisplayName);
    setBaseline({ enabled: secEnabled, displayName: secDisplayName });
  }, [editing, secEnabled, secDisplayName]);

  const canEdit = viewer.hasPermission('profile.secondary_identity');
  const isDirty =
    formEnabled !== baseline.enabled
    || formName.trim() !== baseline.displayName.trim();
  const canEditDetails = !formEnabled && editing;
  const saveMode = !formEnabled && editing;

  const previewName = (formName || '').trim() || SECONDARY_DEFAULT_NAME;

  const summaryName = formEnabled
    ? ((formName || '').trim() || SECONDARY_DEFAULT_NAME)
    : ((formName || '').trim() || '使用主身份');

  const handlePermissionDenied = useCallback((): void => {
    toast.show({ message: lt('沒有第二身份權限', '沒有第二身份權限') });
  }, [lt]);

  const performSave = useCallback(
    async (
      enabled: boolean,
      nameRaw: string,
      opts: { exitEdit: boolean; toastMessage?: string },
    ): Promise<boolean> => {
      if (savingRef.current) return false;
      if (!canEdit) {
        toast.show({ message: lt('沒有第二身份權限', '沒有第二身份權限') });
        return false;
      }
      const trimmed = (nameRaw || '').trim();
      const displayName = trimmed || SECONDARY_DEFAULT_NAME;
      if (displayName.length > MAX_NAME_LENGTH) {
        toast.show({
          message: lt('次身份暱稱不能超過 40 字', '次身份暱稱不能超過 40 字'),
        });
        return false;
      }
      savingRef.current = true;
      setSaving(true);
      const previous = getIdentitySettings();
      const optimistic = buildOptimisticSettings(previous, enabled, displayName);
      setIdentitySettingsLocal(optimistic);
      setBaseline({ enabled, displayName });
      if (opts.exitEdit) setEditing(false);
      try {
        await commitIdentitySettings({
          secondaryEnabled: enabled,
          secondaryDisplayName: displayName,
        });
        toast.show({
          message: opts.toastMessage ?? lt('第二身份已儲存', '第二身份已儲存'),
        });
        return true;
      } catch (err) {
        console.error('[saveIdentitySettings]', err);
        setIdentitySettingsLocal(previous);
        const prevSec = previous?.identities?.secondary ?? null;
        setBaseline({
          enabled: prevSec?.enabled === true,
          displayName: (prevSec?.displayName ?? '').trim(),
        });
        toast.show({ message: lt('第二身份儲存失敗', '第二身份儲存失敗') });
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [canEdit, lt],
  );

  // 照 A `handleSecondaryIdentityToggleChange`：立即儲存、失敗還原。
  async function handleToggleChange(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    if (!canEdit) {
      input.checked = baseline.enabled;
      handlePermissionDenied();
      return;
    }
    const nextEnabled = input.checked;
    setFormEnabled(nextEnabled);
    setEditing(false);
    setTogglePending(true);
    const ok = await performSave(nextEnabled, formName, {
      exitEdit: true,
      toastMessage: nextEnabled
        ? lt('第二身份已啟用', '第二身份已啟用')
        : lt('已恢復主身份顯示', '已恢復主身份顯示'),
    });
    if (!ok) {
      setFormEnabled(baseline.enabled);
      input.checked = baseline.enabled;
    }
    setTogglePending(false);
  }

  // 照 A `toggleIdentitySettingsEdit`。
  function handleEditClick(): void {
    if (!canEdit) {
      handlePermissionDenied();
      return;
    }
    if (formEnabled) {
      toast.show({ message: lt('請先關閉第二身份才可以編輯', '請先關閉第二身份才可以編輯') });
      return;
    }
    if (editing || isDirty) {
      performSave(formEnabled, formName, { exitEdit: true }).catch(() => {
        /* 已於 performSave 內處理錯誤 */
      });
      return;
    }
    setEditing(true);
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 0);
  }

  // 照 A `uploadSecondaryIdentityAvatar`。
  async function handleFileChange(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    try {
      if (!canEdit) {
        handlePermissionDenied();
        return;
      }
      if (formEnabled) {
        toast.show({ message: lt('請先關閉第二身份才可以編輯', '請先關閉第二身份才可以編輯') });
        return;
      }
      const file = input.files?.[0] ?? null;
      if (!file) return;
      if (!isAllowedSecondaryAvatarFile(file)) {
        toast.show({
          message: lt('請上傳 JPG / PNG / WebP 圖片', '請上傳 JPG / PNG / WebP 圖片'),
        });
        return;
      }
      if (file.size > SECONDARY_AVATAR_MAX_BYTES) {
        toast.show({
          message: lt('圖片太大，不能超過 5MB', '圖片太大，不能超過 5MB'),
        });
        return;
      }
      const [dataUrl, mod] = await Promise.all([
        readFileAsDataUrl(file),
        loadImageCropper(),
      ]);
      if (!mountedRef.current) return;
      setCrop({ src: dataUrl, Component: mod.ImageCropper });
    } catch (err) {
      console.error('[uploadSecondaryIdentityAvatar]', err);
      if (mountedRef.current) {
        toast.show({ message: lt('次身份頭像更新失敗', '次身份頭像更新失敗') });
      }
    } finally {
      // 照 A `finally` 清空 input，允許重選同一檔案。
      input.value = '';
    }
  }

  async function handleCropConfirm(dataUrl: string): Promise<void> {
    setCrop(null);
    try {
      const avatarUrl = await uploadSecondaryIdentityAvatarDataUrl(uid, dataUrl);
      if (!mountedRef.current) return;
      mergeSecondaryLocal({ avatarUrl });
      toast.show({ message: lt('次身份頭像已更新', '次身份頭像已更新') });
    } catch (err) {
      console.error('[uploadSecondaryIdentityAvatar]', err);
      if (!mountedRef.current) return;
      toast.show({ message: lt('次身份頭像更新失敗', '次身份頭像更新失敗') });
    }
  }

  function handleCropCancel(): void {
    setCrop(null);
  }

  // 照 A `clearSecondaryIdentityAvatar`。
  async function handleClearAvatar(): Promise<void> {
    if (!canEdit) {
      handlePermissionDenied();
      return;
    }
    if (formEnabled) {
      toast.show({ message: lt('請先關閉第二身份才可以編輯', '請先關閉第二身份才可以編輯') });
      return;
    }
    try {
      await clearAvatar();
      if (!mountedRef.current) return;
      mergeSecondaryLocal({
        avatarUrl: '',
        avatarStoragePath: '',
        avatarStorageBucket: '',
      });
      toast.show({ message: lt('次身份頭像已清除', '次身份頭像已清除') });
    } catch (err) {
      console.error('[clearSecondaryIdentityAvatar]', err);
      if (!mountedRef.current) return;
      toast.show({ message: lt('次身份頭像清除失敗', '次身份頭像清除失敗') });
    }
  }

  const cardClass = [
    'info-card',
    formEnabled ? 'is-secondary-enabled' : '',
    editing ? 'is-identity-editing' : '',
    isDirty ? 'is-identity-dirty' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const editBtnLabel = saveMode ? lt('儲存', '儲存') : lt('編輯', '編輯');

  const cropOptions: ImageCropperOptions = {
    aspectRatio: 1,
    outputWidth: 512,
    outputHeight: 512,
    outputType: 'image/webp',
    quality: 0.88,
    title: lt('次身份頭像', '次身份頭像'),
    subtitle: lt(
      '拖曳調整位置，使用滑桿或滾輪放大縮小',
      '拖曳調整位置，使用滑桿或滾輪放大縮小',
    ),
    targetLabel: lt('次身份頭像', '次身份頭像'),
    recommendedSize: '512 x 512',
    aspectLabel: '1:1',
    confirmText: lt('使用此頭像', '使用此頭像'),
    cancelText: lt('取消', '取消'),
  };

  const CropComponent = crop?.Component;

  return (
    <div
      class={cardClass}
      id="profile-identity-card"
      data-permission-code="profile.secondary_identity"
    >
      <div
        class={`info-title profile-collapse-toggle${open ? ' open' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span style="display:flex;align-items:center;gap:.35rem">
          <ProfileInfoButton infoKey="secondaryIdentity" />
          <span data-i18n="第二身份">{lt('第二身份', '第二身份')}</span>
        </span>
        <span class="profile-collapse-arrow">▶</span>
      </div>
      <div class="profile-collapse-content" style={open ? undefined : 'display:none'}>
        <div class="profile-identity-control">
          <label class={`profile-identity-toggle${formEnabled ? ' active' : ''}`}>
            <span data-i18n="啟用">{lt('啟用', '啟用')}</span>
            <span class="toggle-switch">
              <input
                type="checkbox"
                id="profile-secondary-enabled"
                checked={formEnabled}
                disabled={togglePending}
                onChange={handleToggleChange}
              />
              <span class="toggle-slider" />
            </span>
          </label>
        </div>
        <div class="profile-identity-summary">
          <LegacyAvatar
            id="profile-secondary-avatar-preview"
            url={secAvatarUrl || null}
            name={previewName}
            baseClass="profile-identity-avatar"
            imageContainerClass="profile-identity-avatar"
            crown
          />
          <div class="profile-identity-summary-copy">
            <div
              class="profile-identity-summary-name"
              id="profile-secondary-summary-name"
              data-i18n="使用主身份"
            >
              {summaryName}
            </div>
            <div
              class="profile-identity-summary-status"
              id="profile-secondary-summary-status"
              data-i18n="啟用後會直接以第二身份顯示"
            >
              {formEnabled ? (
                <>
                  {lt('目前身份已啟用', '目前身份已啟用')}
                  <ul class="profile-identity-capability-list">
                    <li>{lt('活動留言與回覆', '活動留言與回覆')}</li>
                    <li>{lt('用戶資料卡片', '用戶資料卡片')}</li>
                    <li>{lt('右上角與我的資料顯示', '右上角與我的資料顯示')}</li>
                  </ul>
                </>
              ) : isDirty ? (
                lt('按儲存後更新第二身份資料', '按儲存後更新第二身份資料')
              ) : (
                lt('啟用後會直接以第二身份顯示', '啟用後會直接以第二身份顯示')
              )}
            </div>
          </div>
          <button
            type="button"
            class={`outline-btn small profile-identity-edit-btn${saveMode ? ' is-save-mode' : ''}`}
            id="profile-identity-edit-btn"
            data-i18n="編輯"
            disabled={saving}
            onClick={handleEditClick}
          >
            {editBtnLabel}
          </button>
        </div>
        <div class="profile-identity-editor">
          <input
            ref={nameInputRef}
            type="text"
            id="profile-secondary-display-name"
            class="profile-edit-input"
            maxLength={MAX_NAME_LENGTH}
            placeholder={lt('次身份暱稱', '次身份暱稱')}
            data-i18n-placeholder="次身份暱稱"
            value={formName}
            disabled={!canEditDetails}
            onInput={(e) => setFormName(e.currentTarget.value)}
          />
          <div class="profile-identity-actions">
            <label
              class={`outline-btn small profile-avatar-upload-btn${canEditDetails ? '' : ' disabled'}`}
              for="profile-secondary-avatar-input"
              aria-disabled={canEditDetails ? 'false' : 'true'}
              tabIndex={canEditDetails ? 0 : -1}
              data-i18n="上傳頭像"
            >
              {lt('上傳頭像', '上傳頭像')}
            </label>
            <button
              type="button"
              class="outline-btn small"
              data-i18n="清除頭像"
              disabled={!canEditDetails}
              onClick={handleClearAvatar}
            >
              {lt('清除頭像', '清除頭像')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              id="profile-secondary-avatar-input"
              accept={SECONDARY_AVATAR_ACCEPT}
              style="display:none"
              onChange={handleFileChange}
            />
          </div>
        </div>
      </div>
      {crop && CropComponent && (
        <CropComponent
          key="profile-secondary-cropper"
          src={crop.src}
          options={cropOptions}
          onConfirm={(dataUrl) => {
            handleCropConfirm(dataUrl).catch((err: unknown) => {
              console.error('[uploadSecondaryIdentityAvatar] confirm failed', err);
            });
          }}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  );
}
