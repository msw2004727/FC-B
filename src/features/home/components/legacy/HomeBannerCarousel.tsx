import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  safeBannerColor,
  sanitizeHttpUrl,
  type BannerDoc,
} from '../../data/banners';

const AUTOPLAY_INTERVAL_MS = 8000;
const imageReadyCache: Record<string, boolean> = {};

export interface HomeBannerCarouselProps {
  banners: readonly BannerDoc[];
  onOpenNearbyMap: (e: MouseEvent) => void;
  onOpenSearchModal: (e: MouseEvent) => void;
  onOpenCreateEvent: (e: MouseEvent) => void;
  /** A `_refreshActivityCreateButton`：沒有開團權限時隱藏所有 .home-create-event-btn。 */
  canCreate: boolean;
}

export function HomeBannerCarousel({
  banners,
  onOpenNearbyMap,
  onOpenSearchModal,
  onOpenCreateEvent,
  canCreate,
}: HomeBannerCarouselProps): JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadedUrls, setLoadedUrls] = useState<Record<string, boolean>>(() => ({
    ...imageReadyCache,
  }));
  const timerRef = useRef<number | null>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const touchStateRef = useRef({
    startX: 0,
    startY: 0,
    startTime: 0,
    dragging: false,
    locked: false,
    trackW: 0,
  });

  const bannerCount = banners.length > 0 ? banners.length : 1;

  useEffect(() => {
    if (activeIndex >= bannerCount) {
      setActiveIndex(0);
    }
  }, [activeIndex, bannerCount]);

  const preloadBannerUrl = useCallback((url: string, priority: 'high' | 'normal') => {
    if (!url || imageReadyCache[url]) return;
    let settled = false;
    const markDone = (): void => {
      if (settled) return;
      settled = true;
      imageReadyCache[url] = true;
      setLoadedUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
    };

    const timeoutMs = priority === 'high' ? 1800 : 3500;
    const fallbackTimer = window.setTimeout(markDone, timeoutMs);
    if (typeof Image === 'undefined') {
      window.clearTimeout(fallbackTimer);
      markDone();
      return;
    }
    const img = new Image();
    if ('decoding' in img) img.decoding = 'async';
    img.onload = () => {
      window.clearTimeout(fallbackTimer);
      markDone();
    };
    img.onerror = () => {
      window.clearTimeout(fallbackTimer);
      markDone();
    };
    img.src = url;
    if (typeof img.decode === 'function') {
      img.decode().then(
        () => {
          window.clearTimeout(fallbackTimer);
          markDone();
        },
        () => {
          window.clearTimeout(fallbackTimer);
          markDone();
        },
      );
    }
  }, []);

  useEffect(() => {
    if (banners.length === 0) return;
    const timers: number[] = [];
    banners.forEach((b, idx) => {
      const url = sanitizeHttpUrl(b.image);
      if (!url) return;
      if (idx === 0 || idx === activeIndex) {
        preloadBannerUrl(url, 'high');
      } else {
        const t = window.setTimeout(() => preloadBannerUrl(url, 'normal'), 120);
        timers.push(t);
      }
    });
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [banners, activeIndex, preloadBannerUrl]);

  const stopAutoplay = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startAutoplay = useCallback(() => {
    stopAutoplay();
    if (banners.length <= 1) return;
    timerRef.current = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % banners.length);
    }, AUTOPLAY_INTERVAL_MS);
  }, [banners.length, stopAutoplay]);

  useEffect(() => {
    startAutoplay();
    return () => {
      stopAutoplay();
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
      }
    };
  }, [startAutoplay, stopAutoplay]);

  const goToBanner = useCallback(
    (idx: number) => {
      const cnt = banners.length || 1;
      const safeIdx = ((idx % cnt) + cnt) % cnt;
      setActiveIndex(safeIdx);
      const target = banners[safeIdx];
      const url = sanitizeHttpUrl(target?.image);
      if (url) preloadBannerUrl(url, 'high');
    },
    [banners, preloadBannerUrl],
  );

  const handleTouchStart = (e: TouchEvent): void => {
    if (banners.length <= 1) return;
    const touch = e.touches[0];
    if (!touch) return;
    const track = trackRef.current;
    touchStateRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      dragging: false,
      locked: false,
      trackW: track?.parentElement?.offsetWidth || track?.offsetWidth || 300,
    };
    if (track) track.style.transition = 'none';
    stopAutoplay();
  };

  const handleTouchMove = (e: TouchEvent): void => {
    const st = touchStateRef.current;
    if (st.locked || banners.length <= 1) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - st.startX;
    const dy = touch.clientY - st.startY;

    if (!st.dragging) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        st.locked = true;
        return;
      }
      if (Math.abs(dx) > 8) {
        st.dragging = true;
      } else {
        return;
      }
    }

    e.preventDefault();
    let ratio = dx / (st.trackW || 1);
    if ((activeIndex === 0 && ratio > 0) || (activeIndex === banners.length - 1 && ratio < 0)) {
      ratio *= 0.3;
    }
    const offset = -(activeIndex * 100) + ratio * 100;
    if (trackRef.current) {
      trackRef.current.style.transform = `translateX(${offset}%)`;
    }
  };

  const handleTouchEnd = (e: TouchEvent): void => {
    if (banners.length <= 1) return;
    const track = trackRef.current;
    if (track) track.style.transition = '';
    const st = touchStateRef.current;
    if (!st.dragging) {
      startAutoplay();
      return;
    }
    const touch = e.changedTouches[0];
    const dx = (touch ? touch.clientX : st.startX) - st.startX;
    const elapsed = Date.now() - st.startTime;
    const velocity = Math.abs(dx) / (elapsed || 1);
    const threshold = (st.trackW || 300) * 0.25;

    let newIdx = activeIndex;
    if (dx < -threshold || (dx < -30 && velocity > 0.4)) {
      newIdx = Math.min(activeIndex + 1, banners.length - 1);
    } else if (dx > threshold || (dx > 30 && velocity > 0.4)) {
      newIdx = Math.max(activeIndex - 1, 0);
    }
    goToBanner(newIdx);
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => startAutoplay(), 4000);
  };

  const firstBanner = banners[0] ?? null;
  const fixedTitle = firstBanner?.title || '下班揪人一起動';
  const fixedSubtitle = firstBanner?.subtitle || '找活動、開團、加入報名，一個地方完成。';
  const fixedTitleColor = safeBannerColor(firstBanner?.titleColor, '#ffffff');
  const fixedSubtitleColor = safeBannerColor(firstBanner?.subtitleColor, '#e5edf8');

  return (
    <div class="banner-carousel">
      <div
        class="banner-track"
        id="banner-track"
        ref={trackRef}
        style={`transform: translateX(-${activeIndex * 100}%)`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {banners.length === 0 ? (
          <div class="banner-slide skeleton-slide">
            <div class="banner-skeleton skeleton" />
          </div>
        ) : (
          banners.map((b, idx) => {
            const safeLink = sanitizeHttpUrl(b.linkUrl);
            const safeImg = sanitizeHttpUrl(b.image);
            const isLoaded = Boolean(safeImg && loadedUrls[safeImg]);
            const handleSlideClick = safeLink
              ? () => {
                  window.open(safeLink, 'sporthub_ad', 'noopener,noreferrer');
                }
              : undefined;

            if (safeImg) {
              const bgCss = isLoaded
                ? `background-image:url("${safeImg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}");background-size:cover;background-position:center;`
                : '';
              const cursorCss = safeLink ? 'cursor:pointer;' : '';
              return (
                <div
                  key={b.id || b._docId || `slide-${idx}`}
                  class={`banner-slide${isLoaded ? '' : ' banner-slide--loading'}`}
                  data-bg-src={safeImg}
                  data-banner-priority={idx === 0 ? 'high' : 'normal'}
                  data-banner-load-state={isLoaded ? 'done' : 'loading'}
                  style={`${bgCss}${cursorCss}` || undefined}
                  onClick={handleSlideClick}
                />
              );
            }

            const bgGradient = b.gradient || 'var(--bg-elevated)';
            return (
              <div
                key={b.id || b._docId || `slide-${idx}`}
                class="banner-slide banner-placeholder"
                style={`background:${bgGradient}${safeLink ? ';cursor:pointer' : ''}`}
                onClick={handleSlideClick}
              >
                <div class="banner-img-placeholder">1200 × 545</div>
              </div>
            );
          })
        )}
      </div>

      <button
        class="banner-arrow banner-arrow-left"
        id="banner-prev"
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        hidden
        onClick={() => goToBanner(activeIndex - 1)}
      />
      <button
        class="banner-arrow banner-arrow-right"
        id="banner-next"
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        hidden
        onClick={() => goToBanner(activeIndex + 1)}
      />

      {firstBanner && (
        <div
          class="banner-content banner-fixed-content"
          style={`--banner-title-color:${fixedTitleColor};--banner-subtitle-color:${fixedSubtitleColor}`}
        >
          <button
            class="banner-nearby-activity-btn"
            type="button"
            aria-disabled="false"
            title="尋找附近活動"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenNearbyMap(e);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.1"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
              <path d="M9 3v15" />
              <path d="M15 6v15" />
            </svg>
            <span>尋找附近活動</span>
          </button>
          <div class="banner-copy">
            <h2>{fixedTitle}</h2>
            <p>{fixedSubtitle}</p>
            <div class="banner-actions">
              <button
                class="banner-find-btn"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSearchModal(e);
                }}
              >
                <span>找活動</span>
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
                  <path d="M20 20l-3.5-3.5" />
                </svg>
              </button>
              <button
                class="primary-btn small home-create-event-btn banner-create-event-btn"
                type="button"
                style={canCreate ? undefined : 'display:none'}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenCreateEvent(e);
                }}
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
        </div>
      )}

      <div class="banner-dots" id="banner-dots">
        {Array.from({ length: bannerCount }, (_, i) => (
          <div
            key={`dot-${i}`}
            class={`banner-dot${i === activeIndex ? ' active' : ''}`}
            onClick={() => goToBanner(i)}
          />
        ))}
      </div>
    </div>
  );
}
