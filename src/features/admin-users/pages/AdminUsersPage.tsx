import '@/styles/legacy/admin-users.css';
import type { JSX } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { useGoBack } from '@/core/back-guard';
import type { AdminManageUserResponse } from '@/data/contract/callables';
import { getLastKnownAuthUid } from '@/data/auth';
import { useViewer } from '@/features/profile/data/viewer';
import { isAdminPlusRole } from '@/features/profile/components/legacy/profile-legacy-helpers';
import { useT } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { EmptyState } from '@/ui/EmptyState';
import { getRuntimeRoleSequence, type CustomRoleInput } from '@/ui/drawer-menu';
import { toast } from '@/ui/Toast';

import { UserCard } from '../components/UserCard';
import { UserEditModal } from '../components/UserEditModal';
import { UserFilterPanel, type RoleFilterOption } from '../components/UserFilterPanel';
import {
  ADMIN_USER_PAGE_SIZE,
  EMPTY_FILTER_INPUTS,
  PERM_USERS_ENTRY,
  PERM_USERS_RESTRICT,
  applyEditToUser,
  applyFilters,
  buildEditUpdates,
  buildProfileEditOpLog,
  buildRestrictionOpLog,
  buildRoleChangeOpLog,
  canManageTarget,
  canToggleRestrictionOf,
  hasActiveFilters,
  normalizeFilters,
  roleLabel,
  showsEditButton,
  sliceVisible,
  sortUsersByName,
  type AdminUser,
  type AdminUserActor,
  type AdminUserFilterInputs,
  type EditFormValues,
} from '../data/admin-users-model';
import {
  classifyAdminUserError,
  fetchCustomRoles,
  loadAdminUsers,
  loadMoreAdminUsers,
  manageAdminUser,
  recordUserOpLog,
  sendRoleUpgradeInbox,
  writeUserAudit,
  type AdminUsersLoad,
} from '../data/admin-users';
import { isViewerPermissionsLoaded } from '../data/viewer-ready';

type LoadStatus = 'loading' | 'ready' | 'error';

/**
 * A 沒有的介面：頁首「重新整理」圖示鈕、人數過多時的說明列與「載入更多用戶」鈕、載入失敗的「重試」鈕。
 * 依 R-GOV-007，偏離 A 的介面要先送站長預覽；待站長預覽同意後改 true。
 * 旗標為 false 時：
 *  - 三組元素都不渲染（載入失敗只顯示純文字錯誤訊息，不放按鈕）；
 *  - 人數超過上限時資料層仍只讀第一批（不顯示說明列、也沒有載入更多的入口），名單只涵蓋已載入的用戶；
 *  - 手動重新整理入口消失，要重讀名單請重新進入頁面。
 * 測試用 props 的 extraUiEnabled 注入，不必改原始碼。
 */
export const ADMIN_USERS_EXTRA_UI_ENABLED = false;

export interface AdminUsersPageProps {
  /** 測試注入；未傳用 ADMIN_USERS_EXTRA_UI_ENABLED。 */
  extraUiEnabled?: boolean;
}

const CENTER_NOTE = 'text-align:center;padding:2rem;color:var(--text-muted)';

/**
 * 後台「用戶管理」頁（路由 `/admin/users`，M-142）。DOM／class 照 A `pages/admin-users.html`。
 * - 權限：入口 `admin.users.entry`；編輯資料 `admin.users.edit_profile`、變更角色 `admin.users.change_role`、限制 `admin.users.restrict`
 *   （按鈕顯示與送出守衛共用 admin-users-model 的同一組 helper）。
 * - 讀取：進頁一次性讀取（非即時監聽），右上角可手動重新整理；離開頁面即釋放。
 * - 不做：歷史入隊補正、自訂角色新增刪除、LINE 推播、手動 EXP。
 */
