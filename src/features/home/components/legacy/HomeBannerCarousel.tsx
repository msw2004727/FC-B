import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  safeBannerColor,
  safeBannerGradient,
  safeBannerLinkUrl,
  sanitizeHttpUrl,
  type BannerDoc,
} from '../../data/banners';

const AUTOPLAY_INTERVAL_MS = 8000;
/** 第一張／其他張等多久還沒載好就不再把整張壓暗、直接設背景圖（慢網路時讓圖片邊載邊顯示），不代表失敗；與原本相同。 */
const FIRST_IMAGE_TIMEOUT_MS = 1800;
const OTHER_IMAGE_TIMEOUT_MS = 3500;
/**
 * 這張圖的載入結果。loaded＝載入成功；failed＝載入失敗；timeout＝等太久，先取消壓暗並設背景圖、仍等它載完。
 * 三種畫面和原本一致：都取消壓暗；loaded、timeout 設背景圖，failed 不設（壞網址的背景圖本來就什麼都不畫，只剩暗色遮罩）。
 */
type ImageStatus = 'loaded' | 'failed' | 'timeout';
/**
 * 本次開啟期間已確認載入成功的圖片（切頁回來略過淡入、不重載）；失敗與逾時不記，下次進來重新嘗試一次。
 * 只由「還活著」的載入工作寫入（見 loadImage）；語意是「曾載入成功」，不偵測之後網址是否失效（原本也沒有）。
 */
const imageReadyCache: Record<string, ImageStatus> = {};
/** 成功紀錄的上限：超過時丟掉最舊的（只是那張圖下次進來會重做一次淡入，不影響正確性）。 */
const IMAGE_READY_CACHE_MAX = 100;

function rememberLoaded(url: string): void {
  // 先刪再寫：讓這個網址排到最新（字串鍵依寫入順序列舉）。
  delete imageReadyCache[url];
  imageReadyCache[url] = 'loaded';
  const urls = Object.keys(imageReadyCache);
  for (let i = 0; i < urls.length - IMAGE_READY_CACHE_MAX; i += 1) delete imageReadyCache[urls[i] as string];
}

function timeoutFor(index: number): number {
  return index === 0 ? FIRST_IMAGE_TIMEOUT_MS : OTHER_IMAGE_TIMEOUT_MS;
}

/** 一個網址的載入工作：alive＝還有效（卸載或網址離開清單就作廢）；settled＝已有載入成功／失敗的結果（逾時不算）。 */
interface LoadJob {
  alive: boolean;
  settled: boolean;
  timer: number | null;
}

