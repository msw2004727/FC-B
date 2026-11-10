// 強制更新狀態機（UPD-1b-1）。load 之後才動態載入，不進入口 chunk。
//
// 真的重載才記次數。同一個 minBuild：分頁內最多 2 次、間隔至少 60 秒；
// 第 2 次先取消註冊再清快取，最多等 5 秒。
// 跨分頁煞車（顧問 §3.99）：同一個 minBuild 累計自動重整 6 次後只顯示按鈕，
// 不再自動重整，也不會過一段時間自己恢復；換成別的 minBuild 才重算。

import type { ReloadSafetyDecision } from './reload-safety';
import type { RuntimeConfig } from './sw-control';

const RELOAD_KEY = 'fcb:min-build-reload';
const CONFIG_AT_KEY = 'fcb:runtime-config-at';
const GUARD_KEY = 'fcb:min-build-guard';
const PROBE_KEY = 'fcb:min-build-probe';

const COOLDOWN_MS = 60_000;
const PURGE_WAIT_MS = 5_000;
const DEFAULT_INTERVAL_MS = 3_000;
const DEFAULT_FOREGROUND_MS = 600_000;
/** 顧問 §3.99：同一個 minBuild 的自動重整次數，不含 10 分鐘滑動窗。 */
const GLOBAL_AUTO_RELOAD_LIMIT = 6;

export interface ForceState {
  m: number;
  n: number;
  t: number;
}

export type ForceDecision =
  | { kind: 'none'; why: 'no-min-build' | 'up-to-date' | 'no-build-id' }
  | { kind: 'exhausted' }
  | { kind: 'cooldown'; retryAt: number }
  | { kind: 'offline' }
  | { kind: 'prompt-only'; why: 'no-session-storage' | 'no-local-storage' | 'global-brake' }
  | { kind: 'quiet'; why: 'checkin' }
  | { kind: 'go'; attempt: 1 | 2 };

export interface ForceUpdateDeps {
  initialConfig: RuntimeConfig | null;
  fetchConfig: () => Promise<RuntimeConfig | null>;
  buildId: () => number;
  now: () => number;
  online: () => boolean;
  session: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  local: Pick<Storage, 'getItem' | 'setItem'> | null;
  evaluateSafety: () => ReloadSafetyDecision;
  isSubmitting: () => boolean;
  onSubmittingIdle: (cb: () => void) => () => void;
  showForcedPrompt: (onReload: () => void) => void;
  dismissForcedPrompt: () => void;
  disableSw: () => Promise<void>;
  applySwEnabled: (enabled: boolean) => Promise<void>;
  reload: () => void;
  report: (what: string) => void;
  target: { doc: Document; win: Window };
  intervalMs?: number;
  foregroundThrottleMs?: number;
}

/** /checkin 與 /checkin/。掃碼頁不顯示強制提示框。 */
export function isCheckinPath(pathname: string): boolean {
  const noHash = pathname.split('#')[0] ?? '';
  const clean = noHash.split('?')[0] || '/';
  const normalized = clean.length > 1 && clean.endsWith('/') ? clean.slice(0, -1) : clean;
  return normalized === '/checkin';
}

/** 舊版純數字字串視為該值已重載 1 次、時間未知（t = 0）。m 不同則當沒記錄。 */
export function readForceState(raw: string | null, minBuild: number): ForceState | null {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const m = Number(raw);
    if (!Number.isFinite(m) || m !== minBuild) return null;
    return { m, n: 1, t: 0 };
  }
  try {
    const parsed = JSON.parse(raw) as { m?: unknown; n?: unknown; t?: unknown };
    if (typeof parsed.m !== 'number' || parsed.m !== minBuild) return null;
    const n = typeof parsed.n === 'number' && Number.isFinite(parsed.n) ? parsed.n : 0;
    const t = typeof parsed.t === 'number' && Number.isFinite(parsed.t) ? parsed.t : 0;
    return { m: parsed.m, n, t };
  } catch {
    return null;
  }
}

/**
 * 規則依序短路。/checkin 只把「會重載」或「會顯示強制提示框」改成安靜等待，
 * 不蓋過不需更新、冷卻、離線、次數用盡。
 */
