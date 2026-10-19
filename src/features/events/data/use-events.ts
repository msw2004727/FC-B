import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { getEventsRepo } from './events-repo';
import { readEventsSnapshot, writeEventsSnapshot } from './events-snapshot-cache';
import { isEventInEndedTab } from './terminal';
import { sortEvents } from './presentation';
import type { EventDoc } from './types';

// 同一 singleton 上的同型 UI 請求共用 Promise，避免首頁／列表互相作廢請求。
// 成功和失敗均清除（L-08）；hook 本身仍有生命週期保護。
let inflight: Promise<EventDoc[]> | null = null;
/** 本次開啟期間最後一次成功讀到的活動（切頁回來時直接先畫）。 */
let lastLoaded: EventDoc[] | null = null;

/** stale-first 的初始資料：記憶體 → 本機快照（30 分鐘內）→ 空。 */
function initialEvents(): EventDoc[] {
  return lastLoaded ?? readEventsSnapshot() ?? [];
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
    const next = [...snapshot.active, ...snapshot.terminal];
    lastLoaded = next;
    writeEventsSnapshot(next);
    return next;
  })();
  inflight = request;
  const clear = (): void => {
    if (inflight === request) inflight = null;
  };
  request.then(clear, clear);
  return request;
}

export function useEvents(): {
  events: EventDoc[];
  loading: boolean;
  error: boolean;
  retry: () => void;
} {
  // 照 A stale-first：有上次資料就先畫，背景向伺服器更新；只有完全沒資料時才顯示載入中／錯誤。
  const [events, setEvents] = useState<EventDoc[]>(initialEvents);
  const [loading, setLoading] = useState(() => events.length === 0);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const hasDataRef = useRef(events.length > 0);

  useEffect(() => {
    let current = true;
    if (!hasDataRef.current) setLoading(true);
    setError(false);
    load().then(
      (next) => {
        if (!current) return;
        hasDataRef.current = true;
        setEvents(next);
        setNow(Date.now());
        setLoading(false);
      },
      () => {
        if (!current) return;
        // 已有上次資料時保留畫面，不顯示錯誤（A 的快取模式也是如此）。
        if (!hasDataRef.current) setError(true);
        setLoading(false);
      },
    );
    return () => { current = false; };
  }, [attempt]);

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
