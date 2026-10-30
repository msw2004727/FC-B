import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';

import { pushOverlay } from '@/core/overlay-back';
import { useT } from '@/i18n/i18n';
import type { CustomRoleInput } from '@/ui/drawer-menu';
import { lockBody } from '@/ui/Modal';
import { toast } from '@/ui/Toast';

import {
  USER_EDIT_GENDER_OPTIONS,
  USER_EDIT_REGION_OPTIONS,
  canChangeRoleOf,
  canEditProfileOf,
  formValuesFromUser,
  getAssignableRoleKeys,
  roleLabel,
  type AdminUser,
  type AdminUserActor,
  type EditFormValues,
} from '../data/admin-users-model';

export interface UserEditModalProps {
  user: AdminUser;
  actor: AdminUserActor;
  customRoles: readonly CustomRoleInput[];
  /** 儲存中：鎖住按鈕並擋關閉（照 A 建立流程「資料儲存中，請稍候」）。 */
  busy: boolean;
  onClose: () => void;
  onSubmit: (form: EditFormValues) => void;
}

/** A `_setSelectValuePreservingUnknown`：目前值不在選項內時，插一個「目前值：xxx」選項保住它。 */
function PreservedOption({ value, options }: { value: string; options: readonly string[] }): JSX.Element | null {
  const t = useT();
  if (!value || options.includes(value)) return null;
  return <option value={value}>{t('admin-users.modal.currentValue', { value })}</option>;
}

/** 編輯用戶彈窗：DOM／id／class 逐字照 A `pages/admin-users.html` 的 #user-edit-modal。 */
export function UserEditModal({
  user,
  actor,
  customRoles,
  busy,
  onClose,
  onSubmit,
}: UserEditModalProps): JSX.Element {
  const t = useT();
  const [form, setForm] = useState<EditFormValues>(() => formValuesFromUser(user));
  const latest = useRef({ busy, onClose, t });
  latest.current = { busy, onClose, t };
  const closeButton = useRef<HTMLButtonElement>(null);

  const canEditProfile = canEditProfileOf(actor, user);
  const canChangeRole = canChangeRoleOf(actor, user);
  const assignable = getAssignableRoleKeys(actor.role, customRoles);
  // 目前角色不在可指派清單時（例如管理員檢視同級管理員）仍要顯示，但整個下拉停用。
  const roleKeys = assignable.includes(user.role) ? assignable : [user.role, ...assignable];
  const patch = (next: Partial<EditFormValues>): void => setForm((prev) => ({ ...prev, ...next }));

  useEffect(() => {
    const unlock = lockBody(document.body);
    const requestClose = (): boolean => {
      if (latest.current.busy) {
        toast.show({ message: latest.current.t('admin-users.toast.saving'), tone: 'info' });
        return true;
      }
      latest.current.onClose();
      return true;
    };
    const releaseBack = pushOverlay(requestClose);
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    };
    document.addEventListener('keydown', handleKey, true);
    closeButton.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      releaseBack();
      unlock();
    };
  }, []);

  const requestClose = (): void => {
    if (busy) {
      toast.show({ message: t('admin-users.toast.saving'), tone: 'info' });
      return;
    }
    onClose();
  };

  return createPortal(
    <div class="legacy-ui">
      <div class="modal-overlay open" aria-hidden="true" onClick={requestClose} />
      <div
        class="modal open"
        id="user-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-edit-modal-title"
      >
        <div class="modal-header">
          <h3 id="user-edit-modal-title">{t('admin-users.modal.title', { name: user.name })}</h3>
          <button
            ref={closeButton}
            type="button"
            class="modal-close"
            aria-label={t('admin-users.modal.close')}
            onClick={requestClose}
          >
            ✕
          </button>
        </div>
        <div class="modal-body">
          <div class="ce-form">
            <div class="ce-row">
              <label for="ue-role">{t('admin-users.modal.role')}</label>
              <select
                id="ue-role"
                value={form.role}
                disabled={!canChangeRole}
                onChange={(event) => patch({ role: event.currentTarget.value })}
              >
                {roleKeys.map((key) => (
                  <option key={key} value={key}>{roleLabel(key, customRoles)}</option>
                ))}
              </select>
            </div>
            <div class="ce-row">
              <label for="ue-region">{t('admin-users.modal.region')}</label>
              <select
                id="ue-region"
                value={form.region}
                disabled={!canEditProfile}
                onChange={(event) => patch({ region: event.currentTarget.value })}
              >
                <option value="">{t('admin-users.modal.unfilled')}</option>
                <PreservedOption value={user.region} options={USER_EDIT_REGION_OPTIONS} />
                {USER_EDIT_REGION_OPTIONS.map((region) => (
                  <option key={region} value={region}>{region}</option>
                ))}
              </select>
            </div>
            <div class="ce-row">
              <label for="ue-gender">{t('admin-users.modal.gender')}</label>
              <select
                id="ue-gender"
                value={form.gender}
                disabled={!canEditProfile}
                onChange={(event) => patch({ gender: event.currentTarget.value })}
              >
                <option value="">{t('admin-users.modal.unfilled')}</option>
                <PreservedOption value={user.gender} options={USER_EDIT_GENDER_OPTIONS.map((g) => g.value)} />
                {USER_EDIT_GENDER_OPTIONS.map((gender) => (
                  <option key={gender.value} value={gender.value}>{t(`admin-users.gender.${gender.key}`)}</option>
                ))}
              </select>
            </div>
            <div class="ce-row">
              <label for="ue-birthday">{t('admin-users.modal.birthday')}</label>
              <input
                type="date"
                id="ue-birthday"
                value={form.birthday}
                disabled={!canEditProfile}
                onInput={(event) => patch({ birthday: event.currentTarget.value })}
              />
            </div>
            <div class="ce-row">
              <label for="ue-sports">{t('admin-users.modal.sports')}</label>
              <input
                type="text"
                id="ue-sports"
                placeholder={t('admin-users.modal.sportsPlaceholder')}
                value={form.sports}
                disabled={!canEditProfile}
                onInput={(event) => patch({ sports: event.currentTarget.value })}
              />
            </div>
            <div class="ce-row">
              <label for="ue-phone">{t('admin-users.modal.phone')}</label>
              <input
                type="text"
                id="ue-phone"
                placeholder={t('admin-users.modal.phonePlaceholder')}
                value={form.phone}
                disabled={!canEditProfile}
                onInput={(event) => patch({ phone: event.currentTarget.value })}
              />
            </div>
            <div class="ce-row">
              <label for="ue-email">{t('admin-users.modal.email')}</label>
              <input
                type="email"
                id="ue-email"
                placeholder={t('admin-users.modal.emailPlaceholder')}
                autocomplete="email"
                inputMode="email"
                spellcheck={false}
                maxLength={254}
                value={form.email}
                disabled={!canEditProfile}
                onInput={(event) => patch({ email: event.currentTarget.value })}
              />
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="outline-btn" onClick={requestClose}>
            {t('admin-users.modal.cancel')}
          </button>
          <button type="button" class="primary-btn" disabled={busy} onClick={() => onSubmit(form)}>
            {t('admin-users.modal.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
