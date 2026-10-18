import type { JSX } from 'preact';
import { Text } from '@/ui/Text';
import { DateTime } from '@/ui/DateTime';
import { Skeleton } from '@/ui/Skeleton';
import { EmptyState } from '@/ui/EmptyState';
import { Button } from '@/ui/Button';
import { useT } from '@/i18n/i18n';
import { eventStartMs } from '../data/terminal';
import type { EventDoc } from '../data/types';
import { EventCard } from './EventCard';

interface EventListProps {
  events: readonly EventDoc[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

export function EventList({
  events,
  loading,
  error,
  onRetry,
}: EventListProps): JSX.Element {
  const t = useT();

  if (loading) {
    return (
      <div class="event-list" role="status" aria-label={t('events.loading')}>
        <Text>{t('events.loading')}</Text>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} shape="rect" height={100} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert">
        <EmptyState
          title={t('events.loadError')}
          action={<Button onClick={onRetry}>{t('events.retry')}</Button>}
        />
      </div>
    );
  }

  if (events.length === 0) {
    return <EmptyState title={t('events.emptyTitle')} body={t('events.emptyBody')} />;
  }

  const groups = new Map<string, { date: number; events: EventDoc[] }>();
  for (const event of events) {
    const start = eventStartMs(event);
    const date = new Date(start);
    const key = start
      ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
      : 'unknown';
    const group = groups.get(key);
    if (group) group.events.push(event);
    else groups.set(key, { date: start, events: [event] });
  }

  return (
    <div class="event-list">
      {[...groups].map(([key, group]) => (
        <section class="event-list__group" key={key}>
          <div class="event-list__date">
            {group.date ? (
              <DateTime
                value={group.date}
                variant="date"
                options={{ month: 'short', day: 'numeric', weekday: 'short' }}
              />
            ) : <Text>{t('events.card.dateUnknown')}</Text>}
          </div>
          <ul class="event-list__cards">
            {group.events.map((event, index) => (
              <li key={event.id ?? event._docId ?? `missing-${index}`}>
                <EventCard event={event} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
