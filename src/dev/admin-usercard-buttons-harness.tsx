// 用戶卡按鈕配置預覽 harness（顧問 §3.817；只給本機截圖，不參與正式 build）。正式 UserCard＋記憶體假資料，不連 Firestore、不呼叫 Functions。
// ?case=five（紅標＋站長）| four（非紅標＋站長）| three（一般管理員看非紅標）| flow（紅標＋站長，走解除紅標流程）
//      | black（黑標、到期一週後）| black-none（黑標、沒有到期）
// 只拍正式元件（站長 §3.818 已選建議版 B 並做進 UserCard；原本 ?layout=b 的 DOM 搬移模擬已拿掉，以免把模擬當真）。
// ?theme=light|dark。畫完設 window.__CPS_READY。
// 解除紅標流程照 AdminUsersPage.handleClearLateCancelRed 重現：同一句確認文字（admin-users.lateCancel.confirm）→ 替身成功 →
// lateCancelLevel 改 null → 提示 admin-users.lateCancel.cleared。
import { render } from 'preact';
import { useState } from 'preact/hooks';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/legacy/base.css';
import '../styles/legacy/layout.css';
import '../styles/legacy-line-height.css';
import '@/styles/legacy/admin-users.css';
import { setLocale, t } from '@/i18n/i18n';
import { AppConfirmHost, appConfirm } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import { toast } from '@/ui/Toast';
import { UserCard } from '@/features/admin-users/components/UserCard';
import type { AdminUser } from '@/features/admin-users/data/admin-users-model';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);
const which = params.get('case') || 'five';
const red = which === 'five' || which === 'flow';
const black = which === 'black' || which === 'black-none';
// 黑標到期：harness 執行當下的一週後（lateCancelStatusText 用現在時間判斷有沒有過期）。
const BLACK_UNTIL = which === 'black' ? Date.now() + 7 * 86_400_000 : null;
const superAdmin = which !== 'three';
// 一般管理員：用戶管理四碼（入口、編輯資料、改角色、限制），沒有 admin.repair.no_show_adjust。
const ADMIN_PERMS = new Set(['admin.users.entry', 'admin.users.edit_profile', 'admin.users.change_role', 'admin.users.restrict']);
const actor = {
  uid: 'U_me',
  role: superAdmin ? 'super_admin' : 'admin',
  hasPermission: (code: string) => superAdmin || ADMIN_PERMS.has(code),
};

const START: AdminUser = {
  _docId: 'U_demo_a', uid: 'U_demo_a', lineUserId: '', name: '王示範', role: 'user', email: 'demo-a@example.com', gender: '',
  region: '台北市', sports: '足球', phone: '', birthday: '', exp: 0, pictureUrl: '', teamName: '', isRestricted: false, stealth: false,
  joinedAtMs: null, lastLoginMs: Date.UTC(2026, 10, 25, 4, 30), lastLoginIp: '', lastLoginRegion: '', lastLoginIsp: '',
  lateCancelLevel: red ? 'red' : black ? 'black' : null, lateCancelTotal: red ? 3 : black ? 1 : 0,
  lateCancelLastMs: red ? Date.UTC(2026, 10, 25, 11, 0) : null, lateCancelUntilMs: BLACK_UNTIL,
};

function Screen() {
  const [user, setUser] = useState<AdminUser>(START);
  const [busy, setBusy] = useState(false);
  const clearRed = async (target: AdminUser): Promise<void> => {
    setBusy(true);
    try {
      if (!await appConfirm(t('admin-users.lateCancel.confirm', { name: target.name }))) return;
      setUser((prev) => ({ ...prev, lateCancelLevel: null, lateCancelUntilMs: null }));
      toast.show({ message: t('admin-users.lateCancel.cleared'), tone: 'success' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="legacy-ui">
      <section class="page active" id="page-admin-users">
        <div class="page-header admin-user-page-header">
          <div class="page-search-title-wrap admin-user-page-heading">
            <h2 class="page-header-title">{t('admin-users.title')}</h2>
          </div>
        </div>
        <div class="admin-card-list" id="admin-user-list">
          <UserCard
            user={user}
            actor={actor}
            canViewRawUid
            customRoles={[]}
            busy={busy}
            onEdit={() => {}}
            onToggleRestriction={() => {}}
            onClearLateCancelRed={(target) => { void clearRed(target); }}
            // 預覽「新版後端部署後」的樣子：黑標也出解除鈕（正式由 LATE_CANCEL_CLEAR_BLACK_DEPLOYED 控制，目前 false）
            lateCancelBlackEnabled
            onOpenProfile={() => {}}
            onCpRemoval={superAdmin ? () => {} : undefined}
          />
        </div>
      </section>
    </div>
  );
}

void start();

async function start(): Promise<void> {
  const win = window as unknown as { __CPS_READY?: boolean; __CPS_ERROR?: string };
  try {
    await setLocale('zh-TW');
    const root = document.getElementById('app');
    if (!root) return;
    render(
      <>
        <Screen />
        <ToastHost />
        <AppConfirmHost />
      </>,
      root,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
  }
}
