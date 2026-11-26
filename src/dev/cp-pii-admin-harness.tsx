// 「賽事個資移除」後台面板預覽 harness（只給本機截圖，不參與正式 build）：正式 UserCard／CpRemovalModal＋記憶體假資料，
// 不連 Firestore、不呼叫 Functions（試算、執行都是假的）。
// ?role=super_admin|admin、?run=done|stale|busy、?theme=light|dark。畫完設 window.__CPS_READY；點擊流程由截圖腳本操作。
import { render } from 'preact';
import { useState } from 'preact/hooks';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/legacy/base.css';
import '../styles/legacy/layout.css';
import '../styles/legacy-line-height.css';
import '@/styles/legacy/admin-users.css';
import { setLocale } from '@/i18n/i18n';
import { AppConfirmHost } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import { UserCard } from '@/features/admin-users/components/UserCard';
import type { AdminUser } from '@/features/admin-users/data/admin-users-model';
import { CpRemovalModal, type CpRemovalApi } from '@/features/admin-users/cp-removal/CpRemovalModal';
import { CpCallError, type CpAdminRemovalDryRun, type CpDataRemovalResult } from '@/features/competitions/data/cp-callables';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);
const role = params.get('role') === 'admin' ? 'admin' : 'super_admin';
const runMode = params.get('run') || 'done';

function user(id: string, name: string, patch: Partial<AdminUser> = {}): AdminUser {
  return {
    _docId: id, uid: id, lineUserId: '', name, role: 'user', email: '', gender: '', region: '台北市', sports: '足球',
    phone: '', birthday: '', exp: 0, pictureUrl: '', teamName: '', isRestricted: false, stealth: false,
    joinedAtMs: null, lastLoginMs: Date.UTC(2026, 10, 25, 4, 30), lastLoginIp: '', lastLoginRegion: '', lastLoginIsp: '',
    lateCancelLevel: null, lateCancelTotal: 0, lateCancelLastMs: null, lateCancelUntilMs: null, ...patch,
  };
}
const USERS = [
  user('U_demo_a', '王示範', { email: 'demo-a@example.com' }),
  user('U_demo_b', '林小明', { email: 'demo-b@example.com', region: '新北市' }),
];

const SUMMARY: CpAdminRemovalDryRun = {
  dryRun: true,
  subject: 'u_3f9a0000',
  reasonCode: 'subject_request',
  generatedAt: '2026-11-26T14:00:00+08:00',
  confirmToken: 'dr_demo',
  expiresAt: '2026-11-29T14:00:00+08:00',
  competitions: [
    {
      cid: 'cp_a', name: '2027 春季社區五人制足球聯賽', roles: ['player', 'scorer'], phase: 'started',
      now: { rosterDeidentify: 1, statsNameReplace: 2, staffNameClear: 1, auditPseudonymize: 3, scorerAuditRekey: 1, cpMineDelete: 1 },
      later: { reasons: ['staff_active'], until: '指派到期' },
    },
    {
      cid: 'cp_b', name: '冬季友誼盃', roles: ['rep'], phase: 'started',
      now: { entryRegistrantClear: 1, addedByClear: 2, cpMineDelete: 1 },
      later: { reasons: ['rep_contact_active', 'invite_open'], until: '賽事結束、邀請到期' },
    },
    {
      cid: 'cp_c', name: '新春迎新友誼賽', roles: ['player'], phase: 'roster_open',
      now: { rosterDelete: 1, cpMineDelete: 1 },
      later: null,
    },
  ],
  totals: { competitions: 3, writesNow: 16, writesLater: 2 },
  irreversible: ['真名', '報隊聯絡資料', '記分員顯示名', '操作紀錄上的代碼換成無法對回本人的假名', '邀請紀錄上的發出人代碼換成無法對回本人的假名'],
  warnings: [],
  limitations: [
    '只代填過球員、自己在賽事系統沒有任何紀錄的人，那幾場不會列在這裡，請由隊伍代表從名單移除。',
    '檢舉紀錄依 180 天規則另行處理，主站會員資料不在這裡處理。',
  ],
};

const RUN: Record<string, () => Promise<CpDataRemovalResult>> = {
  done: async () => ({ status: 'waiting', processed: 1, waiting: [{ cid: 'cp_a', reason: 'staff_active' }, { cid: 'cp_b', reason: 'rep_contact_active' }] }),
  stale: async () => { throw new CpCallError('DRY_RUN_STALE', {}); },
  busy: () => new Promise<CpDataRemovalResult>(() => {}),
};
const api: CpRemovalApi = {
  dryRun: async () => SUMMARY,
  run: RUN[runMode] ?? RUN.done!,
};
const actor = { uid: 'U_me', role, hasPermission: () => true };

function Screen() {
  const [target, setTarget] = useState<AdminUser | null>(null);
  return (
    <div class="legacy-ui">
      <section class="page active" id="page-admin-users">
        <div class="page-header admin-user-page-header">
          <div class="page-search-title-wrap admin-user-page-heading">
            <h2 class="page-header-title">用戶管理</h2>
          </div>
        </div>
        <div class="admin-card-list" id="admin-user-list">
          {USERS.map((item) => (
            <UserCard
              key={item._docId}
              user={item}
              actor={actor}
              canViewRawUid
              customRoles={[]}
              busy={false}
              onEdit={() => {}}
              onToggleRestriction={() => {}}
              onOpenProfile={() => {}}
              // 正式頁只給 super_admin 入口；admin 視角的面板由 ?open=1 直接打開（入口目前只給 super_admin）
              onCpRemoval={role === 'super_admin' ? setTarget : undefined}
            />
          ))}
        </div>
      </section>
      {target || (role === 'admin' && params.get('open') === '1') ? (
        <CpRemovalModal
          uid={(target ?? USERS[0]!).uid}
          name={(target ?? USERS[0]!).name}
          canRun={role === 'super_admin'}
          api={api}
          onClose={() => setTarget(null)}
        />
      ) : null}
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
