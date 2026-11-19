import { callFn } from '@/data/callables';

import { replacePage } from './nav';
import { sha256Hex, pairingNumber } from './pairing';
import { HANDOFF_TTL_MS, PENDING_DISCARD_MS, clearPending, readPending, type PendingHandoff } from './pending';
import { renderWait, type WaitHandlers } from './view';

const POLL_MS = 6000;
const BUSY_MS = 3000;
const BACKOFF_MS = [10_000, 20_000, 40_000, 60_000] as const;

type Outcome = 'success' | 'not-found' | 'backoff' | 'timeout' | 'skipped' | 'stopped';

interface Loop {
  secret: string;
  createdAt: number;
  expiresAt: number;
  number: number;
  stopped: boolean;
  inflight: boolean;
  backoffIndex: number;
  coldStarted: boolean;
  foregroundClaimed: boolean;
  view: 'wait' | 'notYet' | 'hidden';
  busyUntil: number;
  timer: ReturnType<typeof setTimeout> | null;
  busyTimer: ReturnType<typeof setTimeout> | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
}

let loop: Loop | null = null;
let visHandler: (() => void) | null = null;
let buttonQueued = false;
let firstPromise: Promise<void> | null = null;

export const waitHandlers: WaitHandlers = {
  onDone() { void pressDone(); },
  onRetry() { void pressDone(); },
  onRestart() { pressRestart(); },
  onClose() { pressClose(); },
};

/** 畫出等待框並在前景冷開一次。不保證等網路回來。 */
export async function showWaitForPending(): Promise<boolean> {
  const ready = await arm();
  if (!ready || !loop || loop.stopped) return ready;
  if (!firstPromise && !loop.coldStarted && document.visibilityState === 'visible') {
    loop.coldStarted = true;
    loop.foregroundClaimed = true;
    const running = firstClaimBody().finally(() => {
      if (firstPromise === running) firstPromise = null;
    });
    firstPromise = running;
  }
  return true;
}

/** 顯示等待框、冷開 claim，並等到那一次請求結束。 */
export async function beginClaim(): Promise<void> {
  await showWaitForPending();
  if (firstPromise) await firstPromise;
}

export function _resetClaimForTest(): void {
  buttonQueued = false;
  firstPromise = null;
  stopLoop();
}

async function arm(): Promise<boolean> {
  if (loop && !loop.stopped) {
    paint();
    return true;
  }
  const pending = readPending();
  if (!pending) return false;
  if (Date.now() - pending.createdAt > PENDING_DISCARD_MS) {
    clearPending();
    return false;
  }
  if (Date.now() >= pending.createdAt + HANDOFF_TTL_MS) {
    clearPending();
    renderWait({ kind: 'timeout' }, waitHandlers);
    return false;
  }
  const number = await pairingNumber(await sha256Hex(pending.secret));
  if (loop && !loop.stopped) {
    paint();
    return true;
  }
  loop = makeLoop(pending, number);
  paint();
  bindVis();
  armExpiry();
  return true;
}

function makeLoop(pending: PendingHandoff, number: number): Loop {
  return {
    secret: pending.secret,
    createdAt: pending.createdAt,
    expiresAt: pending.createdAt + HANDOFF_TTL_MS,
    number,
    stopped: false,
    inflight: false,
    backoffIndex: 0,
    coldStarted: false,
    foregroundClaimed: false,
    view: 'wait',
    busyUntil: 0,
    timer: null,
    busyTimer: null,
    expiryTimer: null,
  };
}

async function firstClaimBody(): Promise<void> {
  const outcome = await afterClaim('poll');
  scheduleFrom(outcome);
}

function bindVis(): void {
  removeVis();
  visHandler = () => { onVis(); };
  document.addEventListener('visibilitychange', visHandler);
}

function removeVis(): void {
  if (!visHandler) return;
  document.removeEventListener('visibilitychange', visHandler);
  visHandler = null;
}

