import { useEffect, useRef, useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { useViewer } from '@/features/profile/data/viewer';
import type { AdminUser } from '@/features/admin-users/data/admin-users-model';
import { roleLabel } from '@/features/admin-users/data/admin-users-model';
import { toast } from '@/ui/Toast';
import { canManageRoles, type RolesData } from '../data/role-model';
import { loadUserGrant } from '../data/user-grant-admin';
import { prepareUserGrantChange, type UserGrantAction, type UserGrantPreview, type UserGrantSnapshot } from '../data/user-grant-model';
import { toggleUserGrantEnabled, toggleUserGrantPermission } from '../data/user-grant-writes';
import { RoleAdminGuardError } from '../data/role-errors';
import { RoleDiffConfirm } from './RoleDiffConfirm';
import { PermInfoPopup } from './PermInfoPopup';
import { GrantEditor } from './GrantEditor';
import { useGrantUsers } from './use-grant-users';

export function GrantsTab({ active, data, confirmEnabled }: { active: boolean; data: RolesData; confirmEnabled: boolean }) {
  const t = useT();
  const viewer = useViewer();
  const latestViewer = useRef(viewer); latestViewer.current = viewer;
  const [query, setQuery] = useState('');
  const users = useGrantUsers(active, query);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [snapshot, setSnapshot] = useState<UserGrantSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<UserGrantPreview | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const seq = useRef(0);
  const locked = useRef(false);
  const submitting = useRef(false);
  useEffect(() => () => { seq.current += 1; }, []);
  useEffect(() => { if (!active && !submitting.current) { setPending(null); setInfo(null); locked.current = false; } }, [active]);
  const showError = (error: unknown): void => {
    toast.show({ message: t(error instanceof RoleAdminGuardError ? 'roles.ui.error.' + error.code : 'roles.grants.saveFailed'), tone: 'error' });
  };
  const select = async (user: AdminUser): Promise<void> => {
    if (locked.current || !canManageRoles(latestViewer.current)) return;
    const actorUid = latestViewer.current.uid;
    const request = ++seq.current;
    setSelected(user); setSnapshot(null); setLoading(true); setFailed(false); setStale(false);
    try {
      const result = await loadUserGrant(user.uid, user.name);
      if (seq.current === request && latestViewer.current.uid === actorUid) setSnapshot(result);
    } catch { if (seq.current === request) setFailed(true); }
    finally { if (seq.current === request) setLoading(false); }
  };
  const requestChange = (action: UserGrantAction): void => {
    if (!snapshot || locked.current || stale || !canManageRoles(latestViewer.current)) return;
    try {
      const preview = prepareUserGrantChange(snapshot, action, latestViewer.current.uid!);
      locked.current = true; setPending(preview);
    } catch (error) { showError(error); }
  };
  const cancel = (): void => { if (!submitting.current) { locked.current = false; setPending(null); } };
  const confirm = async (): Promise<void> => {
    if (!snapshot || !pending || submitting.current) return;
    const original = snapshot;
    const preview = pending;
    const request = seq.current;
    if (!canManageRoles(latestViewer.current) || latestViewer.current.uid !== preview.actorUid) {
      cancel(); showError(new RoleAdminGuardError('permission-denied')); return;
    }
    submitting.current = true; setBusy(true);
    const optimistic = { ...original, document: preview.after };
    setSnapshot(optimistic);
    try {
      const write = preview.action.kind === 'toggle_permission' ? toggleUserGrantPermission : toggleUserGrantEnabled;
      const result = await write(original, preview, preview.fingerprint);
      if (seq.current !== request || latestViewer.current.uid !== preview.actorUid) return;
      setSnapshot({ ...original, document: result.document }); setStale(result.refreshFailed);
      toast.show({ message: t(result.refreshFailed ? 'roles.ui.readbackFailed' : 'roles.grants.updated'), tone: result.refreshFailed ? 'info' : 'success' });
    } catch (error) {
      if (seq.current !== request || latestViewer.current.uid !== preview.actorUid) return;
      setSnapshot(original);
      if (error instanceof RoleAdminGuardError && error.code === 'stale-document') setStale(true);
      showError(error);
    } finally {
      if (seq.current === request) { setBusy(false); setPending(null); locked.current = false; submitting.current = false; }
    }
  };
  return <div class="role-admin-pane" id="role-admin-user-grants-pane" hidden={!active}>
    <div class="permission-audit-card">
      <div class="permission-audit-head"><div><div class="permission-audit-title">{t('roles.grants.title')}</div>
        <div class="permission-audit-note">{t('roles.grants.note')}</div></div></div>
      <div class="form-row" style={{ marginTop: '.75rem' }}><label for="user-permission-grant-search">{t('roles.grants.search')}</label>
        <input type="search" id="user-permission-grant-search" placeholder={t('roles.grants.placeholder')}
          value={query} onInput={event => setQuery(event.currentTarget.value)} /></div>
      <div id="user-permission-grant-results" class="permission-audit-list">
        {users.busy && <div role="status">{t('roles.ui.loading')}</div>}
        {users.failed && <div role="alert">{t('roles.ui.loadFailed')}<button type="button" class="text-btn" onClick={users.retry}>{t('roles.grants.retry')}</button></div>}
        {!users.busy && !users.failed && !users.users.length && <div class="permission-audit-empty">{t('roles.grants.noUsers')}</div>}
        {users.users.map(user => <button key={user._docId} type="button" disabled={busy || !!pending}
          class={'permission-audit-issue ' + (selected?.uid === user.uid ? 'is-selected' : '')} style={{ width: '100%', textAlign: 'left' }}
          onClick={() => { select(user).catch(showError); }}>
          <span class={'permission-audit-badge ' + (selected?.uid === user.uid ? 'ok' : 'neutral')}>{roleLabel(user.role, data.customRoles)}</span>
          <div><div class="permission-audit-issue-title">{user.name}</div><div class="permission-audit-issue-detail permission-audit-code">{user.uid}</div></div>
        </button>)}
        {users.partial && <div class="permission-audit-note">{t('roles.grants.partial')}</div>}
        {users.hasMore && <button type="button" class="text-btn" disabled={users.busy} onClick={users.more}>{t('roles.grants.more')}</button>}
      </div>
      <div id="user-permission-grant-editor" class="permission-audit-report" style={{ marginTop: '.85rem' }}>
        {!selected ? <div class="permission-audit-empty">{t('roles.grants.selectFirst')}</div>
          : loading ? <div class="permission-audit-empty" role="status">{t('roles.grants.loading')}</div>
          : failed ? <div role="alert">{t('roles.grants.loadFailed')}<button type="button" class="text-btn"
              onClick={() => { select(selected).catch(showError); }}>{t('roles.grants.retry')}</button></div>
          : snapshot && <>
            {stale && <div role="alert">{t('roles.ui.loadFailed')}</div>}
            <GrantEditor key={snapshot.uid} snapshot={snapshot} catalog={data.permissions} busy={busy || !!pending || stale}
              onAction={requestChange} onInfo={setInfo} />
          </>}
      </div>
    </div>
    {active && info && <PermInfoPopup code={info} onClose={() => setInfo(null)} />}
    {active && pending && <RoleDiffConfirm preview={pending} catalog={data.permissions} expanded={confirmEnabled}
      busy={busy} onCancel={cancel} onConfirm={() => { confirm().catch(showError); }} />}
  </div>;
}
