import { useRef, useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import { requestViewerRefresh } from '@/features/profile/data/viewer';
import { adjustRosterStatus, type RosterStatusSnapshot } from '../data/roster-status';
import type { RosterStatusAction } from '../data/roster-status-policy';

export interface RosterStatusActionsOptions {
  eventId: string;
  getLatest: () => RosterStatusSnapshot;
  reload: () => Promise<RosterStatusSnapshot>;
  flush: () => Promise<void>;
  isCurrent: () => boolean;
  submitting: boolean;
  setSubmitting: (value: boolean) => void;
}
/** 名單狀態調整；同步鎖先於確認框，並與既有名單操作共用 submitting。 */
export function useRosterStatusActions(options: RosterStatusActionsOptions) {
  const t = useT();
  const latest = useRef(options);
  latest.current = options;
  const lock = useRef(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  async function perform(action: RosterStatusAction, target: {
    userId: string; name: string; isCompanion?: boolean;
  }): Promise<void> {
    if (lock.current || latest.current.submitting || !latest.current.isCurrent()) return;
    lock.current = true;
    const start = latest.current;
    const actorUid = start.getLatest().context.uid;
    const valid = () => start.isCurrent() && latest.current.eventId === start.eventId
      && latest.current.getLatest().context.uid === actorUid;
    const key = action + ':' + target.userId;
    setPending({ [key]: true });
    start.setSubmitting(true);
    try {
      const result = await adjustRosterStatus({
        action, target, eventId: start.eventId, t,
        getLatest: () => {
          const snapshot = latest.current.getLatest();
          return valid() ? snapshot : { ...snapshot, context: { ...snapshot.context, uid: null } };
        },
        reload: async () => {
          if (!valid()) throw new Error('stale');
          const fresh = await latest.current.reload();
          if (!valid()) throw new Error('stale');
          return fresh;
        },
        flush: () => latest.current.flush(),
        refreshPermissions: requestViewerRefresh,
        confirm: appConfirm,
      });
      if (valid() && result.message) toast.show({ message: result.message, tone: result.tone });
    } catch {
      if (valid()) toast.show({ message: t('events.roster.statusFailed'), tone: 'error' });
    } finally {
      lock.current = false;
      setPending({});
      start.setSubmitting(false);
    }
  }
  return {
    perform,
    busy: () => lock.current,
    demotePendingKeys: Object.fromEntries(Object.entries(pending)
      .filter(([key]) => key.startsWith('demote:')).map(([key, value]) => [key.slice(7), value])),
    promotePendingKeys: Object.fromEntries(Object.entries(pending)
      .filter(([key]) => key.startsWith('promote:')).map(([key, value]) => [key.slice(8), value])),
  };
}
