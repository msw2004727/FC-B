import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { Text } from '@/ui/Text';
import { Skeleton } from '@/ui/Skeleton';
import { EmptyState } from '@/ui/EmptyState';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { useViewer } from '@/features/profile/data/viewer';
import { EventCard } from '@/features/events/components/EventCard';
import { getVisibleEvents } from '@/features/events/data/visibility';
import { resolveNextActivity, type NextActivityResult } from '../data/next-activity';

export function NextActivity(): JSX.Element {
  const viewer = useViewer();
  const t = useT();

  if (!viewer.uid) {
    return (
      <EmptyState
        icon={<Icon name="calendar" size={64} />}
        title={t('home.signedOutTitle')}
        body={t('home.signedOutBody')}
      />
    );
  }

  // 身份變更即重掛載，render 階段便移除前一身份資料，不等 effect 清除。
  return <SignedInNextActivity key={viewer.uid} uid={viewer.uid} />;
}

function SignedInNextActivity({ uid }: { uid: string }): JSX.Element {
  const t = useT();
  const viewer = useViewer();
  const [result, setResult] = useState<NextActivityResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);

    resolveNextActivity({}, uid).then(
      (next) => {
        if (!current) return;
        setResult(next);
        setLoading(false);
      },
      () => {
        if (!current) return;
        setError(true);
        setLoading(false);
      },
    );
    return () => { current = false; };
  }, [uid, attempt]);

  if (loading) {
    return (
      <div class="home-next__loading" role="status" aria-label={t('home.loading')}>
        <Skeleton shape="rect" width={130} height={88} />
        <Skeleton width="65%" />
        <Skeleton width="85%" />
        <Text>{t('home.loading')}</Text>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert">
        <EmptyState
          title={t('home.loadError')}
          action={
            <Button onClick={() => setAttempt((value) => value + 1)}>
              {t('home.retry')}
            </Button>
          }
        />
      </div>
    );
  }

  // TODO(P4.2) 載入使用者報名以支援黑名單第 3 態
  const visible = getVisibleEvents(result ? [result.event] : [], viewer, []);
  const event = visible[0];

  if (event) return <EventCard event={event} />;

  return (
    <EmptyState
      icon={<Icon name="calendar" size={64} />}
      title={t('home.emptyTitle')}
      body={t('home.emptyBody')}
    />
  );
}
