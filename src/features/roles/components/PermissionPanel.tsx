import { useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { INHERENT_ROLE_PERMISSIONS, getRoleLevel } from '@/features/profile/data/permissions';
import {
  COMPETITION_HOST_CODE, USER_COMPETITION_HOST_CODE, isDefaultOnCodeEnabled,
} from '@/features/profile/data/default-on-codes';
import { resolveDrawerRoleInfo } from '@/ui/drawer-menu';
import {
  BACKEND_FIXED_GRANTS, CAPABILITY_GROUPS, CAPABILITY_ITEMS, LEGACY_CATEGORY, NO_FEATURE_IN_B_CAPABILITIES, UNUSED_IN_B_CODES,
  displayPermissionCatalog, type CatalogItem,
} from '../data/permission-catalog';
import { canEditRole, currentPermissions, isLockedRole, type RoleAction, type RolesData } from '../data/role-model';
import { getARolePermissionDefaults, savedDefaults } from '../data/role-defaults';

export function PermissionPanel({ data, role, busy, onAction, onInfo }: {
  data: RolesData; role: string; busy: boolean;
  onAction: (action: RoleAction) => void; onInfo: (code: string) => void;
}) {
  const t = useT();
  const [checkedOnly, setCheckedOnly] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // 「舊站專用」預設收合（預覽二）。
  const [closedCategories, setClosedCategories] = useState<string[]>([LEGACY_CATEGORY]);
  const current = currentPermissions(data, role);
  const inherent = INHERENT_ROLE_PERMISSIONS[role] ?? [];
  const locked = !canEditRole(role);
  const isUser = role === 'user';
  const info = resolveDrawerRoleInfo(role, true, data.customRoles);
  const defaults = getARolePermissionDefaults(role, data.rolePermissions, data.customRoles);
  const roleDoc = data.rolePermissions[role];
  const capDoc = data.roleActivityDocuments['user'];
  // 預設開的碼（站內賽事主辦）只看文件的 disabledCodes（顧問 §3.612），與前後端守門同一套（default-on-codes.ts）。
  const isOn = (code: string, capability: boolean): boolean => {
    if (capability) {
      return code === USER_COMPETITION_HOST_CODE
        ? isDefaultOnCodeEnabled(capDoc?.['disabledCodes'], code)
        : data.roleActivityCapabilities.user.includes(code);
    }
    if (code === COMPETITION_HOST_CODE) {
      return role === 'super_admin' || isDefaultOnCodeEnabled(roleDoc?.['disabledCodes'], code);
    }
    return current.includes(code);
  };
  const toggle = (item: CatalogItem, capability = false) => {
    const checked = isOn(item.code, capability);
    const disabled = busy || (!capability && (locked || inherent.includes(item.code)));
    const action = (): void => { if (!disabled) onAction({ kind: capability ? 'capability' : 'toggle', code: item.code }); };
    return <label class={'toggle-switch' + (checked ? ' active' : '')}
      title={inherent.includes(item.code) ? t('roles.ui.inherentHint') : undefined}
      tabIndex={disabled ? -1 : 0} onClick={event => event.stopPropagation()}
      onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); action(); } }}>
      <input type="checkbox" aria-label={item.name + ' (' + item.code + ')'} checked={checked} disabled={disabled} onChange={action} />
      <span class="toggle-slider" />
    </label>;
  };
  const infoButton = (code: string) => {
    const key = 'roles.info.' + code + '.title';
    return t(key) === key ? null : <button type="button" class="perm-info-btn" title={t('roles.ui.infoLabel')}
      onClick={event => { event.stopPropagation(); onInfo(code); }}>?</button>;
  };
  const level = getRoleLevel(role, data.customRoles);
  const tag = (code: string) => UNUSED_IN_B_CODES.has(code)
    ? <span class="perm-item-tag perm-item-tag--off">{t('roles.ui.unusedTag')}</span>
    : NO_FEATURE_IN_B_CAPABILITIES.has(code)
      ? <span class="perm-item-tag perm-item-tag--off">{t('roles.ui.noFeatureTag')}</span>
      : !isUser && role !== 'super_admin' && BACKEND_FIXED_GRANTS.some(item => item.code === code && level >= item.minLevel)
        ? <span class="perm-item-tag perm-item-tag--fixed">{t('roles.ui.backendFixedTag')}</span>
        : null;
  const toggleCategory = (cat: string) => setClosedCategories(previous => previous.includes(cat)
    ? previous.filter(item => item !== cat) : [...previous, cat]);
  const categories = isUser
    // 方案乙：一般用戶只列自己的開關，依功能分組；後台權限對 user 一律不生效，不再列出鎖住的那 20 組。
    ? CAPABILITY_GROUPS.map(group => {
      const children = CAPABILITY_ITEMS.filter(item => group.codes.includes(item.code));
      return {
        cat: t('roles.ui.group.' + group.key), key: 'user:' + group.key, entry: undefined as CatalogItem | undefined, capability: true,
        children: checkedOnly ? children.filter(item => isOn(item.code, true)) : children,
      };
    }).filter(category => !checkedOnly || category.children.length > 0)
    : displayPermissionCatalog(data.permissions).map(category => {
      const entry = category.items.find(item => item.code.endsWith('.entry'));
      const children = category.items.filter(item => item !== entry);
      return {
        cat: category.cat === LEGACY_CATEGORY ? t('roles.ui.legacyGroup') : category.cat, key: category.cat, entry, capability: false,
        children: checkedOnly ? children.filter(item => isOn(item.code, false)) : children,
      };
    }).filter(category => !checkedOnly || (category.entry && current.includes(category.entry.code)) || category.children.length > 0);
  return <div class="role-perm-panel" id="role-perm-panel">
    <div class="role-perm-panel-header" role="button" tabIndex={0} aria-expanded={!collapsed}
      onClick={() => setCollapsed(!collapsed)} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setCollapsed(!collapsed); }
      }}>
      <span id="role-perm-panel-title">
        <span class="role-level-badge" style={{ background: info.color, fontSize: '.7rem', padding: '.1rem .4rem' }}>
          {role === 'captain' ? '領隊 / 經理' : info.label}
        </span> {t(isUser ? 'roles.ui.userPermissions' : 'roles.ui.backend')}
      </span>
      <span class="role-perm-arrow" id="role-perm-arrow">{collapsed ? '▼' : '▲'}</span>
    </div>
    <div class="role-perm-toolbar">
      <button type="button" class={'text-btn role-perm-filter-btn' + (checkedOnly ? ' active' : '')}
        onClick={() => setCheckedOnly(!checkedOnly)}>{t(checkedOnly ? 'roles.ui.showAll' : 'roles.ui.checkedOnly')}</button>
      {!isUser && <div class="role-perm-toolbar-actions">
        <button type="button" class="text-btn" disabled={busy || locked} onClick={() => onAction({ kind: 'save-defaults' })}>{t('roles.ui.saveDefaults')}</button>
        <button type="button" class="text-btn role-perm-reset-btn" disabled={busy || locked || defaults === null}
          onClick={() => onAction({ kind: 'restore-defaults' })}>{t('roles.ui.restoreDefaults')}</button>
      </div>}
    </div>
    {locked && !isUser && <div class="role-perm-lock-hint">{t(isLockedRole(role) ? 'roles.ui.lockSuper' : 'roles.ui.customReadonly')}</div>}
    {!isUser && savedDefaults(roleDoc ?? null) === null && <div class="permission-audit-note">{t('roles.ui.noDefaults')}</div>}
    <div class="permissions-list" id="permissions-list" hidden={collapsed}>
      {categories.length === 0 && <div class="permission-audit-empty">{t('roles.ui.empty')}</div>}
      {categories.map(category => {
        const key: string = category.key;
        return <div key={key}
          class={'perm-category' + (category.children.length ? '' : ' no-sub') + (closedCategories.includes(key) ? ' collapsed' : '')}>
          <div class="perm-category-title" onClick={() => { if (category.children.length) toggleCategory(key); }}>
            <span class="perm-cat-name">{category.cat}{category.entry && infoButton(category.entry.code)}</span>
            {category.entry && tag(category.entry.code)}
            {category.entry && toggle(category.entry)}
            {category.entry && inherent.includes(category.entry.code) && <small>{t('roles.ui.inherent')}</small>}
          </div>
          {category.children.length > 0 && <div class="perm-items">{category.children.map(item =>
            <div class={'perm-item' + (locked && !category.capability ? ' perm-item-locked' : '')} key={item.code}>
              <span class="perm-item-label">{item.name}
                {inherent.includes(item.code) && <small>({t('roles.ui.inherent')})</small>}{tag(item.code)}{infoButton(item.code)}
              </span>{toggle(item, category.capability)}
            </div>)}</div>}
        </div>;
      })}
    </div>
  </div>;
}
