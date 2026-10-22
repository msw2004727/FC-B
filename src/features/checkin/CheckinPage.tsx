import { useEffect, useMemo, useState } from 'preact/hooks';

import { Text } from '@/ui/Text';
import { EmptyState } from '@/ui/EmptyState';
import { useOperateContext } from '@/features/profile/data/viewer-operate';
import { canOperateEventSite } from '@/features/events/data/operate-permissions';
import type { EventDoc } from '@/features/events/data/types';

import { loadScanEvents, pickScanBucket } from './data/scan-events';
import { loadScanEventDocuments } from './data/scan-reads';
import type { ScanMode } from './data/attendance';
import { ScanSession } from './ScanSession';
import { useCheckinText } from './useCheckinText';
import './checkin.css';

// ASSUMPTION: UI 元件位於 @/ui，viewer-operate 位於 profile/data；
// 附件未提供實際匯入路徑。測試內容已提供，本次未讀檔或執行測試。
// Text 例外：原生 option、aria-label。UserTag／EmptyState／Modal
// 採用既有元件內部文字呈現；動態名稱不作字典 key。

type Bucket = 'today' | 'future' | 'past';
const bucketOrder: readonly Bucket[] = ['today', 'future', 'past'];

export default function CheckinPage() {
  const t = useCheckinText();
  const context = useOperateContext();
  const [snapshot, setSnapshot] = useState<{
    uid: string;
    events: EventDoc[];
  } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<Bucket>('today');
  const [selectedId, setSelectedId] = useState('');
  const [mode, setMode] = useState<ScanMode>('checkin');

  useEffect(() => {
    let active = true;
    if (!context.uid || context.role === null) return;

    const uid = context.uid;
    setLoadError(false);
    loadScanEventDocuments().then(
      (events) => {
        if (!active) return;
        setSnapshot({ uid, events });
      },
      () => {
        if (active) setLoadError(true);
      },
    );

    return () => { active = false; };
  }, [context.uid, context.role, revision]);

  const available = snapshot?.uid === context.uid ? snapshot.events : [];
  const buckets = useMemo(
    () => loadScanEvents({ events: available, context }),
    [available, context],
  );
  const total = buckets.today.length + buckets.future.length + buckets.past.length;
  const list = pickScanBucket(buckets, filter);
  const selected = list.find((entry) => entry.value === selectedId)
    ?? (list.length === 1 ? list[0] : undefined);

  useEffect(() => {
    if (buckets[filter].length > 0) return;
    const first = bucketOrder.find((bucket) => buckets[bucket].length > 0);
    if (first) {
      setFilter(first);
      setSelectedId('');
    }
  }, [buckets, filter]);

  return (
    <section class="checkin-page">
      <header class="scan-page-header">
        <button type="button" onClick={() => window.history.back()}>
          <Text>{t('back')}</Text>
        </button>
        <h1><Text>{t('pageTitle')}</Text></h1>
      </header>

      {loadError && (
        <div class="scan-notice" role="alert">
          <Text>{t('loadError')}</Text>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            <Text>{t('retry')}</Text>
          </button>
        </div>
      )}

      {!context.uid || context.role === null || total === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <div class="scan-content">
          <label class="scan-select-label" for="scan-event-select">
            <Text>{t('event')}</Text>
          </label>
          <select
            id="scan-event-select"
            class="scan-event-select"
            value={selected?.value ?? ''}
            onChange={(event) => setSelectedId(event.currentTarget.value)}
          >
            <option value="">{t('selectEvent')}</option>
            {list.map((entry) => (
              <option key={entry.docId} value={entry.value}>
                {`${entry.typeLabel}${entry.title}（${entry.date}）`}
              </option>
            ))}
          </select>

          <div class="scan-date-filter" role="group" aria-label={t('dateFilter')}>
            {bucketOrder.map((bucket) => (
              <button
                type="button"
                key={bucket}
                aria-pressed={filter === bucket}
                onClick={() => {
                  setFilter(bucket);
                  setSelectedId('');
                }}
              >
                <Text>{`${t(bucket)} (${buckets[bucket].length})`}</Text>
              </button>
            ))}
          </div>

          <div class="scan-mode-toggle" role="group" aria-label={t('mode')}>
            {(['checkin', 'checkout'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                <Text>{t(value)}</Text>
              </button>
            ))}
          </div>

          {selected && canOperateEventSite(context, selected.event) ? (
            <ScanSession
              key={`${context.uid}:${selected.docId}:${mode}`}
              entry={selected}
              context={context}
              mode={mode}
            />
          ) : (
            <EmptyState title={t('selectEvent')} body={t('selectEventHint')} />
          )}
        </div>
      )}
    </section>
  );
}
