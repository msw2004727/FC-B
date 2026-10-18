import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { DateTime } from '@/ui/DateTime';
import { Badge } from '@/ui/Badge';
import { useT } from '@/i18n/i18n';
import type { EventDoc } from '../data/types';
import { parseEventDateRange } from '../data/terminal';
import { eventCapacity, eventStatusKey, publicEventHref } from '../data/presentation';
import { eventSportTag, sportKey, sportSymbol } from '../data/sports';
import '../events.css';

export interface EventCardProps {
  event: EventDoc;
}

export function EventCard({ event }: EventCardProps): JSX.Element {
  const t = useT();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = event.imageVariants?.cover || event.image;
  const range = parseEventDateRange(event.date ?? event.startAt ?? event.startTime);
  const href = publicEventHref(event);
  const sport = eventSportTag(event);
  const capacity = eventCapacity(event);
  const title = event.title?.trim() || t('events.card.untitled');
  const content = (
    <>
      <div class="event-card__image">
        {image && image !== failedImage ? (
          <img
            src={image}
            alt=""
            width={48}
            height={48}
            loading="lazy"
            decoding="async"
            onError={() => setFailedImage(image)}
          />
        ) : (
          <span aria-hidden="true"><Text>{sportSymbol(sport)}</Text></span>
        )}
      </div>
      <div class="event-card__body">
        <Text as="h3" class="event-card__title">{title}</Text>
        <div class="event-card__capacity">
          <span class="event-card__track" aria-hidden="true">
            <span style={{
              width: `${capacity.current !== null && capacity.max !== null && capacity.max > 0
                ? Math.min(100, capacity.current / capacity.max * 100)
                : 0}%`,
            }} />
          </span>
          <Text>
            {t('events.card.capacity', {
              current: capacity.current ?? '—',
              max: capacity.max ?? '—',
            })}
          </Text>
        </div>
        <div class="event-card__meta">
          {range ? (
            <>
              <DateTime value={range.startMs} variant="datetime" />
              <Text>–</Text>
              <DateTime value={range.endMs} variant="time" />
            </>
          ) : (
            <Text>{t('events.card.dateUnknown')}</Text>
          )}
        </div>
        <Text as="p" class="event-card__location">
          {event.location?.trim() || t('events.card.locationUnknown')}
        </Text>
      </div>
      <div class="event-card__aside">
        <Badge label={t(`events.status.${eventStatusKey(event.status)}`)} />
        <Text class="event-card__sport">{t(`events.sport.${sportKey(sport)}`)}</Text>
      </div>
    </>
  );

  // R-ID-009：缺少 public id 時保留資訊，不以 _docId/docId 假造詳情 URL。
  return href ? (
    <a href={href} class="event-card" aria-label={title}>{content}</a>
  ) : (
    <article class="event-card event-card--unlinked">{content}</article>
  );
}
