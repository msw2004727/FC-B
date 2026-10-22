// M-078：外部活動中繼卡，照 A `js/modules/event/event-external-transit.js`（整檔 156 行）。
// - DOM / class 照 A（`.ext-transit-*`，CSS 已在 legacy/activity.css）
// - YouTube 嵌入判斷照 `_extractYouTubeVideoId`
// - 開啟動畫：rAF 後 add `visible`；關閉動畫：remove `visible`，transitionend + 保險 setTimeout(400)
// - 點遮罩關閉、關閉時把 iframe src 清空停止播放
// - 手機返回鍵先關卡片：使用 `@/core/overlay-back`
// ASSUMPTION：A 的「活動分享模組」屬另一批工單，中繼卡分享鈕先共用 UNAVAILABLE_FEATURE_MSG。
// ASSUMPTION：A 中 `externalUrl` 未檢查協定；本檔依站長規範只允許 http:/https:，其他不顯示外連按鈕（改用不可點的 span 保留排版）。
// ASSUMPTION：A 有 `SPORT_ICON_EMOJI` 全域表，B 尚未移植，標題前僅保留 A「sportEmoji + ' ' + title」的空白格式。
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { UNAVAILABLE_FEATURE_MSG } from '@/core/unavailable';
import { toast } from '@/ui/Toast';
import type { LegacyEventDoc } from './TimelineEventCard';

interface ExternalEventLike {
  externalUrl?: unknown;
  title?: string;
  image?: string;
  date?: string;
  location?: string;
}

const YT_PATTERNS: readonly RegExp[] = [
  /(?:youtube\.com\/watch\?.*v=)([\w-]{11})/,
  /(?:youtube\.com\/embed\/)([\w-]{11})/,
  /(?:youtube\.com\/v\/)([\w-]{11})/,
  /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  /(?:youtube\.com\/live\/)([\w-]{11})/,
  /(?:youtu\.be\/)([\w-]{11})/,
  /(?:m\.youtube\.com\/watch\?.*v=)([\w-]{11})/,
];

// 照 A `_extractYouTubeVideoId`
export function extractYouTubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  for (const pattern of YT_PATTERNS) {
    const m = url.match(pattern);
    if (m && m[1]) return m[1];
  }
  return null;
}

// ASSUMPTION：只有 http:/https: 才產出外連
function isSafeExternalUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const SHARE_SVG = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" y1="2" x2="12" y2="15" />
  </svg>
);

export interface ExternalTransitCardProps {
  event: LegacyEventDoc;
  onClose: () => void;
}

export function ExternalTransitCard({ event, onClose }: ExternalTransitCardProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const eventView = event as unknown as ExternalEventLike;
  const rawExternalUrl =
    typeof eventView.externalUrl === 'string' ? eventView.externalUrl : '';
  const externalSafe = isSafeExternalUrl(rawExternalUrl);
  const ytId = extractYouTubeVideoId(rawExternalUrl || null);
  const showCover = Boolean(eventView.image);
  const dateStr = String(eventView.date || '');
  const locStr = String(eventView.location || '');
  // 照 A `<div class="ext-transit-title">' + sportEmoji + ' ' + title`：B 無 sportEmoji，保留 A 的前置空白
  const title = ` ${String(eventView.title || '外部活動')}`;

  const requestCloseRef = useRef<() => void>(() => undefined);

  // 進入動畫照 A showExternalTransitCard：rAF 後加 visible
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // 手機返回鍵先關卡片（照 Modal 用法）
  useEffect(() => {
    const release = pushOverlay(() => {
      requestCloseRef.current();
      return true;
    });
    return () => release();
  }, []);

  // 卸載時清計時器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const requestClose = (): void => {
    if (closingRef.current) return;
    closingRef.current = true;
    setVisible(false);

    const overlay = overlayRef.current;
    if (!overlay) {
      onCloseRef.current();
      return;
    }

    // 移除 iframe 停止播放（照 A closeExternalTransitCard）
    const iframe = overlay.querySelector('iframe');
    if (iframe) iframe.setAttribute('src', '');

    // transitionend + 保險 setTimeout(400)
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      overlay.removeEventListener('transitionend', finish);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      onCloseRef.current();
    };
    overlay.addEventListener('transitionend', finish);
    timeoutRef.current = setTimeout(finish, 400);
  };
  requestCloseRef.current = requestClose;

  const handleOverlayClick = (e: MouseEvent): void => {
    if (e.target === e.currentTarget) requestClose();
  };

  const handleShare = (): void => {
    // ASSUMPTION：A 會載入完整活動分享模組，本批先共用未開放提示
    toast.show({ message: UNAVAILABLE_FEATURE_MSG });
  };

  return (
    <div
      ref={overlayRef}
      id="ext-transit-overlay"
      class={`ext-transit-overlay${visible ? ' visible' : ''}`}
      onClick={handleOverlayClick}
    >
      <div class="ext-transit-card">
        <button
          class="ext-transit-close"
          id="ext-transit-close"
          type="button"
          onClick={requestClose}
        >
          ×
        </button>
        {showCover && (
          <div class="ext-transit-cover">
            <img src={eventView.image as string} alt="" />
          </div>
        )}
        <div class="ext-transit-body">
          <div class="ext-transit-title">{title}</div>
          {(dateStr || locStr) && (
            <div class="ext-transit-info">
              {dateStr && <div class="ext-transit-meta">{dateStr}</div>}
              {locStr && <div class="ext-transit-meta">{locStr}</div>}
            </div>
          )}
          {ytId ? (
            <>
              <div class="ext-transit-yt-wrap">
                <iframe
                  src={`https://www.youtube.com/embed/${ytId}?playsinline=1&rel=0`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              <div class="ext-transit-actions">
                {externalSafe ? (
                  <a
                    class="ext-transit-btn ext-transit-btn-secondary"
                    href={rawExternalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    在 YouTube 開啟
                  </a>
                ) : (
                  <span class="ext-transit-btn ext-transit-btn-secondary" aria-disabled="true">
                    在 YouTube 開啟
                  </span>
                )}
                <button
                  class="ext-transit-btn ext-transit-btn-share"
                  id="ext-transit-share"
                  type="button"
                  title="分享"
                  onClick={handleShare}
                >
                  {SHARE_SVG}
                </button>
              </div>
            </>
          ) : (
            <div class="ext-transit-actions">
              {externalSafe ? (
                <a
                  class="ext-transit-btn ext-transit-btn-primary"
                  href={rawExternalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  前往活動頁面
                </a>
              ) : (
                <span class="ext-transit-btn ext-transit-btn-primary" aria-disabled="true">
                  前往活動頁面
                </span>
              )}
              <button
                class="ext-transit-btn ext-transit-btn-share"
                id="ext-transit-share"
                type="button"
                title="分享"
                onClick={handleShare}
              >
                {SHARE_SVG}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
