import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getLastKnownAuthUid } from '@/data/auth';
import { getEventsRepo } from './events-repo';
import { readEventsSnapshot, writeEventsSnapshot } from './events-snapshot-cache';
import { isEventInEndedTab } from './terminal';
import { sortEvents } from './presentation';
import type { EventDoc } from './types';

// 同一 singleton 上的同型 UI 請求共用 Promise，避免首頁／列表互相作廢請求。
// 成功和失敗均清除（L-08）；hook 本身仍有生命週期保護。
let inflight: Promise<EventDoc[]> | null = null;
/** 本次開啟期間最後一次成功讀到的活動與讀取當時的帳號（切頁回來時直接先畫）。 */
let lastLoaded: { uid: string | null; events: EventDoc[] } | null = null;

/**
 * stale-first 的上次資料：記憶體 → 本機快照（30 分鐘內）。
 * 只有 viewer 帳號等於登入模組確認的帳號時才給（使用者資料載入前不以訪客身分先畫，Fable 2026-10-19）。
 */
function staleEventsFor(viewerUid: string | null): EventDoc[] | null {
  const known = getLastKnownAuthUid();
  if (known === undefined || known !== viewerUid) return null;
  if (lastLoaded && lastLoaded.uid === viewerUid) return lastLoaded.events;
  return readEventsSnapshot(viewerUid);
}

/** 測試用。 */
export function _resetUseEventsForTest(): void {
  inflight = null;
  lastLoaded = null;
}

function load(): Promise<EventDoc[]> {
  if (inflight) return inflight;
  const request = (async () => {
    const repo = getEventsRepo();
    // 需要 terminal preview：結束後六小時內仍在一般列表（R-EVT-002）。
    await repo.loadEventsStatic({ terminalMode: 'preview' });
    const snapshot = repo.getSnapshot();
    return [...snapshot.active, ...snapshot.terminal];
  })();
  inflight = request;
  const clear = (): void => {
    if (inflight === request) inflight = null;
  };
  request.then(clear, clear);
  return request;
}

/**
 * @param viewerUid 目前畫面使用者的 uid（訪客為 null）；用來決定能不能先畫上次資料與快照歸屬。
 */
export function useEvents(viewerUid: string | null): {
  events: EventDoc[];
  loading: boolean;
  error: boolean;
  retry: () => void;
} {
  // 照 A stale-first：有上次資料就先畫，背景向伺服器更新；只有完全沒資料時才顯示載入中／錯誤。
  const [fresh, setFresh] = useState<EventDoc[] | null>(null);
  const [pending, setPending] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const viewerUidRef = useRef(viewerUid);
  viewerUidRef.current = viewerUid;
  const stale = useMemo(() => (fresh ? null : staleEventsFor(viewerUid)), [fresh, viewerUid]);

  useEffect(() => {
    let current = true;
    setPending(true);
    setFailed(false);
    load().then(
      (next) => {
        const owner = viewerUidRef.current;
        if (getLastKnownAuthUid() === owner) {
          lastLoaded = { uid: owner, events: next };
          writeEventsSnapshot(owner, next);
        }
        if (!current) return;
        setFresh(next);
        setNow(Date.now());
        setPending(false);
      },
      () => {
        if (!current) return;
        setFailed(true);
        setPending(false);
      },
    );
    return () => { current = false; };
  }, [attempt]);

  const events = fresh ?? stale ?? [];
  // 已有上次資料時更新失敗不顯示錯誤（A 的快取模式也是如此）。
  const loading = pending && events.length === 0;
  const error = failed && events.length === 0;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return {
    events: sortEvents(events.filter((event) => !isEventInEndedTab(event, now))),
    loading,
    error,
    retry,
  };
}
