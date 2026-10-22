import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { lt } from '@/i18n/i18n';
import { getLastKnownAuthUid } from '@/data/auth';
import { toast } from '@/ui/Toast';
import type { ViewerView } from '@/features/profile/data/viewer';
import { readEventsSnapshot } from '../../data/events-snapshot-cache';
import { isEventVisibleToUser } from '../../data/visibility';
import { safeImageUrl } from '../../data/detail-model';
import type { ShareBuilderContext, ShareEvent } from '../../data/event-share-builders';
import { shareEvent } from '../../data/event-share';
import { addEventToCalendar } from '../../data/event-calendar';

interface ShellProps {
  publicId: string;
  viewer: ViewerView;
  goBack: () => void;
  loading?: boolean;
  children?: ComponentChildren;
}

// 照 A _renderFastEventDetailShell／_renderEventDetailBelowFoldLoadingHtml。
export function EventDetailLoadingShell({
  publicId,
  viewer,
  goBack,
  loading = true,
  children,
}: ShellProps): JSX.Element {
  const uid = viewer.uid || null;
  const candidate = getLastKnownAuthUid() === uid
    ? readEventsSnapshot(uid)?.find((event) => event.id === publicId)
    : undefined;
  // 快取也先過可見性；無報名證據時不預覽受限活動。
  const event = candidate && isEventVisibleToUser(candidate, viewer, [])
    ? candidate
    : undefined;
  const image = safeImageUrl(event?.imageVariants?.cover || event?.image);

  return (
    <div class="legacy-ui">
      <section
        class="page active"
        id="page-activity-detail"
        aria-busy={loading ? 'true' : undefined}
      >
        <div class="page-header">
          <button
            type="button"
            class="back-btn"
            aria-label={lt('返回', '返回')}
            data-i18n-aria-label="返回"
            onClick={goBack}
          >
            <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M15 6l-6 6 6 6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <h2 id="detail-title">{event?.title || '活動詳情'}</h2>
        </div>
        <div
          class="td-img-placeholder"
          id="detail-img-placeholder"
          data-i18n="活動圖片 800 × 300"
          style={image ? 'border:none' : undefined}
        >
          {/* 照 A navigation.js#_renderShellImage：有圖滿版 img，沒圖顯示標題文字（無快取時「活動封面」）。 */}
          {image ? (
            <img
              src={image}
              alt={event?.title || '活動封面'}
              style="width:100%;height:100%;object-fit:cover;display:block;border-radius:var(--radius)"
            />
          ) : (event?.title || '活動封面')}
        </div>
        <div class="detail-body" id="detail-body">
          {event?.location && (
            <div class="detail-row detail-row-wide">
              <span class="detail-label">地點</span>
              {event.location}
            </div>
          )}
          {event?.date && (
            <div class="detail-row detail-row-wide">
              <span class="detail-label">時間</span>
              {event.date}
            </div>
          )}
          {loading && (
            <div
              class="event-detail-belowfold-loading activity-list-loading"
              data-detail-info-loading="true"
              aria-live="polite"
              aria-busy="true"
            >
              <div class="activity-list-loading-bar"><span /></div>
              <div class="reg-loading">活動資訊載入中...</div>
              <div class="reg-loading-skeleton" aria-hidden="true">
                <div class="reg-loading-skeleton-row" />
                <div class="reg-loading-skeleton-row" />
                <div class="reg-loading-skeleton-row" />
              </div>
            </div>
          )}
          {children}
        </div>
      </section>
    </div>
  );
}

// 照 A 找不到活動提示；依本單改用 B 共用返回。
export function EventDetailMissing({ goBack }: { goBack: () => void }): null {
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    toast.show({ message: '找不到此活動' });
    goBack();
  }, [goBack]);
  return null;
}

interface ToolbarProps extends ShareBuilderContext {
  event: ShareEvent;
  loggedIn: boolean;
  canScan: () => boolean;
  onScan: () => void;
}

// 本單三鈕的生命週期獨立管理，避免修改其他派工的頁面 hooks。
export function EventDetailToolbarActions({
  event,
  loggedIn,
  heat,
  registrations,
  canScan,
  onScan,
}: ToolbarProps): JSX.Element {
  const alive = useRef(true);
  const controller = useRef(new AbortController());
  const sharing = useRef(false);
  const calendar = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current.abort();
    };
  }, []);

  async function share(): Promise<void> {
    if (sharing.current || !alive.current) return;
    sharing.current = true;
    try {
      await shareEvent(event, {
        loggedIn,
        heat,
        registrations,
        signal: controller.current.signal,
        showToast: (message) => {
          if (alive.current) toast.show({ message });
        },
      });
    } catch {
      if (alive.current) toast.show({ message: '分享失敗，請稍後再試' });
    } finally {
      sharing.current = false;
    }
  }

  async function addCalendar(): Promise<void> {
    if (calendar.current || !alive.current) return;
    calendar.current = true;
    try {
      await addEventToCalendar(event, {
        signal: controller.current.signal,
        showToast: (message) => {
          if (alive.current) toast.show({ message });
        },
      });
    } catch {
      // A 沒有此失敗狀態；沿用 B 既有「操作失敗，請稍後重試。」翻譯。
      if (alive.current) {
        toast.show({ message: lt('events.detailPage.actionError', '操作失敗，請稍後重試。') });
      }
    } finally {
      calendar.current = false;
    }
  }

  return (
    <>
      <button
        type="button"
        class="detail-toolbar-btn"
        onClick={() => { share().catch(() => {}); }}
      >
        分享活動
      </button>
      <button
        type="button"
        class="detail-toolbar-btn"
        onClick={() => { addCalendar().catch(() => {}); }}
      >
        加入行事曆
      </button>
      {canScan() && (
        <button
          type="button"
          class="detail-toolbar-btn"
          onClick={() => {
            if (alive.current && canScan()) onScan();
          }}
        >
          現場簽到
        </button>
      )}
    </>
  );
}
