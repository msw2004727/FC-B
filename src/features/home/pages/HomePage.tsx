import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useActiveSport } from '@/core/sport-filter';
import { UNAVAILABLE_FEATURE_MSG } from '@/core/unavailable';
import { useCreateEventEntry } from '@/features/events/components/event-form/use-create-event-entry';
import { useEventFormPostSave } from '@/features/events/components/event-form/use-event-form-post-save';
import { useLegacyT } from '@/i18n/i18n';
import { publicEventHref } from '@/features/events/data/presentation';
import { SPORTS } from '@/features/events/data/sports';
import type { EventDoc } from '@/features/events/data/types';
import { useEvents } from '@/features/events/data/use-events';
import { getVisibleEvents } from '@/features/events/data/visibility';
import { getFirebaseCore, trackPublicRead } from '@/data/firebase';
import { useViewer } from '@/features/profile/data/viewer';
import { SportIcon } from '@/ui/SportIcon';
import { toast } from '@/ui/Toast';
import { HomeBannerCarousel } from '../components/legacy/HomeBannerCarousel';
import { HomeNextActivity } from '../components/legacy/HomeNextActivity';
import {
  computeMarqueeDurationSeconds,
  loadActiveAnnouncements,
  type AnnouncementDoc,
} from '../data/announcements';
import { loadActiveBanners, type BannerDoc } from '../data/banners';
import { startBannersRestFetch } from '../data/banners-rest';
import { canUseBannersRest } from '../data/banners-rest-guard';
import {
  loadEventFormModal,
  scheduleEventFormPrefetch,
  type EventFormModalComponent,
} from '../data/event-form-loader';
import {
  readBannersSnapshot,
  readSportsSnapshot,
  writeBannersSnapshot,
  toPublicBanners,
  writeSportsSnapshot,
  type SnapshotRead,
} from '../data/home-snapshot';
import { computeGuestSportRows, computeSportRows, type SportRow } from '../data/sport-rows';
import { useSnapshotExpiry } from '../data/use-snapshot-expiry';
// 首頁兩顆「我要開團」按鈕（.home-create-event-btn：金色旋轉外框、藍色漸層、光暈動畫、鎖定狀態）的樣式定義在
// activity.css。表單改 lazy 後它不再隨 EventFormModal 進首頁，所以在這裡明確引入，並放在 home.css 之前，
// 維持和 main 相同的層疊順序（同權重規則由 home.css 勝出）。T-041 退修 1 P1-1。
import '@/features/events/legacy/activity.css';
import '../legacy/home.css';

const HOME_ACTIVITY_REGION_KEY = 'toosterx_home_activity_region';
const HOME_ACTIVITY_REGIONS = ['全部', '北部', '中部', '南部', '東部&外島'] as const;
const HOME_ACTIVITY_TYPES = [
  { value: '', label: '全部類型' },
  { value: 'play', label: 'PLAY' },
  { value: 'camp', label: '訓練營' },
  { value: 'watch', label: '觀賽' },
  { value: 'external', label: '外部活動' },
] as const;

function numberText(value: number): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return '0';
  return Math.floor(num).toLocaleString('zh-TW');
}

function readStoredRegion(): string {
  try {
    const raw = (localStorage.getItem(HOME_ACTIVITY_REGION_KEY) || '').trim();
    return (HOME_ACTIVITY_REGIONS as readonly string[]).includes(raw) ? raw : '全部';
  } catch {
    return '全部';
  }
}

