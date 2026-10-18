/**
 * 活動列表的 Firestore 存取層。
 *
 * 移植 A 的：
 *   - firebase-service.js::_loadEventsStatic
 *   - firebase-service.js::_fetchTerminalEventsSnapshot
 *   - firebase-service.js::ensureTerminalEventsLoaded
 *   - firebase-service.js::loadMoreTerminalEvents
 *
 * 本檔是 events feature 唯一直接呼叫 Firestore API 的地方。
 * 以「請求序號」避免舊請求覆蓋新結果（review-lessons L-02）。
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

// ── 常數（與 A 對齊） ─────────────────────────────────

export const ACTIVE_EVENT_STATUSES = ['open', 'full', 'upcoming'] as const;
export const TERMINAL_EVENT_STATUSES = ['ended', 'cancelled'] as const;

/** A 的 _terminalPreviewLimit */
export const TERMINAL_PREVIEW_LIMIT = 50;
/** A 的 _terminalHistoryLimit */
export const TERMINAL_HISTORY_LIMIT = 10;
/** A 的 _terminalPageSize 預設 */
export const TERMINAL_PAGE_SIZE_DEFAULT = 100;
/** A 的 active events limit */
export const ACTIVE_EVENTS_LIMIT = 200;

export type TerminalMode = 'preview' | 'history' | 'none';

// ── 公開型別 ────────────────────────────────────────

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

// ── 內部狀態 ────────────────────────────────────────

interface InternalState {
  active: EventDoc[];
  terminal: EventDoc[];
  terminalLoadedMode: 'none' | 'preview' | 'history';
  terminalLastDoc: QueryDocumentSnapshot<DocumentData> | null;
  terminalPageSize: number;
  terminalAllLoaded: boolean;
  loadingMoreTerminal: boolean;
  terminalOrderedByDate: boolean | null;
  loadSeq: number;
  moreSeq: number;
}

function createInitialState(): InternalState {
  return {
    active: [],
    terminal: [],
    terminalLoadedMode: 'none',
    terminalLastDoc: null,
    terminalPageSize: TERMINAL_PAGE_SIZE_DEFAULT,
    terminalAllLoaded: false,
    loadingMoreTerminal: false,
    terminalOrderedByDate: null,
    loadSeq: 0,
    moreSeq: 0,
  };
}

// ── 工廠 ────────────────────────────────────────────