export function decideForceUpdate(input: {
  minBuild: number;
  buildId: number;
  state: ForceState | null;
  now: number;
  online: boolean;
  sessionOk: boolean;
  /** localStorage 能讀寫（跨分頁煞車要靠它）；沒傳視為可用。不可用時只跳提示，不自動重整。 */
  localOk?: boolean;
  /** 同一個 minBuild 已發生的自動重整次數（不隨時間減少）。 */
  recentGlobal: number;
  pathname: string;
}): ForceDecision {
  const { minBuild, buildId, state, now, online, sessionOk, recentGlobal, pathname } = input;
  const localOk = input.localOk !== false;
  let decision: ForceDecision;
  if (minBuild <= 0) decision = { kind: 'none', why: 'no-min-build' };
  else if (buildId <= 0) decision = { kind: 'none', why: 'no-build-id' };
  else if (buildId >= minBuild) decision = { kind: 'none', why: 'up-to-date' };
  else if (state?.m === minBuild && state.n >= 2) decision = { kind: 'exhausted' };
  else if (!online) decision = { kind: 'offline' };
  else if (!sessionOk) decision = { kind: 'prompt-only', why: 'no-session-storage' };
  else if (!localOk) decision = { kind: 'prompt-only', why: 'no-local-storage' };
  else if (recentGlobal >= GLOBAL_AUTO_RELOAD_LIMIT) decision = { kind: 'prompt-only', why: 'global-brake' };
  else if (state?.m === minBuild && state.n === 1) {
    const retryAt = state.t + COOLDOWN_MS;
    decision = now - state.t < COOLDOWN_MS ? { kind: 'cooldown', retryAt } : { kind: 'go', attempt: 2 };
  } else decision = { kind: 'go', attempt: 1 };

  if (isCheckinPath(pathname) && (decision.kind === 'go' || decision.kind === 'prompt-only')) {
    return { kind: 'quiet', why: 'checkin' };
  }
  return decision;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 啟動強制更新。回傳 stop（測試卸載監聽與計時器）。 */
export function startForceUpdate(deps: ForceUpdateDeps): () => void {
  let stopped = false;
  let reloading = false;
  let deferred = false;
  let offlineWaiting = false;
  let configFetchInFlight = false;
  let generation = 0;
  let lastConfig: RuntimeConfig | null = deps.initialConfig;
  let memoryConfigAt = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  const reported = new Set<string>();
  const sessionOk = probeSession();
  const localOk = probeLocal();

  const doc = deps.target.doc;
  const win = deps.target.win;
  const ac = new AbortController();

  function reportOnce(what: string): void {
    if (reported.has(what)) return;
    reported.add(what);
    try {
      deps.report(what);
    } catch {
      // 上報失敗不得擋住更新判斷
    }
  }

  function probeSession(): boolean {
    const session = deps.session;
    if (!session) return false;
    try {
      session.setItem(PROBE_KEY, '1');
      const ok = session.getItem(PROBE_KEY) === '1';
      try {
        session.removeItem(PROBE_KEY);
      } catch {
        // 探針刪不掉不影響讀寫驗證
      }
      return ok;
    } catch {
      return false;
    }
  }

  function probeLocal(): boolean {
    const local = deps.local;
    if (!local) return false;
    try {
      local.setItem(PROBE_KEY, '1');
      return local.getItem(PROBE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function readSessionRaw(): string | null {
    try {
      return deps.session?.getItem(RELOAD_KEY) ?? null;
    } catch {
      return null;
    }
  }

  function clearReloadMark(): void {
    try {
      deps.session?.removeItem(RELOAD_KEY);
    } catch {
      // 刪不掉就留著；達標後決策不再讀它來重載
    }
  }

  function markConfigRead(at: number): void {
    memoryConfigAt = at;
    try {
      deps.session?.setItem(CONFIG_AT_KEY, String(at));
    } catch {
      // 節流退回記憶體
    }
  }

  function lastConfigReadAt(): number {
    let stored = 0;
    try {
      const raw = deps.session?.getItem(CONFIG_AT_KEY);
      const n = raw ? Number(raw) : 0;
      if (Number.isFinite(n)) stored = n;
    } catch {
      stored = 0;
    }
    return Math.max(memoryConfigAt, stored);
  }

  function readRecentGlobal(minBuild: number): number {
    const local = deps.local;
    if (!local) return 0;
    try {
      const raw = local.getItem(GUARD_KEY);
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { m?: unknown; n?: unknown };
      if (parsed.m !== minBuild) return 0;
      if (typeof parsed.n !== 'number' || !Number.isFinite(parsed.n) || parsed.n < 0) return 0;
      return Math.floor(parsed.n);
    } catch {
      return 0;
    }
  }

  function bumpGuard(minBuild: number): void {
    const local = deps.local;
    if (!local) return;
    try {
      const next = readRecentGlobal(minBuild) + 1;
      local.setItem(GUARD_KEY, JSON.stringify({ m: minBuild, n: next }));
    } catch {
      // 第二道煞車寫失敗不阻擋這次重載
    }
  }

  function currentPath(): string {
    try {
      return win.location.pathname || '/';
    } catch {
      return '/';
    }
  }

  function safety(): ReloadSafetyDecision {
    if (deps.isSubmitting()) return { safe: false, reason: 'write-pending' };
    return deps.evaluateSafety();
  }

  function temporarilyBlocked(decision: ReloadSafetyDecision): boolean {
    return !decision.safe && decision.reason !== 'unsafe-page';
  }

  function stopPoll(): void {
    if (pollTimer != null) clearInterval(pollTimer);
    pollTimer = null;
  }

  function clearCooldown(): void {
    if (cooldownTimer != null) clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }

  function ensurePoll(): void {
    if (stopped || pollTimer != null) return;
    if (doc.visibilityState === 'hidden') return;
    const ms = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
    pollTimer = setInterval(() => {
      if (doc.visibilityState === 'hidden') {
        stopPoll();
        return;
      }
      evaluate('tick');
    }, ms);
  }

  function armCooldown(retryAt: number): void {
    clearCooldown();
    const delay = Math.min(COOLDOWN_MS, Math.max(0, retryAt - deps.now()));
    cooldownTimer = setTimeout(() => {
      cooldownTimer = null;
      evaluate('cooldown');
    }, delay);
  }

  function showPrompt(onReload: () => void): void {
    deps.showForcedPrompt(onReload);
  }

  async function executeReload(attempt: 1 | 2, via: 'auto' | 'user'): Promise<void> {
    if (reloading || stopped) return;
    reloading = true;
    stopPoll();
    clearCooldown();
    const minBuild = lastConfig?.minBuild ?? 0;
    const now = deps.now();
    const payload = JSON.stringify({ m: minBuild, n: attempt, t: now });
    try {
      if (!deps.session) throw new Error('no-session');
      deps.session.setItem(RELOAD_KEY, payload);
      if (deps.session.getItem(RELOAD_KEY) !== payload) throw new Error('mismatch');
    } catch {
      reloading = false;
      if (isCheckinPath(currentPath())) {
        deferred = true;
        deps.dismissForcedPrompt();
        ensurePoll();
        return;
      }
      deferred = false;
      showPrompt(() => {
        deps.reload();
      });
      return;
    }
    if (via === 'auto') bumpGuard(minBuild);
    if (attempt === 2) {
      await Promise.race([
        deps.disableSw().then(() => undefined, () => undefined),
        sleep(PURGE_WAIT_MS),
      ]);
      if (stopped) return;
    }
    deps.reload();
  }

  function evaluate(_trigger: string): void {
    if (stopped || reloading) return;
    const config = lastConfig;
    if (!config) return;
    const decision = decideForceUpdate({
      minBuild: config.minBuild,
      buildId: deps.buildId(),
      state: readForceState(readSessionRaw(), config.minBuild),
      now: deps.now(),
      online: deps.online(),
      sessionOk,
      localOk,
      recentGlobal: readRecentGlobal(config.minBuild),
      pathname: currentPath(),
    });

    if (decision.kind === 'none') {
      deferred = false;
      offlineWaiting = false;
      clearCooldown();
      stopPoll();
      deps.dismissForcedPrompt();
      if (decision.why === 'no-build-id') reportOnce('no-build-id');
      if (decision.why === 'up-to-date' || decision.why === 'no-min-build') clearReloadMark();
      return;
    }

    if (decision.kind === 'exhausted') {
      deferred = false;
      offlineWaiting = false;
      clearCooldown();
      stopPoll();
      deps.dismissForcedPrompt();
      reportOnce('min-build-stuck');
      return;
    }

    if (decision.kind === 'cooldown') {
      offlineWaiting = false;
      armCooldown(decision.retryAt);
      return;
    }

    if (decision.kind === 'offline') {
      offlineWaiting = true;
      deferred = false;
      clearCooldown();
      stopPoll();
      return;
    }

    if (decision.kind === 'quiet') {
      offlineWaiting = false;
      deferred = true;
      clearCooldown();
      deps.dismissForcedPrompt();
      ensurePoll();
      return;
    }

    if (decision.kind === 'prompt-only') {
      offlineWaiting = false;
      clearCooldown();
      const blocked = temporarilyBlocked(safety());
      if (blocked) {
        deferred = true;
        ensurePoll();
        return;
      }
      deferred = false;
      stopPoll();
      showPrompt(() => {
        deps.reload();
      });
      return;
    }

    offlineWaiting = false;
    clearCooldown();
    const page = safety();
    if (page.safe) {
      deferred = false;
      stopPoll();
      void executeReload(decision.attempt, 'auto');
      return;
    }
    deferred = true;
    if (page.reason === 'unsafe-page') {
      const attempt = decision.attempt;
      showPrompt(() => {
        void executeReload(attempt, 'user');
      });
    }
    ensurePoll();
  }

  async function onForeground(): Promise<void> {
    const throttle = deps.foregroundThrottleMs ?? DEFAULT_FOREGROUND_MS;
    const due = deps.now() - lastConfigReadAt() >= throttle;
    if (!due) {
      if (deferred || offlineWaiting) evaluate('foreground');
      return;
    }
    if (configFetchInFlight) return;
    configFetchInFlight = true;
    const gen = generation;
    try {
      const next = await deps.fetchConfig();
      if (stopped || gen !== generation) return;
      markConfigRead(deps.now());
      if (next) {
        lastConfig = next;
        if (next.swEnabled === false) {
          try {
            await deps.applySwEnabled(false);
          } catch {
            // 停用失敗仍繼續看 minBuild
          }
        }
      }
    } catch {
      if (!stopped && gen === generation) markConfigRead(deps.now());
    } finally {
      configFetchInFlight = false;
    }
    if (stopped || gen !== generation) return;
    evaluate('foreground');
  }

  function onVisibility(): void {
    if (doc.visibilityState === 'hidden') {
      stopPoll();
      return;
    }
    if (deferred) ensurePoll();
    void onForeground();
  }

  function onPageShow(event: Event): void {
    if (!('persisted' in event) || (event as PageTransitionEvent).persisted !== true) return;
    void onForeground();
  }

  function onFocusOut(): void {
    if (deferred || offlineWaiting) evaluate('focusout');
  }

  function onPopState(): void {
    if (deferred || offlineWaiting) evaluate('popstate');
  }

  function onOnline(): void {
    if (offlineWaiting || deferred) evaluate('online');
  }

  const unsubIdle = deps.onSubmittingIdle(() => {
    if (deferred || offlineWaiting) evaluate('idle');
  });

  doc.addEventListener('visibilitychange', onVisibility, { signal: ac.signal });
  win.addEventListener('pageshow', onPageShow, { signal: ac.signal });
  doc.addEventListener('focusout', onFocusOut, { signal: ac.signal });
  win.addEventListener('popstate', onPopState, { signal: ac.signal });
  win.addEventListener('online', onOnline, { signal: ac.signal });

  markConfigRead(deps.now());
  if (lastConfig) evaluate('load');

  return () => {
    stopped = true;
    generation += 1;
    ac.abort();
    stopPoll();
    clearCooldown();
    unsubIdle();
    deferred = false;
    offlineWaiting = false;
  };
}
