import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { effectiveEventStatus } from '../../data/my-activities-model';
import { getEventParticipantStats } from '../../data/participant-stats';
import { SPORTS, eventSportTag, sportSymbol } from '../../data/sports';
import type { EventDoc, RegistrationDoc } from '../../data/types';

export type LegacyEventDoc = EventDoc & {
  pinned?: boolean;
  pinOrder?: number;
  region?: string;
  regionEnabled?: boolean;
  sport?: string;
  sportTag?: string;
  venue?: string;
  hostName?: string;
  host?: string;
  genderRestrictionEnabled?: boolean;
  allowedGender?: string;
};

const TYPE_CONFIG: Record<string, { label: string }> = {
  friendly: { label: '友誼' },
  camp: { label: '教學' },
  play: { label: 'PLAY' },
  watch: { label: '觀賽' },
  course: { label: '課程' },
  external: { label: '外部' },
};

const STATUS_CONFIG: Record<string, { label: string; css: string }> = {
  open: { label: '報名中', css: 'open' },
  full: { label: '已額滿', css: 'full' },
  ended: { label: '已結束', css: 'ended' },
  upcoming: { label: '即將開放', css: 'upcoming' },
  cancelled: { label: '已取消', css: 'cancelled' },
};

/** A `event-list-helpers.js#_getEventAllowedGender`：需開啟 genderRestrictionEnabled，值只認「男」「女」。 */
export function getEventAllowedGender(event: LegacyEventDoc): string {
  if (!event.genderRestrictionEnabled) return '';
  const raw = event.allowedGender;
  return raw === '男' || raw === '女' ? raw : '';
}

/** A `_getEventGenderTimelineRibbonText`。 */
export function getGenderRibbonText(allowedGender: string): string {
  if (!allowedGender) return '';
  return allowedGender === '男' ? '限男生' : '限女生';
}

function getViewerRegStatus(
  event: EventDoc,
  viewerUid: string | null,
  viewerRegistrations: readonly RegistrationDoc[],
): { isSignedUp: boolean; isWaitlist: boolean } {
  if (!viewerUid) return { isSignedUp: false, isWaitlist: false };
  const eventIds = new Set(
    [event.id, event._docId, event.docId].filter((x): x is string => Boolean(x)),
  );
  // R-ID-002 / R-ID-003: 只認 UID
  const activeRegs = viewerRegistrations.filter((r) => {
    const rUid = r.userId || r.uid || r.ownerUid;
    return (
      rUid === viewerUid
      && Boolean(r.eventId && eventIds.has(r.eventId))
      && (r.status === 'confirmed' || r.status === 'waitlisted' || r.status === 'registered')
    );
  });
  if (activeRegs.length === 0) return { isSignedUp: false, isWaitlist: false };
  const hasConfirmed = activeRegs.some(
    (r) => r.status === 'confirmed' || r.status === 'registered',
  );
  const isWaitlist = !hasConfirmed && activeRegs.some((r) => r.status === 'waitlisted');
  return { isSignedUp: true, isWaitlist };
}

export interface TimelineEventCardProps {
  event: LegacyEventDoc;
  viewerUid: string | null;
  viewerRegistrations: readonly RegistrationDoc[];
  isPending: boolean;
  onSelect: (event: LegacyEventDoc) => void;
  onUnavailableFeature: (e: MouseEvent) => void;
}

