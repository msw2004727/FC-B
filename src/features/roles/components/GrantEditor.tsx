import { useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { getUserPermissionGrantAllowedCodes } from '@/features/profile/data/permissions';
import { mergePermissionCatalog, type CatalogCategory, type CatalogItem } from '../data/permission-catalog';
import { grantState, type UserGrantAction, type UserGrantSnapshot } from '../data/user-grant-model';

export function GrantEditor({ snapshot, catalog, busy, onAction, onInfo }: {
  snapshot: UserGrantSnapshot; catalog: readonly CatalogCategory[]; busy: boolean;
  onAction: (action: UserGrantAction) => void; onInfo: (code: string) => void;
}) {
  const t = useT();
  const [checkedOnly, setCheckedOnly] = useState(false);
  const [closed, setClosed] = useState<string[]>([]);
  let state: ReturnType<typeof grantState>;
  try { state = grantState(snapshot); }
  catch { return <div role="alert">{t('roles.ui.error.invalid-argument')}</div>; }
  const allowed = new Set(getUserPermissionGrantAllowedCodes());
  const categories = mergePermissionCatalog(catalog).map(category => {
    const items = category.items.filter(item => allowed.has(item.code));
    const entry = items.find(item => item.code.endsWith('.entry'));
    return { cat: category.cat, entry: entry && (!checkedOnly || state.permissions.includes(entry.code)) ? entry : undefined,
      children: items.filter(item => item !== entry && (!checkedOnly || state.permissions.includes(item.code))) };
  }).filter(category => category.entry || category.children.length);
  const infoButton = (code: string) => {
    const key = 'roles.info.' + code + '.title';
    return t(key) === key ? null : <button type="button" class="perm-info-btn" title={t('roles.ui.infoLabel')}
      onClick={event => { event.stopPropagation(); onInfo(code); }}>?</button>;
  };
  const toggle = (item: CatalogItem) => {
    const checked = state.permissions.includes(item.code);
    const disabled = busy || !state.enabled;
    const action = (): void => { if (!disabled) onAction({ kind: 'toggle_permission', code: item.code }); };
    return <label class={'toggle-switch' + (checked ? ' active' : '') + (disabled ? ' is-disabled' : '')} tabIndex={disabled ? -1 : 0}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); action(); } }}>
      <input type="checkbox" aria-label={item.name + ' (' + item.code + ')'} checked={checked} disabled={disabled} onChange={action} />
      <span class="toggle-slider" />
    </label>;
  };
  return <div class="permission-audit-section">
    <div class="permission-audit-section-title"><span>{snapshot.targetName}</span>
      <span class="permission-audit-section-meta permission-audit-code">{snapshot.uid}</span></div>
    <div class="perm-item"><span class="perm-item-label">{t('roles.grants.enabled')}</span>
      <label class={'toggle-switch' + (state.enabled ? ' active' : '')}>
        <input type="checkbox" aria-label={t('roles.grants.enabled')} checked={state.enabled} disabled={busy}
          onChange={() => { if (!busy) onAction({ kind: 'update_enabled' }); }} /><span class="toggle-slider" />
      </label></div>
    {!state.enabled && <div class="role-perm-lock-hint">{t('roles.ui.error.grant-disabled')}</div>}
    <div class="role-perm-toolbar"><button type="button" class={'text-btn role-perm-filter-btn' + (checkedOnly ? ' active' : '')}
      onClick={() => setCheckedOnly(!checkedOnly)}>{t(checkedOnly ? 'roles.ui.showAll' : 'roles.ui.checkedOnly')}</button></div>
    <div class="permissions-list">
      {!categories.length && <div class="permission-audit-empty">{t('roles.ui.empty')}</div>}
      {categories.map(category => <div key={category.cat}
        class={'perm-category' + (category.children.length ? '' : ' no-sub') + (closed.includes(category.cat) ? ' collapsed' : '')}>
        <div class="perm-category-title" onClick={() => {
          if (category.children.length) setClosed(previous => previous.includes(category.cat)
            ? previous.filter(cat => cat !== category.cat) : [...previous, category.cat]);
        }}><span class="perm-cat-name">{category.cat}{category.entry && infoButton(category.entry.code)}</span>
          {category.entry && toggle(category.entry)}</div>
        {category.children.length > 0 && <div class="perm-items">{category.children.map(item =>
          <div class="perm-item" key={item.code}><span class="perm-item-label">{item.name}{infoButton(item.code)}</span>{toggle(item)}</div>)}</div>}
      </div>)}
    </div>
  </div>;
}
