import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import {
  formatRegLogTime,
  loadEventRegLog,
  type RegLogEntry,
  type RegLogRegistration,
} from '../../data/event-reg-log';

export interface EventRegLogModalProps {
  eventId: string;
  eventDocId: string;
  cachedRegistrations: readonly RegLogRegistration[];
  onClose(): void;
}

/** 照 A `openEventRegLogModal`；僅在開啟時掛載。 */
export function EventRegLogModal({
  eventId, eventDocId, cachedRegistrations, onClose,
}: EventRegLogModalProps): JSX.Element {
  const [entries, setEntries] = useState<RegLogEntry[] | null>(null);
  const alive = useRef(false);
  const close = useRef(onClose);
  const cached = useRef(cachedRegistrations);
  close.current = onClose;
  cached.current = cachedRegistrations;

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    setEntries(null);
    const release = pushOverlay(() => {
      close.current();
      return true;
    });
    loadEventRegLog(eventId, eventDocId, cached.current).then(result => {
      if (alive.current && !disposed) setEntries(result);
    }).catch(() => {
      if (alive.current && !disposed) setEntries([]);
    });
    return () => {
      disposed = true;
      alive.current = false;
      release();
    };
  }, [eventId, eventDocId]);

  return (
    <div
      id="event-reg-log-modal"
      class="event-reg-log-overlay open"
      role="dialog"
      aria-modal="true"
      aria-label="報名紀錄"
      onClick={event => {
        if (event.target === event.currentTarget) close.current();
      }}
    >
      <div class="event-reg-log-box">
        <div class="event-reg-log-header">
          <span data-i18n="報名紀錄">報名紀錄</span>
          <button type="button" class="event-reg-log-close" aria-label="關閉" onClick={() => close.current()}>
            ×
          </button>
        </div>
        <div class="event-reg-log-body" id="event-reg-log-body">
          {entries === null || entries.length === 0 ? (
            <div style="text-align:center;color:var(--text-muted);padding:1.5rem;font-size:.82rem">
              {entries === null ? '載入中…' : '尚無報名紀錄'}
            </div>
          ) : entries.map((entry, index) => (
            <div class="event-reg-log-item" key={`${entry.ms}:${index}`}>
              <span class="event-reg-log-time">{formatRegLogTime(entry.ms)}</span>
              <span class="event-reg-log-user" data-no-translate>{entry.userName}</span>
              <span class={`event-reg-log-action ${entry.actionClass}`}>{entry.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
