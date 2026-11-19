// 由時間軸推出作廢與第二黃引用。比分疊加只看日誌裡還沒落地的動作。

import { LIVE_COPY } from '../copy';
import { compareEntries } from './action-log';
import type {
  GroupView,
  LogEntry,
  ScoreView,
  ServerClock,
  ServerEvent,
  ServerMatch,
  Side,
} from './types';
import type { VoidMark } from '../types';

export function voidsFromTimeline(events: readonly ServerEvent[]): VoidMark[] {
  const out: VoidMark[] = [];
  for (const event of events) {
    if (event.type !== 'void' || event.targetSeq == null) continue;
    out.push({ targetSeq: event.targetSeq, seq: event.seq, createdAt: event.createdAt });
  }
  return out;
}

/** 給既有畫面元件用的作廢標記。 */
export function voidsAsMarks(events: readonly ServerEvent[]): VoidMark[] {
  return voidsFromTimeline(events);
}

export function voidedSeqs(events: readonly ServerEvent[]): Set<number> {
  const out = new Set<number>();
  for (const mark of voidsFromTimeline(events)) out.add(mark.targetSeq);
  return out;
}

/**
 * 還沒作廢的第二黃指向的第一黃 seq。
 * 第二黃自己被作廢後，第一黃就不再算被引用。
 */
/** 項目建立時的重置線不低於目前 resetRev，才屬於這一場。缺 baseResetRev 視為 0。 */
export function entryInEpoch(entry: LogEntry, resetRev: number): boolean {
  return (entry.baseResetRev ?? 0) >= resetRev;
}

export function activeYellowRefs(events: readonly ServerEvent[], resetRev = 0): Map<number, number> {
  const voided = voidedSeqs(events);
  const refs = new Map<number, number>();
  for (const event of events) {
    if (event.seq <= resetRev) continue;
    if (event.type !== 'card' || event.cardType !== 'second_yellow' || event.refSeq == null) continue;
    if (event.refSeq <= resetRev) continue;
    if (voided.has(event.seq)) continue;
    refs.set(event.refSeq, event.seq);
  }
  return refs;
}

export interface OpenYellow {
  seq: number | null;
  op: string | null;
  side: Side;
  plId: string;
}

function pendingVoidTargets(entries: readonly LogEntry[]): { seqs: Set<number>; ops: Set<string> } {
  const seqs = new Set<number>();
  const ops = new Set<string>();
  for (const entry of entries) {
    if (entry.intent.kind !== 'void') continue;
    if (entry.state !== 'pending' && entry.state !== 'sending') continue;
    if (entry.intent.targetSeq != null) seqs.add(entry.intent.targetSeq);
    if (entry.intent.targetOp) ops.add(entry.intent.targetOp);
  }
  return { seqs, ops };
}

/**
 * 同人未作廢、未被有效第二黃引用的黃牌。
 * 日誌裡 pending 的黃牌算進去，pending 的作廢扣掉。
 */
export function findOpenYellow(
  plId: string,
  side: Side,
  events: readonly ServerEvent[],
  entries: readonly LogEntry[],
  resetRev = 0,
): OpenYellow | null {
  events = events.filter((event) => event.seq > resetRev);
  entries = entries.filter((entry) => entryInEpoch(entry, resetRev));
  const voided = voidedSeqs(events);
  const pendingVoids = pendingVoidTargets(entries);
  const refs = activeYellowRefs(events);
  const referencedOps = new Set<string>();
  for (const entry of entries) {
    if (entry.state !== 'pending' && entry.state !== 'sending') continue;
    const intent = entry.intent;
    if (intent.kind !== 'card' || intent.cardType !== 'second_yellow') continue;
    if (intent.refSeq != null) refs.set(intent.refSeq, -1);
    const refOp = intent.refOp;
    if (refOp) {
      referencedOps.add(refOp);
      const host = entries.find((item) => item.op === refOp);
      if (host?.seq != null) refs.set(host.seq, -1);
    }
  }

  const opens: OpenYellow[] = [];
  for (const event of events) {
    if (event.type !== 'card' || event.cardType !== 'yellow') continue;
    if (event.plId !== plId || event.side !== side) continue;
    if (voided.has(event.seq) || pendingVoids.seqs.has(event.seq)) continue;
    if (refs.has(event.seq)) continue;
    opens.push({ seq: event.seq, op: event.op, side, plId });
  }
  for (const entry of entries) {
    if (entry.state !== 'pending' && entry.state !== 'sending') continue;
    if (pendingVoids.ops.has(entry.op) || referencedOps.has(entry.op)) continue;
    if (entry.intent.kind !== 'card' || entry.intent.cardType !== 'yellow') continue;
    if (entry.intent.plId !== plId || entry.intent.side !== side) continue;
    if (entry.seq != null && (voided.has(entry.seq) || refs.has(entry.seq))) continue;
    opens.push({ seq: entry.seq ?? null, op: entry.op, side, plId });
  }
  opens.sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER));
  return opens[0] ?? null;
}

