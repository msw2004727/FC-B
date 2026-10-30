import { useT } from '@/i18n/i18n';
import { getRuntimeRoleSequence, resolveDrawerRoleInfo } from '@/ui/drawer-menu';
import { currentPermissions, type RolesData } from '../data/role-model';

export function RoleHierarchyList({ data, selected, busy, onSelect, onInfo }: {
  data: RolesData; selected: string | null; busy: boolean;
  onSelect: (role: string) => void; onInfo: (code: string) => void;
}) {
  const t = useT();
  return <div class="role-hierarchy-card">
    <div class="role-hierarchy-title">{t('roles.ui.hierarchy')}
      <span style="font-size:.68rem;font-weight:400;color:var(--text-muted)">{t('roles.ui.clickRole')}</span>
      <button type="button" class="perm-info-btn" style="margin-left:auto" title={t('roles.ui.infoLabel')} onClick={() => onInfo('_hierarchy')}>?</button>
    </div>
    <div class="role-hierarchy-list" id="role-hierarchy-list">
      {[...new Set(getRuntimeRoleSequence(data.customRoles))].map((key, index) => {
        const info = resolveDrawerRoleInfo(key, true, data.customRoles);
        return <div class={'role-level-row' + (selected === key ? ' role-level-selected' : '')} key={key}
          role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy} aria-pressed={selected === key}
          style="cursor:pointer" onClick={() => { if (!busy) onSelect(key); }}
          onKeyDown={event => { if (!busy && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(key); } }}>
          <span class="role-level-num">Lv.{index}</span>
          <span class="role-level-badge" style={{ background: info.color }}>{key === 'captain' ? '領隊 / 經理' : info.label}</span>
          <span class="role-perm-count">{currentPermissions(data, key).length}</span>
          <span class="role-level-key">{key} <span class="role-user-count">{data.counts[key] ?? 0}</span>
            {info.custom && <span style="font-size:.6rem;color:var(--accent)">{t('roles.ui.custom')}</span>}
          </span>
        </div>;
      })}
    </div>
  </div>;
}
