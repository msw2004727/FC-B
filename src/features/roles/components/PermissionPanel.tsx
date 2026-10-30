import { useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { INHERENT_ROLE_PERMISSIONS } from '@/features/profile/data/permissions';
import { resolveDrawerRoleInfo } from '@/ui/drawer-menu';
import { CAPABILITY_ITEMS, mergePermissionCatalog, type CatalogItem } from '../data/permission-catalog';
import { canEditRole, currentPermissions, isLockedRole, type RoleAction, type RolesData } from '../data/role-model';
import { getARolePermissionDefaults, savedDefaults } from '../data/role-defaults';

export function PermissionPanel({ data, role, busy, onAction, onInfo }: {
  data: RolesData; role: string; busy: boolean;
  onAction: (action: RoleAction) => void; onInfo: (code: string) => void;
}) {
  const t = useT();
  const [checkedOnly, setCheckedOnly] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [closedCategories, setClosedCategories] = useState<string[]>([]);
  const current = currentPermissions(data, role);
  const inherent = INHERENT_ROLE_PERMISSIONS[role] ?? [];
  const locked = !canEditRole(role);
  const info = resolveDrawerRoleInfo(role, true, data.customRoles);
  const defaults = getARolePermissionDefaults(role, data.rolePermissions, data.customRoles);
  const toggle = (item: CatalogItem, capability = false) => {
    const checked = (capability ? data.roleActivityCapabilities.user : current).includes(item.code);
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
  const categories = mergePermissionCatalog(data.permissions).map(category => {
    const entry = category.items.find(item => item.code.endsWith('.entry'));
    const children = category.items.filter(item => item !== entry);
    return { cat: category.cat, entry, children: checkedOnly ? children.filter(item => current.includes(item.code)) : children };
  }).filter(category => !checkedOnly || (category.entry && current.includes(category.entry.code)) || category.children.length > 0);
  return <div class="role-perm-panel" id="role-perm-panel">
    <div class="role-perm-panel-header" role="button" tabIndex={0} aria-expanded={!collapsed}
      onClick={() => setCollapsed(!collapsed)} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setCollapsed(!collapsed); }
      }}>
      <span id="role-perm-panel-title">
        <span class="role-level-badge" style={{ background: info.color, fontSize: '.7rem', padding: '.1rem .4rem' }}>
          {role === 'captain' ? '領隊 / 經理' : info.label}
        </span> {t('roles.ui.backend')}
      </span>
      <span class="role-perm-arrow" id="role-perm-arrow">{collapsed ? '▼' : '▲'}</span>
    </div>
    <div class="role-perm-toolbar">
      <button type="button" class={'text-btn role-perm-filter-btn' + (checkedOnly ? ' active' : '')}
        onClick={() => setCheckedOnly(!checkedOnly)}>{t(checkedOnly ? 'roles.ui.showAll' : 'roles.ui.checkedOnly')}</button>
      <div class="role-perm-toolbar-actions">
        <button type="button" class="text-btn" disabled={busy || locked} onClick={() => onAction({ kind: 'save-defaults' })}>{t('roles.ui.saveDefaults')}</button>
        <button type="button" class="text-btn role-perm-reset-btn" disabled={busy || locked || defaults === null}
          onClick={() => onAction({ kind: 'restore-defaults' })}>{t('roles.ui.restoreDefaults')}</button>
      </div>
    </div>
    {locked && <div class="role-perm-lock-hint">{t(isLockedRole(role)
      ? role === 'user' ? 'roles.ui.lockUser' : 'roles.ui.lockSuper' : 'roles.ui.customReadonly')}</div>}
    {savedDefaults(data.rolePermissions[role] ?? null) === null && <div class="permission-audit-note">{t('roles.ui.noDefaults')}</div>}
    <div class="permissions-list" id="permissions-list" hidden={collapsed}>
      {categories.length === 0 && <div class="permission-audit-empty">{t('roles.ui.empty')}</div>}
      {categories.map(category => <div key={category.cat}
        class={'perm-category' + (category.children.length ? '' : ' no-sub') + (closedCategories.includes(category.cat) ? ' collapsed' : '')}>
        <div class="perm-category-title" onClick={() => {
          if (category.children.length) setClosedCategories(previous => previous.includes(category.cat)
            ? previous.filter(cat => cat !== category.cat) : [...previous, category.cat]);
        }}>
          <span class="perm-cat-name">{category.cat}{category.entry && infoButton(category.entry.code)}</span>
          {category.entry && toggle(category.entry)}
          {category.entry && inherent.includes(category.entry.code) && <small>{t('roles.ui.inherent')}</small>}
        </div>
        {category.children.length > 0 && <div class="perm-items">{category.children.map(item =>
          <div class={'perm-item' + (locked ? ' perm-item-locked' : '')} key={item.code}>
            <span class="perm-item-label">{item.name}
              {inherent.includes(item.code) && <small>({t('roles.ui.inherent')})</small>}{infoButton(item.code)}
            </span>{toggle(item)}
          </div>)}</div>}
      </div>)}
      {role === 'user' && <div class="perm-category">
        <div class="perm-category-title"><span class="perm-cat-name">{t('roles.ui.capabilities')}</span></div>
        <div class="perm-items">{CAPABILITY_ITEMS.map(item => <div class="perm-item" key={item.code}>
          <span class="perm-item-label">{item.name}{infoButton(item.code)}</span>{toggle(item, true)}
        </div>)}</div>
      </div>}
    </div>
  </div>;
}
