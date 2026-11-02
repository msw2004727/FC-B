import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { t } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

import type { Cursor, Page } from '../data/inactive-data';

export interface PagedListState<T> {
  status: 'loading' | 'ready' | 'error';
  items: T[];
  total: number;
  cursor: Cursor;
  done: boolean;
  loadingMore: boolean;
}

export interface PagedList<T> extends PagedListState<T> {
  hasMore: boolean;
  retry: () => void;
  loadMore: () => void;
}

/**
 * 進頁讀第一頁＋總數，之後按「載入更多」逐頁。卸載後晚到的結果不寫入狀態。
 * 「還有更多」＝上一頁讀滿且已顯示數小於總數（避免剛好整除時多讀一次空頁）。
 * loadFirst／loadNext 請傳模組層函式（不隨 render 改變）；首頁只在掛載與重試時讀。
 */
export function usePagedList<T>(
  loadFirst: () => Promise<{ total: number; page: Page<T> }>,
  loadNext: (cursor: Cursor) => Promise<Page<T>>,
): PagedList<T> {
  const [state, setState] = useState<PagedListState<T>>({
    status: 'loading', items: [], total: 0, cursor: null, done: false, loadingMore: false,
  });
  const [attempt, setAttempt] = useState(0);
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    setState((prev) => ({ ...prev, status: 'loading' }));
    const run = async (): Promise<void> => {
      try {
        const { total, page } = await loadFirst();
        if (seq !== seqRef.current) return;
        setState({ status: 'ready', items: page.items, total, cursor: page.cursor, done: page.done, loadingMore: false });
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[admin-inactive] load failed', err);
        if (seq !== seqRef.current) return;
        setState((prev) => ({ ...prev, status: 'error' }));
      }
    };
    void run();
    return () => { seqRef.current += 1; };
  }, [attempt, loadFirst]);

  const hasMore = state.status === 'ready' && !state.done && state.items.length < state.total;

  const loadMore = useCallback(() => {
    if (!hasMore || state.loadingMore) return;
    const seq = seqRef.current;
    const cursor = state.cursor;
    setState((prev) => ({ ...prev, loadingMore: true }));
    const run = async (): Promise<void> => {
      try {
        const page = await loadNext(cursor);
        if (seq !== seqRef.current) return;
        setState((prev) => ({
          ...prev, items: [...prev.items, ...page.items], cursor: page.cursor, done: page.done, loadingMore: false,
        }));
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[admin-inactive] load more failed', err);
        if (seq !== seqRef.current) return;
        setState((prev) => ({ ...prev, loadingMore: false }));
        toast.show({ message: t('admin-inactive.loadError'), tone: 'error' });
      }
    };
    void run();
  }, [hasMore, loadNext, state.cursor, state.loadingMore]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, hasMore, retry, loadMore };
}
