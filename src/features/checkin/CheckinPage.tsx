import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { useGoBack } from '@/core/back-guard';
import { toast } from '@/ui/Toast';
import { useOperateContext } from '@/features/profile/data/viewer-operate';
import {
  canOperateEventSite,
  hasActivityManageEntry,
} from '@/features/events/data/operate-permissions';
import type { EventDoc } from '@/features/events/data/types';

import {
  SCAN_EVENT_TYPE_CONFIG,
  loadScanEvents,
  pickScanBucket,
  toScanEventEntry,
  type ScanEventBuckets,
  type ScanEventEntry,
} from './data/scan-events';
import { loadScanEventDocuments } from './data/scan-reads';
import type { ScanMode } from './data/attendance';
import { ScanSession } from './ScanSession';
import { useCheckinText } from './useCheckinText';
import '@/styles/legacy/scan.css';
import './checkin.css';

type Bucket = 'today' | 'past' | 'future';
const bucketOrder: readonly Bucket[] = ['today', 'past', 'future'];
const EMPTY_EVENTS: EventDoc[] = [];

interface Snapshot {
  uid: string;
  events: EventDoc[];
}

interface PresetState {
  status: 'idle' | 'loading' | 'ready' | 'denied';
  entry: ScanEventEntry | null;
}

function optionText(entry: ScanEventEntry): string {
  return `${entry.typeLabel}${entry.title}（${entry.date}）`;
}

function defaultSelection(entries: readonly ScanEventEntry[]): string {
  return entries.length === 1 ? entries[0]!.value : '';
}