function cancelJob(job: LoadJob): void {
  job.alive = false;
  if (job.timer !== null) {
    window.clearTimeout(job.timer);
    job.timer = null;
  }
}

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
  const [imageStatus, setImageStatus] = useState<Record<string, ImageStatus>>(() => ({
    ...imageReadyCache,
  }));
  /** 這個畫面的載入工作（每個網址一個）。 */
  const jobsRef = useRef(new Map<string, LoadJob>());
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

  // 結算（只會被「還活著」的載入工作呼叫，見 loadImage）：成功寫進共用紀錄並更新本畫面；失敗只更新本畫面（不記）。
  const markImage = useCallback((url: string, status: 'loaded' | 'failed') => {
    if (status === 'loaded') rememberLoaded(url);
    setImageStatus((prev) => (prev[url] === status ? prev : { ...prev, [url]: status }));
  }, []);

  // 載入：圖片用 `new Image()` 載（和原本一樣），先載到才設背景圖；畫面本身仍是 slide 的 inline background-image，沒有 <img> 當畫面。
  // 第一張一開始就載；其餘只在「目前這張有結果（載好或確定失敗）」之後才載下一張——逾時（timeout）只是取消壓暗並設背景圖，
  // 圖片可能還在下載，這時再載下一張會跟它搶頻寬（慢網路最明顯）；使用者點圓點直接跳到某張時，只載那一張。
  //
  // 載入工作的生命週期（每個網址一個工作，存在 jobsRef）：
  // - 同一個網址在這個畫面只有一個工作（去重）；失敗只結算一次、不重試、沒有重試迴圈。
  // - 工作在畫面卸載、或這個網址不在新的清單裡時作廢（cancelJob）：之後才回來的 onload／onerror／decode／逾時都不得寫共用紀錄或本地狀態
  //   （否則舊工作會污染共用紀錄，讓新畫面以為載好了卻沒有結果）。網址換回來（A→B→A）時是新的工作，不沿用舊的。
  // - 共用紀錄命中（這次開啟期間已載入成功過）就不重載，但必須把本地狀態同步成 loaded，新畫面才拿得到結果。
  // 共用紀錄的語意是「這次開啟期間曾載入成功，可略過淡入」，不偵測之後網址是否失效（原本也沒有）；失敗不記，下次進來重新嘗試一次。
  const loadImage = useCallback(
    (url: string, timeoutMs: number) => {
      if (!url) return;
      if (imageReadyCache[url]) {
        setImageStatus((prev) => (prev[url] === 'loaded' ? prev : { ...prev, [url]: 'loaded' }));
        return;
      }
      const jobs = jobsRef.current;
      if (jobs.has(url)) return;
      const job: LoadJob = { alive: true, settled: false, timer: null };
      jobs.set(url, job);
      if (typeof Image === 'undefined') {
        setImageStatus((prev) => (prev[url] ? prev : { ...prev, [url]: 'timeout' }));
        return;
      }
      job.timer = window.setTimeout(() => {
        job.timer = null;
        if (!job.alive) return;
        setImageStatus((prev) => (prev[url] ? prev : { ...prev, [url]: 'timeout' }));
      }, timeoutMs);
      const settle = (status: 'loaded' | 'failed'): void => {
        if (!job.alive || job.settled) return;
        job.settled = true;
        if (job.timer !== null) {
          window.clearTimeout(job.timer);
          job.timer = null;
        }
        markImage(url, status);
      };
      const img = new Image();
      if ('decoding' in img) img.decoding = 'async';
      img.onload = () => settle('loaded');
      img.onerror = () => settle('failed');
      img.src = url;
      if (typeof img.decode === 'function') {
        img.decode().then(
          () => settle('loaded'),
          () => settle('failed'),
        );
      }
    },
    [markImage],
  );
  // 清單改變：不在新清單裡的網址，工作作廢並丟掉它的本地狀態（沒有成功紀錄的話），之後換回來才會重新開始；仍在清單裡的網址保留（去重）。
  // 必須定義在下面兩個載入 effect 之前（同一輪 commit 依定義順序執行）。
  useEffect(() => {
    const present = new Set<string>();
    for (const b of banners) {
      const url = sanitizeHttpUrl(b.image);
      if (url) present.add(url);
    }
    const jobs = jobsRef.current;
    const dropped: string[] = [];
    jobs.forEach((job, url) => {
      if (present.has(url)) return;
      cancelJob(job);
      jobs.delete(url);
      dropped.push(url);
    });
    if (dropped.length === 0) return;
    setImageStatus((prev) => {
      let next = prev;
      for (const url of dropped) {
        if (!(url in next) || imageReadyCache[url]) continue;
        if (next === prev) next = { ...prev };
        delete next[url];
      }
      return next;
    });
  }, [banners]);
  // 卸載：全部作廢（清掉逾時計時，並讓還在途的回呼失效）。
  useEffect(() => {
    const jobs = jobsRef.current;
    return () => {
      jobs.forEach(cancelJob);
      jobs.clear();
    };
  }, []);
  useEffect(() => {
    if (banners.length === 0) return;
    loadImage(sanitizeHttpUrl(banners[activeIndex]?.image), timeoutFor(activeIndex));
  }, [banners, activeIndex, loadImage]);
  useEffect(() => {
    if (banners.length < 2) return;
    const currentUrl = sanitizeHttpUrl(banners[activeIndex]?.image);
    const currentStatus = currentUrl ? imageStatus[currentUrl] : undefined;
    if (currentUrl && currentStatus !== 'loaded' && currentStatus !== 'failed') return;
    const next = (activeIndex + 1) % banners.length;
    loadImage(sanitizeHttpUrl(banners[next]?.image), timeoutFor(next));
  }, [banners, activeIndex, imageStatus, loadImage]);

  // 提早高優先權下載第一張：動態加一個 <link rel="preload" as="image" fetchpriority="high">（取代原本想用的隱藏 <img>：
  // 少一層 DOM、沒有 LCP 歸屬與破圖圖示的問題）。href 與背景圖用的是同一個字串（safeImg，背景圖只多了 CSS 跳脫、解析後相同），
  // 才打得到同一份快取。清單替換或畫面卸載時移除，不累積；這張已經載入成功過（記憶體紀錄）就不需要。
  const firstImageUrl = sanitizeHttpUrl(banners[0]?.image);
  useEffect(() => {
    if (!firstImageUrl || imageReadyCache[firstImageUrl]) return;
    const link = document.createElement('link');
    link.setAttribute('rel', 'preload');
    link.setAttribute('as', 'image');
    link.setAttribute('fetchpriority', 'high');
    link.setAttribute('href', firstImageUrl);
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [firstImageUrl]);

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
      loadImage(sanitizeHttpUrl(banners[safeIdx]?.image), timeoutFor(safeIdx));
    },
    [banners, loadImage],
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
            const safeLink = safeBannerLinkUrl(b.linkUrl);
            const safeImg = sanitizeHttpUrl(b.image);
            const status = safeImg ? imageStatus[safeImg] : undefined;
            const handleSlideClick = safeLink
              ? () => {
                  window.open(safeLink, 'sporthub_ad', 'noopener,noreferrer');
                }
              : undefined;

            if (safeImg) {
              // 畫面和原本（a924c7b）完全一樣：slide 自己的 inline background-image。載入中壓暗（.banner-slide--loading）；
              // loaded、timeout 設背景圖（timeout＝逾時後直接設，邊載邊顯示）；failed 不設——壞網址的背景圖本來就什麼都不畫，只剩暗色遮罩，
              // 所以失敗時的可見畫面沒有任何新樣式。
              const bgCss = status === 'loaded' || status === 'timeout'
                ? `background-image:url("${safeImg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}");background-size:cover;background-position:center;`
                : '';
              const cursorCss = safeLink ? 'cursor:pointer;' : '';
              return (
                <div
                  key={b.id || b._docId || `slide-${idx}`}
                  class={`banner-slide${status ? '' : ' banner-slide--loading'}`}
                  data-bg-src={safeImg}
                  data-banner-priority={idx === 0 ? 'high' : 'normal'}
                  data-banner-load-state={status === 'loaded' ? 'done' : (status ?? 'loading')}
                  style={`${bgCss}${cursorCss}` || undefined}
                  onClick={handleSlideClick}
                />
              );
            }

            const bgGradient = safeBannerGradient(b.gradient) || 'var(--bg-elevated)';
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
