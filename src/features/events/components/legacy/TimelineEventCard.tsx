import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { effectiveEventStatus } from '../../data/my-activities-model';
import { getEventParticipantStats } from '../../data/participant-stats';
import { SPORTS, eventSportTag, sportSymbol } from '../../data/sports';
import type { EventDoc, RegistrationDoc } from '../../data/types';
import { getViewerEventRegState } from '../../data/viewer-reg-state';
import './timeline-card-extra.css';

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
  // M-079：A `_isCourseLinkedEvent` 需要的欄位
  courseLinked?: boolean;
  courseLinkId?: string;
  courseLinkSource?: string;
  source?: string;
  courseEventDetailsManagedByEvent?: boolean;
};

/** A `config.js#TYPE_CONFIG`（個人頁活動卡也共用）。 */
export const TYPE_CONFIG: Record<string, { label: string }> = {
  friendly: { label: '友誼' },
  camp: { label: '教學' },
  play: { label: 'PLAY' },
  watch: { label: '觀賽' },
  course: { label: '課程' },
  external: { label: '外部' },
};

/** A `config.js#STATUS_CONFIG`（個人頁活動卡也共用）。 */
export const STATUS_CONFIG: Record<string, { label: string; css: string }> = {
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

/** M-079：照 A `event-list-helpers.js#_isCourseLinkedEvent`。 */
function isCourseLinkedEvent(event: LegacyEventDoc): boolean {
  const source = String(event.courseLinkSource || event.source || '').trim();
  return Boolean(
    event.courseLinked === true
      || String(event.courseLinkId || '').trim()
      || source === 'eduCourseLesson',
  );
}

/** M-079：照 A `_getEventDisplayTypeKey`。 */
function getEventDisplayTypeKey(event: LegacyEventDoc): string {
  if (isCourseLinkedEvent(event) && event.courseEventDetailsManagedByEvent !== true) return 'course';
  const rawType = String(event.type || '').trim();
  if (rawType && TYPE_CONFIG[rawType]) return rawType;
  return 'friendly';
}

/** M-077：照 A 進度條公式（每 100ms 加 4 / 2 / 0.5 / 0.15，最高 85）。 */
function nextProgress(p: number): number {
  const inc = p < 30 ? 4 : p < 60 ? 2 : p < 80 ? 0.5 : 0.15;
  return Math.min(p + inc, 85);
}

export interface TimelineEventCardProps {
  event: LegacyEventDoc;
  viewerUid: string | null;
  viewerRoleLevel: number;
  viewerRegistrations: readonly RegistrationDoc[];
  isPending: boolean;
  isFavorited: boolean;
  onSelect: (event: LegacyEventDoc) => void;
  onToggleFavorite: (event: LegacyEventDoc) => void;
}

export function TimelineEventCard({
  event,
  viewerUid,
  viewerRoleLevel,
  viewerRegistrations,
  isPending,
  isFavorited,
  onSelect,
  onToggleFavorite,
}: TimelineEventCardProps): JSX.Element {
  const [failedImg, setFailedImg] = useState<string | null>(null);
  const [showPending, setShowPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [commentVisible, setCommentVisible] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // M-077：`isPending` 為 true 後等 150ms 才亮載入條；之後每 100ms 依 A 公式遞增到 85。
  useEffect(() => {
    if (!isPending) {
      if (delayRef.current) { clearTimeout(delayRef.current); delayRef.current = null; }
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      setShowPending(false);
      setProgress(0);
      return;
    }
    delayRef.current = setTimeout(() => {
      delayRef.current = null;
      setShowPending(true);
      setProgress(0);
      intervalRef.current = setInterval(() => {
        setProgress((p) => nextProgress(p));
      }, 100);
    }, 150);
    return () => {
      if (delayRef.current) { clearTimeout(delayRef.current); delayRef.current = null; }
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [isPending]);

  // M-076：卡片進入可視範圍才觀察（照 A `_observeActivityCommentBadgeRows`，rootMargin 240px）。
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    if (typeof IntersectionObserver !== 'function') {
      setCommentVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        setCommentVisible(true);
      }
    }, { root: null, rootMargin: '240px 0px', threshold: 0.01 });
    observer.observe(el);
    return () => {
      try { observer.disconnect(); } catch { /* ignore */ }
    };
  }, []);

  // M-076：可見且登入才動態載入 comment-badge 並查詢留言數（卸載/不可見時取消）。
  useEffect(() => {
    if (!commentVisible) return;
    if (!viewerUid) return;
    if (event.type === 'external') return;
    const eventId = event.id || '';
    if (!eventId) return;
    const eventDocId = event._docId || event.docId || eventId;
    if (!eventDocId) return;

    let cancelled = false;
    let cancelFn: (() => void) | null = null;

    import('../../data/comment-badge')
      .then((m) => {
        if (cancelled) return;
        const scope = m.canManageEventComments(event, viewerUid, viewerRoleLevel) ? 'manage' : 'member';
        const cacheKey = m.getCommentBadgeCacheKey(eventId, viewerUid, scope);
        const req = m.requestCommentCount({
          cacheKey,
          eventId,
          eventDocId,
          event,
          viewerUid,
          viewerRoleLevel,
        });
        cancelFn = req.cancel;
        req.promise
          .then((count) => { if (!cancelled) setCommentCount(count); })
          .catch(() => { /* 留言數非關鍵，靜默 */ });
      })
      .catch(() => { /* 動態載入失敗不影響卡片 */ });

    return () => {
      cancelled = true;
      if (cancelFn) cancelFn();
    };
    // event 物件在列表內為穩定參考；此 effect 依 id/docId/type 重新掛載。
  }, [commentVisible, viewerUid, viewerRoleLevel, event]);

  const rawType = String(event.type || 'friendly');
  // M-079：課程連動活動 -> 顯示「課程」
  const typeKey = getEventDisplayTypeKey(event);
  const typeConf = TYPE_CONFIG[typeKey] ?? TYPE_CONFIG.friendly!;
  const isExternal = typeKey === 'external';
  const effStatus = !isExternal ? effectiveEventStatus(event) : (event.status || 'open');
  const isEnded = effStatus === 'ended' || effStatus === 'cancelled';

  const allowedGender = !isExternal ? getEventAllowedGender(event) : '';
  const isFemaleOnly = allowedGender === '女';
  const hasGenderRestriction = Boolean(allowedGender);
  const genderRibbonText = hasGenderRestriction ? getGenderRibbonText(allowedGender) : '';

  // M-080：照 A `_getCurrentUserEventRegistrationState`（排除同行者、只認 UID、含備援）。
  const { signedUp, onWaitlist } = !isExternal
    ? getViewerEventRegState(event, viewerUid, viewerRegistrations)
    : { signedUp: false, onWaitlist: false };

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
    showPending ? 'tl-pending' : '',
  ].filter(Boolean).join(' ');

  const hasComment = commentCount > 0;
  const commentLabel = hasComment
    ? `${commentCount > 99 ? '99+' : commentCount} 則留言`
    : '';

  function handleCardKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
    // U-022：焦點在內部按鈕（收藏愛心）時，不攔 Enter／空白鍵，避免誤開詳情。
    const target = e.target;
    if (target instanceof Element && target.closest('button')) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      onSelect(event);
    }
  }

  return (
    <div
      ref={cardRef}
      class={classList}
      data-event-id={event.id || ''}
      style={rowStyle}
      // U-022：讓卡片像連結一樣可用滑鼠、鍵盤、讀屏。
      role="link"
      tabIndex={0}
      aria-busy={showPending ? 'true' : undefined}
      onClick={() => onSelect(event)}
      onKeyDown={handleCardKeyDown}
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
        {/* M-076：留言數徽章（可見才載入）；DOM 照 A `_activityCommentBadgeHtml` */}
        <span
          class="tl-comment-badge"
          data-comment-badge-for={event.id || ''}
          hidden={!hasComment}
          aria-hidden={hasComment ? 'false' : 'true'}
          aria-label={hasComment ? commentLabel : undefined}
          title={hasComment ? commentLabel : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.6-.8L3 21l1.8-4.7A8.1 8.1 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />
            <path d="M8 10h8M8 14h5" />
          </svg>
          <span class="tl-comment-badge-count">{commentCount > 99 ? '99+' : String(commentCount)}</span>
        </span>
      </div>
      <div class="tl-event-icons">
        {/* M-076：收藏愛心（照 A `_favHeartHtml` 外觀）；U-022：擋冒泡避免開詳情 */}
        <button
          type="button"
          class={isFavorited ? 'fav-heart active' : 'fav-heart'}
          data-fav-type="Event"
          data-fav-id={event.id || ''}
          title={isFavorited ? '取消收藏' : '加入收藏'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(event);
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill={isFavorited ? 'var(--danger)' : 'none'}
            stroke={isFavorited ? 'var(--danger)' : 'var(--text-muted)'}
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
      {/* M-080：正取／候補章（只用本⼈報名判斷） */}
      {onWaitlist ? (
        <span class="tl-stamp-waitlisted">候補</span>
      ) : signedUp ? (
        <span class="tl-stamp-confirmed">正取</span>
      ) : null}
      {/* M-077：150ms 後才顯示載入條，進度條漸進 0→85% */}
      {showPending && (
        <div class="tl-loading-bar">
          <div class="tl-loading-fill" style={`width: ${progress}%`} />
        </div>
      )}
    </div>
  );
}
