import { useT } from '@/i18n/i18n';
import { permissionName, type CatalogCategory } from '../data/permission-catalog';
import { canonical, type RolePreview } from '../data/role-model';
import { RolesDialog } from './RolesDialog';
import type { UserGrantPreview } from '../data/user-grant-model';

export function RoleDiffConfirm({ preview, catalog, expanded, busy, onCancel, onConfirm }: {
  preview: RolePreview | UserGrantPreview; catalog: readonly CatalogCategory[]; expanded: boolean; busy: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const t = useT();
  const list = (codes: string[]): string => codes.map(code => permissionName(code, catalog)).join('、') || t('roles.ui.none');
  const fields = [...new Set([...Object.keys(preview.before ?? {}), ...Object.keys(preview.after), ...('role' in preview ? ['defaultPermissions'] : [])])];
  const fieldLabel = (field: string): string => {
    if (field === 'enabled') return t('roles.grants.enabled');
    if (field === 'permissions') return t('roles.ui.permissionsField');
    if (field === 'defaultPermissions') return t('roles.ui.defaultsField');
    if (field === 'capabilities') return t('roles.ui.capabilitiesField');
    return field;
  };
  const value = (field: string, raw: unknown): string => {
    if (raw === undefined) return t(field === 'defaultPermissions' ? 'roles.ui.noDefaults' : 'roles.ui.none');
    if (field === 'updatedBy') return t(raw === preview.actorUid ? 'roles.ui.currentActor' : 'roles.ui.previousActor');
    if (field === 'updatedAt' && raw === 'SERVER_TIMESTAMP') return t('roles.ui.serverTime');
    if (field === 'updatedAt' && raw !== null && typeof raw === 'object' && typeof (raw as { seconds?: unknown }).seconds === 'number') {
      return new Date((raw as { seconds: number }).seconds * 1000).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
    }
    if (Array.isArray(raw) && ['permissions', 'defaultPermissions', 'capabilities'].includes(field)) {
      return raw.map(code => typeof code === 'string' ? permissionName(code, catalog) : canonical(code)).join('、') || t('roles.ui.none');
    }
    return typeof raw === 'string' ? raw : canonical(raw);
  };
  return <RolesDialog title={t('roles.ui.confirmTitle')} onClose={onCancel} busy={busy} footer={<>
    <button type="button" class="outline-btn" disabled={busy} onClick={onCancel}>{t('roles.ui.cancel')}</button>
    <button type="button" class="primary-btn" disabled={busy} onClick={onConfirm}>{t('roles.ui.confirm')}</button>
  </>}>
    {'targetName' in preview && <p>{preview.targetName}</p>}
    <p>{t('roles.ui.added')}：{list(preview.added)}</p>
    <p>{t('roles.ui.removed')}：{list(preview.removed)}</p>
    <p>{t('roles.ui.fields')}</p>
    {!preview.before && <p>{t('roles.ui.before')}：{t('roles.ui.missing')}</p>}
    {/* 旗標只調整展開式／緊湊式呈現，兩態都列完整文件並要求按確認。 */}
    <div class={expanded ? 'role-diff-expanded' : 'role-diff-compact'}>
      {fields.map(field => <div class="role-diff-field" key={field}>
        <strong>{fieldLabel(field)}</strong>
        <div>{t('roles.ui.before')}：{value(field, preview.before?.[field])}</div>
        <div>{t('roles.ui.after')}：{value(field, preview.after[field])}</div>
      </div>)}
    </div>
  </RolesDialog>;
}
