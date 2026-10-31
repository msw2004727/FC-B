import { useT } from '@/i18n/i18n';
import {
  additionTime, blockedUsers, existingBlocklists, lastAddition, userLabel,
  type BlocklistEvent, type BlocklistUser,
} from '../data/event-blocklist-model';

export function ExistingBlocklists({ events, users, disabled, loading, onRemove }: {
  events: BlocklistEvent[]; users: BlocklistUser[]; disabled: boolean; loading: boolean;
  onRemove: (event: BlocklistEvent, uid: string) => void;
}) {
  const t = useT();
  const groups = existingBlocklists(events);
  return <div class="form-card">
    <h2 class="eb-step">{t('data-repair.blocklist.existingTitle')}</h2>
    <div id="eb-existing-list">
      {loading ? <div role="status">{t('data-repair.blocklist.loading')}</div>
        : groups.length === 0 ? <div class="eb-empty">{t('data-repair.blocklist.empty')}</div>
        : groups.map(event => <div class="eb-group" key={event._docId || event.id}>
          <div class="eb-group-heading">{event.title} <span>{event.date}</span></div>
          {blockedUsers(event).map((uid, index) => {
            const log = lastAddition(event, uid);
            const by = typeof log?.by === 'string' ? userLabel(users, log.by) : '—';
            const reason = typeof log?.reason === 'string' ? log.reason : '';
            return <div class="eb-row" key={index}>
              <div class="eb-row-body">
                <div class="eb-row-name">{userLabel(users, uid)}</div>
                <div class="eb-row-meta">{t('data-repair.blocklist.addedBy', { by, time: additionTime(log?.at) })}
                  {reason && t('data-repair.blocklist.reasonSuffix', { reason })}</div>
              </div>
              <button type="button" class="outline-btn eb-remove" disabled={disabled}
                onClick={() => onRemove(event, uid)}>{t('data-repair.blocklist.removeButton')}</button>
            </div>;
          })}
        </div>)}
    </div>
  </div>;
}
