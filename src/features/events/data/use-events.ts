import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getLastKnownAuthUid } from '@/data/auth';
import { trackPublicRead } from '@/data/firebase';
import { on } from '@/core/events';
import { eventsRetainedForSnapshot, readEventsSnapshot, writeEventsSnapshot } from './events-snapshot-cache';
import { isEventInEndedTab } from './terminal';
import { sortEvents } from './presentation';
import type { EventDoc } from './types';

/** preview：一併載入 ended／cancelled 近 50 筆（R-EVT-002、R-EVT-003，活動列表等頁用）；none：只載進行中，首頁用。 */
export type UseEventsTerminalMode = 'preview' | 'none';

export interface UseEventsOptions {
  /** 預設 'preview'。首頁只算進行中活動，用 'none' 少一個查詢與 payload。 */
  terminalMode?: UseEventsTerminalMode;
  /**
   * 每次「確認向伺服器新取得」的結果被這個畫面採用時呼叫一次（含「目前沒有活動」的空結果）。
   * 參數**只有這次確認新取得的進行中（active）活動**，不含 ended／cancelled 預覽（terminal）：terminal 沒有自己的
   * 「是否為本次伺服器結果」旗標（`none` 模式根本不更新它，沿用的是更早一次的資料）。
   * 不呼叫：記憶體／本機快照那份上次資料、離線時 Firestore 回的持久快取（`activeFromCache` 不是 false）、
   * 已卸載或已被新一輪請求取代的畫面。首頁用它寫自己的公開首屏快照（T-042）：
   * 只能拿確認新取得的資料寫，否則舊資料會被重新蓋上新的時間戳。
   */
  onFresh?: (activeEvents: EventDoc[]) => void;
}

interface Inflight {
  mode: UseEventsTerminalMode;
  promise: Promise<EventDoc[]>;
  listeners: Set<(active: EventDoc[]) => void>;
  /** active 已先畫、terminal 可能還沒到。後加入的畫面補畫這份。 */
  activePaint: EventDoc[] | null;
}

interface LoadRequest {
  /** 手動重新整理：不沿用短 TTL 的 active，terminal 也重抓。 */
  force?: boolean;
  /** preview：active 已可畫時呼叫（terminal 可能還沒到）。 */
  onActive?: (active: EventDoc[]) => void;
}

// 同一 singleton 上的同型 UI 請求共用 Promise，避免首頁／列表互相作廢請求。
// 成功和失敗均清除（L-08）；hook 本身仍有生命週期保護。
let inflight: Inflight | null = null;
/** 本次開啟期間最後一次成功讀到的活動與讀取當時的帳號（切頁回來時直接先畫）。 */
let lastLoaded: { uid: string | null; events: EventDoc[] } | null = null;

/**
 * stale-first 的上次資料：記憶體 → 本機快照（30 分鐘內）。
 * 訪客（viewerUid === null）第一次 render 就讀 owner 為 guest 的快照，不等 getLastKnownAuthUid()
 * （那個值從「尚未確定」變成 null 時，memo 的依賴不會變，等下去就永遠畫不到）。
 * 登入者仍要 viewer 帳號等於登入模組確認的帳號才給（Fable 2026-10-19）：不拿登入者快照給訪客，
 * 也不在帳號未確認時畫登入者快照。記憶體那份也必須是同一個 uid。
 * 首頁（none）寫入的快照沒有 ended／cancelled 預覽；活動列表拿來先畫後，仍會照常載入預覽再更新。
 * 短 TTL 內列表沿用 repo 剛成功的 active，不再讀一次 active；手動重新整理（retry）不沿用。
 */
function staleEventsFor(viewerUid: string | null): EventDoc[] | null {
  if (viewerUid !== null) {
    const known = getLastKnownAuthUid();
    if (known === undefined || known !== viewerUid) return null;
  }
  if (lastLoaded && lastLoaded.uid === viewerUid) return lastLoaded.events;
  return readEventsSnapshot(viewerUid);
}