function onVis(): void {
  if (!loop || loop.stopped) return;
  if (document.visibilityState !== 'visible') {
    loop.foregroundClaimed = false;
    return;
  }
  if (loop.foregroundClaimed) return;
  loop.foregroundClaimed = true;
  if (loop.timer) {
    clearTimeout(loop.timer);
    loop.timer = null;
  }
  void (async () => {
    const outcome = await afterClaim('poll');
    scheduleFrom(outcome);
  })();
}

function armExpiry(): void {
  if (!loop || loop.stopped) return;
  const remain = loop.expiresAt - Date.now();
  loop.expiryTimer = setTimeout(() => { finishTimeout(); }, Math.max(0, remain));
}

function schedulePoll(delay: number): void {
  if (!loop || loop.stopped) return;
  if (loop.timer) clearTimeout(loop.timer);
  const remain = loop.expiresAt - Date.now();
  if (remain <= 0) {
    finishTimeout();
    return;
  }
  loop.timer = setTimeout(() => { void onPoll(); }, Math.min(delay, remain));
}

async function onPoll(): Promise<void> {
  if (!loop || loop.stopped) return;
  loop.timer = null;
  if (Date.now() >= loop.expiresAt) {
    finishTimeout();
    return;
  }
  if (document.visibilityState !== 'visible') return;
  const outcome = await afterClaim('poll');
  scheduleFrom(outcome);
}

function scheduleFrom(outcome: Outcome): void {
  if (!loop || loop.stopped) return;
  if (outcome === 'skipped' || outcome === 'success' || outcome === 'timeout' || outcome === 'stopped') return;
  if (outcome === 'backoff') {
    const delay = backoffDelay(loop.backoffIndex);
    loop.backoffIndex += 1;
    schedulePoll(delay);
    return;
  }
  schedulePoll(POLL_MS);
}

