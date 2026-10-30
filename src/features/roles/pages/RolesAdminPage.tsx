import '@/styles/legacy/admin-roles.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useGoBack } from '@/core/back-guard';
import { getLastKnownAuthUid } from '@/data/auth';
import { useViewer } from '@/features/profile/data/viewer';
import { isViewerPermissionsLoaded } from '@/features/admin-users/data/viewer-ready';
import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { loadRolesData } from '../data/role-admin';
import {
  ROLES_WRITE_CONFIRM_ENABLED, resetRolePermissions, saveRoleActivityCapabilities,
  saveRolePermissionDefaults, saveRolePermissions,
} from '../data/role-admin-writes';
import { capabilitySource, canManageRoles, prepareRoleChange, type RoleAction, type RolePreview, type RolesData } from '../data/role-model';
import { RoleAdminGuardError } from '../data/role-errors';
import { RoleHierarchyList } from '../components/RoleHierarchyList';
import { PermissionPanel } from '../components/PermissionPanel';
import { PermInfoPopup } from '../components/PermInfoPopup';
import { RoleDiffConfirm } from '../components/RoleDiffConfirm';
import { GrantsTab } from '../components/GrantsTab';

export default function RolesAdminPage({ confirmEnabled = ROLES_WRITE_CONFIRM_ENABLED }: { confirmEnabled?: boolean } = {}) {
  const t = useT();
  const viewer = useViewer();
  const goBack = useGoBack('/');
  const ready = isViewerPermissionsLoaded(viewer);
  const allowed = canManageRoles(viewer);
  const [tab, setTab] = useState<'settings' | 'grants'>('settings');
  const [data, setData] = useState<RolesData | null>(null);
  const [failed, setFailed] = useState(false);
  const [stale, setStale] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState<RolePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const submitting = useRef(false);
  const seq = useRef(0);
  const latestViewer = useRef(viewer);
  latestViewer.current = viewer;
  const loadedUid = useRef<string | null>(null);
  useEffect(() => {
    const request = ++seq.current;
    loadedUid.current = null;
    locked.current = false;
    submitting.current = false;
    setTab('settings'); setData(null); setSelected(null); setPending(null); setInfo(null); setBusy(false); setFailed(false); setStale(false);
    if (!viewer.uid || !ready || !allowed) return undefined;
    const load = async (): Promise<void> => {
      try {
        const result = await loadRolesData();
        if (seq.current !== request || latestViewer.current.uid !== viewer.uid) return;
        loadedUid.current = viewer.uid;
        setData(result);
      } catch {
        if (seq.current === request) setFailed(true);
      }
    };
    load().catch(() => { if (seq.current === request) setFailed(true); });
    return () => { seq.current += 1; loadedUid.current = null; };
  }, [viewer.uid, ready, allowed]);

  useEffect(() => {
    if (selected) document.getElementById('role-perm-panel')?.scrollIntoView?.({ behavior: 'smooth' });
  }, [selected]);

  const showError = (error: unknown): void => {
    toast.show({ message: error instanceof RoleAdminGuardError
      ? t('roles.ui.error.' + error.code) : t('roles.ui.saveFailed'), tone: 'error' });
  };
  const requestChange = (action: RoleAction): void => {
    if (!data || !selected || locked.current || stale || !canManageRoles(latestViewer.current) ||
        loadedUid.current !== latestViewer.current.uid) return;
    try {
      const preview = prepareRoleChange(data, selected, action, latestViewer.current.uid!);
      locked.current = true;
      setPending(preview);
    } catch (error) { showError(error); }
  };
  const cancel = (): void => {
    if (submitting.current) return;
    locked.current = false;
    setPending(null);
  };
  const confirm = async (): Promise<void> => {
    if (!data || !pending || submitting.current) return;
    const original = data;
    const preview = pending;
    const request = seq.current;
    if (!canManageRoles(latestViewer.current) || latestViewer.current.uid !== preview.actorUid) {
      cancel(); showError(new RoleAdminGuardError('permission-denied')); return;
    }
    submitting.current = true;
    setBusy(true);
    // A 樂觀更新只在明確確認後開始；失敗回復整份頁面資料。
    const optimistic = preview.collection === 'rolePermissions'
      ? { ...data, rolePermissions: { ...data.rolePermissions, [preview.role]: preview.after } }
      : { ...data, roleActivityDocuments: { ...data.roleActivityDocuments, [preview.role]: preview.after },
          roleActivityCapabilities: capabilitySource(preview.after) };
    setData(optimistic);
    try {
      const write = preview.action.kind === 'capability' ? saveRoleActivityCapabilities
        : preview.action.kind === 'save-defaults' ? saveRolePermissionDefaults
        : preview.action.kind === 'restore-defaults' ? resetRolePermissions : saveRolePermissions;
      const result = await write(original, preview, preview.fingerprint);
      if (seq.current !== request || latestViewer.current.uid !== preview.actorUid) return;
      setData(preview.collection === 'rolePermissions'
        ? { ...optimistic, rolePermissions: { ...optimistic.rolePermissions, [preview.role]: result.document } }
        : { ...optimistic, roleActivityDocuments: { ...optimistic.roleActivityDocuments, [preview.role]: result.document },
            roleActivityCapabilities: capabilitySource(result.document) });
      setStale(result.refreshFailed);
      toast.show({ message: t(result.refreshFailed ? 'roles.ui.readbackFailed' : 'roles.ui.updated'),
        tone: result.refreshFailed ? 'info' : 'success' });
    } catch (error) {
      if (seq.current !== request || latestViewer.current.uid !== preview.actorUid) return;
      setData(original);
      if (error instanceof RoleAdminGuardError && error.code === 'stale-document') setStale(true);
      showError(error);
    } finally {
      if (seq.current === request) { setBusy(false); setPending(null); locked.current = false; submitting.current = false; }
    }
  };
  const loading = !viewer.uid ? getLastKnownAuthUid() !== null : !ready;
  const ownsData = data !== null && loadedUid.current === viewer.uid;
  return <div class="legacy-ui">
    <section class="page active" id="page-admin-roles" data-min-role="super_admin">
      <div class="page-header">
        <button type="button" class="back-btn" aria-label={t('roles.ui.back')} onClick={goBack}>
          <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button><h2>{t('roles.title')}</h2>
      </div>
      {loading ? <div role="status">{t('roles.ui.loading')}</div>
        : !allowed ? <div role="alert">{t('roles.ui.denied')}</div>
        : failed ? <div role="alert">{t('roles.ui.loadFailed')}</div>
        : !ownsData ? <div role="status">{t('roles.ui.loading')}</div>
        : <>
          <div class="role-admin-tabs">
            <button type="button" id="role-admin-tab-settings" class={'role-admin-tab' + (tab === 'settings' ? ' active' : '')}
              disabled={busy || !!pending} onClick={() => setTab('settings')}>{t('roles.ui.settings')}</button>
            <button type="button" id="role-admin-tab-user-grants" class={'role-admin-tab' + (tab === 'grants' ? ' active' : '')}
              disabled={busy || !!pending} onClick={() => setTab('grants')}>{t('roles.grants.tab')}</button>
          </div>
          <div class="role-admin-pane" id="role-admin-settings-pane" hidden={tab !== 'settings'}>
            {stale && <div role="alert">{t('roles.ui.loadFailed')}</div>}
            <RoleHierarchyList data={data} selected={selected} busy={busy || !!pending}
              onSelect={setSelected} onInfo={setInfo} />
            {selected && <PermissionPanel key={selected} data={data} role={selected} busy={busy || !!pending || stale}
              onAction={requestChange} onInfo={setInfo} />}
          </div>
          <GrantsTab key={viewer.uid!} active={tab === 'grants'} data={data} confirmEnabled={confirmEnabled} />
        </>}
    </section>
    {allowed && ownsData && info && <PermInfoPopup code={info} onClose={() => setInfo(null)} />}
    {allowed && ownsData && pending && <RoleDiffConfirm preview={pending} catalog={data.permissions}
      expanded={confirmEnabled} busy={busy} onCancel={cancel} onConfirm={() => { confirm().catch(showError); }} />}
  </div>;
}
