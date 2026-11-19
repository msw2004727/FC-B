// 事件額度與停錶次數。門檻沿用畫面預覽的常數。

import {
  EVENT_MAX,
  EVENT_RESERVE,
  EVENT_WARN,
  PAUSE_MAX,
  SCORING_RESERVE,
} from '../present';
import type { ActionKind, BudgetView, ClockActionName, LogEntry, ServerEvent } from './types';

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

/** 伺服器 clock 事件（seq > resetRev）每兩筆算一次，再加上本機還沒落地的停錶。 */
export function pauseUseCount(events: readonly ServerEvent[], entries: readonly LogEntry[], resetRev: number): number {
  let clocks = 0;
  for (const event of events) {
    if (event.type === 'clock' && event.seq > resetRev) clocks += 1;
  }
  let pendingPauses = 0;
  for (const entry of entries) {
    if (entry.kind !== 'clock') continue;
    if (entry.state !== 'pending' && entry.state !== 'sending') continue;
    if (entry.intent.kind === 'clock' && entry.intent.clockAction === 'pause') pendingPauses += 1;
  }
  return Math.floor(clocks / 2) + pendingPauses;
}

export function localInflightCount(entries: readonly LogEntry[]): number {
  let n = 0;
  for (const entry of entries) {
    if (entry.state === 'pending' || entry.state === 'sending') n += 1;
  }
  return n;
}

export function budgetView(
  rev: number,
  resetRev: number,
  entries: readonly LogEntry[],
  events: readonly ServerEvent[],
): BudgetView {
  const used = eventUsed(rev, resetRev, localInflightCount(entries));
  const pauseUses = pauseUseCount(events, entries, resetRev);
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