function backoffDelay(index: number): number {
  const clamped = Math.min(Math.max(index, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[clamped] ?? 60_000;
}

async function afterClaim(source: 'poll' | 'button'): Promise<Outcome> {
  const outcome = await runClaim(source);
  if (outcome === 'skipped') return outcome;
  if (buttonQueued && loop && !loop.stopped && outcome !== 'success' && outcome !== 'timeout') {
    buttonQueued = false;
    return afterClaim('button');
  }
  return outcome;
}

async function runClaim(source: 'poll' | 'button'): Promise<Outcome> {
  if (!loop || loop.stopped) return 'stopped';
  if (Date.now() >= loop.expiresAt) {
    finishTimeout();
    return 'timeout';
  }
  if (loop.inflight) {
    if (source === 'button') buttonQueued = true;
    return 'skipped';
  }
  loop.inflight = true;
  try {
    const res = await callFn('lineLoginHandoff', { op: 'claim', handoffSecret: loop.secret });
    if (!loop || loop.stopped) return 'stopped';
    const payload = readClaimPayload(res);
    if (!payload) return 'backoff';
    const url = successUrl(payload);
    if (url === null) {
      finishTimeout();
      return 'timeout';
    }
    finishSuccess(url);
    return 'success';
  } catch (err) {
    if (!loop || loop.stopped) return 'stopped';
    if (Date.now() >= loop.expiresAt) {
      finishTimeout();
      return 'timeout';
    }
    if (callableCode(err) === 'not-found') {
      loop.backoffIndex = 0;
      if (source === 'button') {
        loop.view = 'notYet';
        paint();
      }
      return 'not-found';
    }
    return 'backoff';
  } finally {
    if (loop) loop.inflight = false;
  }
}

function readClaimPayload(res: unknown): { code: string; liffClientId: string; liffRedirectUri: string } | null {
  if (!res || typeof res !== 'object') return null;
  const rec = res as { code?: unknown; liffClientId?: unknown; liffRedirectUri?: unknown };
  if (typeof rec.code !== 'string' || typeof rec.liffClientId !== 'string' || typeof rec.liffRedirectUri !== 'string') {
    return null;
  }
  return { code: rec.code, liffClientId: rec.liffClientId, liffRedirectUri: rec.liffRedirectUri };
}

function successUrl(payload: { code: string; liffClientId: string; liffRedirectUri: string }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(payload.liffRedirectUri);
  } catch {
    return null;
  }
  if (parsed.origin !== location.origin) return null;
  const original = payload.liffRedirectUri;
  parsed.searchParams.delete('fcbHandoff');
  parsed.searchParams.set('code', payload.code);
  parsed.searchParams.set('liffClientId', payload.liffClientId);
  parsed.searchParams.set('liffRedirectUri', original);
  return parsed.toString();
}

function finishSuccess(url: string): void {
  if (!loop || loop.stopped) return;
  loop.stopped = true;
  clearTimers(loop);
  removeVis();
  loop = null;
  clearPending();
  try {
    replacePage(url);
  } catch {
    renderWait({ kind: 'timeout' }, waitHandlers);
  }
}

function finishTimeout(): void {
  if (!loop || loop.stopped) return;
  loop.stopped = true;
  clearTimers(loop);
  removeVis();
  loop = null;
  clearPending();
  renderWait({ kind: 'timeout' }, waitHandlers);
}

function stopLoop(): void {
  if (loop) {
    loop.stopped = true;
    clearTimers(loop);
  }
  removeVis();
  loop = null;
}

function clearTimers(current: Loop): void {
  if (current.timer) clearTimeout(current.timer);
  if (current.busyTimer) clearTimeout(current.busyTimer);
  if (current.expiryTimer) clearTimeout(current.expiryTimer);
  current.timer = null;
  current.busyTimer = null;
  current.expiryTimer = null;
}

async function pressDone(): Promise<void> {
  if (!loop || loop.stopped) {
    await showWaitForPending();
    return;
  }
  if (Date.now() < loop.busyUntil) return;
  loop.busyUntil = Date.now() + BUSY_MS;
  loop.view = 'wait';
  paint();
  armBusyClear();
  if (loop.timer) {
    clearTimeout(loop.timer);
    loop.timer = null;
  }
  const outcome = await afterClaim('button');
  if (outcome === 'skipped') return;
  scheduleFrom(outcome);
}

function armBusyClear(): void {
  if (!loop) return;
  if (loop.busyTimer) clearTimeout(loop.busyTimer);
  const left = loop.busyUntil - Date.now();
  loop.busyTimer = setTimeout(() => {
    if (!loop || loop.view !== 'wait') return;
    paint();
  }, Math.max(0, left));
}

function pressRestart(): void {
  stopLoop();
  clearPending();
  renderWait(null, waitHandlers);
  void import('@/data/auth').then(async (auth) => {
    try {
      await auth.signIn();
    } catch (err) {
      if (!auth.isLoginRedirectingError(err)) throw err;
    }
  });
}

function pressClose(): void {
  if (loop && !loop.stopped) loop.view = 'hidden';
  renderWait(null, waitHandlers);
}

function paint(): void {
  if (!loop || loop.stopped) return;
  if (loop.view === 'hidden') {
    renderWait(null, waitHandlers);
    return;
  }
  if (loop.view === 'notYet') {
    renderWait({ kind: 'notYet', number: loop.number, expiresAt: loop.expiresAt }, waitHandlers);
    return;
  }
  renderWait({
    kind: 'wait',
    number: loop.number,
    expiresAt: loop.expiresAt,
    busy: Date.now() < loop.busyUntil,
  }, waitHandlers);
}

function callableCode(err: unknown): string {
  if (!err || typeof err !== 'object') return 'network';
  const code = (err as { code?: unknown }).code;
  if (typeof code !== 'string' || code.length === 0) return 'network';
  const slash = code.lastIndexOf('/');
  return slash >= 0 ? code.slice(slash + 1) : code;
}