/**
 * 網路資料比登入確認更早回來時（首頁的公開讀取不等 Auth，T-041）暫存在這裡，
 * 等登入帳號確定、且與畫面使用者相同才寫入記憶體與本機快照——快取歸屬守門不放寬（Fable 2026-10-19）。
 * 寫入時訪客會拿掉私密／俱樂部限定，登入者保留原清單。守門保證快照只掛在確認過的帳號底下。
 */
let pendingSnapshot: EventDoc[] | null = null;

function commitSnapshot(owner: string | null, events: EventDoc[]): void {
  // 訪客只把可見活動留在記憶體與 localStorage。登入者維持原清單，頁面再濾。
  const stored = eventsRetainedForSnapshot(owner, events);
  lastLoaded = { uid: owner, events: stored };
  writeEventsSnapshot(owner, stored);
}

function flushPendingSnapshot(viewerUid: string | null): void {
  if (!pendingSnapshot) return;
  if (getLastKnownAuthUid() !== viewerUid) return;
  const events = pendingSnapshot;
  pendingSnapshot = null;
  commitSnapshot(viewerUid, events);
}

/** 測試用。 */
export function _resetUseEventsForTest(): void {
  inflight = null;
  lastLoaded = null;
  pendingSnapshot = null;
}

let repoModule: Promise<typeof import('./events-repo')> | null = null;

/**
 * events-repo 靜態 import Firestore SDK，這裡動態載入才不會把 SDK 帶進首頁路由的靜態相依（T-041 A2）。
 * 只 import 一次（共用 Promise），失敗時清掉以便重試（L-08）。
 */
function loadRepoModule(): Promise<typeof import('./events-repo')> {
  if (!repoModule) {
    const promise = import('./events-repo');
    repoModule = promise;
    promise.catch(() => {
      if (repoModule === promise) repoModule = null;
    });
  }
  return repoModule;
}

/**
 * 回傳的結果陣列（key）→ 這一次呼叫「確認向伺服器新取得」的進行中（active）清單。沒有登記＝不是確認新取得的。
 * 依賴 events-repo 的 `loadEventsStatic` 回傳契約（`events-repo.test.ts` 與 `use-events.repo-contract.test.tsx` 用真實 repo 驗證）：
 * - 回傳值（`receipt`）是**完成回條，不是活動陣列**：這次呼叫自己成功（含成功但零筆）且有查 active 回 `['events']`；
 *   短 TTL 沿用已成功的 active、只補 terminal 回 `['terminal']`（這次沒有確認新取得 active）；
 *   被較新請求取代回 `[]`（這次呼叫沒有提交任何資料）；active 查詢失敗丟 `EventsLoadError`（不會走到組清單）——
 *   但「失敗丟錯」只在這次呼叫沒被取代時成立：被取代的呼叫即使底層失敗，也是先判斷被取代而回 `[]`（所以 `[]` 不一定代表沒失敗，
 *   只代表這次呼叫的結果不算數）。只有 terminal 失敗時 active 已提交，`start` 改回傳目前快照，整頁不報錯（見 `isTerminalOnlyFailure`）。
 * - 成功的呼叫在回傳前、通過 sequence 檢查之後，同步把 **active 清單與 `activeFromCache`** 一起提交；所以緊接著 `getSnapshot()`
 *   讀到的 active 與旗標，就是這一次呼叫剛提交的。被取代的呼叫沒有提交，那時共用 snapshot 仍是上一次的 active 與旗標，不能算這次新取得。
 *   沿用 TTL 時這次沒有重交 active。terminal 不在這個保證裡（`none` 模式不更新它；`preview` 的 terminal 也沒有獨立旗標），所以只登記 active。
 * 因此條件是：`receipt` 含 `'events'`（這次自己查了 active 且成功）且 `activeFromCache === false`（不是離線時的本機快取）。見 `UseEventsOptions.onFresh`。
 */