function goalSideOf(entry: LogEntry, events: readonly ServerEvent[], entries: readonly LogEntry[]): Side | null {
  const intent = entry.intent;
  if (intent.kind !== 'void') return null;
  const targetSeq = intent.targetSeq;
  const targetOp = intent.targetOp;
  if (targetSeq != null) {
    const found = events.find((event) => event.seq === targetSeq);
    if (found?.type === 'goal' && found.side) return found.side;
    const logged = entries.find((item) => item.seq === targetSeq && item.intent.kind === 'goal');
    if (logged?.intent.kind === 'goal') return logged.intent.side;
  }
  if (targetOp) {
    const logged = entries.find((item) => item.op === targetOp);
    if (logged?.intent.kind === 'goal') return logged.intent.side;
  }
  return null;
}

export function overlayScore(
  match: Pick<ServerMatch, 'score' | 'clockBase' | 'rev'> & { resetRev?: number },
  events: readonly ServerEvent[],
  entries: readonly LogEntry[],
): { score: { home: number; away: number }; clockBase: ServerClock; pendingCount: number } {
  const resetRev = match.resetRev ?? 0;
  const fresh = (entry: LogEntry) => entryInEpoch(entry, resetRev);
  const score = { home: match.score.home, away: match.score.away };
  let clockBase: ServerClock = { ...match.clockBase };
  // 快照 rev 還沒追上的已套用項目仍要疊加，避免比分或時鐘先退回去。
  const ahead = entries
    .filter((entry) => fresh(entry) && entry.state === 'applied' && entry.seq != null && entry.seq > match.rev)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || compareEntries(a, b));
  const pending = entries
    .filter((entry) => fresh(entry) && (entry.state === 'pending' || entry.state === 'sending'))
    .sort(compareEntries);
  for (const entry of [...ahead, ...pending]) {
    if (entry.intent.kind === 'goal') score[entry.intent.side] += 1;
    if (entry.intent.kind === 'void') {
      const side = goalSideOf(entry, events, entries);
      if (side) score[side] -= 1;
    }
    if (entry.intent.kind === 'clock') clockBase = { ...entry.intent.clock };
    if (
      entry.intent.kind === 'kickoff'
      || entry.intent.kind === 'halftime'
      || entry.intent.kind === 'resume'
      || entry.intent.kind === 'fulltime'
      || entry.intent.kind === 'undoFinish'
    ) {
      clockBase = { ...entry.intent.clock };
    }
  }
  return { score, clockBase, pendingCount: pending.length };
}

export function scoreView(match: ServerMatch, events: readonly ServerEvent[], entries: readonly LogEntry[]): ScoreView {
  const over = overlayScore(match, events, entries);
  return {
    home: over.score.home,
    away: over.score.away,
    pendingCount: over.pendingCount,
    server: { home: match.score.home, away: match.score.away },
  };
}

export function fulltimeBlocked(entries: readonly LogEntry[]): boolean {
  for (const entry of entries) {
    if (!entry.group) continue;
    if (entry.state !== 'applied' && entry.state !== 'discarded') return true;
  }
  return false;
}

export function groupMessage(list: readonly LogEntry[]): string | null {
  if (list.length === 0) return null;
  const label = list[0]?.group?.label;
  const step = (index: number) => list.find((entry) => entry.group?.index === index);
  const open = (entry: LogEntry | undefined) => !!entry && entry.state !== 'applied' && entry.state !== 'discarded';
  if (label === 'amend') {
    if (step(0)?.state === 'applied' && open(step(1))) return LIVE_COPY.amendHalf;
    return null;
  }
  if (label === 'undoFirstYellow') {
    if (step(0)?.state === 'rejected') return LIVE_COPY.undoSecondFailed;
    if (step(0)?.state === 'applied' && open(step(1))) return LIVE_COPY.undoHalf;
  }
  if (label === 'amendFirstYellow') {
    if (step(0)?.state === 'rejected') return LIVE_COPY.undoSecondFailed;
    if (step(0)?.state === 'applied' && open(step(1))) return LIVE_COPY.undoHalf;
    // 兩張黃牌都已復原，新紀錄這一步被拒或還沒送出。
    if (step(1)?.state === 'applied' && open(step(2))) return LIVE_COPY.amendHalf;
  }
  return null;
}

export function groupViews(entries: readonly LogEntry[]): GroupView[] {
  const map = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    if (!entry.group) continue;
    const list = map.get(entry.group.id) ?? [];
    list.push(entry);
    map.set(entry.group.id, list);
  }
  const out: GroupView[] = [];
  for (const list of map.values()) {
    list.sort((a, b) => (a.group?.index ?? 0) - (b.group?.index ?? 0));
    const group = list[0]?.group;
    if (!group) continue;
    out.push({
      id: group.id,
      label: group.label,
      size: group.size,
      applied: list.filter((entry) => entry.state === 'applied').length,
      message: groupMessage(list),
      ops: list.map((entry) => entry.op),
    });
  }
  return out;
}

