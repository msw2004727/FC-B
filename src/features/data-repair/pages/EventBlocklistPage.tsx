import '@/styles/legacy/admin-repair.css';
import { getLastKnownAuthUid } from '@/data/auth';
import { useViewer } from '@/features/profile/data/viewer';
import { isViewerPermissionsLoaded } from '@/features/admin-users/data/viewer-ready';
import { useT } from '@/i18n/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { canViewEventBlocklist } from '../data/event-blocklist-model';
import { EventBlocklistPanel } from '../components/EventBlocklistPanel';

export default function EventBlocklistPage() {
  const viewer = useViewer();
  const t = useT();
  const waiting = !viewer.uid ? getLastKnownAuthUid() !== null : !isViewerPermissionsLoaded(viewer);
  return <div class="legacy-ui"><section class="page active" id="page-admin-repair">
    {waiting ? <div class="eb-center" role="status">{t('data-repair.blocklist.loading')}</div>
      : !canViewEventBlocklist(viewer) ? <EmptyState title={t('data-repair.blocklist.noPermission')} />
      : <EventBlocklistPanel key={viewer.uid} viewer={viewer} />}
  </section></div>;
}
