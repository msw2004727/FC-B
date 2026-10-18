import { useCallback, useEffect, useState } from 'preact/hooks';
import { getEventsRepo } from './events-repo';
import { isEventInEndedTab } from './terminal';
import { sortEvents } from './presentation';
import type { EventDoc } from './types';

// 同一 singleton 上的同型 UI 請求共用 Promise，避免首頁／列表互相作廢請求。
// 成功和失敗均清除（L-08）；hook 本身仍有生命週期保護。
let inflight: Promise<EventDoc[]> | null = null;

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

export function useEvents(): {
  events: EventDoc[];
  loading: boolean;
  error: boolean;
  retry: () => void;
} {
  const [events, setEvents] = useState<EventDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    load().then(
      (next) => {
        if (!current) return;
        setEvents(next);
        setNow(Date.now());
        setLoading(false);
      },
      () => {
        if (!current) return;
        setError(true);
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