export function unappliedSummary(entry: LogEntry): string {
  const intent = entry.intent;
  const side = 'side' in intent ? (intent.side === 'home' ? '主隊' : '客隊') : '';
  if (intent.kind === 'goal') return `${side} 進球`;
  if (intent.kind === 'card') {
    const name = intent.cardType === 'yellow' ? '黃牌' : intent.cardType === 'red' ? '紅牌' : '第二張黃牌';
    return `${side} ${name}`;
  }
  if (intent.kind === 'sub') return `${side} 換人`;
  if (intent.kind === 'void') return '復原';
  if (intent.kind === 'clock') {
    if (intent.clockAction === 'pause') return '停錶';
    if (intent.clockAction === 'resume') return '繼續計時';
    return '修正時鐘';
  }
  if (intent.kind === 'kickoff') return '開賽';
  if (intent.kind === 'halftime') return '半場';
  if (intent.kind === 'resume') return '下半場開始';
  if (intent.kind === 'fulltime') return '終場';
  return '撤回終場';
}

/**
 * 仍然有效的第二黃。事件軸用 activeYellowRefs（已排除作廢），
 * 日誌裡的第二黃同樣排除已作廢與待送作廢。
 */
export function liveSecondYellow(
  target: { seq?: number; op?: string },
  events: readonly ServerEvent[],
  entries: readonly LogEntry[],
  resetRev = 0,
): { seq?: number; op?: string } | null {
  const lineEvents = events.filter((event) => event.seq > resetRev);
  const lineEntries = entries.filter((entry) => entryInEpoch(entry, resetRev));
  const voided = voidedSeqs(lineEvents);
  const pending = pendingVoidTargets(lineEntries);
  if (target.seq != null && target.seq > resetRev) {
    const secondSeq = activeYellowRefs(lineEvents, resetRev).get(target.seq);
    if (secondSeq != null && !pending.seqs.has(secondSeq)) return { seq: secondSeq };
  }
  for (const entry of lineEntries) {
    if (entry.state !== 'pending' && entry.state !== 'sending' && entry.state !== 'applied') continue;
    if (entry.intent.kind !== 'card' || entry.intent.cardType !== 'second_yellow') continue;
    if (entry.seq != null && (voided.has(entry.seq) || pending.seqs.has(entry.seq))) continue;
    if (pending.ops.has(entry.op)) continue;
    const hitSeq = target.seq != null && entry.intent.refSeq === target.seq;
    const hitOp = !!target.op && entry.intent.refOp === target.op;
    if (!hitSeq && !hitOp) continue;
    return { seq: entry.seq, op: entry.op };
  }
  return null;
}

export function linkModeFor(
  refSeq: number,
  events: readonly ServerEvent[],
  entries: readonly LogEntry[],
): 'create' | 'update' {
  for (const event of events) {
    if (event.type === 'card' && event.cardType === 'second_yellow' && event.refSeq === refSeq) return 'update';
  }
  for (const entry of entries) {
    if (entry.state !== 'applied' || entry.intent.kind !== 'card') continue;
    if (entry.intent.cardType === 'second_yellow' && (entry.intent.refSeq === refSeq || entry.seq === refSeq)) {
      if (entry.intent.refSeq === refSeq) return 'update';
    }
  }
  return 'create';
}

export function eventFromApplied(entry: LogEntry): ServerEvent | null {
  if (entry.seq == null) return null;
  const base: ServerEvent = {
    seq: entry.seq,
    type: entry.kind,
    op: entry.op,
    sid: entry.sid,
    matchSecond: entry.intent.matchSecond,
    createdAt: entry.createdAt,
  };
  const intent = entry.intent;
  if (intent.kind === 'goal') {
    base.side = intent.side;
    base.plId = intent.plId;
    base.goalKind = intent.goalKind;
  } else if (intent.kind === 'card') {
    base.side = intent.side;
    base.plId = intent.plId;
    base.cardType = intent.cardType;
    if (intent.refSeq != null) base.refSeq = intent.refSeq;
  } else if (intent.kind === 'sub') {
    base.side = intent.side;
    base.inPlId = intent.inPlId;
    base.outPlId = intent.outPlId;
  } else if (intent.kind === 'void' && intent.targetSeq != null) {
    base.targetSeq = intent.targetSeq;
  }
  return base;
}

export function mergedEvents(known: readonly ServerEvent[], entries: readonly LogEntry[]): ServerEvent[] {
  const map = new Map<number, ServerEvent>();
  for (const event of known) map.set(event.seq, event);
  for (const entry of entries) {
    if (entry.state !== 'applied' || entry.seq == null || map.has(entry.seq)) continue;
    const synth = eventFromApplied(entry);
    if (synth) map.set(entry.seq, synth);
  }
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}
