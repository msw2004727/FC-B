/**
 * 錯誤日誌與用戶提示共用的區間讀取（同一區間只讀一次，兩個頁籤共用；只放記憶體）。
 * 換區間才讀；「重新整理」清掉該區間快取再讀。晚到回應以序號丟棄。
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import type { LogRange } from '../data/log-range';
import { fetchErrorLogsInRange, type ErrorLogsRangeResult } from '../data/error-logs';
import type { ErrorLogDoc } from '../data/error-log-model';

export type ErrorRangeFetcher = (startMs: number, endMs: number) => Promise<ErrorLogsRangeResult>;

const cache = new Map<string, Promise<ErrorLogsRangeResult>>();

export type ErrorLoad = { status: 'loading' } | { status: 'error' } | { status: 'ready'; docs: ErrorLogDoc[]; truncated: boolean };

export function useErrorLogRange(range: LogRange, fetcher: ErrorRangeFetcher = fetchErrorLogsInRange) {
  const [load, setLoad] = useState<ErrorLoad>({ status: 'loading' });
  const seq = useRef(0);
  const key = `${range.startMs}-${range.endMs}`;

  async function run(force: boolean): Promise<void> {
    const mySeq = ++seq.current;
    setLoad({ status: 'loading' });
    if (force) cache.delete(key);
    let p = cache.get(key);
    if (!p) {
      p = fetcher(range.startMs, range.endMs);
      cache.set(key, p);
      const mine = p;
      // 只刪自己放進去的那一份；強制重抓後舊的晚失敗不得刪掉新的（第二批審查 Flash P2）。
      p.catch(() => { if (cache.get(key) === mine) cache.delete(key); });
    }
    try {
      const res = await p;
      if (mySeq === seq.current) setLoad({ status: 'ready', docs: res.docs, truncated: res.truncated });
    } catch {
      if (mySeq === seq.current) setLoad({ status: 'error' });
    }
  }

  useEffect(() => {
    run(false).catch(() => undefined);
    return () => { seq.current += 1; };
  }, [key]);

  return { load, refresh: () => { run(true).catch(() => undefined); } };
}

/** 測試用。 */
export function _resetErrorRangeCacheForTest(): void {
  cache.clear();
}
