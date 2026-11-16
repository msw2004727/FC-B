/**
 * 聊天室稽核 log 的分頁讀取（時間區間＋每頁筆數；2026-11-16 站長、顧問 §3.196）。
 * - 第一批以區間終點當 cursor（後端 startAfter＝早於終點），之後用後端 nextCursor。
 * - 每批 `limit`＝每頁筆數；「無限」每批 100、本區間累計上限 500（最多 5 次呼叫），達上限標 truncated 並停止。
 * - 早於區間起點的筆數丟棄，並視為「沒有更多」。
 * - 篩選一次只送一個鍵（filterToPayload）；已抓過的頁留在記憶體，上一頁不重抓。
 * - 晚到的回應（篩選／區間已換）以序號丟棄。`more()` 回傳是否成功，呼叫端成功後才換頁。
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import type { LogRange, PageSizeOption } from '../data/log-range';
import { loadPmAuditLogs, pmLogMs, type PmAuditLog } from '../data/pm-audit';
import type { PmAuditFilter } from '../data/pm-audit-view';

/** 「無限」模式每次呼叫的筆數（後端單次上限 100）。 */
export const PM_AUDIT_INFINITE_LIMIT = 100;
/** 同一區間累計上限。 */
export const PM_AUDIT_RANGE_CAP = 500;

export interface PmAuditPagesState {
  status: 'loading' | 'error' | 'ready';
  chunks: PmAuditLog[][];
  nextCursorMs: number | null;
  done: boolean;
  /** 已達區間上限（還有更多但不再抓）。 */
  truncated: boolean;
  loadingMore: boolean;
}

const INITIAL: PmAuditPagesState = { status: 'loading', chunks: [], nextCursorMs: null, done: false, truncated: false, loadingMore: false };

export function usePmAuditPages(filter: PmAuditFilter, range: LogRange, pageSize: PageSizeOption, onLoaded: (logs: PmAuditLog[]) => void) {
  const [state, setState] = useState<PmAuditPagesState>(INITIAL);
  const seq = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const loadedCb = useRef(onLoaded);
  loadedCb.current = onLoaded;
  const limit = pageSize === 'infinite' ? PM_AUDIT_INFINITE_LIMIT : pageSize;

  async function fetchChunk(first: boolean): Promise<boolean> {
    const cur = stateRef.current;
    if (!first && (cur.status !== 'ready' || cur.done || cur.loadingMore || cur.nextCursorMs === null)) return false;
    const mySeq = first ? ++seq.current : seq.current;
    const next = first ? INITIAL : { ...cur, loadingMore: true };
    stateRef.current = next;
    setState(next);
    try {
      const page = await loadPmAuditLogs(filter, first ? range.endMs : cur.nextCursorMs, limit);
      if (mySeq !== seq.current) return false;
      const inRange = page.logs.filter((log) => (pmLogMs(log) ?? 0) >= range.startMs);
      const clipped = inRange.length < page.logs.length;
      const chunks = first ? [inRange] : cur.chunks.concat([inRange]);
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const ended = clipped || !page.hasMore;
      const capped = !ended && total >= PM_AUDIT_RANGE_CAP;
      const done: PmAuditPagesState = {
        status: 'ready',
        chunks,
        nextCursorMs: page.nextCursorMs,
        done: ended || capped,
        truncated: capped,
        loadingMore: false,
      };
      stateRef.current = done;
      setState(done);
      loadedCb.current(inRange);
      return true;
    } catch {
      if (mySeq !== seq.current) return false;
      const failed = first ? { ...INITIAL, status: 'error' as const } : { ...stateRef.current, loadingMore: false };
      stateRef.current = failed;
      setState(failed);
      return false;
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
    more: (): Promise<boolean> => fetchChunk(false).catch(() => false),
  };
}