export function createEventsRepo(deps: EventsRepoDeps): EventsRepo {
  const logger: EventsRepoLogger = deps.logger ?? console;
  const state = createInitialState();

  function mapDoc(snapshot: QueryDocumentSnapshot<DocumentData>): EventDoc {
    const data = snapshot.data() as Record<string, unknown>;
    return { ...data, _docId: snapshot.id } as EventDoc;
  }

  async function fetchQuerySnapshot(label: string, q: Query<DocumentData>): Promise<SnapshotResult> {
    try {
      const snap = await getDocs(q);
      return { ok: true, docs: snap.docs };
    } catch (err) {
      logger.warn(`[EventsRepo] ${label} query skipped:`, err);
      return { ok: false, docs: [] };
    }
  }

  async function fetchTerminalEventsSnapshot(db: Firestore, limitCount: number): Promise<SnapshotResult> {
    const safeLimit = Math.max(1, Number(limitCount) || 200);
    const ordered = await fetchQuerySnapshot(
      'events:terminal:recent',
      query(
        collection(db, eventsCollectionPath),
        where('status', 'in', [...TERMINAL_EVENT_STATUSES]),
        orderBy('date', 'desc'),
        limit(safeLimit),
      ),
    );
    if (ordered.ok) {
      state.terminalOrderedByDate = true;
      state.terminalPageSize = safeLimit;
      return ordered;
    }
    state.terminalOrderedByDate = false;
    state.terminalPageSize = Math.min(safeLimit, TERMINAL_PAGE_SIZE_DEFAULT);
    return fetchQuerySnapshot(
      'events:terminal:fallback',
      query(
        collection(db, eventsCollectionPath),
        where('status', 'in', [...TERMINAL_EVENT_STATUSES]),
        limit(state.terminalPageSize),
      ),
    );
  }

  async function loadEventsStatic(options: LoadEventsStaticOptions = {}): Promise<string[]> {
    const requestedTerminalMode: TerminalMode = options.terminalMode ?? 'preview';
    const shouldLoadTerminal =
      requestedTerminalMode !== 'none'
      && !(
        requestedTerminalMode === 'preview'
        && state.terminalLoadedMode === 'history'
        && !options.forceTerminalRefresh
      );
    const terminalLimit = requestedTerminalMode === 'history'
      ? TERMINAL_HISTORY_LIMIT
      : TERMINAL_PREVIEW_LIMIT;
    const seq = ++state.loadSeq;

    const { db } = await deps.getFirebase();
    const [activeResult, terminalResult] = await Promise.all([
      fetchQuerySnapshot(
        'events:active',
        query(
          collection(db, eventsCollectionPath),
          where('status', 'in', [...ACTIVE_EVENT_STATUSES]),
          limit(ACTIVE_EVENTS_LIMIT),
        ),
      ),
      shouldLoadTerminal
        ? fetchTerminalEventsSnapshot(db, terminalLimit)
        : Promise.resolve<SnapshotResult>({ ok: true, docs: [] }),
    ]);

    // L-02：舊請求回來時直接丟棄，不寫任何狀態。
    if (seq !== state.loadSeq) return [];

    if (!activeResult.ok && shouldLoadTerminal && !terminalResult.ok) {
      logger.warn('[EventsRepo] Skip cache overwrite for "events" due to load failure.');
      return [];
    }

    if (activeResult.ok) {
      state.active = activeResult.docs.map(mapDoc);
    }

    if (shouldLoadTerminal && terminalResult.ok) {
      state.terminal = terminalResult.docs.map(mapDoc);
      state.terminalLoadedMode = requestedTerminalMode === 'history' ? 'history' : 'preview';
      const lastDoc = terminalResult.docs.length > 0
        ? terminalResult.docs[terminalResult.docs.length - 1]
        : undefined;
      state.terminalLastDoc = lastDoc ?? null;
      state.terminalAllLoaded =
        terminalResult.docs.length < (state.terminalPageSize || terminalLimit);
    }

    return ['events'];
  }

  async function ensureTerminalEventsLoaded(
    options: EnsureTerminalEventsLoadedOptions = {},
  ): Promise<string[]> {
    const mode = options.mode ?? 'history';
    if (mode === 'history' && state.terminalLoadedMode === 'history' && !options.force) return ['events'];
    if (mode === 'preview' && state.terminalLoadedMode !== 'none' && !options.force) return ['events'];
    return loadEventsStatic({ terminalMode: mode, forceTerminalRefresh: true });
  }

  async function loadMoreTerminalEvents(): Promise<number> {
    if (!state.terminalLastDoc && state.terminalLoadedMode !== 'history') {
      await ensureTerminalEventsLoaded({ mode: 'history', force: true });
    }
    if (state.terminalAllLoaded || !state.terminalLastDoc) return 0;
    if (state.loadingMoreTerminal) return -1;

    state.loadingMoreTerminal = true;
    const seq = ++state.moreSeq;
    try {
      const lastDoc = state.terminalLastDoc;
      if (!lastDoc) return 0;

      const { db } = await deps.getFirebase();
      const constraints: QueryConstraint[] = [
        where('status', 'in', [...TERMINAL_EVENT_STATUSES]),
      ];
      if (state.terminalOrderedByDate !== false) {
        constraints.push(orderBy('date', 'desc'));
      }
      constraints.push(
        startAfter(lastDoc),
        limit(state.terminalPageSize || TERMINAL_PAGE_SIZE_DEFAULT),
      );
      const q = query(collection(db, eventsCollectionPath), ...constraints);
      const snap = await getDocs(q);

      if (seq !== state.moreSeq) return 0;

      const newDocs = snap.docs.map(mapDoc);
      if (newDocs.length > 0) {
        state.terminal = state.terminal.concat(newDocs);
        const newLast = snap.docs.length > 0
          ? snap.docs[snap.docs.length - 1]
          : undefined;
        state.terminalLastDoc = newLast ?? null;
      }
      if (newDocs.length < (state.terminalPageSize || TERMINAL_PAGE_SIZE_DEFAULT)) {
        state.terminalAllLoaded = true;
      }
      return newDocs.length;
    } catch (err) {
      logger.error('[loadMoreTerminalEvents]', err);
      throw err;
    } finally {
      state.loadingMoreTerminal = false;
    }
  }

  return {
    loadEventsStatic,
    ensureTerminalEventsLoaded,
    loadMoreTerminalEvents,
    getSnapshot: () => ({ active: [...state.active], terminal: [...state.terminal] }),
  };
}

// ── 預設 singleton（UI 端使用） ─────────────────────

let singleton: EventsRepo | null = null;

export function getEventsRepo(): EventsRepo {
  if (!singleton) {
    singleton = createEventsRepo({ getFirebase: defaultGetFirebase });
  }
  return singleton;
}