export default function CheckinPage() {
  const t = useCheckinText();
  const context = useOperateContext();
  const goBack = useGoBack('/');
  const location = useLocation();
  const eventId = typeof location.query?.eventId === 'string' ? location.query.eventId : '';

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<Bucket>('today');
  const [selectedId, setSelectedId] = useState('');
  const [mode, setMode] = useState<ScanMode>('checkin');
  const [preset, setPreset] = useState<PresetState>({ status: 'idle', entry: null });

  const contextRef = useRef(context);
  contextRef.current = context;
  const tRef = useRef(t);
  tRef.current = t;
  const noPermissionShown = useRef(false);
  const presetResolved = useRef<string | null>(null);

  const presetMode = eventId !== '';

  useEffect(() => {
    if (!context.uid || context.role === null) return;
    let active = true;
    const uid = context.uid;
    setLoadError(false);
    loadScanEventDocuments().then(
      (events) => {
        if (!active) return;
        // 照 A renderScanPage：載入完成時分類並自動跳頁一次。
        const buckets = loadScanEvents({
          events,
          context: contextRef.current,
          typeConfig: SCAN_EVENT_TYPE_CONFIG,
        });
        let nextFilter: Bucket = 'today';
        if (buckets.today.length === 0) {
          const first = bucketOrder.find((bucket) => buckets[bucket].length > 0);
          nextFilter = first ?? 'today';
        }
        setFilter(nextFilter);
        setSelectedId(defaultSelection(buckets[nextFilter]));
        setSnapshot({ uid, events });
      },
      () => {
        if (active) setLoadError(true);
      },
    );
    return () => { active = false; };
  }, [context.uid, context.role, revision]);

  const available = snapshot && snapshot.uid === context.uid ? snapshot.events : EMPTY_EVENTS;
  const buckets = useMemo(
    () => loadScanEvents({ events: available, context, typeConfig: SCAN_EVENT_TYPE_CONFIG }),
    [available, context],
  );
  const total = buckets.today.length + buckets.past.length + buckets.future.length;
  const list = pickScanBucket(buckets, filter);
  const selected = presetMode
    ? preset.entry ?? undefined
    : list.find((entry) => entry.value === selectedId);

  // M-109：從詳情帶入活動。照 A renderScanPage 的 preset 分支，但改為 async 讀取。
  useEffect(() => {
    if (!eventId) return;
    if (!context.uid || context.role === null) return;
    if (!snapshot || snapshot.uid !== context.uid) return;
    if (presetResolved.current === eventId) return;
    presetResolved.current = eventId;
    let active = true;
    setPreset({ status: 'loading', entry: null });

    const resolve = async (): Promise<void> => {
      const currentContext = contextRef.current;
      const events = snapshot.events;
      let event = events.find((item) => item.id === eventId)
        ?? events.find((item) => item._docId === eventId)
        ?? null;
      if (!event) {
        try {
          const mod = await import('@/features/events/data/event-detail');
          const detail = await mod.loadEventDetail(eventId);
          event = detail?.event ?? null;
        } catch {
          event = null;
        }
      }
      if (!active) return;
      if (event && canOperateEventSite(currentContext, event)) {
        const entry = toScanEventEntry(event, SCAN_EVENT_TYPE_CONFIG);
        if (entry) {
          setPreset({ status: 'ready', entry });
          return;
        }
      }
      setPreset({ status: 'denied', entry: null });
      if (!noPermissionShown.current) {
        noPermissionShown.current = true;
        toast.show(tRef.current('noPermission'));
      }
    };

    resolve().catch(() => {
      if (!active) return;
      setPreset({ status: 'denied', entry: null });
      if (!noPermissionShown.current) {
        noPermissionShown.current = true;
        toast.show(tRef.current('noPermission'));
      }
    });

    return () => { active = false; };
  }, [eventId, context.uid, context.role, snapshot]);

  // 照 A renderScanPage 第 39 行近似：一般模式完全沒有可操作活動時提示一次。
  // ASSUMPTION: A 另以 event.scan／activity.manage.entry 權限碼放行；B 無法在本檔讀權限碼，
  // 以 hasActivityManageEntry 近似；頁面內容一樣是空清單。
  useEffect(() => {
    if (eventId) return;
    if (!snapshot || snapshot.uid !== context.uid) return;
    if (!context.uid || context.role === null) return;
    if (total > 0) return;
    if (hasActivityManageEntry(context)) return;
    if (noPermissionShown.current) return;
    noPermissionShown.current = true;
    toast.show(tRef.current('noPermission'));
  }, [eventId, snapshot, context, total]);

  const sessionEntry = selected && canOperateEventSite(context, selected.event) ? selected : null;

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-scan">
        <div class="page-header">
          <button type="button" class="back-btn" aria-label={t('back')} onClick={goBack}>
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
          <h2>{t('pageTitle')}</h2>
        </div>

        {loadError && (
          <div class="scan-notice">
            <span>{t('loadError')}</span>
            <button
              type="button"
              class="primary-btn"
              onClick={() => setRevision((value) => value + 1)}
            >
              {t('retry')}
            </button>
          </div>
        )}

        <div class="scan-content">
          <select
            id="scan-event-select"
            class="scan-event-select"
            value={selected?.value ?? ''}
            disabled={presetMode}
            onChange={(event) => setSelectedId(event.currentTarget.value)}
          >
            <option value="">{t('selectEvent')}</option>
            {presetMode
              ? preset.entry && (
                <option key={preset.entry.docId} value={preset.entry.value}>
                  {optionText(preset.entry)}
                </option>
              )
              : list.map((entry) => (
                <option key={entry.docId} value={entry.value}>
                  {optionText(entry)}
                </option>
              ))}
          </select>

          <div
            id="scan-date-filter"
            class="scan-date-filter"
            style={presetMode ? 'display:none' : undefined}
          >
            {bucketOrder.map((bucket) => (
              <button
                type="button"
                key={bucket}
                class={`scan-date-tab${filter === bucket ? ' active' : ''}`}
                data-scan-date={bucket}
                aria-pressed={filter === bucket}
                onClick={() => {
                  setFilter(bucket);
                  setSelectedId(defaultSelection(buckets[bucket]));
                }}
              >
                {`${t(bucket)} (${buckets[bucket].length})`}
              </button>
            ))}
          </div>

          <div class="scan-mode-toggle">
            {(['checkin', 'checkout'] as const).map((value) => (
              <button
                type="button"
                key={value}
                class={`scan-mode${mode === value ? ' active' : ''}`}
                data-mode={value}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {t(value)}
              </button>
            ))}
          </div>

          {sessionEntry ? (
            <ScanSession
              key={`${context.uid}:${sessionEntry.docId}`}
              entry={sessionEntry}
              context={context}
              mode={mode}
            />
          ) : (
            <>
              <div class="scan-camera">
                <div class="scan-qr-reader" id="scan-qr-reader">
                  <span style="color:var(--text-muted);font-size:.85rem;">{t('cameraHint')}</span>
                </div>
                <button type="button" class="scan-camera-btn" id="scan-camera-btn" disabled>
                  {t('startCamera')}
                </button>
              </div>
              <div class="scan-results" id="scan-results"></div>
              <div class="scan-stats" id="scan-stats"></div>
              <div id="scan-registered-section"></div>
              <div id="scan-unreg-section"></div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