export default function HomePage(): JSX.Element {
  const lt = useLegacyT();
  const viewer = useViewer();
  const location = useLocation();
  // 首屏快照（T-042）。運動統計的畫面來源有三種，優先順序固定：
  //   1. 即時：這個畫面採用了「確認向伺服器新取得」的活動（含空結果）→ 一律用 computedSportRows，快照從此撤銷（sportSnap=null）；
  //   2. 既有快取：useEvents 已有活動（記憶體／帳號底下的本機快照／離線時的持久快取）→ 用它算（T-041 以來的行為，沒動）；
  //   3. 首屏快照：以上都沒有（活動還在讀或讀取失敗）才用，且到期（見下）或被撤銷後就不再用。
  // 橫幅同理：快照只是第一次 render 先畫的內容，伺服器確認的結果一到就取代，到期也要撤掉。
  // 帳號語意：快照為訪客視角的公開資料、沒有帳號歸屬；登入者的最終畫面一律以正式資料（用自己的視角算）取代快照。
  // 「只放訪客可見資料」由寫入守門保證：writeSportsSnapshot／writeBannersSnapshot 只收 computeGuestSportRows／toPublicBanners 的輸出型別。
  const [sportSnap, setSportSnap] = useState<SnapshotRead<SportRow> | null>(() => readSportsSnapshot());
  // 統計的到期回呼只是「丟掉快照 fallback」，不碰正式資料（正式資料是另外用 events 算出來的），所以過時的回呼晚到也沒有副作用，
  // 不需要核對來源（橫幅不同：橫幅的 state 同時放快照與正式資料，過時的回呼會把正式資料清掉，所以橫幅那邊要核對）。
  useSnapshotExpiry(sportSnap?.expiresAt ?? null, () => setSportSnap(null));
  // 只有「確認新取得」的活動才會走到這裡（use-events 的 onFresh）：用訪客視角寫快照、撤銷快照 fallback（含空結果；之後重試也不回頭用舊統計）。
  const handleFreshEvents = useCallback((events: EventDoc[]) => {
    writeSportsSnapshot(computeGuestSportRows(events, Date.now()));
    setSportSnap(null);
  }, []);
  // 首頁只用進行中活動算運動數量與卡片，不載 ended／cancelled 近 50 筆（A4）；活動列表等頁仍載入預覽（R-EVT-002／003）。
  const eventsData = useEvents(viewer.uid, { terminalMode: 'none', onFresh: handleFreshEvents });

  // 橫幅快照第一次 render 就畫（沒有、過期或版本不同＝空陣列，維持骨架）。只讀一次。
  const [initialBanners] = useState(() => readBannersSnapshot());
  // 冷啟動（沒有有效快照）才在第一次 render 就發出匿名 REST 讀取（T-042c），與 SDK 載入並行；已有快照的暖啟動不發（快照已經畫出來了）。
  // 本機網址或 emulator 模式不發（REST 會繞過 SDK 的「本機只能連 emulator」守門）；每次頁面載入只發一次（重掛回傳 null）。
  // 結果由下方的 effect 接手，失敗（null）一律靜默、SDK 路徑照常。T-042d：index.html 內嵌 script 若已提早發出請求（window.__fcbEarlyBanners），
  // startBannersRestFetch 接手它的原始回應（映射、toPublicBanners 白名單、快照寫入守門仍全在這裡），不再自己發。
  const [bannersRest] = useState(() => (initialBanners || !canUseBannersRest() ? null : startBannersRestFetch()));
  const [banners, setBanners] = useState<BannerDoc[]>(() => initialBanners?.items ?? []);
  // 目前畫面上的橫幅若來自快照，這裡是它的到期時間；被伺服器結果取代後為 null。
  const [bannerExpiry, setBannerExpiry] = useState<number | null>(() => initialBanners?.expiresAt ?? null);
  const bannerExpiryRef = useRef(bannerExpiry);
  useSnapshotExpiry(bannerExpiry, () => {
    const due = bannerExpiryRef.current;
    // 已被正式資料取代（ref 已是 null）或還沒真的到期（計時器提早醒來、時鐘被調回）：什麼都不做。
    if (due === null || Date.now() < due) return;
    bannerExpiryRef.current = null;
    setBanners([]);
    setBannerExpiry(null);
  });
  const [announcements, setAnnouncements] = useState<AnnouncementDoc[]>([]);
  const [selectedAnn, setSelectedAnn] = useState<AnnouncementDoc | null>(null);
  const [activeSport, setActiveSport] = useActiveSport();
  const createEntry = useCreateEventEntry(viewer);
  const onFormSaved = useEventFormPostSave({
    viewer,
    close: createEntry.closeForm,
    refresh: () => eventsData.retry(),
  });
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchRegion, setSearchRegion] = useState<string>(() => readStoredRegion());
  const [searchSport, setSearchSport] = useState<string>(() => activeSport || 'all');
  const [searchType, setSearchType] = useState<string>('');

  const userCanCreate = createEntry.canCreate;

  // 開團表單改成點擊時才下載（A1）；載入完成後元件保持掛載，行為同原本「一直掛著、靠 open 開關」。
  const [FormModal, setFormModal] = useState<EventFormModalComponent | null>(null);
  const formOpen = createEntry.formOpen;
  const closeForm = createEntry.closeForm;
  useEffect(() => {
    if (!formOpen || FormModal) return undefined;
    let active = true;
    loadEventFormModal().then(
      (component) => {
        // 元件本身是函式，setState 要包一層避免被當成 updater。
        if (active) setFormModal(() => component);
      },
      () => {
        if (!active) return;
        toast.show({
          message: lt('活動建立功能載入失敗，請稍後再試', '活動建立功能載入失敗，請稍後再試'),
        });
        closeForm();
      },
    );
    return () => {
      active = false;
    };
  }, [formOpen, FormModal]);

  // 有建立權限的人：瀏覽器空閒時先把表單載好，點「我要開團」後少一次等待。
  useEffect(() => {
    if (!userCanCreate) return undefined;
    return scheduleEventFormPrefetch();
  }, [userCanCreate]);

  useEffect(() => {
    let active = true;
    let bannersConfirmed = false;
    // SDK 已確認的正式資料取代過畫面：之後晚到的 REST 結果不得再覆蓋、也不得再寫快照。
    let sdkConfirmed = false;
    // 橫幅與公告都是公開讀取（Rules allow read: if true），只需要 app＋firestore，不等 auth／functions；
    // 登記後，沒有登入旗標的訪客：首頁公開讀取全部處理完才讓 Auth 註冊，首屏資料不再被 Auth 還原擋住；
    // 有登入旗標的人 Auth 先走（避免新分頁以未登入身分成為 Firestore 主分頁），登記不生效（T-041，見 data/firebase.ts）。
    trackPublicRead(
      loadActiveBanners({
        getFirebase: getFirebaseCore,
        onResult: (meta) => {
          bannersConfirmed = meta.fromCache === false;
        },
      }),
    )
      .then((list) => {
        // 畫面已卸載（或被新的一輪取代）就什麼都不做：舊請求晚到不能覆寫快照，也不能動畫面。
        if (!active) return;
        if (!bannersConfirmed) {
          // 沒有確認向伺服器新取得：查詢失敗（loadActiveBanners 回 []、沒有回報結果）、離線時 Firestore 回持久快取、或讀不到旗標。
          // 一律不更新快照新鮮度，也不拿它取代畫面上的快照橫幅（失敗不會清掉快照）；畫面上還沒有任何橫幅時才用（維持 T-041 以來的行為）。
          setBanners((prev) => (prev.length > 0 ? prev : list));
          return;
        }
        // 確認新取得：寫快照（空清單＝目前沒有橫幅，刪掉舊快照）、換畫面、快照到期不再適用。
        sdkConfirmed = true;
        writeBannersSnapshot(toPublicBanners(list));
        bannerExpiryRef.current = null;
        setBanners(list);
        setBannerExpiry(null);
      })
      .catch(() => {
        if (active) setBanners([]);
      });
    // 冷啟動的 REST 結果（比 SDK 早到的暫時畫面）：畫面已卸載、SDK 已確認取代過、REST 失敗（null）、或沒有可顯示的橫幅（空清單，
    // 「真的沒有橫幅」交給 SDK 的確認結果判斷）都不動作。有結果就和 SDK 確認路徑一樣，經 toPublicBanners 白名單後寫快照並畫出同一份白名單結果；
    // 之後 SDK 的正式資料照舊取代它。REST 不經 trackPublicRead／Auth 暫緩（獨立的匿名請求）。
    bannersRest?.result
      .then((list) => {
        if (!active || sdkConfirmed || !list || list.length === 0) return;
        const publicList = toPublicBanners(list);
        if (publicList.length === 0) return;
        writeBannersSnapshot(publicList);
        setBanners([...publicList]);
      })
      .catch(() => undefined);
    trackPublicRead(loadActiveAnnouncements())
      .then((list) => {
        if (active) setAnnouncements(list);
      })
      .catch(() => {
        if (active) setAnnouncements([]);
      });
    return () => {
      active = false;
      bannersRest?.cancel();
    };
  }, []);

  const visibleEvents = useMemo(
    () => getVisibleEvents(eventsData.events, viewer, []),
    [eventsData.events, viewer],
  );

  const computedSportRows = useMemo(
    () => computeSportRows(visibleEvents, Date.now()),
    [visibleEvents],
  );
  // 來源 2（既有快取）優先於來源 3（首屏快照）；來源 1 確認後 sportSnap 已是 null，見上方 handleFreshEvents。
  // 選用快照當下再檢查一次期限（計時器被延後、時鐘往前跳時，不能選到已過期的快照）。
  const sportSnapUsable = sportSnap !== null && Date.now() < sportSnap.expiresAt;
  const sportRows = eventsData.events.length === 0 && sportSnap && sportSnapUsable ? sportSnap.items : computedSportRows;
  // 橫幅同理：畫面上的橫幅若來自快照而且已過期（計時器還沒來得及撤掉），這一輪 render 就不畫。
  const shownBanners = bannerExpiry !== null && Date.now() >= bannerExpiry ? [] : banners;

  function handleUnavailableFeature(e?: Event): void {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    toast.show({ message: UNAVAILABLE_FEATURE_MSG });
  }

  function handleOpenCreateEvent(e?: Event): void {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    // 一按就開始下載表單：後面還有讀個人資料與類型選擇，通常載完才輪到它。
    loadEventFormModal().catch(() => undefined);
    createEntry.onClick();
  }

  function handleSelectHomeSport(sportKey: string): void {
    const safeKey = setActiveSport(sportKey || 'all');
    if (safeKey && safeKey !== 'all') {
      const found = SPORTS.find((s) => s.key === safeKey);
      toast.show({ message: `已切換到${found?.label ?? '此運動'}` });
      location.route(`/activities?sport=${encodeURIComponent(safeKey)}`);
    } else {
      location.route('/activities');
    }
  }

  function handleOpenSearchModal(e?: Event): void {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setSearchRegion(readStoredRegion());
    setSearchSport(activeSport || 'all');
    setSearchType('');
    setSearchModalOpen(true);
  }

  function handleSubmitSearchModal(): void {
    try {
      localStorage.setItem(HOME_ACTIVITY_REGION_KEY, searchRegion);
    } catch {
      /* ignore */
    }
    const safeSport = setActiveSport(searchSport || 'all');
    setSearchModalOpen(false);
    const params = new URLSearchParams();
    if (safeSport && safeSport !== 'all') {
      params.set('sport', safeSport);
    }
    const qs = params.toString();
    location.route(qs ? `/activities?${qs}` : '/activities');
  }

  function handleOpenEventDetail(event: EventDoc): void {
    const href = publicEventHref(event);
    if (href) {
      location.route(href);
    }
  }

  const marqueeDuration = useMemo(
    () => computeMarqueeDurationSeconds(announcements),
    [announcements],
  );

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-home">
        {/* Banner Carousel */}
        <HomeBannerCarousel
          banners={shownBanners}
          onOpenNearbyMap={handleUnavailableFeature}
          onOpenSearchModal={handleOpenSearchModal}
          onOpenCreateEvent={handleOpenCreateEvent}
          canCreate={userCanCreate}
        />

        <div class="home-hero-actions is-empty" aria-label="首頁快速操作">
          <button
            class="home-watch-party-card is-hidden"
            type="button"
            aria-label="查看觀賽聚會"
            onClick={handleUnavailableFeature}
          >
            <span class="home-watch-party-copy">一起找人看比賽</span>
          </button>
          <button
            class={`primary-btn small home-create-event-btn${createEntry.buttonProps.lockedClass ? ` ${createEntry.buttonProps.lockedClass}` : ''}`}
            type="button"
            style={userCanCreate ? undefined : 'display:none'}
            aria-disabled={createEntry.buttonProps['aria-disabled']}
            data-profile-incomplete={createEntry.buttonProps['data-profile-incomplete']}
            title={createEntry.buttonProps.title}
            onClick={handleOpenCreateEvent}
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
            <span>{lt('我要開團', '我要開團')}</span>
          </button>
        </div>

        {/* System Announcement Marquee */}
        <div
          class="announce-marquee-wrap"
          id="announce-marquee-wrap"
          style={announcements.length > 0 ? undefined : 'display:none'}
        >
          <span class="announce-marquee-label">公告</span>
          <div class="announce-marquee-track" id="announce-marquee-track">
            {announcements.length > 0 && (
              <div
                class="announce-marquee-inner"
                style={`--marquee-duration: ${marqueeDuration}s`}
              >
                {[...announcements, ...announcements].map((ann, idx) => (
                  <span
                    key={`${ann.id}-${idx}`}
                    class="announce-marquee-item"
                    onClick={() => setSelectedAnn(ann)}
                  >
                    {`${ann.title || '公告'}：${ann.content || ''}`}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Announcement Detail Modal */}
        <div
          class={`modal-overlay${selectedAnn ? ' open' : ''}`}
          id="announce-detail-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedAnn(null);
          }}
        >
          <div class={`modal announcement-detail-modal${selectedAnn ? ' open' : ''}`}>
            <div class="modal-header">
              <h3 id="ann-detail-title">{selectedAnn?.title || (selectedAnn ? '公告' : '')}</h3>
              <button
                class="modal-close"
                type="button"
                onClick={() => setSelectedAnn(null)}
              >
                ✕
              </button>
            </div>
            <div class="modal-body" id="ann-detail-body">
              {selectedAnn?.content || ''}
            </div>
            <div
              id="ann-detail-footer"
              style="padding:.4rem 1.2rem .8rem;display:flex;align-items:center;gap:.5rem;font-size:.72rem;color:var(--text-muted)"
            >
              {selectedAnn ? <span>{selectedAnn.publishAt || ''}</span> : null}
            </div>
          </div>
        </div>

        {/* My Next Activity */}
        <HomeNextActivity
          viewer={viewer}
          onViewAll={() => location.route('/activities')}
          onFindActivity={() => location.route('/activities')}
          onCreateEvent={handleOpenCreateEvent}
          onOpenDetail={handleOpenEventDetail}
          onAddToCalendar={() => handleUnavailableFeature()}
        />

        {/* Sport Quick Entry */}
        <section class="home-dashboard-section" aria-labelledby="home-sport-entry-title">
          <div class="home-dashboard-title-row">
            <h3 id="home-sport-entry-title">運動快速入口</h3>
            {/* 瀏覽次數（views）B 沒有資料來源：照 A 位置顯示，無資料時不顯示數字（搭配 :empty 自動隱藏） */}
            <span
              class="home-stat-views home-sport-views"
              id="home-sport-views"
              title="瀏覽統計"
              aria-live="polite"
            />
          </div>
          <div class="home-sport-entry" id="home-sport-entry" aria-live="polite">
            {sportRows.map((item) => (
              <button
                key={item.key}
                class={`home-sport-chip${item.key === activeSport ? ' active' : ''}`}
                type="button"
                data-home-sport={item.key}
                aria-label={`${item.label} ${numberText(item.count)} 個活動`}
                title={item.label}
                onClick={() => handleSelectHomeSport(item.key)}
              >
                <span
                  class={`home-sport-chip-mark home-sport-chip-mark-${item.key}`}
                  aria-hidden="true"
                >
                  <SportIcon sportKey={item.key} />
                </span>
                <span class="home-sport-chip-text">
                  <span class="home-sport-chip-label">{item.label}</span>
                  <span class="home-sport-chip-count">{`${numberText(item.count)} 活動`}</span>
                </span>
              </button>
            ))}
            <button
              class="home-sport-chip home-sport-chip-more"
              type="button"
              aria-label="查看更多活動分類"
              onClick={() => handleSelectHomeSport('all')}
            >
              <span class="home-sport-chip-more-text">查看更多</span>
            </button>
          </div>
        </section>

        {/* Current Info Meter（照 A homeInfoSettings 預設無受管設定時 status 為 pending → .is-hidden） */}
        <section
          class="home-dashboard-section home-info-dashboard-section is-hidden"
          aria-labelledby="home-info-title"
        >
          <div class="home-dashboard-title-row home-info-title-row">
            <h3 id="home-info-title">目前資訊</h3>
          </div>
          <div class="home-info-meter" id="home-info-meter" aria-live="polite" />
        </section>

        <hr class="home-divider" id="home-game-divider" style="display:none" />
        {/* Game Shortcut */}
        <div class="home-heading" id="home-game-heading" style="display:none">
          <h3>小遊戲</h3>
          <div class="home-heading-accent" />
        </div>
        <button
          class="home-game-card"
          id="home-game-card-shot"
          type="button"
          aria-label="蓄力射門 誰與爭鋒"
          style="display:none"
          onClick={handleUnavailableFeature}
        >
          <div class="home-game-card-icon" aria-hidden="true">⚽</div>
          <div class="home-game-card-info">
            <div class="home-game-card-title">蓄力射門 誰與爭鋒</div>
            <div class="home-game-card-sub">挑戰移動九宮格、登上榮耀射手榜!!</div>
          </div>
          <svg
            class="home-game-card-arrow"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <button
          class="home-game-rank-trigger"
          id="home-game-rank-load-shot"
          type="button"
          aria-controls="home-game-rank-shot"
          aria-expanded="false"
          aria-label="查看蓄力射門本月排行"
          style="display:none"
          onClick={handleUnavailableFeature}
        >
          查看本月排行
        </button>
        <div
          class="home-game-rank-preview"
          id="home-game-rank-shot"
          role="region"
          aria-label="蓄力射門本月排行"
          aria-live="polite"
          hidden
        />
        <button
          class="home-game-card"
          id="home-game-card-kick"
          type="button"
          aria-label="誰才是開球王"
          style="display:none"
          onClick={handleUnavailableFeature}
        >
          <div class="home-game-card-icon" aria-hidden="true">⚽</div>
          <div class="home-game-card-info">
            <div class="home-game-card-title">誰才是開球王</div>
            <div class="home-game-card-sub">蓄力開球、挑戰最遠距離，登上開球榜!</div>
          </div>
          <svg
            class="home-game-card-arrow"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <button
          class="home-game-rank-trigger"
          id="home-game-rank-load-kick"
          type="button"
          aria-controls="home-game-rank-kick"
          aria-expanded="false"
          aria-label="查看開球王本月排行"
          style="display:none"
          onClick={handleUnavailableFeature}
        >
          查看本月排行
        </button>
        <div
          class="home-game-rank-preview"
          id="home-game-rank-kick"
          role="region"
          aria-label="開球王本月排行"
          aria-live="polite"
          hidden
        />

        <hr class="home-divider" id="sponsor-divider" style="display:none" />
        {/* Sponsors（無贊助商資料時照 A renderSponsors 隱藏） */}
        <div class="sponsor-grid" id="sponsor-grid" style="display:none" />

        <hr class="home-divider" id="news-divider" style="display:none" />
        {/* Sports News */}
        <div class="home-heading" id="news-section-title" style="display:none">
          <h3>每日體育新聞</h3>
          <div class="home-heading-accent" />
        </div>
        <div class="news-tabs" id="news-tabs" style="display:none" />
        {/* A news.js#renderNews：新聞未開放時整個列表隱藏（B 新聞功能下一批補） */}
        <div class="news-card-list" id="news-card-list" style="display:none" />

        {/* Floating Ads */}
        <div class="floating-ads" id="floating-ads" />

        {/* 找活動條件篩選對話框（照 A _ensureHomeActivitySearchModal） */}
        {searchModalOpen && (
          <div
            class="home-activity-search-overlay open"
            id="home-activity-search-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSearchModalOpen(false);
            }}
          >
            <div
              class="home-activity-search-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="home-activity-search-title"
            >
              <button
                class="home-activity-search-close"
                type="button"
                aria-label="關閉"
                onClick={() => setSearchModalOpen(false)}
              >
                &times;
              </button>
              <div class="home-activity-search-head">
                <h3 id="home-activity-search-title">找活動</h3>
                <p>選好條件後，我會直接帶你到活動頁並套用篩選。</p>
              </div>
              <div class="home-activity-search-fields">
                <label>
                  <span>地區</span>
                  <select
                    id="home-search-region"
                    value={searchRegion}
                    onChange={(e) => setSearchRegion(e.currentTarget.value)}
                  >
                    {HOME_ACTIVITY_REGIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>運動類別</span>
                  <select
                    id="home-search-sport"
                    value={searchSport}
                    onChange={(e) => setSearchSport(e.currentTarget.value)}
                  >
                    <option value="all">全部運動</option>
                    {SPORTS.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>活動類型</span>
                  <select
                    id="home-search-type"
                    value={searchType}
                    onChange={(e) => setSearchType(e.currentTarget.value)}
                  >
                    {HOME_ACTIVITY_TYPES.map((tItem) => (
                      <option key={tItem.value} value={tItem.value}>
                        {tItem.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                class="home-activity-search-submit"
                type="button"
                onClick={handleSubmitSearchModal}
              >
                找活動
              </button>
            </div>
          </div>
        )}

        {createEntry.overlays}
        {FormModal && (
          <FormModal
            open={createEntry.formOpen}
            mode="create"
            viewer={viewer}
            onClose={createEntry.closeForm}
            onSaved={onFormSaved}
          />
        )}
      </section>
    </div>
  );
}