const serverConfirmedActive = new WeakMap<EventDoc[], EventDoc[]>();

/** 不靜態 import events-repo（那會把 Firestore SDK 帶進首頁）。terminal 失敗、active 已成功：整頁不報錯。 */
function isTerminalOnlyFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const fields = error as { name?: unknown; activeFailed?: unknown; terminalFailed?: unknown };
  return fields.name === 'EventsLoadError' && fields.activeFailed === false && fields.terminalFailed === true;
}

function start(mode: UseEventsTerminalMode, request: LoadRequest): Promise<EventDoc[]> {
  return (async () => {
    const { getEventsRepo } = await loadRepoModule();
    const repo = getEventsRepo();
    // preview：結束後六小時內仍在一般列表（R-EVT-002）；none：首頁用不到 terminal，不載。
    // 列表在短 TTL 內沿用首頁剛載入的 active，只補 terminal。手動重新整理不沿用。
    const reuse = mode === 'preview' && request.force !== true;
    let receipt: string[] = [];
    try {
      receipt = await repo.loadEventsStatic({
        terminalMode: mode,
        ...(request.force && mode !== 'none' ? { forceTerminalRefresh: true } : {}),
        ...(reuse ? { reuseActiveIfFresh: true } : {}),
        ...(mode === 'preview'
          ? {
              onActiveCommitted: () => {
                request.onActive?.([...repo.getSnapshot().active]);
              },
            }
          : {}),
      });
    } catch (error) {
      // active 已提交。terminal 失敗保留 repo 裡的舊 terminal，整頁仍算這次有資料可畫。
      if (!isTerminalOnlyFailure(error)) throw error;
    }
    const snapshot = repo.getSnapshot();
    const events = [...snapshot.active, ...snapshot.terminal];
    // 回條含 'events' 才是這次真的查了 active。沿用時回條是 ['terminal']，不算確認新取得。
    if (Array.isArray(receipt) && receipt.includes('events') && snapshot.activeFromCache === false) {
      serverConfirmedActive.set(events, snapshot.active);
    }
    return events;
  })();
}

function load(mode: UseEventsTerminalMode, request: LoadRequest = {}): Promise<EventDoc[]> {
  const current = inflight;
  // preview 是 none 的超集：進行中的是 preview，或這次只要 none，都直接共用。
  // 進行中的請求不因手動重新整理再平行開一輪（loadSeq 會讓較早的那輪作廢）。
  if (current && (current.mode === 'preview' || mode === 'none')) {
    if (request.onActive) {
      current.listeners.add(request.onActive);
      if (current.activePaint) request.onActive(current.activePaint);
    }
    return current.promise;
  }

  const entry: Inflight = {
    mode,
    promise: undefined as never,
    listeners: new Set(),
    activePaint: null,
  };
  if (request.onActive) entry.listeners.add(request.onActive);
  const publish = (active: EventDoc[]): void => {
    entry.activePaint = active;
    for (const listener of entry.listeners) {
      try {
        listener(active);
      } catch {
        /* 呼叫端失敗不影響載入 */
      }
    }
  };

  // 進行中的是 none、這次要 preview：等它結束再補載 terminal，
  // 不並行（repo 的 loadSeq 會讓較早的請求作廢）。
  const run = (): Promise<EventDoc[]> => start(mode, { force: request.force === true, onActive: publish });
  const loading = current ? current.promise.then(run, run) : run();
  entry.promise = loading;
  inflight = entry;
  // 首頁的活動讀取是公開讀取：登記後，首頁公開讀取全部處理完才讓 Auth 註冊（見 data/firebase.ts）。
  trackPublicRead(loading);
  const clear = (): void => {
    if (inflight === entry) inflight = null;
  };
  loading.then(clear, clear);
  return loading;
}

