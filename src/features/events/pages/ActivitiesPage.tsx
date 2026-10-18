import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { on } from '@/core/events';
import { useT } from '@/i18n/i18n';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Tabs } from '@/ui/Tabs';
import { BottomSheet } from '@/ui/BottomSheet';
import { useViewer } from '@/features/profile/data/viewer';
import { getVisibleEvents } from '../data/visibility';
import { normalizeListTab } from '../data/terminal';
import { SPORTS, eventSportTag } from '../data/sports';
import { useEvents } from '../data/use-events';
import { loadViewerRegistrations } from '../data/viewer-registrations';
import type { RegistrationDoc } from '../data/types';
import { EventList } from '../components/EventList';
import '../events.css';

interface ViewerRegistrationsState {
  uid: string | null;
  docs: RegistrationDoc[];
}

export default function ActivitiesPage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const location = useLocation();
  const data = useEvents();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [viewerRegistrations, setViewerRegistrations] = useState<ViewerRegistrationsState>({
    uid: null,
    docs: [],
  });
  const registrationRequestSeq = useRef(0);

  const url = new URL(location.url, 'https://toosterx.invalid');
  const sport = url.searchParams.get('sport')?.trim() ?? '';
  const requestedTab = url.searchParams.get('tab');
  const normalizedTab = normalizeListTab(requestedTab);
  // 本批僅一般列表；normalizeListTab 仍保留其他值，這裡限制可呈現頁籤。
  const tab = normalizedTab === 'normal' ? normalizedTab : 'normal';

  useEffect(() => {
    return on('sport:picker-open', () => setPickerOpen(true));
  }, []);

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
        console.warn('[ActivitiesPage] viewer registrations could not be loaded.');
      });

    return () => {
      cancelled = true;
    };
  }, [viewer.uid]);

  useEffect(() => {
    const current = new URL(location.url, 'https://toosterx.invalid');
    const requested = current.searchParams.get('tab');
    if (requested !== null && requested !== 'normal') {
      normalizeListTab(requested);
      current.searchParams.set('tab', 'normal');
      location.route(`${current.pathname}${current.search}${current.hash}`, true);
    }
  }, [location.url, location.route]);

  function selectSport(value: string): void {
    const next = new URL(location.url, 'https://toosterx.invalid');
    if (value) next.searchParams.set('sport', value);
    else next.searchParams.delete('sport');
    next.searchParams.set('tab', 'normal');
    location.route(`${next.pathname}${next.search}${next.hash}`);
    setPickerOpen(false);
  }

  const registrations = viewerRegistrations.uid === viewer.uid
    ? viewerRegistrations.docs
    : [];
  const visible = getVisibleEvents(data.events, viewer, registrations);
  const searchText = search.trim().toLocaleLowerCase();
  const filtered = visible.filter((event) =>
    (!sport || eventSportTag(event) === sport) &&
    (!searchText ||
      `${event.title ?? ''} ${event.location ?? ''}`.toLocaleLowerCase().includes(searchText)),
  );

  return (
    <section class="activities-page">
      <header class="activities-page__header">
        <a href="/" class="activities-page__back" aria-label={t('events.backHome')}>
          <span aria-hidden="true"><Text>‹</Text></span>
        </a>
        <Text as="h1">{t('events.pageTitle')}</Text>
        <button
          type="button"
          class="activities-page__tool"
          aria-label={t('events.search')}
          aria-expanded={searchOpen}
          aria-controls="activities-search"
          onClick={() => setSearchOpen((value) => !value)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <circle cx="10" cy="10" r="6" />
            <path d="m15 15 6 6" />
          </svg>
        </button>
        <Button onClick={() => setPickerOpen(true)}>{t('events.filter')}</Button>
      </header>

      {searchOpen && (
        <div id="activities-search" class="activities-page__search">
          <Input
            type="search"
            label={t('events.search')}
            value={search}
            onValueChange={setSearch}
            placeholder={t('events.searchPlaceholder')}
          />
        </div>
      )}

      {/* 月曆與地圖檢視延後；不放置不可使用的按鈕。
          分享與地區欄位未提供契約，本批不捏造無作用控制項。 */}
      <Tabs
        id="activities-tabs"
        label={t('events.tabsLabel')}
        variant="segmented"
        value={tab}
        onValueChange={() => undefined}
        items={[{
          id: 'normal',
          label: t('events.normal'),
          panel: (
            <>
              <div class="activities-page__filters">
                <button
                  type="button"
                  class="activities-page__sport"
                  aria-pressed={!sport}
                  onClick={() => selectSport('')}
                >
                  <Text>{t('events.sport.all')}</Text>
                </button>
                {SPORTS.map((item) => (
                  <button
                    type="button"
                    key={item.key}
                    class="activities-page__sport"
                    aria-pressed={sport === item.sportTag}
                    onClick={() => selectSport(item.sportTag)}
                  >
                    <Text>{t(`events.sport.${item.key}`)}</Text>
                  </button>
                ))}
                {sport && !SPORTS.some((item) => item.sportTag === sport) && (
                  <Text class="activities-page__unknown-sport">{sport}</Text>
                )}
              </div>
              <EventList
                events={filtered}
                loading={data.loading}
                error={data.error}
                onRetry={data.retry}
              />
            </>
          ),
        }]}
      />

      <BottomSheet
        open={pickerOpen}
        title={t('events.chooseSport')}
        onClose={() => setPickerOpen(false)}
      >
        <div class="activities-page__picker">
          <button
            type="button"
            aria-pressed={!sport}
            onClick={() => selectSport('')}
          >
            <Text>{t('events.sport.all')}</Text>
          </button>
          {SPORTS.map((item) => (
            <button
              type="button"
              key={item.key}
              aria-pressed={sport === item.sportTag}
              onClick={() => selectSport(item.sportTag)}
            >
              <span aria-hidden="true"><Text>{item.symbol}</Text></span>
              <Text>{t(`events.sport.${item.key}`)}</Text>
            </button>
          ))}
        </div>
      </BottomSheet>
    </section>
  );
}
