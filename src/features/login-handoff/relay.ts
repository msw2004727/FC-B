import { callFn } from '@/data/callables';

import { pairingOptions } from './pairing';
import { renderRelay, type RelayHandlers } from './view';

export interface RelayInput {
  handoffId: string;
  code: string;
  liffClientId: string;
  liffRedirectUri: string | null;
}

interface RelayState {
  handoffId: string;
  code: string;
  liffClientId: string;
  liffRedirectUri: string;
  options: number[];
  busy: boolean;
  tryLater: boolean;
  lastPick: number | null;
}

let relay: RelayState | null = null;

const relayHandlers: RelayHandlers = {
  onPick(n: number) { void onPick(n); },
  onRetry() { void onRetry(); },
  onClose() { onClose(); },
};

export async function beginRelay(input: RelayInput): Promise<void> {
  if (!input.liffRedirectUri) {
    relay = null;
    renderRelay({ kind: 'wrong' }, relayHandlers);
    return;
  }
  const options = await pairingOptions(input.handoffId);
  relay = {
    handoffId: input.handoffId,
    code: input.code,
    liffClientId: input.liffClientId,
    liffRedirectUri: input.liffRedirectUri,
    options,
    busy: false,
    tryLater: false,
    lastPick: null,
  };
  paint();
}

export function _resetRelayForTest(): void {
  relay = null;
}

async function onPick(n: number): Promise<void> {
  if (!relay || relay.busy) return;
  await send(n);
}

async function onRetry(): Promise<void> {
  if (!relay || relay.busy || relay.lastPick === null) return;
  await send(relay.lastPick);
}

function onClose(): void {
  relay = null;
  renderRelay(null, relayHandlers);
}

async function send(n: number): Promise<void> {
  if (!relay || relay.busy) return;
  relay.lastPick = n;
  relay.busy = true;
  relay.tryLater = false;
  paint();
  const current = relay;
  try {
    const res = await callFn('lineLoginHandoff', {
      op: 'relay',
      handoffId: current.handoffId,
      code: current.code,
      liffClientId: current.liffClientId,
      liffRedirectUri: current.liffRedirectUri,
      pick: String(n),
    });
    if (relay !== current) return;
    relay.busy = false;
    if (res && typeof res === 'object' && 'ok' in res && res.ok === true) {
      relay = null;
      renderRelay({ kind: 'done' }, relayHandlers);
      return;
    }
    relay = null;
    renderRelay({ kind: 'wrong' }, relayHandlers);
  } catch (err) {
    if (relay !== current) return;
    relay.busy = false;
    const code = callableCode(err);
    if (code === 'failed-precondition') {
      relay = null;
      renderRelay({ kind: 'sentOrExpired' }, relayHandlers);
      return;
    }
    // 只有 invalid-argument 當成數字不符。其餘錯誤（internal、deadline-exceeded、unknown、
    // 無 code、resource-exhausted、unavailable）都留同一個數字可重試：網路失敗時 Firebase
    // 回 internal、逾時回 deadline-exceeded，伺服器可能根本沒收到。
    // 重試安全：伺服器用 create()。同一個正確數字再送得到 failed-precondition（畫面
    // sentOrExpired）；同一個錯誤數字再送得到 mismatch（畫面 wrong）。
    if (code === 'invalid-argument') {
      relay = null;
      renderRelay({ kind: 'wrong' }, relayHandlers);
      return;
    }
    relay.tryLater = true;
    paint();
  }
}

function paint(): void {
  if (!relay) return;
  renderRelay({
    kind: 'pick',
    options: relay.options,
    busy: relay.busy,
    tryLater: relay.tryLater,
  }, relayHandlers);
}

function callableCode(err: unknown): string {
  if (!err || typeof err !== 'object') return 'network';
  const code = (err as { code?: unknown }).code;
  if (typeof code !== 'string' || code.length === 0) return 'network';
  const slash = code.lastIndexOf('/');
  return slash >= 0 ? code.slice(slash + 1) : code;
}
