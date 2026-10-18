import type { JSX } from 'preact';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/Card';
import { Skeleton } from '@/ui/Skeleton';
import { useT } from '@/i18n/i18n';
import { useViewer } from '@/features/profile/data/viewer';
import { getVisibleEvents } from '@/features/events/data/visibility';
import { useEvents } from '@/features/events/data/use-events';
import { SPORTS, eventSportTag } from '@/features/events/data/sports';
import { EventList } from '@/features/events/components/EventList';
import { NextActivity } from '../components/NextActivity';
import '../home.css';

export default function HomePage(): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const data = useEvents();

  // TODO(P4.2) 載入使用者報名以支援黑名單第 3 態
  const visible = getVisibleEvents(data.events, viewer, []);

  return (
    <section class="home-page">
      <section class="home-hero">
        <Text class="home-hero__brand">ToosterX</Text>
        <div>
          <Text as="h1">{t('home.heroTitle')}</Text>
          <Text as="p">{t('home.heroBody')}</Text>
          <a href="/activities" class="home-action home-action--primary">
            <Text>{t('home.findActivities')}</Text>
          </a>
        </div>
      </section>

      <Card class="home-section home-next" padding="sm">
        <header class="home-section__header">
          <Text as="h2">{t('home.nextTitle')}</Text>
          <a href="/activities" class="home-section__more">
            <Text>{t('home.viewAll')}</Text>
          </a>
        </header>
        <NextActivity />
        <div class="home-next__actions">
          <a href="/activities" class="home-action home-action--primary">
            <Text>{t('home.findActivities')}</Text>
          </a>
          {/* TODO(建立活動)：A 此位置是「我要開團」；B 的建立活動功能完成後換回，並依 _canCreateEvent 類 helper 決定是否顯示。
              不新增假開團入口；保留 A 雙欄位置，以可用的俱樂部入口承接。 */}
          <a href="/teams" class="home-action home-action--outline">
            <Text>{t('home.findClubs')}</Text>
          </a>
        </div>
      </Card>

      <Card class="home-section" padding="sm">
        <header class="home-section__header">
          <Text as="h2">{t('home.sportsTitle')}</Text>
        </header>
        {/* 沒有瀏覽量來源，不以 A 截圖的 673 偽造即時統計。 */}
        <div class="home-sports">
          {SPORTS.map((sport) => (
            <a
              key={sport.key}
              class="home-sports__chip"
              href={`/activities?sport=${encodeURIComponent(sport.sportTag)}`}
            >
              <span aria-hidden="true" class="home-sports__symbol">
                <Text>{sport.symbol}</Text>
              </span>
              <span class="home-sports__copy">
                <Text>{t(`events.sport.${sport.key}`)}</Text>
                {data.loading ? (
                  <Skeleton width={48} />
                ) : data.error ? (
                  <Text class="home-sports__count">{t('home.countUnavailable')}</Text>
                ) : (
                  <Text class="home-sports__count">
                    {t('home.activityCount', {
                      count: visible.filter((event) =>
                        eventSportTag(event) === sport.sportTag).length,
                    })}
                  </Text>
                )}
              </span>
            </a>
          ))}
          <a href="/activities" class="home-sports__chip">
            <Text>{t('home.more')}</Text>
          </a>
        </div>
      </Card>

      <section class="home-recent">
        <header class="home-section__header">
          <Text as="h2">{t('home.recentTitle')}</Text>
          <a href="/activities" class="home-section__more">
            <Text>{t('home.viewAll')}</Text>
          </a>
        </header>
        <EventList
          events={visible.slice(0, 5)}
          loading={data.loading}
          error={data.error}
          onRetry={data.retry}
        />
      </section>
    </section>
  );
}