/** 先畫新的 active，畫面上已有的 ended／cancelled 先留著，等這次 terminal 回來再整份換掉。 */
function mergeActiveKeepTerminal(previous: readonly EventDoc[], active: readonly EventDoc[]): EventDoc[] {
  const activeIds = new Set(
    active.map((event) => event._docId || event.id).filter((id): id is string => !!id),
  );
  const kept = previous.filter((event) => {
    const id = event._docId || event.id;
    if (id && activeIds.has(id)) return false;
    return event.status === 'ended' || event.status === 'cancelled';
  });
  return [...active, ...kept];
}

/**
 * @param viewerUid 目前畫面使用者的 uid（訪客為 null）；用來決定能不能先畫上次資料與快照歸屬。
 */
export function useEvents(viewerUid: string | null, options: UseEventsOptions = {}): {
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
  const terminalMode = options.terminalMode ?? 'preview';
  const terminalModeRef = useRef(terminalMode);
  terminalModeRef.current = terminalMode;
  const onFreshRef = useRef(options.onFresh);
  onFreshRef.current = options.onFresh;
  const stale = useMemo(() => (fresh ? null : staleEventsFor(viewerUid)), [fresh, viewerUid]);
  const shownRef = useRef<EventDoc[]>([]);
  shownRef.current = fresh ?? stale ?? [];

  useEffect(() => {
    let current = true;
    setPending(true);
    setFailed(false);
    const mode = terminalModeRef.current;
    // attempt > 0 是 retry()（錯誤重試、表單存檔後重新整理）。TTL 內仍要真的重抓。
    const force = attempt > 0;
    load(mode, {
      force,
      onActive: mode === 'preview'
        ? (active) => {
            if (!current) return;
            setFresh(mergeActiveKeepTerminal(shownRef.current, active));
            setNow(Date.now());
            setPending(false);
            setFailed(false);
          }
        : undefined,
    }).then(
      (next) => {
        const owner = viewerUidRef.current;
        if (getLastKnownAuthUid() === owner) {
          pendingSnapshot = null;
          commitSnapshot(owner, next);
        } else {
          // 登入狀態還沒確定（或 viewer 還沒載成本人）：先不寫，確定後補寫。
          pendingSnapshot = next;
        }
        if (!current) return;
        const confirmedActive = serverConfirmedActive.get(next);
        if (confirmedActive) {
          try {
            onFreshRef.current?.(confirmedActive);
          } catch {
            /* 呼叫端的快照寫入失敗不影響列表 */
          }
        }
        setFresh(next);
        setNow(Date.now());
        setPending(false);
      },
      (error: unknown) => {
        if (!current) return;
        // 後備：start() 已把「只有 terminal 失敗」收成成功。這裡再擋一次，避免整頁報錯。
        if (isTerminalOnlyFailure(error)) {
          setFailed(false);
          setPending(false);
          return;
        }
        setFailed(true);
        setPending(false);
      },
    );
    return () => { current = false; };
  }, [attempt]);

  // 登入帳號確定（auth:changed）或畫面使用者換成確認過的帳號時，補寫早到的網路資料。
  useEffect(() => {
    flushPendingSnapshot(viewerUid);
  }, [viewerUid]);
  useEffect(() => on('auth:changed', () => flushPendingSnapshot(viewerUidRef.current)), []);

  const raw = fresh ?? stale ?? [];
  // 訪客的回傳（畫面資料來源）再濾一次：伺服器清單、記憶體、本機快照都不含私密／俱樂部限定。
  // 登入者沿用原清單（長度判斷與 SPEED-1-4 相同，不把已結束頁籤提前算成沒資料）。
  const listed = viewerUid === null ? eventsRetainedForSnapshot(null, raw) : raw;
  // 已有可畫的資料時，更新失敗不顯示錯誤（A 的快取模式也是如此）。
  const loading = pending && listed.length === 0;
  const error = failed && listed.length === 0;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return {
    events: sortEvents(listed.filter((event) => !isEventInEndedTab(event, now))),
    loading,
    error,
    retry,
  };
}
