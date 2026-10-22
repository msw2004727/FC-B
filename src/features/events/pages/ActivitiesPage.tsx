import { UNAVAILABLE_FEATURE_MSG } from '@/core/unavailable';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import type { ComponentType } from 'preact';
import { drawerOwnActivityManage } from '@/core/drawer-access';
import {
  getActiveSport,
  normalizeActiveSport,
  useActiveSport,
} from '@/core/sport-filter';
import { useSwipeTabs } from '@/core/use-swipe-tabs';
import { lt, useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { useViewer } from '@/features/profile/data/viewer';
import { EventFormModal } from '../components/EventFormModal';
import {
  TimelineEventCard,
  getEventAllowedGender,
  type LegacyEventDoc,
} from '../components/legacy/TimelineEventCard';
import { ExternalTransitCard } from '../components/legacy/ExternalTransitCard';
import { canCreateEvent } from '../data/event-create';
import { createEventContextFromViewer } from '../data/event-create-context';
import {
  NEARBY_DISABLED_MSG,
  SHARED_TOAST_FAIL,
  shareCurrentActivityUrl,
  type ActivityShareFilters,
} from '../data/activity-share';
import { publicEventHref } from '../data/presentation';
import { SPORTS, eventSportTag } from '../data/sports';
import { isEventInEndedTab, normalizeListTab } from '../data/terminal';
import type { RegistrationDoc } from '../data/types';
import { useEvents } from '../data/use-events';
import { loadViewerRegistrations } from '../data/viewer-registrations';
import { getVisibleEvents } from '../data/visibility';
import {
  loadFavorites,
  saveFavorites,
  toggleEventInFavorites,
  type FavoritesDoc,
} from '../data/favorites';
import { useDebouncedValue } from '../data/use-debounced-value';
import { useFemalePetals } from '../components/legacy/use-female-petals';
import '../legacy/activity.css';
import '../components/legacy/activity-search.css';
import type { ActivityCalendarProps } from '../components/legacy/ActivityCalendar';

// M-071：月曆載入中骨架（同 A pages/activity.html #activity-calendar 內容）。
function CalendarSkeleton(): JSX.Element {
  return (
    <div class="evt-cal-skeleton" aria-hidden="true">
      <div class="evt-cal-skeleton-cell" />
      <div class="evt-cal-skeleton-cell" />
      <div class="evt-cal-skeleton-cell" />
      <div class="evt-cal-skeleton-cell" />
      <div class="evt-cal-skeleton-cell" />
      <div class="evt-cal-skeleton-cell" />
      <div class="evt-cal-skeleton-cell" />
    </div>
  );
}

interface ViewerRegistrationsState {
  uid: string | null;
  docs: RegistrationDoc[];
}

interface DayGroup {
  day: number;
  dayName: string;
  events: LegacyEventDoc[];
}

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'] as const;
const REGIONS = ['中部', '北部', '南部', '東部&外島', '全部'] as const;
// U-020：共用 core/unavailable 的提示文字。
const UNAVAILABLE_MSG = UNAVAILABLE_FEATURE_MSG;

const REGION_SLUGS: Readonly<Record<string, string>> = {
  all: '全部',
  north: '北部',
  central: '中部',
  south: '南部',
  'east-islands': '東部&外島',
};

const ACTIVITY_URL_TYPES = ['play', 'camp', 'watch', 'external'] as const;
const ACTIVITY_URL_FILTER_KEYS = ['region', 'sport', 'tab', 'type'] as const;

function normalizeActivityUrlRegion(value: string | null | undefined): string {
  const raw = String(value ?? '').trim().replace(/&amp;/g, '&');
  if (!raw) return '全部';
  const lower = raw.toLowerCase();
  if (REGION_SLUGS[lower]) return REGION_SLUGS[lower]!;
  return Object.values(REGION_SLUGS).includes(raw) ? raw : '全部';
}

function getActivityRegionSlug(region: string): string {
  const normalized = normalizeActivityUrlRegion(region);
  const found = Object.entries(REGION_SLUGS).find(([, label]) => label === normalized);
  return found ? found[0] : 'all';
}

function normalizeActivityUrlType(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  return (ACTIVITY_URL_TYPES as readonly string[]).includes(raw) ? raw : '';
}

function readUrlFilters(urlStr: string): {
  hasExplicit: boolean;
  hasSportParam: boolean;
  region: string;
  sport: string;
  tab: 'normal' | 'female' | 'calendar';
  type: string;
} {
  const parsed = new URL(urlStr || '/activities', 'https://toosterx.invalid');
  const params = parsed.searchParams;
  const hasExplicit = ACTIVITY_URL_FILTER_KEYS.some((key) => params.has(key));
  const hasSportParam = params.has('sport');
  const requestedTab = params.get('tab');
  const normalizedTab = normalizeListTab(requestedTab);
  return {
    hasExplicit,
    hasSportParam,
    region: normalizeActivityUrlRegion(params.get('region')),
    sport: normalizeActiveSport(params.get('sport')),
    tab: normalizedTab === 'calendar' ? 'calendar' : normalizedTab === 'female' ? 'female' : 'normal',
    type: normalizeActivityUrlType(params.get('type')),
  };
}

function normalizeActivitySearchValue(value: unknown): string {
  return String(value || '')
    .replace(/\u81fa/g, '\u53f0')
    .toLowerCase()
    .replace(/[^\w\u3400-\u9fff]+/g, '');
}

function fuzzyTextContains(text: string, keyword: string): boolean {
  const hay = normalizeActivitySearchValue(text);
  const needle = normalizeActivitySearchValue(keyword);
  if (!needle) return true;
  if (!hay) return false;
  if (hay.includes(needle)) return true;
  let pos = 0;
  for (let i = 0; i < needle.length; i++) {
    const ch = needle[i];
    if (!ch) continue;
    pos = hay.indexOf(ch, pos);
    if (pos === -1) return false;
    pos++;
  }
  return true;
}

function getActivitySearchText(e: LegacyEventDoc): string {
  const tag = eventSportTag(e) || e.sport || '';
  const sportLabel = SPORTS.find((s) => s.sportTag === tag)?.label ?? '';
  return [
    e.title,
    e.location,
    e.venue,
    e.region,
    e.date,
    e.hostName,
    e.creatorName,
    e.organizer,
    e.host,
    e.type,
    e.sportTag,
    sportLabel,
  ].filter(Boolean).join(' ');
}

function matchesActivityKeyword(e: LegacyEventDoc, keyword: string): boolean {
  const tokens = String(keyword || '')
    .trim()
    .split(/\s+/)
    .map((token) => normalizeActivitySearchValue(token))
    .filter(Boolean);
  if (!tokens.length) return true;
  const text = getActivitySearchText(e);
  return tokens.every((token) => fuzzyTextContains(text, token));
}

function filterByRegionTab(events: LegacyEventDoc[], tab: string): LegacyEventDoc[] {
  const active = tab || '全部';
  if (active === '全部') return events;
  return events.filter((e) => {
    if (!e.regionEnabled && !e.region) return true;
    if (e.regionEnabled === false) return true;
    return e.region === active;
  });
}

function filterBySportTag(events: LegacyEventDoc[], tag: string): LegacyEventDoc[] {
  const active = tag || 'all';
  if (active === 'all') return events;
  return events.filter((e) => (eventSportTag(e) || 'football') === active);
}

export default function ActivitiesPage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const location = useLocation();
  const data = useEvents(viewer.uid);

  const initialUrlFilters = useMemo(() => readUrlFilters(location.url), []);
  const [globalSport, setGlobalSport] = useActiveSport();

  const [searchOpen, setSearchOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [filterType, setFilterType] = useState<string>(() => initialUrlFilters.type);
  // U-027：輸入框即時顯示，實際篩選延遲 150ms。
  const [keywordInput, setKeywordInput] = useState('');
  const debouncedKeyword = useDebouncedValue(keywordInput, 150);
  const filterKeyword = debouncedKeyword.value;
  const keywordInputRef = useRef<HTMLInputElement>(null);
  const [regionTab, setRegionTab] = useState<string>(() => initialUrlFilters.region);
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);
  const [viewerRegistrations, setViewerRegistrations] = useState<ViewerRegistrationsState>({
    uid: null,
    docs: [],
  });
  const registrationRequestSeq = useRef(0);
  const lastSyncedUrlRef = useRef<string>(location.url);
  // M-076：卡片收藏狀態（心／資料同步都以此為準）
  const [favorites, setFavorites] = useState<FavoritesDoc>({ events: [], tournaments: [] });
  const favoritesRequestSeq = useRef(0);
  const favoritesRef = useRef<FavoritesDoc>({ events: [], tournaments: [] });
  const [transitEvent, setTransitEvent] = useState<LegacyEventDoc | null>(null);
  const activityListRef = useRef<HTMLDivElement>(null);
  const activityTabsRef = useRef<HTMLDivElement>(null);

  const createCtx = useMemo(() => createEventContextFromViewer(viewer), [viewer]);
  const showCreateButton = useMemo(
    () => (createCtx ? canCreateEvent(createCtx) : false),
    [createCtx],
  );
  const showManageEntry = useMemo(
    () => drawerOwnActivityManage(viewer),
    [viewer],
  );

  const urlFilters = readUrlFilters(location.url);
  const activeTab = urlFilters.tab;
  // M-024：網址帶 ?sport= 時優先並同步回全站；沒帶時套用全站記憶的 activeSport
  const effectiveSport = urlFilters.hasSportParam
    ? urlFilters.sport
    : (globalSport || getActiveSport() || 'all');

  const petalsCanvasRef = useRef<HTMLCanvasElement>(null);
  // M-074：切到女生專屬頁籤時在既有 canvas 上飄花瓣（照 A `_startActivityFemalePetals`）。
  useFemalePetals(petalsCanvasRef, activeTab === 'female');

  // 當外部改變 location.url（例如首次進入帶 ?sport=、?region=、?type=、?tab=）時同步進狀態與全站運動
  useEffect(() => {
    const parsed = readUrlFilters(location.url);
    const current = new URL(location.url, 'https://toosterx.invalid');
    const requestedTab = current.searchParams.get('tab');
    if (requestedTab !== null && requestedTab !== 'normal'
      && requestedTab !== 'female' && requestedTab !== 'calendar') {
      const nextTab = normalizeListTab(requestedTab);
      current.searchParams.set('tab', nextTab === 'female' ? 'female' : 'normal');
      location.route(`${current.pathname}${current.search}${current.hash}`, true);
      return;
    }

    if (parsed.hasSportParam && parsed.sport !== getActiveSport()) {
      setGlobalSport(parsed.sport);
    }
    if (location.url !== lastSyncedUrlRef.current && parsed.hasExplicit) {
      setRegionTab(parsed.region);
      setFilterType(parsed.type);
      lastSyncedUrlRef.current = location.url;
    }
  }, [location.url, location.route, setGlobalSport]);

  // M-024：當運動／地區／類型在活動頁變動時，照 A `_syncActivityUrlFilters` 同步到網址
  // 全站運動是這次 render 才改的（使用者從頂部下拉選）→ 用全站值寫網址；
  // 否則（剛進頁、網址帶 ?sport=）保留網址上的值，避免讀網址的同步還沒跑完就把分享連結的運動參數清掉。
  const prevGlobalSportRef = useRef(globalSport);
  useEffect(() => {
    const globalChanged = prevGlobalSportRef.current !== globalSport;
    prevGlobalSportRef.current = globalSport;
    const current = new URL(location.url, 'https://toosterx.invalid');
    if (current.pathname && current.pathname !== '/activities') return;

    const regionSlug = getActivityRegionSlug(regionTab);
    if (regionSlug !== 'all') {
      current.searchParams.set('region', regionSlug);
    } else {
      current.searchParams.delete('region');
    }

    const normSport = normalizeActiveSport(globalChanged ? globalSport : effectiveSport);
    if (normSport !== 'all') {
      current.searchParams.set('sport', normSport);
    } else {
      current.searchParams.delete('sport');
    }

    if (filterType) {
      current.searchParams.set('type', filterType);
    } else {
      current.searchParams.delete('type');
    }

    const target = `${current.pathname || '/activities'}${current.search}${current.hash}`;
    lastSyncedUrlRef.current = target;
    if (target !== location.url) {
      location.route(target, true);
    }
  }, [regionTab, globalSport, effectiveSport, filterType, location.url, location.route]);

  useEffect(() => {
    const sequence = ++registrationRequestSeq.current;
    const uid = viewer.uid;

    if (!uid) {
      setViewerRegistrations({ uid: null, docs: [] });
      return;
    }

    setViewerRegistrations({ uid, docs: [] });
    let cancelled = false;

    loadViewerRegistrations(uid)
      .then((docs) => {
        if (cancelled || sequence !== registrationRequestSeq.current) return;
        setViewerRegistrations({ uid, docs });
      })
      .catch(() => {
        if (cancelled || sequence !== registrationRequestSeq.current) return;
        setViewerRegistrations({ uid, docs: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [viewer.uid]);

  // M-076：viewer.uid 變動時讀取 `users/{uid}.favorites`（照 A `_getFavorites`；失敗視為空收藏）
  useEffect(() => {
    const sequence = ++favoritesRequestSeq.current;
    const uid = viewer.uid;
    if (!uid) {
      favoritesRef.current = { events: [], tournaments: [] };
      setFavorites({ events: [], tournaments: [] });
      return;
    }
    favoritesRef.current = { events: [], tournaments: [] };
    setFavorites({ events: [], tournaments: [] });
    let cancelled = false;
    loadFavorites(uid)
      .then((fav) => {
        if (cancelled || sequence !== favoritesRequestSeq.current) return;
        favoritesRef.current = fav;
        setFavorites(fav);
      })
      .catch(() => {
        if (cancelled || sequence !== favoritesRequestSeq.current) return;
        favoritesRef.current = { events: [], tournaments: [] };
        setFavorites({ events: [], tournaments: [] });
      });
    return () => { cancelled = true; };
  }, [viewer.uid]);

  function switchActivityTab(nextTab: string, e?: MouseEvent): void {
    if (e) e.stopPropagation();
    // 下一批補：新手友善、高強度篩選
    if (nextTab === 'beginner' || nextTab === 'high-intensity') {
      toast.show({ message: UNAVAILABLE_MSG });
      return;
    }
    // 照 A _setActivityTab：切到月曆捲回頂端
    if (nextTab === 'calendar') {
      try { window.scrollTo(0, 0); } catch { /* 環境未提供捲動。 */ }
    }
    const next = new URL(location.url, 'https://toosterx.invalid');
    next.searchParams.set('tab', normalizeListTab(nextTab));
    const target = `${next.pathname}${next.search}${next.hash}`;
    lastSyncedUrlRef.current = target;
    location.route(target);
  }

  function handleUnavailableFeature(e?: MouseEvent): void {
    if (e) e.stopPropagation();
    // 下一批補：收藏愛心、主辦方排行
    toast.show({ message: UNAVAILABLE_MSG });
  }

  // M-073：分享當前活動分類網址，照 A `shareCurrentActivityUrl`
  function handleShareCurrentActivityUrl(e?: MouseEvent): void {
    if (e) e.stopPropagation();
    const filters: ActivityShareFilters = {
      region: regionTab,
      sport: effectiveSport || 'all',
      tab: activeTab,
      type: filterType,
    };
    shareCurrentActivityUrl(filters, {
      showToast: (message) => toast.show({ message }),
    }).catch(() => {
      // L-07：獨立非同步 Promise 自行捕捉錯誤
      toast.show({ message: SHARED_TOAST_FAIL });
    });
  }

  // M-073：附近活動地圖在 B 一律停用外觀，點擊照 A 停用分支原文
  function handleNearbyActivity(e?: MouseEvent): void {
    if (e) e.stopPropagation();
    toast.show({ message: NEARBY_DISABLED_MSG });
  }

  function handleSelectCard(event: LegacyEventDoc): void {
    // M-078：外部活動開中繼卡、不換頁，照 A `openTimelineEventDetail` 開頭
    if (event.type === 'external' && event.externalUrl) {
      setTransitEvent(event);
      return;
    }
    // 連帶 M-077：同一張卡已在開啟中時直接 return，不重複 route
    if (pendingEventId === event.id) return;
    const href = publicEventHref(event);
    if (!href) return;
    setPendingEventId(event.id ?? null);
    location.route(href);
  }


  // M-076：卡片愛心切換收藏（樂觀更新；失敗還原）。點擊前先阻擋「未登入」。
  function handleToggleFavorite(targetEvent: LegacyEventDoc): void {
    const eventId = targetEvent.id;
    if (!eventId) return;
    const uid = viewer.uid;
    if (!uid) {
      // 照 A `_requireProtectedActionLogin(..., { suppressToast: true })`：不提示直接登入
      void import('@/data/auth')
        .then((m) => m.signIn())
        .catch(() => { /* 登入失敗不處理 */ });
      return;
    }
    // 用 ref 讀最新狀態，避免連點時拿舊閉包。
    const current = favoritesRef.current;
    const { next, added } = toggleEventInFavorites(current, eventId);
    favoritesRef.current = next;
    setFavorites(next);
    saveFavorites(uid, next)
      .then(() => {
        toast.show({
          message: added
            ? lt('toast.favoriteAdded', '已加入收藏')
            : lt('toast.favoriteRemoved', '已取消收藏'),
        });
      })
      .catch(() => {
        // ASSUMPTION：A 是 fire-and-forget；B 失敗時還原（期間若又點過，以後來的狀態為準不還原）。
        if (favoritesRef.current === next) {
          favoritesRef.current = current;
          setFavorites(current);
        }
        toast.show({ message: t('events.detailPage.actionError') });
      });
  }

  function handleCloseTransitCard(): void {
    setTransitEvent(null);
  }

  // U-027：點清除鈕清空關鍵字並立即套用，焦點回到輸入框。
  function handleClearKeyword(): void {
    setKeywordInput('');
    debouncedKeyword.setImmediate('');
    keywordInputRef.current?.focus();
  }

  // U-026：空狀態一鍵清除地區、運動、類型、關鍵字
  function handleClearAllFilters(): void {
    setRegionTab('全部');
    setFilterType('');
    // U-027：清除輸入框與延遲中的計時器。
    setKeywordInput('');
    debouncedKeyword.setImmediate('');
    setGlobalSport('all');
    const next = new URL(location.url, 'https://toosterx.invalid');
    next.searchParams.delete('region');
    next.searchParams.delete('sport');
    next.searchParams.delete('type');
    const target = `${next.pathname}${next.search}${next.hash}`;
    lastSyncedUrlRef.current = target;
    if (target !== location.url) {
      location.route(target, true);
    }
  }

  const registrations = viewerRegistrations.uid === viewer.uid
    ? viewerRegistrations.docs
    : [];

  const filteredEvents = useMemo(() => {
    const nowMs = Date.now();
    let list = getVisibleEvents(data.events, viewer, registrations) as LegacyEventDoc[];
    list = filterByRegionTab(list, regionTab);
    list = filterBySportTag(list, effectiveSport || 'all');
    list = list.filter((e) => !isEventInEndedTab(e, nowMs));
    if (activeTab === 'female') {
      list = list.filter((e) => getEventAllowedGender(e) === '女');
    }
    if (filterType) {
      list = list.filter((e) => e.type === filterType);
    }
    const kw = filterKeyword.trim().toLowerCase();
    if (kw) {
      list = list.filter((e) => matchesActivityKeyword(e, kw));
    }
    return list;
  }, [data.events, viewer, registrations, regionTab, effectiveSport, activeTab, filterType, filterKeyword]);

  // 照 A _groupEventsByDateForMonth：包含已結束活動，不套女生專屬。
  const calendarEvents = useMemo(() => {
    let list = getVisibleEvents(data.events, viewer, registrations) as LegacyEventDoc[];
    list = filterByRegionTab(list, regionTab);
    list = filterBySportTag(list, effectiveSport || 'all');
    if (filterType) list = list.filter((event) => event.type === filterType);
    const keyword = filterKeyword.trim().toLowerCase();
    if (keyword) list = list.filter((event) => matchesActivityKeyword(event, keyword));
    return list;
  }, [data.events, viewer, registrations, regionTab, effectiveSport, filterType, filterKeyword]);

  // M-071：照 A _loadAndRenderCalendar，切到月曆才下載月曆模組；失敗提示，再切回月曆會重試。
  const [CalendarView, setCalendarView] = useState<ComponentType<ActivityCalendarProps> | null>(null);
  useEffect(() => {
    if (activeTab !== 'calendar' || CalendarView) return;
    let alive = true;
    import('../components/legacy/ActivityCalendar')
      .then((mod) => {
        if (alive) setCalendarView(() => mod.default);
      })
      .catch(() => {
        if (alive) toast.show({ message: '月曆載入失敗，請重試' });
      });
    return () => {
      alive = false;
    };
  }, [activeTab, CalendarView]);

  const monthGroups = useMemo(() => {
    const groups: Record<string, Record<number, DayGroup>> = {};
    for (const e of filteredEvents) {
      const datePart = (e.date || '').split(' ')[0] || '';
      const parts = datePart.split('/');
      if (parts.length < 3) continue;
      const y = parseInt(parts[0] ?? '', 10);
      const m = parseInt(parts[1] ?? '', 10);
      const day = parseInt(parts[2] ?? '', 10);
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) continue;
      const monthKey = `${parts[0]}/${parts[1]}`;
      const dateObj = new Date(y, m - 1, day);
      const dayName = DAY_NAMES[dateObj.getDay()] ?? '日';
      if (!groups[monthKey]) groups[monthKey] = {};
      if (!groups[monthKey]![day]) {
        groups[monthKey]![day] = { day, dayName, events: [] };
      }
      groups[monthKey]![day]!.events.push(e);
    }
    return groups;
  }, [filteredEvents]);

  const today = new Date();
  const todayStr = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
  const sortedMonthKeys = Object.keys(monthGroups).sort((a, b) => a.localeCompare(b));

  // M-075：左右滑切頁籤，照 A `_bindSwipeTabs`；活動頁 getKey 排除未開放頁籤（beginner、high-intensity）
  useSwipeTabs({
    contentRef: activityListRef,
    tabsRef: activityTabsRef,
    onSwitch: (key) => switchActivityTab(key),
    getKey: (btn) => {
      const key = btn.dataset.atab;
      if (!key) return null;
      if (key === 'beginner' || key === 'high-intensity') return null;
      return key;
    },
  });

  return (
    <div class="legacy-ui">
      <section
        class={`page active${activeTab === 'female' ? ' activity-female-theme' : ''}`}
        id="page-activities"
      >
        <canvas
          ref={petalsCanvasRef}
          id="activity-female-petals"
          class="activity-female-petals"
          aria-hidden="true"
        />
        <div class="page-header activity-page-header">
          <button
            class="back-btn"
            type="button"
            aria-label={lt('返回', '返回')}
            data-i18n-aria-label="返回"
            onClick={() => location.route('/')}
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
          <div class="activity-page-heading">
            <h2 class="page-header-title" data-i18n="活動行事曆">
              {lt('活動行事曆', '活動行事曆')}
            </h2>
            <button
              type="button"
              class="page-search-toggle-btn activity-filter-toggle-btn"
              id="filter-toggle"
              aria-label={lt('搜尋與篩選活動', '搜尋與篩選活動')}
              aria-expanded={searchOpen ? 'true' : 'false'}
              aria-controls="filter-bar"
              data-i18n-aria-label="搜尋與篩選活動"
              onClick={() => setSearchOpen((v) => !v)}
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
                <path d="m16.2 16.2 4 4" />
              </svg>
            </button>
            {/* M-073：分享當前活動分類網址，照 A `shareCurrentActivityUrl` */}
            <button
              type="button"
              class="page-search-toggle-btn activity-share-url-btn"
              id="activity-share-url-btn"
              aria-label={lt('分享當前活動分類網址', '分享當前活動分類網址')}
              title={lt('分享當前活動分類網址', '分享當前活動分類網址')}
              data-i18n-aria-label="分享當前活動分類網址"
              data-i18n-title="分享當前活動分類網址"
              onClick={handleShareCurrentActivityUrl}
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
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="m8.6 10.5 6.8-4" />
                <path d="m8.6 13.5 6.8 4" />
              </svg>
            </button>
          </div>
          <div class="activity-page-actions">
            <button
              type="button"
              class="page-header-doc-btn"
              title={lt('主辦方排行', '主辦方排行')}
              style="display:none;"
              data-i18n-title="主辦方排行"
              onClick={handleUnavailableFeature}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="#F59E0B"
                stroke="#D97706"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="8" r="6" />
                <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
              </svg>
            </button>
            <button
              type="button"
              class="primary-btn small"
              id="activity-create-btn"
              style={showCreateButton ? undefined : 'display:none'}
              aria-label={lt('＋我要開團', '＋我要開團')}
              data-i18n-aria-label="＋我要開團"
              onClick={() => setCreateModalOpen(true)}
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
              <span data-i18n="我要開團">{lt('我要開團', '我要開團')}</span>
            </button>
          </div>
        </div>

        <div
          class="filter-bar collapsible-search-panel activity-filter-panel"
          id="filter-bar"
          hidden={!searchOpen}
          aria-hidden={searchOpen ? 'false' : 'true'}
        >
          <select
            id="activity-filter-type"
            value={filterType}
            onChange={(e) => setFilterType(e.currentTarget.value)}
          >
            <option value="" data-i18n="全部類別">{lt('全部類別', '全部類別')}</option>
            <option value="play">PLAY</option>
            <option value="camp" data-i18n="教學">{lt('教學', '教學')}</option>
            <option value="watch" data-i18n="觀賽">{lt('觀賽', '觀賽')}</option>
            <option value="external" data-i18n="外部">{lt('外部', '外部')}</option>
          </select>
          <div class="filter-search-wrap">
            <input
              type="text"
              id="activity-filter-keyword"
              ref={keywordInputRef}
              value={keywordInput}
              onInput={(e) => setKeywordInput(e.currentTarget.value)}
              placeholder={lt('模糊搜尋名稱 / 地點 / 主辦 / 日期...', '模糊搜尋名稱 / 地點 / 主辦 / 日期...')}
              autocomplete="off"
              data-i18n-placeholder="模糊搜尋名稱 / 地點 / 主辦 / 日期..."
            />
            {keywordInput.length > 0 && (
              <button
                type="button"
                class="activity-filter-clear-btn"
                aria-label={lt('清除', '清除')}
                onClick={handleClearKeyword}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {showManageEntry && (
          <div class="my-section" id="own-activity-manage-entry" data-min-role="coach">
            <button
              type="button"
              class="action-btn"
              data-i18n="活動管理"
              onClick={() => location.route('/my-activities')}
            >
              {lt('活動管理', '活動管理')}
            </button>
          </div>
        )}

        <div class="tab-bar" id="activity-tabs" ref={activityTabsRef}>
          <button
            type="button"
            class={`tab${activeTab === 'calendar' ? ' active' : ''}`}
            data-atab="calendar"
            onClick={(e) => switchActivityTab('calendar', e)}
          >
            <svg
              class="activity-tab-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.1"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
              <path d="M8 2.8v4" />
              <path d="M16 2.8v4" />
              <path d="M3.8 9h16.4" />
            </svg>
            <span data-i18n="月曆">{lt('月曆', '月曆')}</span>
          </button>
          <button
            type="button"
            class={`tab${activeTab === 'normal' ? ' active' : ''}`}
            data-atab="normal"
            onClick={(e) => switchActivityTab('normal', e)}
          >
            <svg
              class="activity-tab-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.1"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M8 6h12" />
              <path d="M8 12h12" />
              <path d="M8 18h12" />
              <path d="m3.8 6 .9 .9 1.7-1.9" />
              <path d="m3.8 12 .9 .9 1.7-1.9" />
              <path d="m3.8 18 .9 .9 1.7-1.9" />
            </svg>
            <span data-i18n="報名中">{lt('報名中', '報名中')}</span>
          </button>
          <span class="activity-tab-separator" aria-hidden="true">|</span>
          <button
            type="button"
            class={`tab activity-tab-female${activeTab === 'female' ? ' active' : ''}`}
            data-atab="female"
            data-i18n="女生專屬"
            onClick={(e) => switchActivityTab('female', e)}
          >
            {lt('女生專屬', '女生專屬')}
          </button>
          {/* 下一批補：新手友善 */}
          <button
            type="button"
            class="tab activity-tab-unavailable"
            data-atab="beginner"
            aria-disabled="true"
            title={lt('功能未開放', '功能未開放')}
            data-i18n-title="功能未開放"
            data-i18n="新手友善"
            onClick={(e) => switchActivityTab('beginner', e)}
          >
            {lt('新手友善', '新手友善')}
          </button>
          {/* 下一批補：高強度 */}
          <button
            type="button"
            class="tab activity-tab-unavailable"
            data-atab="high-intensity"
            aria-disabled="true"
            title={lt('功能未開放', '功能未開放')}
            data-i18n-title="功能未開放"
            data-i18n="高強度"
            onClick={(e) => switchActivityTab('high-intensity', e)}
          >
            {lt('高強度', '高強度')}
          </button>
        </div>

        <div class="region-tabs" id="activity-region-tabs">
          {REGIONS.map((region) => (
            <button
              key={region}
              type="button"
              class={`region-tab${regionTab === region ? ' active' : ''}`}
              data-region={region}
              data-i18n={region}
              onClick={() => setRegionTab(region)}
            >
              {region}
            </button>
          ))}
          {/* M-073：附近活動地圖在 B 一律停用外觀，title/點擊照 A 停用分支 */}
          <button
            type="button"
            class="region-tab region-tab-nearby region-tab-disabled"
            id="region-tab-nearby-activity"
            aria-disabled="true"
            title={lt('附近活動地圖尚未開啟', '附近活動地圖尚未開啟')}
            data-i18n-title="附近活動地圖尚未開啟"
            onClick={handleNearbyActivity}
          >
            <svg
              class="region-tab-icon"
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M3 7l5-2 5 2 5-2v12l-5 2-5-2-5 2z" opacity="0.55" />
              <line x1="8" y1="5" x2="8" y2="19" opacity="0.55" />
              <line x1="13" y1="7" x2="13" y2="21" opacity="0.55" />
              <path
                d="M12 8c-1.5 0-2.7 1.2-2.7 2.7 0 1.8 2.7 4 2.7 4s2.7-2.2 2.7-4c0-1.5-1.2-2.7-2.7-2.7z"
                fill="currentColor"
                stroke="none"
              />
              <circle cx="12" cy="10.7" r="0.8" fill="#fff" stroke="none" />
            </svg>
            尋找附近活動
          </button>
        </div>

        <div
          class="timeline-calendar"
          id="activity-list"
          ref={activityListRef}
          hidden={activeTab === 'calendar'}
        >
          {data.loading ? (
            <div
              class="activity-list-loading"
              data-activity-loading="initial"
              aria-live="polite"
              aria-busy="true"
            >
              <div class="activity-list-loading-bar" aria-hidden="true"><span /></div>
              <div class="reg-loading" data-i18n="活動資料載入中...">
                {lt('活動資料載入中...', '活動資料載入中...')}
              </div>
              <div class="reg-loading-skeleton">
                <div class="reg-loading-skeleton-row" />
                <div class="reg-loading-skeleton-row" />
                <div class="reg-loading-skeleton-row" />
              </div>
            </div>
          ) : data.error ? (
            <div
              role="alert"
              style="padding:1.5rem;font-size:.82rem;color:var(--text-muted);text-align:center"
            >
              <div>{t('events.loadError')}</div>
              <button
                type="button"
                class="outline-btn"
                style="margin-top:.65rem"
                onClick={data.retry}
              >
                {t('events.retry')}
              </button>
            </div>
          ) : sortedMonthKeys.length === 0 ? (
            <div style="padding:1.5rem;font-size:.82rem;color:var(--text-muted);text-align:center">
              <div>請確認「右上角」活動類別，當前沒有活動</div>
              <button
                type="button"
                id="activity-clear-filters-btn"
                style="margin-top:.5rem;background:none;border:none;color:var(--text-muted);font-size:.78rem;text-decoration:underline;cursor:pointer;padding:.25rem .5rem"
                onClick={handleClearAllFilters}
              >
                清除篩選
              </button>
            </div>
          ) : (
            sortedMonthKeys.map((monthKey) => {
              const [y, m] = monthKey.split('/');
              const monthInt = parseInt(m ?? '1', 10);
              const monthLabel = `${y} 年 ${monthInt} 月`;
              const dayMap = monthGroups[monthKey] ?? {};
              const days = Object.values(dayMap).sort((a, b) => a.day - b.day);

              return (
                <div class="tl-month-group" key={monthKey}>
                  <div class="tl-month-header">{monthLabel}</div>
                  {days.map((dayInfo) => {
                    const isToday = todayStr === `${y}/${monthInt}/${dayInfo.day}`;
                    const anchorKey = `${y}-${String(monthInt).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`;
                    const sortedDayEvents = [...dayInfo.events].sort((a, b) => {
                      const ap = a.pinned ? 1 : 0;
                      const bp = b.pinned ? 1 : 0;
                      if (ap !== bp) return bp - ap;
                      if (ap && bp) {
                        const ao = Number(a.pinOrder) || 0;
                        const bo = Number(b.pinOrder) || 0;
                        if (ao !== bo) return ao - bo;
                      }
                      const ta = (a.date || '').split(' ')[1] || '';
                      const tb = (b.date || '').split(' ')[1] || '';
                      return ta.localeCompare(tb);
                    });

                    return (
                      <div class="tl-day-group" data-date-anchor={anchorKey} key={anchorKey}>
                        <div class={`tl-date-col${isToday ? ' today' : ''}`}>
                          <div class="tl-day-num">{String(dayInfo.day)}</div>
                          <div class="tl-day-name">{`週${dayInfo.dayName}`}</div>
                        </div>
                        <div class="tl-events-col">
                          {sortedDayEvents.map((ev, idx) => (
                            <TimelineEventCard
                              key={ev.id ?? ev._docId ?? `ev-${idx}`}
                              event={ev}
                              viewerUid={viewer.uid}
                              viewerRoleLevel={viewer.roleLevel}
                              viewerRegistrations={registrations}
                              isPending={Boolean(ev.id && pendingEventId === ev.id)}
                              isFavorited={Boolean(ev.id && favorites.events.includes(ev.id))}
                              onSelect={handleSelectCard}
                              onToggleFavorite={handleToggleFavorite}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div id="activity-calendar" hidden={activeTab !== 'calendar'}>
          {activeTab === 'calendar' && !CalendarView && <CalendarSkeleton />}
          {activeTab === 'calendar' && CalendarView && (
              <CalendarView
                events={calendarEvents}
                viewerUid={viewer.uid}
                viewerRegistrations={registrations}
                onSelectEvent={handleSelectCard}
                onJumpToDate={(dateKey: string) => {
                  switchActivityTab('normal');
                  // 照 A _jumpToTimelineDate；確認頁面仍存在才定位。
                  requestAnimationFrame(() => {
                    const list = document.getElementById('activity-list');
                    if (!list || list.hidden) return;
                    list.querySelector<HTMLElement>(`[data-date-anchor="${dateKey}"]`)
                      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
                  });
                }}
              />
          )}
        </div>

        <EventFormModal
          open={createModalOpen}
          mode="create"
          viewer={viewer}
          onClose={() => setCreateModalOpen(false)}
          onSaved={(eventId) => {
            setCreateModalOpen(false);
            location.route('/events/' + eventId);
          }}
        />

        {/* M-078：外部活動中繼卡，照 A `event-external-transit.js` */}
        {transitEvent && (
          <ExternalTransitCard
            event={transitEvent}
            onClose={handleCloseTransitCard}
          />
        )}
      </section>
    </div>
  );
}
