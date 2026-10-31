import { useEffect, useRef, useState } from 'preact/hooks';
import { useGoBack } from '@/core/back-guard';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { useT } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import { changeEventBlocklist } from '../data/event-blocklist';
import { blocklistErrorKey } from '../data/event-blocklist-errors';
import {
  canViewEventBlocklist, canWriteEventBlocklist, existingBlocklists, searchEvents, searchUsers, userLabel,
  type BlocklistEvent, type BlocklistUser, type BlocklistViewer,
} from '../data/event-blocklist-model';
import { useBlocklistUsers } from '../data/use-blocklist-users';
import { BlocklistSearch } from './BlocklistSearch';
import { ExistingBlocklists } from './ExistingBlocklists';

export function EventBlocklistPanel({ viewer }: { viewer: BlocklistViewer }) {
  const t = useT();
  const goBack = useGoBack('/');
  const key = (suffix: string) => t('data-repair.blocklist.' + suffix);
  const directory = useBlocklistUsers();
  const [events, setEvents] = useState<BlocklistEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [eventQuery, setEventQuery] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<BlocklistEvent | null>(null);
  const [selectedUser, setSelectedUser] = useState<BlocklistUser | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  const alive = useRef(true);
  const writable = canWriteEventBlocklist(viewer);
  const disabled = busy || !writable;
  useEffect(() => {
    let active = true;
    const repo = getEventsRepo();
    const read = () => {
      const snapshot = repo.getSnapshot();
      return [...snapshot.active, ...snapshot.terminal];
    };
    const initial = read();
    if (initial.length) { setEvents(initial); setLoading(false); }
    else void repo.loadEventsStatic({ terminalMode: 'none' }).then(() => {
      if (active) setEvents(read());
    }).catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; alive.current = false; };
  }, []);

  const show = (suffix: string) => toast.show({ message: key(suffix) });
  const authorized = () => alive.current && canViewEventBlocklist(viewerRef.current)
    && canWriteEventBlocklist(viewerRef.current);
  useEffect(() => {
    if (!loading && existingBlocklists(events).length > 0) void directory.load();
  }, [loading]);
  const apply = async (event: BlocklistEvent, uid: string, action: 'add' | 'remove', users: readonly BlocklistUser[]) => {
    if (!authorized()) { if (alive.current) show('grantMethodUnavailable'); return; }
    try {
      const result = await changeEventBlocklist({ viewer: viewerRef.current, event, uid, action, reason, users });
      if (!alive.current) return;
      setEvents(previous => previous.map(item =>
        ((!!item._docId && item._docId === result.event._docId) || (item._docId || item.id) === (event._docId || event.id)) ? result.event : item));
      if (!result.changed) { show(action === 'add' ? 'toastDup' : 'toastNotInList'); return; }
      toast.show({ message: t('data-repair.blocklist.' + (action === 'add' ? 'toastAdded' : 'toastRemoved'),
        { name: userLabel(users, uid) }), tone: 'success' });
      if (action === 'add') { setSelectedEvent(null); setSelectedUser(null); setReason(''); setEventQuery(''); setUserQuery(''); }
    } catch (error) {
      if (alive.current) show(blocklistErrorKey(error, action));
    }
  };
  const add = async () => {
    if (busyRef.current) return;
    if (!authorized()) { show('grantMethodUnavailable'); return; }
    if (!selectedEvent) { show('toastPickEvent'); return; }
    if (!selectedUser) { show('toastPickUser'); return; }
    busyRef.current = true; setBusy(true);
    try { await apply(selectedEvent, selectedUser.uid, 'add', directory.users); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const remove = async (event: BlocklistEvent, uid: string) => {
    if (busyRef.current || !authorized()) return;
    busyRef.current = true; setBusy(true);
    try {
      const users = await directory.load();
      if (!authorized()) return;
      if (await appConfirm(t('data-repair.blocklist.confirmRemove', {
        name: userLabel(users, uid), title: event.title || key('unnamed'),
      }), { danger: true })) await apply(event, uid, 'remove', users);
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const statusLabel = (event: BlocklistEvent) => key(
    event.status === 'ended' ? 'statusEnded' : event.status === 'cancelled' ? 'statusCancelled'
      : event.status === 'upcoming' ? 'statusUpcoming' : 'statusOpen');
  return <>
    <div class="page-header"><button class="back-btn" type="button" aria-label={key('back')} onClick={goBack}>
      <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg></button><h2 class="page-header-title">{key('title')}</h2></div>
    <div id="repair-pane-event-blocklist">
      <div class="form-card eb-intro"><div class="eb-step">{key('title')}</div>
        <div class="eb-intro-text">{key('intro1')}<br />{key('intro2')}<br />{key('intro3')}</div></div>
      {!writable && <div class="eb-note" role="status">{key('grantMethodUnavailable')}</div>}
      {loadError && <div class="eb-note" role="alert">{key('eventsLoadFailed')}</div>}
      <BlocklistSearch kind="event" query={eventQuery} onQuery={setEventQuery}
        results={searchEvents(events, eventQuery)} disabled={disabled} status={loading ? 'loading' : 'ready'}
        onSelect={event => { setSelectedEvent(event); setEventQuery(''); }}
        label={event => event.title || key('unnamed')}
        meta={event => [event.date, event.creator, statusLabel(event)].filter(Boolean).join(' · ')}
        selected={selectedEvent && <>{key('selectedPrefix')}<strong>{selectedEvent.title}</strong> · {selectedEvent.date} · {selectedEvent.creator}</>} />
      <BlocklistSearch kind="user" query={userQuery} disabled={disabled} status={directory.status} partial={directory.partial}
        onQuery={value => { setUserQuery(value); if (value.trim()) void directory.load(); }}
        results={searchUsers(directory.users, userQuery)}
        onSelect={user => { setSelectedUser(user); setUserQuery(''); }}
        label={user => user.name || key('unnamed')} meta={user => userLabel([], user.uid)}
        selected={selectedUser && <>{key('selectedPrefix')}<strong>{selectedUser.name}</strong> · {userLabel([], selectedUser.uid)}</>} />
      <div class="form-card eb-reason-card"><label class="eb-step" for="eb-reason">{key('stepReason')}</label>
        <input id="eb-reason" type="text" autoComplete="off" maxLength={80} placeholder={key('reasonPlaceholder')}
          value={reason} disabled={disabled} onInput={event => setReason(event.currentTarget.value)} />
        <button class="primary-btn full-width eb-add" type="button" disabled={disabled} onClick={() => void add()}>{key('addButton')}</button>
      </div>
      <ExistingBlocklists events={events} users={directory.users} disabled={disabled} loading={loading} onRemove={(event, uid) => void remove(event, uid)} />
    </div>
  </>;
}
