// 事件額度與停錶次數。門檻沿用畫面預覽的常數。

import {
  EVENT_MAX,
  EVENT_RESERVE,
  EVENT_WARN,
  PAUSE_MAX,
  SCORING_RESERVE,
} from '../present';
import { entryInEpoch } from './derive';
import type { ActionKind, BudgetView, ClockActionName, Intent, LogEntry, ServerEvent } from './types';

const CONTROL: ReadonlySet<ActionKind> = new Set([
  'kickoff',
  'halftime',
  'resume',
  'fulltime',
  'undoFinish',
]);

export function eventUsed(rev: number, resetRev: number, inflightLocal: number): number {
  return Math.max(0, rev - resetRev) + Math.max(0, inflightLocal);
}

/**
 * 伺服器 clock 事件（seq > resetRev）每兩筆算一次，再加上本機還沒落地的停錶。
 * stopsClock 為真時，伺服器上的 timeout 也各算一次（事件本身沒有停錶旗標，只能看當下規則）。
 * 本機待送且帶 stopClock 的 timeout 一律算，跟這個旗標無關。
 */
export function pauseUseCount(
  events: readonly ServerEvent[],
  entries: readonly LogEntry[],
  resetRev: number,
  stopsClock = false,
): number {
  let clocks = 0;
  let serverTimeouts = 0;
  for (const event of events) {
    if (event.seq <= resetRev) continue;
    if (event.type === 'clock') clocks += 1;
    if (stopsClock && event.type === 'timeout') serverTimeouts += 1;
  }
  let pendingPauses = 0;
  // 本機快照（離線延遲補償）已讀進 events 的待送項目不重算（依 op 去重；預演離線疊加修正同一批）。
  const serverOps = new Set(events.map((event) => event.op));
  for (const entry of entries) {
    if (!entryInEpoch(entry, resetRev)) continue;
    if (entry.state !== 'pending' && entry.state !== 'sending') continue;
    if (serverOps.has(entry.op)) continue;
    if (entry.kind === 'clock' && entry.intent.kind === 'clock' && entry.intent.clockAction === 'pause') {
      pendingPauses += 1;
    }
    if (entry.kind === 'timeout' && entry.intent.kind === 'timeout' && entry.intent.stopClock) {
      pendingPauses += 1;
    }
  }
  return Math.floor(clocks / 2) + pendingPauses + serverTimeouts;
}

/** 待送筆數。傳 rev 時，已排定 seq 且被快照 rev 涵蓋的不算（rev 已含它，避免事件額度多算一筆）。 */
export function localInflightCount(entries: readonly LogEntry[], resetRev = 0, rev?: number): number {
  let n = 0;
  for (const entry of entries) {
    if (!entryInEpoch(entry, resetRev)) continue;
    if (entry.state !== 'pending' && entry.state !== 'sending') continue;
    if (rev != null && entry.seq != null && entry.seq <= rev) continue;
    n += 1;
  }
  return n;
}

export function budgetView(
  rev: number,
  resetRev: number,
  entries: readonly LogEntry[],
  events: readonly ServerEvent[],
  stopsClock = false,
): BudgetView {
  const used = eventUsed(rev, resetRev, localInflightCount(entries, resetRev, rev));
  const pauseUses = pauseUseCount(events, entries, resetRev, stopsClock);
  const pauseEnabled = used <= EVENT_MAX - SCORING_RESERVE && pauseUses < PAUSE_MAX;
  return {
    used,
    pauseUses,
    pauseLeft: Math.max(0, PAUSE_MAX - pauseUses),
    pauseEnabled,
    nearLimit: used >= EVENT_WARN,
    controlsOnly: used >= EVENT_RESERVE,
    exhausted: used >= EVENT_MAX,
  };
}

export function actionAllowed(
  kind: ActionKind,
  budget: BudgetView,
  clockAction?: ClockActionName,
): boolean {
  if (budget.exhausted) return false;
  if (budget.controlsOnly) return CONTROL.has(kind);
  if (clockAction === 'pause' && !budget.pauseEnabled) return false;
  return true;
}

export function isControlKind(kind: ActionKind): boolean {
  return CONTROL.has(kind);
}

/**
 * 多步動作先加總整組筆數。已用含本機待送。
 * 投影超過 200 整組不寫；非比賽控制且投影超過 190 整組不寫；停錶次數加上整組停錶超過 20 也不寫。
 */
export function groupWithinBudget(intents: readonly Intent[], budget: BudgetView): boolean {
  const count = intents.length;
  if (count === 0) return true;
  const projected = budget.used + count;
  if (projected > EVENT_MAX) return false;
  const needsScore = intents.some((intent) => !CONTROL.has(intent.kind));
  if (needsScore && projected > EVENT_RESERVE) return false;
  let pauses = 0;
  for (const intent of intents) {
    if (intent.kind === 'clock' && intent.clockAction === 'pause') pauses += 1;
    if (intent.kind === 'timeout' && intent.stopClock) pauses += 1;
  }
  if (pauses === 0) return true;
  if (budget.used > EVENT_MAX - SCORING_RESERVE) return false;
  if (budget.pauseUses + pauses > PAUSE_MAX) return false;
  return true;
}
