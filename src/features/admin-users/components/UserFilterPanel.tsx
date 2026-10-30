import type { JSX } from 'preact';

import { useT } from '@/i18n/i18n';

import { USER_EDIT_GENDER_OPTIONS, type AdminUserFilterInputs } from '../data/admin-users-model';

export interface RoleFilterOption {
  value: string;
  label: string;
}

export interface UserFilterPanelProps {
  open: boolean;
  inputs: AdminUserFilterInputs;
  roleOptions: readonly RoleFilterOption[];
  onChange: (patch: Partial<AdminUserFilterInputs>) => void;
}

/**
 * 搜尋與篩選面板：DOM／class／id 逐字照 A `pages/admin-users.html` 的 #admin-user-filter-panel。
 * 原生 <option>／placeholder 不使用 <Text>（legacy 外觀頁不用 <Text>）。
 */
export function UserFilterPanel({ open, inputs, roleOptions, onChange }: UserFilterPanelProps): JSX.Element {
  const t = useT();
  const numberInput = (
    id: string,
    field: 'joinedMin' | 'joinedMax' | 'loginMin' | 'loginMax',
    rangeKey: 'joinedRange' | 'loginRange',
    edge: 'rangeFrom' | 'rangeTo',
  ): JSX.Element => (
    <input
      type="number"
      id={id}
      min="0"
      inputMode="numeric"
      placeholder={t(`admin-users.filter.${edge}`)}
      aria-label={`${t(`admin-users.filter.${rangeKey}`)} ${t(`admin-users.filter.${edge}`)}`}
      value={inputs[field]}
      onInput={(event) => onChange({ [field]: event.currentTarget.value } as Partial<AdminUserFilterInputs>)}
    />
  );

  return (
    <div
      class={`admin-search collapsible-search-panel admin-user-filter-panel${open ? ' visible' : ''}`}
      id="admin-user-filter-panel"
      hidden={!open}
      aria-hidden={open ? 'false' : 'true'}
    >
      <input
        type="text"
        id="admin-user-search"
        placeholder={t('admin-users.filter.keywordPlaceholder')}
        value={inputs.keyword}
        onInput={(event) => onChange({ keyword: event.currentTarget.value })}
      />
      <select
        id="admin-user-role-filter"
        aria-label={t('admin-users.filter.roleLabel')}
        value={inputs.role}
        onChange={(event) => onChange({ role: event.currentTarget.value })}
      >
        <option value="">{t('admin-users.filter.roleAll')}</option>
        {roleOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <select
        id="admin-user-gender-filter"
        aria-label={t('admin-users.filter.genderLabel')}
        value={inputs.gender}
        onChange={(event) => onChange({ gender: event.currentTarget.value })}
      >
        <option value="">{t('admin-users.filter.genderAll')}</option>
        {USER_EDIT_GENDER_OPTIONS.map((gender) => (
          <option key={gender.value} value={gender.value}>{t(`admin-users.gender.${gender.key}`)}</option>
        ))}
      </select>
      <label class="admin-user-range-field">
        <span>{t('admin-users.filter.joinedRange')}</span>
        <span class="admin-user-range-inputs">
          {numberInput('admin-user-joined-min-days', 'joinedMin', 'joinedRange', 'rangeFrom')}
          {numberInput('admin-user-joined-max-days', 'joinedMax', 'joinedRange', 'rangeTo')}
        </span>
      </label>
      <label class="admin-user-range-field">
        <span>{t('admin-users.filter.loginRange')}</span>
        <span class="admin-user-range-inputs">
          {numberInput('admin-user-login-min-days', 'loginMin', 'loginRange', 'rangeFrom')}
          {numberInput('admin-user-login-max-days', 'loginMax', 'loginRange', 'rangeTo')}
        </span>
      </label>
      <input
        type="text"
        id="admin-user-region-filter"
        placeholder={t('admin-users.filter.regionPlaceholder')}
        value={inputs.region}
        onInput={(event) => onChange({ region: event.currentTarget.value })}
      />
      <input
        type="email"
        id="admin-user-email-filter"
        placeholder="Email"
        autocomplete="off"
        inputMode="email"
        value={inputs.email}
        onInput={(event) => onChange({ email: event.currentTarget.value })}
      />
    </div>
  );
}
