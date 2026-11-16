/**
 * 聊天室稽核 log 的分頁讀取（時間區間＋每頁筆數；2026-11-16 站長）。
 * - 第一批以區間終點當 cursor（後端 startAfter＝早於終點），之後用後端 nextCursor；每批 `limit`＝每頁筆數（無限＝30）。
 * - 早於區間起點的筆數丟棄，並視為「沒有更多」。
 * - 篩選一次只送一個鍵（filterToPayload）；已抓過的頁留在記憶體，上一頁不重抓。
 * - 晚到的回應（篩選／區間已換）以序號丟棄。
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import { INFINITE_CHUNK, type LogRange, type PageSizeOption } from '../data/log-range';
import { loadPmAuditLogs, pmLogMs, type PmAuditLog } from '../data/pm-audit';
import type { PmAuditFilter } from '../data/pm-audit-view';

export interface PmAuditPagesState {
  status: 'loading' | 'error' | 'ready';
  chunks: PmAuditLog[][];
  nextCursorMs: number | null;
  done: boolean;
  loadingMore: boolean;
}

const INITIAL: PmAuditPagesState = { status: 'loading', chunks: [], nextCursorMs: null, done: false, loadingMore: false };

export function usePmAuditPages(filter: PmAuditFilter, range: LogRange, pageSize: PageSizeOption, onLoaded: (logs: PmAuditLog[]) => void) {
  const [state, setState] = useState<PmAuditPagesState>(INITIAL);
  const seq = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const loadedCb = useRef(onLoaded);
  loadedCb.current = onLoaded;
  const limit = pageSize === 'infinite' ? INFINITE_CHUNK : pageSize;

  async function fetchChunk(first: boolean): Promise<void> {
    const cur = stateRef.current;
    if (!first && (cur.status !== 'ready' || cur.done || cur.loadingMore || cur.nextCursorMs === null)) return;
    const mySeq = first ? ++seq.current : seq.current;
    if (first) setState(INITIAL);
    else setState({ ...cur, loadingMore: true });
    try {
      const page = await loadPmAuditLogs(filter, first ? range.endMs : cur.nextCursorMs, limit);
      if (mySeq !== seq.current) return;
      const inRange = page.logs.filter((log) => (pmLogMs(log) ?? 0) >= range.startMs);
      const clipped = inRange.length < page.logs.length;
      setState((prev) => ({
        status: 'ready',
        chunks: first ? [inRange] : prev.chunks.concat([inRange]),
        nextCursorMs: page.nextCursorMs,
        done: clipped || !page.hasMore,
        loadingMore: false,
      }));
      loadedCb.current(inRange);
    } catch {
      if (mySeq !== seq.current) return;
      if (first) setState({ ...INITIAL, status: 'error' });
      else setState((prev) => ({ ...prev, loadingMore: false }));
    }
  }

  const filterKey = JSON.stringify(filter);
  useEffect(() => {
    fetchChunk(true).catch(() => undefined);
    return () => {
      seq.current += 1;
    };
  }, [filterKey, range.startMs, range.endMs, limit]);

  return {
    state,
    reload: () => { fetchChunk(true).catch(() => undefined); },
    more: () => { fetchChunk(false).catch(() => undefined); },
  };
}