export function TimelineEventCard({
  event,
  viewerUid,
  viewerRegistrations,
  isPending,
  onSelect,
  onUnavailableFeature,
}: TimelineEventCardProps): JSX.Element {
  const [failedImg, setFailedImg] = useState<string | null>(null);

  const rawType = event.type || 'friendly';
  const typeKey = TYPE_CONFIG[rawType] ? rawType : 'friendly';
  const typeConf = TYPE_CONFIG[typeKey] ?? TYPE_CONFIG.friendly!;
  const isExternal = typeKey === 'external';
  const effStatus = !isExternal ? effectiveEventStatus(event) : (event.status || 'open');
  const isEnded = effStatus === 'ended' || effStatus === 'cancelled';

  const allowedGender = !isExternal ? getEventAllowedGender(event) : '';
  const isFemaleOnly = allowedGender === '女';
  const hasGenderRestriction = Boolean(allowedGender);
  const genderRibbonText = hasGenderRestriction ? getGenderRibbonText(allowedGender) : '';

  const { isSignedUp, isWaitlist } = !isExternal
    ? getViewerRegStatus(event, viewerUid, viewerRegistrations)
    : { isSignedUp: false, isWaitlist: false };

  const rawImg = event.imageVariants?.cover || event.image || '';
  const eventImage = rawImg && rawImg !== failedImg ? rawImg : '';

  const stats = getEventParticipantStats(event, []);
  const time = (event.date || '').split(' ')[1] || '';
  const locShort = event.location
    ? (event.location.split('市')[1] || event.location)
    : '';

  let statusLabel: string;
  let statusCss: string;
  let metaText: string;

  if (isExternal) {
    if (event.status === 'cancelled') {
      statusLabel = '已取消';
      statusCss = 'cancelled';
    } else if (isEnded) {
      statusLabel = '已結束';
      statusCss = 'ended';
    } else {
      statusLabel = '外部活動';
      statusCss = 'external';
    }
    const locPart = locShort ? ` · ${locShort}` : '';
    metaText = `${typeConf.label} · ${time}${locPart}`;
  } else {
    const statusConf = STATUS_CONFIG[effStatus] ?? STATUS_CONFIG.open!;
    statusLabel = statusConf.label;
    statusCss = statusConf.css;
    const waitlistTag = stats.waitlistCount > 0 ? ` · 候補(${stats.waitlistCount})` : '';
    const reservationTag = stats.reservedRemainingCount > 0
      ? ` · 預留 ${stats.reservedRemainingCount}`
      : '';
    metaText = `${typeConf.label} · ${time} · ${locShort} · ${stats.confirmedCount}/${stats.maxCount}人${reservationTag}${waitlistTag}`;
  }

  const rowBaseClass = event.teamOnly ? 'tl-type-teamonly' : `tl-type-${typeKey}`;
  const rowClass = isFemaleOnly ? `${rowBaseClass} tl-type-female-only` : rowBaseClass;
  const rowStyle = event.pinned
    ? (isFemaleOnly
      ? 'box-shadow:0 0 0 1px rgba(236,72,153,.16)'
      : 'border:1px solid var(--warning);box-shadow:0 0 0 1px rgba(245,158,11,.12)')
    : undefined;

  const sportTag = eventSportTag(event) || 'football';
  const sportObj = SPORTS.find((s) => s.sportTag === sportTag);
  const sportLabel = sportObj?.label ?? '足球';
  const symbol = sportSymbol(sportTag);

  const pPct = stats.maxCount > 0
    ? Math.min(100, Math.round(((stats.occupiedCount ?? stats.confirmedCount) / stats.maxCount) * 100))
    : 0;
  const pClr = pPct >= 100 ? 'var(--danger)' : pPct >= 70 ? 'var(--warning)' : 'var(--success)';
  const wTag = stats.waitlistCount > 0 ? ` · 候補 ${stats.waitlistCount}` : '';
  const rTag = stats.reservedRemainingCount > 0 ? ` · 預留 ${stats.reservedRemainingCount}` : '';

  const classList = [
    'tl-event-row',
    rowClass,
    isEnded ? 'tl-past' : '',
    isPending ? 'tl-pending' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      class={classList}
      data-event-id={event.id || ''}
      style={rowStyle}
      aria-busy={isPending ? 'true' : undefined}
      onClick={() => onSelect(event)}
    >
      {hasGenderRestriction && (
        <span class="tl-event-gender-ribbon">{genderRibbonText}</span>
      )}
      {eventImage && (
        <div class="tl-event-thumb">
          <img
            src={eventImage}
            alt={event.title || ''}
            width={48}
            height={48}
            loading="lazy"
            decoding="async"
            onError={() => setFailedImg(eventImage)}
          />
        </div>
      )}
      <div class="tl-event-info">
        <div class="tl-event-title-row">
          <div class="tl-event-title">
            {event.pinned && (
              <span
                style="font-size:.62rem;padding:.08rem .35rem;border-radius:999px;border:1px solid var(--warning);color:var(--warning);font-weight:700;margin-right:.3rem"
              >
                置頂
              </span>
            )}
            {event.title || ''}
            {event.teamOnly && (
              <span class="tl-teamonly-badge">限定</span>
            )}
          </div>
        </div>
        {!isExternal && !isEnded && (
          <div style="display:flex;align-items:center;gap:.4rem;margin-top:.2rem">
            <div style="flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden">
              <div style={`width:${pPct}%;height:100%;background:${pClr};border-radius:3px`} />
            </div>
            <span style="font-size:.65rem;color:var(--text-muted);white-space:nowrap">
              {`${stats.confirmedCount}/${stats.maxCount}人${rTag}${wTag}`}
            </span>
          </div>
        )}
        <div class="tl-event-meta">
          {metaText}
        </div>
      </div>
      <div class="tl-event-status-stack">
        <span class={`tl-event-status ${statusCss}`}>
          {statusLabel}
        </span>
        {/* 下一批補：留言數徽章 */}
        <span
          class="tl-comment-badge"
          data-comment-badge-for={event.id || ''}
          hidden
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.6-.8L3 21l1.8-4.7A8.1 8.1 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />
            <path d="M8 10h8M8 14h5" />
          </svg>
          <span class="tl-comment-badge-count">0</span>
        </span>
      </div>
      <div class="tl-event-icons">
        {/* 下一批補：收藏愛心 */}
        <button
          type="button"
          class="fav-heart"
          data-fav-type="Event"
          data-fav-id={event.id || ''}
          title="加入收藏"
          onClick={onUnavailableFeature}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-muted)"
            stroke-width="2"
          >
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
          </svg>
        </button>
        <span
          class="event-sport-icon tl-event-sport-corner"
          title={sportLabel}
          aria-label={sportLabel}
        >
          <span class="sport-emoji">{symbol}</span>
        </span>
      </div>
      <span class="tl-event-arrow">›</span>
      {event.privateEvent && (
        <span class="tl-stamp-private">不公開</span>
      )}
      {isWaitlist ? (
        <span class="tl-stamp-waitlisted">候補</span>
      ) : isSignedUp ? (
        <span class="tl-stamp-confirmed">正取</span>
      ) : null}
      {isPending && (
        <div class="tl-loading-bar">
          <div class="tl-loading-fill" style="width: 30%" />
        </div>
      )}
    </div>
  );
}
