/**
 * 唯一直接存取活動 Firestore 的模組。
 * 保留 preview/history、fallback、分頁與過期回應丟棄語意。
 * 查詢失敗會 reject；成功分支仍更新自己的快取，失敗分支保留舊快取。
 */
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type Firestore,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getFirebase as defaultGetFirebase } from '@/data/firebase';
import { events as eventsCollectionPath } from '@/data/paths';
import type { EventDoc } from './types';

export const ACTIVE_EVENT_STATUSES = ['open', 'full', 'upcoming'] as const;
export const TERMINAL_EVENT_STATUSES = ['ended', 'cancelled'] as const;
export const TERMINAL_PREVIEW_LIMIT = 50;
export const TERMINAL_HISTORY_LIMIT = 10;
export const TERMINAL_PAGE_SIZE_DEFAULT = 100;
export const ACTIVE_EVENTS_LIMIT = 200;

export type TerminalMode = 'preview' | 'history' | 'none';

export interface EventsRepoLogger {
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface EventsRepoDeps {
  getFirebase: () => Promise<{ db: Firestore }>;
  logger?: EventsRepoLogger;
}

export interface EventsSnapshot {
  active: EventDoc[];
  terminal: EventDoc[];
}

export interface LoadEventsStaticOptions {
  terminalMode?: TerminalMode;
  forceTerminalRefresh?: boolean;
}

export interface EnsureTerminalEventsLoadedOptions {
  mode?: 'preview' | 'history';
  force?: boolean;
}

export interface EventsRepo {
  loadEventsStatic(options?: LoadEventsStaticOptions): Promise<string[]>;
  ensureTerminalEventsLoaded(options?: EnsureTerminalEventsLoadedOptions): Promise<string[]>;
  loadMoreTerminalEvents(): Promise<number>;
  getSnapshot(): EventsSnapshot;
}

type SnapshotResult =
  | { ok: true; docs: QueryDocumentSnapshot<DocumentData>[] }
  | { ok: false; docs: QueryDocumentSnapshot<DocumentData>[] };

interface TerminalResult {
  result: SnapshotResult;
  ordered: boolean;
  pageSize: number;
}

interface InternalState {
  active: EventDoc[];
  terminal: EventDoc[];
  terminalLoadedMode: 'none' | 'preview' | 'history';
  terminalLastDoc: QueryDocumentSnapshot<DocumentData> | null;
  terminalPageSize: number;
  terminalAllLoaded: boolean;
  terminalOrderedByDate: boolean | null;
  loadingMoreTerminal: boolean;
  loadSeq: number;
  moreSeq: number;
}

export class EventsLoadError extends Error {
  constructor(
    readonly activeFailed: boolean,
    readonly terminalFailed: boolean,
  ) {
    super('Events could not be loaded.');
    this.name = 'EventsLoadError';
  }
}

export function createEventsRepo(deps: EventsRepoDeps): EventsRepo {
  const logger = deps.logger ?? console;
  const state: InternalState = {
    active: [],
    terminal: [],
    terminalLoadedMode: 'none',
    terminalLastDoc: null,
    terminalPageSize: TERMINAL_PAGE_SIZE_DEFAULT,
    terminalAllLoaded: false,
    terminalOrderedByDate: null,
    loadingMoreTerminal: false,
    loadSeq: 0,
    moreSeq: 0,
  };

  function mapDoc(snapshot: QueryDocumentSnapshot<DocumentData>): EventDoc {
    return {
      ...(snapshot.data() as Record<string, unknown>),
      _docId: snapshot.id,
    } as EventDoc;
  }

  async function fetchSnapshot(
    label: string,
    request: Query<DocumentData>,
  ): Promise<SnapshotResult> {
    try {
      const snapshot = await getDocs(request);
      return { ok: true, docs: snapshot.docs };
    } catch {
      // 不輸出 SDK 原始錯誤、查詢內容或使用者資料。
      logger.warn(`[EventsRepo] ${label} query failed.`);
      return { ok: false, docs: [] };
    }
  }

  async function fetchTerminal(db: Firestore, count: number): Promise<TerminalResult> {
    const safeLimit = Math.max(1, Number(count) || 200);
    const ordered = await fetchSnapshot(
      'terminal:recent',
      query(
        collection(db, eventsCollectionPath),
        where('status', 'in', [...TERMINAL_EVENT_STATUSES]),
        orderBy('date', 'desc'),
        limit(safeLimit),
      ),
    );
    if (ordered.ok) {
      return { result: ordered, ordered: true, pageSize: safeLimit };
    }

    const pageSize = Math.min(safeLimit, TERMINAL_PAGE_SIZE_DEFAULT);
    const fallback = await fetchSnapshot(
      'terminal:fallback',
      query(
        collection(db, eventsCollectionPath),
        where('status', 'in', [...TERMINAL_EVENT_STATUSES]),
        limit(pageSize),
      ),
    );
    // Metadata 同樣須經 loadSeq 驗證後才能提交（L-02）。
    return { result: fallback, ordered: false, pageSize };
  }

  async function loadEventsStatic(
    options: LoadEventsStaticOptions = {},
  ): Promise<string[]> {
    const mode = options.terminalMode ?? 'preview';
    const shouldLoadTerminal = mode !== 'none' && !(
      mode === 'preview' &&
      state.terminalLoadedMode === 'history' &&
      !options.forceTerminalRefresh
    );
    const terminalLimit = mode === 'history'
      ? TERMINAL_HISTORY_LIMIT
      : TERMINAL_PREVIEW_LIMIT;
    const sequence = ++state.loadSeq;

    let db: Firestore;
    try {
      ({ db } = await deps.getFirebase());
    } catch {
      if (sequence !== state.loadSeq) return [];
      throw new EventsLoadError(true, shouldLoadTerminal);
    }
    if (sequence !== state.loadSeq) return [];

    const [active, terminal] = await Promise.all([
      fetchSnapshot(
        'active',
        query(
          collection(db, eventsCollectionPath),
          where('status', 'in', [...ACTIVE_EVENT_STATUSES]),
          limit(ACTIVE_EVENTS_LIMIT),
        ),
      ),
      shouldLoadTerminal
        ? fetchTerminal(db, terminalLimit)
        : Promise.resolve<TerminalResult | null>(null),
    ]);

    if (sequence !== state.loadSeq) return [];

    if (active.ok) state.active = active.docs.map(mapDoc);
    if (terminal?.result.ok) {
      state.terminal = terminal.result.docs.map(mapDoc);
      state.terminalLoadedMode = mode === 'history' ? 'history' : 'preview';
      state.terminalOrderedByDate = terminal.ordered;
      state.terminalPageSize = terminal.pageSize;
      state.terminalLastDoc = terminal.result.docs.at(-1) ?? null;
      state.terminalAllLoaded = terminal.result.docs.length < terminal.pageSize;
      // 已替換分頁基準，舊分頁結果不得再追加進來。
      state.moreSeq += 1;
    }

    const terminalFailed = terminal !== null && !terminal.result.ok;
    if (!active.ok || terminalFailed) {
      throw new EventsLoadError(!active.ok, terminalFailed);
    }
    return ['events'];
  }

  async function ensureTerminalEventsLoaded(
    options: EnsureTerminalEventsLoadedOptions = {},
  ): Promise<string[]> {
    const mode = options.mode ?? 'history';
    if (!options.force && (
      (mode === 'history' && state.terminalLoadedMode === 'history') ||
      (mode === 'preview' && state.terminalLoadedMode !== 'none')
    )) {
      return ['events'];
    }
    return loadEventsStatic({ terminalMode: mode, forceTerminalRefresh: true });
  }

  async function loadMoreTerminalEvents(): Promise<number> {
    if (!state.terminalLastDoc && state.terminalLoadedMode !== 'history') {
      await ensureTerminalEventsLoaded({ mode: 'history', force: true });
    }
    if (state.terminalAllLoaded || !state.terminalLastDoc) return 0;
    if (state.loadingMoreTerminal) return -1;

    state.loadingMoreTerminal = true;
    const sequence = ++state.moreSeq;
    try {
      const cursor = state.terminalLastDoc;
      const pageSize = state.terminalPageSize || TERMINAL_PAGE_SIZE_DEFAULT;
      const ordered = state.terminalOrderedByDate;
      const { db } = await deps.getFirebase();
      const constraints: QueryConstraint[] = [
        where('status', 'in', [...TERMINAL_EVENT_STATUSES]),
      ];
      if (ordered !== false) constraints.push(orderBy('date', 'desc'));
      constraints.push(startAfter(cursor), limit(pageSize));

      const snapshot = await getDocs(
        query(collection(db, eventsCollectionPath), ...constraints),
      );
      if (sequence !== state.moreSeq) return 0;

      const docs = snapshot.docs.map(mapDoc);
      if (docs.length > 0) {
        state.terminal = state.terminal.concat(docs);
        state.terminalLastDoc = snapshot.docs.at(-1) ?? null;
      }
      if (docs.length < pageSize) state.terminalAllLoaded = true;
      return docs.length;
    } catch {
      if (sequence !== state.moreSeq) return 0;
      logger.error('[EventsRepo] terminal pagination failed.');
      throw new EventsLoadError(false, true);
    } finally {
      state.loadingMoreTerminal = false;
    }
  }

  return {
    loadEventsStatic,
    ensureTerminalEventsLoaded,
    loadMoreTerminalEvents,
    getSnapshot: () => ({
      active: [...state.active],
      terminal: [...state.terminal],
    }),
  };
}

let singleton: EventsRepo | null = null;

export function getEventsRepo(): EventsRepo {
  singleton ??= createEventsRepo({ getFirebase: defaultGetFirebase });
  return singleton;
}
