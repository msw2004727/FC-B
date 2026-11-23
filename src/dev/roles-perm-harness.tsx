// 權限管理頁權限面板截圖用（只給本機截圖，不參與正式 build）：正式 PermissionPanel／RoleDiffConfirm＋記憶體假資料，不連 Firestore。
// ?theme=light|dark、?role=user|coach|admin、?confirm=host-off（顯示「關閉主辦賽事」確認框）。畫完設 window.__CPS_READY。
import { render } from 'preact';
import { initLocale } from '@/i18n/i18n';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/legacy/base.css';
import '../styles/legacy/layout.css';
import '../styles/legacy-line-height.css';
import '@/styles/legacy/admin-roles.css';
import { PermissionPanel } from '@/features/roles/components/PermissionPanel';
import { RoleDiffConfirm } from '@/features/roles/components/RoleDiffConfirm';
import { prepareRoleChange, type RolesData } from '@/features/roles/data/role-model';

const params = new URLSearchParams(location.search);
document.documentElement.setAttribute('data-theme', params.get('theme') === 'dark' ? 'dark' : 'light');
const role = params.get('role') || 'user';
// 正式站讀回的一般用戶能力（顧問 §3.611：9 碼全開）；教練、管理員用內建預設（文件存在、沒有 disabledCodes）。
const data: RolesData = {
  rolePermissions: {
    coach: { permissions: ['activity.manage.entry', 'admin.tournaments.entry', 'activity.view_noshow'] },
    admin: {
      permissions: ['activity.manage.entry', 'event.create', 'event.edit_all', 'admin.tournaments.entry', 'admin.tournaments.manage_all',
        'team.manage.entry', 'team.create', 'team.manage_all', 'admin.users.entry', 'admin.banners.entry', 'admin.repair.entry'],
    },
  },
  roleActivityDocuments: {
    user: {
      capabilities: ['user.activity.basic_create', 'user.activity.external_create', 'user.activity.own_manage_entry',
        'user.activity.own_edit_basic', 'user.activity.own_cancel', 'user.activity.site_operate', 'user.activity.delegate_assign',
        'user.activity.addons_use', 'user.activity.team_create'],
    },
  },
  roleActivityCapabilities: { user: [] },
  customRoles: [], permissions: [], counts: {},
};
data.roleActivityCapabilities = { user: data.roleActivityDocuments['user']!['capabilities'] as string[] };
const preview = params.get('confirm') === 'host-off'
  ? prepareRoleChange(data, role, role === 'user'
    ? { kind: 'capability', code: 'user.competition.host' } : { kind: 'toggle', code: 'competition.host' }, 'harness')
  : null;

await initLocale();
render(
  <div class="legacy-ui" style="min-height:100vh;background:var(--bg-root)">
    <section class="page active" id="page-admin-roles" style="padding:12px">
      <PermissionPanel data={data} role={role} busy={false} onAction={() => undefined} onInfo={() => undefined} />
    </section>
    {preview && <RoleDiffConfirm preview={preview} catalog={[]} expanded={false} busy={false}
      onCancel={() => undefined} onConfirm={() => undefined} />}
  </div>,
  document.getElementById('app')!,
);
setTimeout(() => {
  (window as unknown as { __CPS_READY: boolean }).__CPS_READY = true;
}, 300);
