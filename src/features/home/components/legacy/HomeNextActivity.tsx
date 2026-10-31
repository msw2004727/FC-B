import type { JSX } from 'preact';
import { taipeiParts } from '@/core/taipei-time';
import { useEffect, useState } from 'preact/hooks';
import { getVisibleEvents } from '@/features/events/data/visibility';
import type { EventDoc } from '@/features/events/data/types';
import type { ViewerView } from '@/features/profile/data/viewer';
import {
  parseEventDateRange,
  registrationStatusMeta,
  resolveNextActivity,
  type NextActivityResult,
} from '../../data/next-activity';

const FALLBACK_IMAGE = 'LOGO/Nocoverimage%20set.png';
const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'] as const;

function pad2(num: number): string {
  return String(num).padStart(2, '0');
}

export function formatNextActivityDateRange(event: EventDoc | null | undefined): string {
  if (!event) return '';
  const range = parseEventDateRange(event.date ?? event.startAt ?? event.startTime);
  if (!range?.startMs) return String(event.date ?? '');
  const start = taipeiParts(range.startMs);
  const end = taipeiParts(range.endMs || range.startMs + 2 * 60 * 60 * 1000);
  const dayName = DAY_NAMES[start.weekday] ?? '日';
  const datePart = `${pad2(start.month)}/${pad2(start.day)} (${dayName})`;
  const startTime = `${pad2(start.hour)}:${pad2(start.minute)}`;
  const endTime = `${pad2(end.hour)}:${pad2(end.minute)}`;
  return `${datePart} ${startTime} - ${endTime}`;
}

export interface HomeNextActivityProps {
  viewer: ViewerView;
  onViewAll: () => void;
  onFindActivity: () => void;
  onCreateEvent: (e: MouseEvent) => void;
  onOpenDetail: (event: EventDoc) => void;
  onAddToCalendar: (event: EventDoc) => void;
}

export function HomeNextActivity({
  viewer,
  onViewAll,
  onFindActivity,
  onCreateEvent,
  onOpenDetail,
  onAddToCalendar,
}: HomeNextActivityProps): JSX.Element {
  const [state, setState] = useState<{
    uid: string | null;
    loading: boolean;
    result: NextActivityResult | null;
  }>(() => ({
    uid: viewer.uid,
    loading: Boolean(viewer.uid),
    result: null,
  }));

  const [imgSrc, setImgSrc] = useState<string | null>(null);

  useEffect(() => {
    const uid = viewer.uid;
    if (!uid) {
      setState({ uid: null, loading: false, result: null });
      return;
    }

    let current = true;
    setState({ uid, loading: true, result: null });

    resolveNextActivity({}, uid)
      .then((next) => {
        if (!current) return;
        setState({ uid, loading: false, result: next });
      })
      .catch(() => {
        if (!current) return;
        // 照 A home-next-activity.js#refreshHomeNextActivity：發生錯誤時 renderEmpty(host)
        setState({ uid, loading: false, result: null });
      });

    return () => {
      current = false;
    };
  }, [viewer.uid]);

  const isCurrentUid = state.uid === viewer.uid;
  const loading = Boolean(viewer.uid) && (!isCurrentUid || state.loading);
  const candidate = isCurrentUid ? state.result : null;

  const visibleList = candidate
    ? getVisibleEvents(
        [candidate.event],
        viewer,
        candidate.registration ? [candidate.registration] : [],
      )
    : [];
  const visibleEvent = visibleList[0] ?? null;

  const rawImage =
    (visibleEvent?.imageVariants as { homeNext?: string; cover?: string } | undefined)?.homeNext
    || visibleEvent?.imageVariants?.cover
    || visibleEvent?.image
    || FALLBACK_IMAGE;

  useEffect(() => {
    setImgSrc(rawImage);
  }, [rawImage]);

  const statusMeta = registrationStatusMeta(
    candidate?.registration ?? (candidate?.managedRole ? { managedRole: candidate.managedRole } : null),
  );

  return (
    <section class="home-next-activity-section" id="home-next-activity" aria-live="polite">
      <div class="home-next-card">
        <div class="home-next-head">
          <h3>我的下一場活動</h3>
          <button
            class="home-next-view-all"
            type="button"
            data-home-next-action="all"
            onClick={onViewAll}
          >
            查看全部
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.3"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div class="home-next-loading" role="status" aria-label="載入中">
            <div class="home-next-loading-img skeleton" />
            <div class="home-next-loading-lines">
              <span class="skeleton" />
              <span class="skeleton" />
              <span class="skeleton short" />
            </div>
          </div>
        ) : visibleEvent ? (
          <div class="home-next-event">
            <button
              class="home-next-cover"
              type="button"
              data-home-next-action="detail"
              aria-label="查看活動"
              onClick={() => onOpenDetail(visibleEvent)}
            >
              <img
                src={imgSrc || FALLBACK_IMAGE}
                alt={visibleEvent.title || '未命名活動'}
                width={1000}
                height={750}
                loading="lazy"
                decoding="async"
                onError={() => {
                  if (imgSrc !== FALLBACK_IMAGE) setImgSrc(FALLBACK_IMAGE);
                }}
              />
            </button>
            <div class="home-next-event-main">
              <h4>{visibleEvent.title || '未命名活動'}</h4>
              <div class="home-next-meta-row">
                <span class="home-next-meta">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.1"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4" />
                    <path d="M8 2v4" />
                    <path d="M3 10h18" />
                  </svg>
                  <span>{formatNextActivityDateRange(visibleEvent)}</span>
                </span>
                <span class="home-next-meta">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>{visibleEvent.location || '地點待補'}</span>
                </span>
                <span class={`home-next-status-pill home-next-status-${statusMeta.key}`}>
                  {statusMeta.label}
                </span>
              </div>
            </div>
            <div class="home-next-event-actions">
              <button
                class="home-next-primary"
                type="button"
                data-home-next-action="detail"
                onClick={() => onOpenDetail(visibleEvent)}
              >
                查看活動
              </button>
              <button
                class="home-next-outline"
                type="button"
                data-home-next-action="calendar"
                onClick={() => onAddToCalendar(visibleEvent)}
              >
                <span>加入行事曆</span>
              </button>
            </div>
          </div>
        ) : (
          <div class="home-next-empty">
            <div class="home-next-empty-illustration" aria-hidden="true">
              <div class="home-next-calendar-art">
                <span />
                <span />
                <span />
                <span />
                <strong>+</strong>
              </div>
            </div>
            <div class="home-next-empty-title">你目前還沒有報名活動</div>
            <div class="home-next-empty-sub">找一場活動，或建立你的第一場活動</div>
            <div class="home-next-empty-actions">
              <button
                class="home-next-primary"
                type="button"
                data-home-next-action="find"
                onClick={onFindActivity}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <span>找活動</span>
              </button>
              <button
                class="home-next-outline"
                type="button"
                data-home-next-action="create"
                onClick={onCreateEvent}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
                <span>我要開團</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