export default function AdminUsersPage({
  extraUiEnabled = ADMIN_USERS_EXTRA_UI_ENABLED,
}: AdminUsersPageProps = {}): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const location = useLocation();
  const goBack = useGoBack('/');

  const actor = useMemo<AdminUserActor>(
    () => ({ uid: viewer.uid, role: viewer.role, hasPermission: viewer.hasPermission }),
    [viewer],
  );
  // F3（L-43）：useViewer 先給「權限一律 false」的最小 viewer，完整資料到位前不能判成沒權限。
  const permsLoaded = isViewerPermissionsLoaded(viewer);
  const canAccess = viewer.hasPermission(PERM_USERS_ENTRY);

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [loadInfo, setLoadInfo] = useState<AdminUsersLoad | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRoleInput[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [inputs, setInputs] = useState<AdminUserFilterInputs>(EMPTY_FILTER_INPUTS);
  const [visibleCount, setVisibleCount] = useState(ADMIN_USER_PAGE_SIZE);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadSeqRef = useRef(0);
  const busyRef = useRef(false);
  const loadInfoRef = useRef<AdminUsersLoad | null>(null);
  loadInfoRef.current = loadInfo;
  const usersRef = useRef<AdminUser[]>([]);
  usersRef.current = users;
  // 確認框（await）之後要用「現在」的操作者權限再驗一次，不能用點擊當下的舊閉包。
  const actorRef = useRef<AdminUserActor>(actor);
  actorRef.current = actor;
  /** 開啟編輯彈窗的「編輯」鈕與那個人的文件 ID；彈窗關閉後把焦點還給它（F13）。 */
  const editTriggerRef = useRef<{ node: HTMLElement; docId: string } | null>(null);
  const wasEditingRef = useRef(false);

  const load = useCallback(async (manual: boolean): Promise<void> => {
    const seq = ++loadSeqRef.current;
    if (manual) setRefreshing(true);
    else setStatus('loading');
    try {
      const [result, roles] = await Promise.all([loadAdminUsers(), fetchCustomRoles()]);
      if (seq !== loadSeqRef.current) return;
      setLoadInfo(result);
      setUsers(result.users);
      setCustomRoles(roles);
      setStatus('ready');
      if (manual) toast.show({ message: t('admin-users.toast.refreshed'), tone: 'success' });
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[admin-users] load failed', err);
      if (seq !== loadSeqRef.current) return;
      if (manual) toast.show({ message: t('admin-users.toast.refreshFailed'), tone: 'error' });
      else setStatus('error');
    } finally {
      if (manual) setRefreshing(false);
    }
  }, [t]);

  // L-43：uid 到位且有入口權限才讀取；uid 變動重讀。
  useEffect(() => {
    if (!viewer.uid || !permsLoaded || !canAccess) return undefined;
    load(false).catch(() => {
      // load 內部已處理錯誤。
    });
    return () => {
      loadSeqRef.current += 1;
    };
  }, [viewer.uid, permsLoaded, canAccess, load]);

  useEffect(() => {
    if (!filterOpen) return;
    document.getElementById('admin-user-search')?.focus({ preventScroll: true });
  }, [filterOpen]);

  // F13：彈窗關閉後把焦點還給「編輯」鈕。必須等整個 commit 完成才做：Preact 會先卸載被移除的彈窗、才更新其他節點，
  // 彈窗卸載當下卡片按鈕還是 disabled（busy 尚未改回 false），在那裡 focus() 會無效。
  useLayoutEffect(() => {
    if (editTarget) {
      wasEditingRef.current = true;
      return;
    }
    if (!wasEditingRef.current) return;
    wasEditingRef.current = false;
    const saved = editTriggerRef.current;
    editTriggerRef.current = null;
    if (!saved) return;
    // 原節點通常還在；若名單重繪過，改用 data-edit-user-doc 找同一個人的鈕。
    const candidates = [
      saved.node,
      ...Array.from(document.querySelectorAll<HTMLElement>('[data-edit-user-doc]'))
        .filter((el) => el.dataset['editUserDoc'] === saved.docId),
    ];
    const target = candidates.find((el) => el.isConnected && !(el as HTMLButtonElement).disabled);
    target?.focus();
  }, [editTarget]);

  const filters = useMemo(() => normalizeFilters(inputs), [inputs]);
  const filtered = useMemo(
    () => sortUsersByName(applyFilters(users, filters, Date.now())),
    [users, filters],
  );
  const page = useMemo(() => sliceVisible(filtered, visibleCount), [filtered, visibleCount]);

  const roleOptions = useMemo<RoleFilterOption[]>(() => {
    const seen = new Set<string>(['']);
    const keys = [...getRuntimeRoleSequence(customRoles), ...users.map((user) => user.role)].filter((key) => {
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return keys.map((key) => ({ value: key, label: roleLabel(key, customRoles) }));
  }, [customRoles, users]);

  const openProfile = useCallback((uid: string): void => {
    if (uid) location.route(`/profile/${encodeURIComponent(uid)}`);
  }, [location]);

  const errorMessage = (err: unknown, fallbackKey: string, params?: Record<string, string | number>): string => {
    switch (classifyAdminUserError(err)) {
      case 'permission': return t('admin-users.error.permission');
      case 'not_found': return t('admin-users.error.notFound');
      case 'precondition': return t('admin-users.toast.cannotRestrictSelf');
      default: return t(fallbackKey, params);
    }
  };

  const findUser = (docId: string): AdminUser | null => users.find((user) => user._docId === docId) ?? null;

  /** A `_writeOpLog` 的 operator：顯示名稱 → 角色中文名 → 系統。 */
  const operatorName = (): string =>
    viewer.displayName?.trim() || roleLabel(viewer.role, customRoles) || '系統';

  const handleOpenEditor = (user: AdminUser, trigger: HTMLElement): void => {
    const target = findUser(user._docId);
    if (!target) {
      toast.show({ message: t('admin-users.toast.userNotFound'), tone: 'error' });
      return;
    }
    // 與列表「編輯」鈕同一個 helper（R-IAM-011）。
    if (!showsEditButton(actor, target)) {
      toast.show({ message: t('admin-users.toast.noPermission'), tone: 'error' });
      return;
    }
    editTriggerRef.current = { node: trigger, docId: target._docId };
    setEditTarget(target);
  };

  /** 伺服器實際改到的文件和本機這筆不是同一份（舊資料 uid 對到別的文件）：本機畫面可能不準，重新讀取名單。 */
  const reloadIfDocMismatch = (response: AdminManageUserResponse, target: AdminUser): void => {
    if (response.targetDocId && response.targetDocId !== target._docId) {
      load(true).catch(() => undefined);
    }
  };

  const handleSave = async (form: EditFormValues): Promise<void> => {
    const target = editTarget;
    if (!target || busyRef.current) return;
    if (!showsEditButton(actor, target)) {
      toast.show({ message: t('admin-users.toast.noPermission'), tone: 'error' });
      return;
    }
    const built = buildEditUpdates(actor, target, form);
    if (!built.ok) {
      toast.show({
        message: built.reason === 'invalid_email' ? t('admin-users.toast.invalidEmail') : t('admin-users.toast.noChange'),
        tone: built.reason === 'invalid_email' ? 'error' : 'info',
      });
      return;
    }

    busyRef.current = true;
    setBusy(true);
    let response: AdminManageUserResponse;
    try {
      response = await manageAdminUser({
        actor,
        target,
        profileUpdates: built.profileUpdates,
        customRoles,
        ...(built.role !== null ? { role: built.role } : {}),
      });
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[admin-users] saveUserEdit', err);
      toast.show({ message: errorMessage(err, 'admin-users.toast.saveFailed'), tone: 'error' });
      busyRef.current = false;
      setBusy(false);
      return;
    }

    setUsers((prev) => prev.map((user) =>
      user._docId === target._docId ? applyEditToUser(user, built.profileUpdates, built.role) : user));
    setEditTarget(null);
    toast.show({ message: t('admin-users.toast.updated', { name: target.name }), tone: 'success' });
    busyRef.current = false;
    setBusy(false);
    reloadIfDocMismatch(response, target);

    // 主操作已成功；以下皆 best-effort（失敗只 warn，不影響結果）。
    const targetUid = response.targetUid || target.uid;
    await writeUserAudit({
      action: 'admin_user_edit',
      target: { uid: targetUid, name: target.name },
      statusFrom: target.role,
      statusTo: built.role ?? '',
    });
    if (built.role !== null) {
      await writeUserAudit({
        action: 'role_change',
        target: { uid: targetUid, name: target.name },
        statusFrom: target.role,
        statusTo: built.role,
      });
    }
    // 操作日誌：actorUid 是操作者（viewer）自己，被改的用戶只出現在 content。
    if (built.role !== null) {
      await recordUserOpLog({
        ...buildRoleChangeOpLog(target.name, target.role, built.role, customRoles),
        actorUid: viewer.uid,
        operator: operatorName(),
      });
    }
    const profileLog = buildProfileEditOpLog(target.name, built.profileUpdates);
    if (profileLog) {
      await recordUserOpLog({ ...profileLog, actorUid: viewer.uid, operator: operatorName() });
    }
    if (built.role !== null) {
      await sendRoleUpgradeInbox({
        targetUid,
        userName: target.name,
        roleName: roleLabel(built.role, customRoles),
        senderUid: viewer.uid,
      });
    }
  };

  const handleToggleRestriction = async (user: AdminUser): Promise<void> => {
    if (busyRef.current) return;
    if (!actor.hasPermission(PERM_USERS_RESTRICT)) {
      toast.show({ message: t('admin-users.toast.noPermission'), tone: 'error' });
      return;
    }
    const target = findUser(user._docId);
    if (!target) {
      toast.show({ message: t('admin-users.toast.restrictUserNotFound'), tone: 'error' });
      return;
    }
    if (target.role === 'super_admin') {
      toast.show({ message: t('admin-users.toast.cannotRestrictSuperAdmin'), tone: 'error' });
      return;
    }
    if (target.role !== 'user' || !canManageTarget(actor, target)) {
      toast.show({ message: t('admin-users.toast.onlyUserRole'), tone: 'error' });
      return;
    }
    if (actor.uid && target.uid && actor.uid === target.uid) {
      toast.show({ message: t('admin-users.toast.cannotRestrictSelf'), tone: 'error' });
      return;
    }

    // F2：點擊當下就上鎖——確認框開著時不會再排第二個確認框或第二次送出；取消或結束時解鎖（只解自己這一次的鎖）。
    busyRef.current = true;
    setBusy(true);
    let locked = true;
    const release = (): void => {
      if (!locked) return;
      locked = false;
      busyRef.current = false;
      setBusy(false);
    };
    try {
      const next = !target.isRestricted;
      const action = next ? t('admin-users.restrict.do') : t('admin-users.restrict.undo');
      const ok = await appConfirm(t('admin-users.restrict.confirm', { action, name: target.name }));
      if (!ok) return;

      // 確認框開著的期間名單或權限可能變了：用最新那筆資料與最新的操作者權限（actorRef）再驗一次。
      const latest = usersRef.current.find((item) => item._docId === target._docId) ?? null;
      if (!latest) {
        toast.show({ message: t('admin-users.toast.restrictUserNotFound'), tone: 'error' });
        return;
      }
      if (!canToggleRestrictionOf(actorRef.current, latest)) {
        toast.show({ message: t('admin-users.toast.noPermission'), tone: 'error' });
        return;
      }
      if (latest.isRestricted !== target.isRestricted) return;

      let response: AdminManageUserResponse;
      try {
        response = await manageAdminUser({ actor: actorRef.current, target: latest, restriction: next });
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[admin-users] toggleUserRestriction', err);
        toast.show({ message: errorMessage(err, 'admin-users.restrict.failed', { action }), tone: 'error' });
        return;
      }

      setUsers((prev) => prev.map((item) =>
        item._docId === target._docId ? { ...item, isRestricted: next } : item));
      toast.show({
        message: next ? t('admin-users.toast.restricted') : t('admin-users.toast.unrestricted'),
        tone: 'success',
      });
      release();
      reloadIfDocMismatch(response, target);

      // 主操作已成功；以下皆 best-effort。稽核用伺服器回傳的 targetUid（與編輯流程一致）。
      await recordUserOpLog({
        ...buildRestrictionOpLog(target.name, next),
        actorUid: viewer.uid,
        operator: operatorName(),
      });
      await writeUserAudit({
        action: 'admin_user_edit',
        target: { uid: response.targetUid || target.uid, name: target.name },
        statusFrom: next ? 'active' : 'restricted',
        statusTo: next ? 'restricted' : 'active',
      });
    } finally {
      release();
    }
  };

  const handleLoadMoreUsers = async (): Promise<void> => {
    const current = loadInfoRef.current;
    if (!current || current.done) return;
    // 序號保護：載入期間若發生重新整理（或離開頁面），這批結果作廢。
    const seq = loadSeqRef.current;
    setRefreshing(true);
    try {
      const next = await loadMoreAdminUsers(current);
      if (seq !== loadSeqRef.current) return;
      setLoadInfo(next);
      // 只補「本機還沒有」的新用戶，不覆蓋已套用的本機變更（例如剛限制的人）。
      setUsers((prev) => {
        const known = new Set(prev.map((user) => user._docId));
        return [...prev, ...next.users.filter((user) => !known.has(user._docId))];
      });
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[admin-users] load more failed', err);
      if (seq === loadSeqRef.current) toast.show({ message: t('admin-users.toast.refreshFailed'), tone: 'error' });
    } finally {
      setRefreshing(false);
    }
  };

  const shell = (children: JSX.Element): JSX.Element => (
    <div class="legacy-ui">
      <section class="page active" id="page-admin-users">
        {children}
      </section>
    </div>
  );

  if (!viewer.uid) {
    if (getLastKnownAuthUid() === null) {
      return shell(<EmptyState title={t('admin-users.access.deniedTitle')} body={t('admin-users.access.deniedBody')} />);
    }
    return shell(<div style={CENTER_NOTE} role="status">{t('admin-users.list.loading')}</div>);
  }
  if (!permsLoaded) {
    return shell(<div style={CENTER_NOTE} role="status">{t('admin-users.list.loading')}</div>);
  }
  if (!canAccess) {
    return shell(<EmptyState title={t('admin-users.access.deniedTitle')} body={t('admin-users.access.deniedBody')} />);
  }

  const filterActive = filterOpen || hasActiveFilters(filters);

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-admin-users">
        <div class="page-header admin-user-page-header">
          <button type="button" class="back-btn" aria-label={t('admin-users.back')} onClick={goBack}>
            <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div class="page-search-title-wrap admin-user-page-heading">
            <h2 class="page-header-title">{t('admin-users.title')}</h2>
            <button
              type="button"
              class={`page-search-toggle-btn admin-user-filter-toggle-btn${filterActive ? ' active' : ''}`}
              id="admin-user-filter-toggle"
              aria-label={t('admin-users.filter.toggleLabel')}
              aria-expanded={filterOpen ? 'true' : 'false'}
              aria-controls="admin-user-filter-panel"
              onClick={() => setFilterOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
            </button>
            {extraUiEnabled && (
              <button
                type="button"
                class="page-search-toggle-btn admin-user-refresh-btn"
                id="admin-user-refresh"
                aria-label={t('admin-users.list.refresh')}
                title={t('admin-users.list.refresh')}
                disabled={refreshing || status === 'loading'}
                onClick={() => { load(true).catch(() => undefined); }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M23 4v6h-6" />
                  <path d="M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <UserFilterPanel
          open={filterOpen}
          inputs={inputs}
          roleOptions={roleOptions}
          onChange={(patch) => {
            setInputs((prev) => ({ ...prev, ...patch }));
            setVisibleCount(ADMIN_USER_PAGE_SIZE);
          }}
        />
        {extraUiEnabled && loadInfo?.partial && status === 'ready' && (
          <div class="admin-user-meta" role="status" style="padding:.4rem .5rem;white-space:normal">
            {loadInfo.total !== null
              ? t('admin-users.list.partialNote', { loaded: users.length, total: loadInfo.total })
              : t('admin-users.list.partialUnknown', { loaded: users.length })}
            {' '}
            <button type="button" class="outline-btn" style="font-size:.78rem;padding:.3rem .8rem" disabled={refreshing} onClick={() => { handleLoadMoreUsers().catch(() => undefined); }}>
              {t('admin-users.list.loadMoreUsers')}
            </button>
          </div>
        )}
        <div class="admin-card-list" id="admin-user-list">
          {status === 'loading' && <div style={CENTER_NOTE} role="status">{t('admin-users.list.loading')}</div>}
          {status === 'error' && (
            <div style={CENTER_NOTE} role="alert">
              <div>{t('admin-users.list.loadFailed')}</div>
              {extraUiEnabled && (
                <button type="button" class="outline-btn" style="margin-top:.6rem" onClick={() => { load(false).catch(() => undefined); }}>
                  {t('admin-users.list.retry')}
                </button>
              )}
            </div>
          )}
          {status === 'ready' && filtered.length === 0 && (
            <div style={CENTER_NOTE}>{t('admin-users.list.empty')}</div>
          )}
          {status === 'ready' && page.visible.map((user) => (
            <UserCard
              key={user._docId}
              user={user}
              actor={actor}
              canViewRawUid={isAdminPlusRole(viewer.role)}
              customRoles={customRoles}
              busy={busy}
              onEdit={handleOpenEditor}
              onToggleRestriction={(target) => { handleToggleRestriction(target).catch(() => undefined); }}
              onOpenProfile={openProfile}
            />
          ))}
          {status === 'ready' && page.hasMore && (
            <div style="padding:1rem 0;text-align:center">
              <button
                type="button"
                class="outline-btn"
                style="font-size:.85rem;padding:.55rem 1.5rem"
                onClick={() => setVisibleCount((count) => count + ADMIN_USER_PAGE_SIZE)}
              >
                {t('admin-users.list.loadMore', { shown: Math.max(visibleCount, ADMIN_USER_PAGE_SIZE), total: filtered.length })}
              </button>
            </div>
          )}
        </div>
      </section>
      {editTarget && (
        <UserEditModal
          user={editTarget}
          actor={actor}
          customRoles={customRoles}
          busy={busy}
          onClose={() => setEditTarget(null)}
          onSubmit={(form) => { handleSave(form).catch(() => undefined); }}
        />
      )}
    </div>
  );
}
