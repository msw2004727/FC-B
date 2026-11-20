// 依序送出、對帳、被拒原因。S1／S2／S3 見 decideRetry。

import type { ActionLog } from './action-log';
import { buildBatch } from './batch';
import { eventFromApplied, linkModeFor, mergedEvents } from './derive';
import type {
  DecideEntry,
  DecideServer,
  LogEntry,
  LogPatch,
  RejectReason,
  RetryDecision,
  ScoringPort,
  ServerControl,
  ServerEvent,
  ServerMatch,
} from './types';

/**
 * S1：已取號就沿用原 seq。
 * 重置分界排在 S2 之前：伺服器 resetRev 比項目建立時的 baseResetRev 大，一律丟棄，不換號、不重送。
 * S2：只有 rev >= seq 且 e{seq} 不存在或 op 不是自己，才換新 seq。
 * S3：原 commit 還沒結束就 inflight，不得重送。已經對到自己的 op 則直接 applied。
 */
export function decideRetry(entry: DecideEntry, server: DecideServer, inflight: boolean): RetryDecision {
  const resetRev = server.resetRev ?? 0;
  if (resetRev > (entry.baseResetRev ?? 0)) return { kind: 'discard', reason: 'reset' };
  if (server.matchedSeq != null) return { kind: 'applied', seq: server.matchedSeq };
  if (entry.seq != null && server.eventAtSeq?.op === entry.op) return { kind: 'applied', seq: entry.seq };
  if (inflight) return { kind: 'inflight' };
  if (entry.seq == null) return { kind: 'assign' };
  const seq = entry.seq;
  if (server.rev >= seq && (server.eventAtSeq == null || server.eventAtSeq.op !== entry.op)) {
    return { kind: 'resequence' };
  }
  if (server.rev < seq - 1) return { kind: 'wait' };
  return { kind: 'reuse' };
}

/** §4.2 的順序：接手、鎖、上限、衝突，其餘當規則錯。 */
export function classifyReject(input: {
  entrySeq: number;
  localSid: string;
  uid: string;
  match: ServerMatch;
  control: ServerControl | null;
}): RejectReason {
  const control = input.control;
  if (!control || control.uid !== input.uid || control.sid !== input.localSid) return 'takenOver';
  if (input.match.status === 'finished' || input.match.status === 'confirmed' || input.match.lock.locked) {
    return 'locked';
  }
  if (input.match.rev - input.match.resetRev >= 200) return 'limit';
  if (input.match.rev !== input.entrySeq - 1) return 'conflict';
  return 'rules';
}

export function isOfflineError(err: unknown): boolean {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';
  return code === 'unavailable' || code === 'deadline-exceeded'
    || code.endsWith('/unavailable') || code.endsWith('/deadline-exceeded');
}

function resolvedIntent(entry: LogEntry, plan: { event: Record<string, unknown> }): LogEntry['intent'] {
  if (entry.intent.kind === 'card' && typeof plan.event.refSeq === 'number') {
    return { ...entry.intent, refSeq: plan.event.refSeq };
  }
  if (entry.intent.kind === 'void' && typeof plan.event.targetSeq === 'number') {
    return { ...entry.intent, targetSeq: plan.event.targetSeq };
  }
  return entry.intent;
}

function predecessorReady(entry: LogEntry, all: readonly LogEntry[]): boolean {
  if (entry.group) {
    for (const other of all) {
      if (other.group?.id !== entry.group.id) continue;
      if (other.group.index < entry.group.index && other.state !== 'applied') return false;
    }
  }
  const intent = entry.intent;
  if (intent.kind === 'card' && intent.refOp && intent.refSeq == null) {
    const ref = all.find((item) => item.op === intent.refOp);
    if (!ref || ref.state !== 'applied' || ref.seq == null) return false;
  }
  if (intent.kind === 'void' && intent.targetOp && intent.targetSeq == null) {
    const ref = all.find((item) => item.op === intent.targetOp);
    if (!ref || ref.state !== 'applied' || ref.seq == null) return false;
  }
  return true;
}

export type Pick =
  | { kind: 'entry'; entry: LogEntry }
  | { kind: 'rejected' }
  | { kind: 'wait' }
  | { kind: 'none' };

/** 最舊的一筆。前置沒好就暫停，不跳過後面的。有被拒的也先暫停。 */
export function pickNext(entries: readonly LogEntry[]): Pick {
  const open = entries.filter((entry) => entry.state !== 'applied' && entry.state !== 'discarded');
  if (open.length === 0) return { kind: 'none' };
  if (open.some((entry) => entry.state === 'rejected')) return { kind: 'rejected' };
  const queue = open.filter((entry) => entry.state === 'pending' || entry.state === 'sending');
  queue.sort((a, b) => (a.createdAt - b.createdAt) || ((a.group?.index ?? 0) - (b.group?.index ?? 0)));
  const entry = queue[0];
  if (!entry) return { kind: 'none' };
  if (!predecessorReady(entry, entries)) return { kind: 'wait' };
  return { kind: 'entry', entry };
}

export interface SenderOptions {
  log: ActionLog;
  port: ScoringPort;
  uid: string;
  cid: string;
  mtId: string;
  localSid: () => string;
  now: () => number;
}

type Step = 'continue' | 'stop' | 'wait' | 'queued';

export class Sender {
  /** 原 commit 還沒結束的 op。S3：這段時間不得再送同一項。 */
  private readonly inflight = new Set<string>();
  private tail: Promise<void> = Promise.resolve();
  private dead = false;
  /** 第一次發現 sid 不符的時間。這之後新記的動作維持 pending，不標被拒。 */
  blockedAt: number | null = null;
  needsTakeover = false;
  /** 最近一次讀到的伺服器 resetRev。丟棄重置前項目時用。 */
  private serverResetRev = 0;

  constructor(private readonly options: SenderOptions) {}

  stop(): void {
    this.dead = true;
  }

  whenIdle(): Promise<void> {
    return this.tail;
  }

  flush(): Promise<void> {
    if (this.dead) return Promise.resolve();
    const run = this.tail.then(() => this.pump());
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  /** 恢復連線時對進行中的寫入只對帳，不另外 commit。 */
  async reconcileInflight(): Promise<void> {
    const ops = [...this.inflight];
    if (ops.length === 0 || this.dead) return;
    let server: { match: ServerMatch; control: ServerControl | null };
    try {
      server = await this.options.port.loadServer();
    } catch {
      return;
    }
    for (const op of ops) {
      if (this.dead) return;
      const entry = await this.options.log.get(op);
      if (!entry?.seq) continue;
      try {
        const view = await this.look(entry, server.match);
        const decision = decideRetry(entry, view, true);
        if (decision.kind === 'discard') {
          await this.markDiscarded(entry.op);
          continue;
        }
        if (decision.kind === 'applied') await this.markApplied(entry.op, decision.seq);
      } catch {
        // 讀取失敗就留給原 commit。
      }
    }
  }

  /** 重整後：對 sending／已取號的 pending 先對帳，S2 才清 seq。 */
  async recover(): Promise<void> {
    if (this.dead) return;
    let server: { match: ServerMatch; control: ServerControl | null };
    try {
      server = await this.options.port.loadServer();
    } catch {
      return;
    }
    this.noteServer(server.match);
    this.noteControl(server.control);
    await this.discardReset(server.match.resetRev);
    const entries = await this.options.log.list(this.options.cid, this.options.mtId);
    for (const entry of entries) {
      if (this.dead) return;
      if (entry.state !== 'sending' && entry.state !== 'pending') continue;
      if (entry.seq == null && entry.state === 'pending') continue;
      if (this.inflight.has(entry.op)) continue;
      let view: DecideServer;
      try {
        view = await this.look(entry, server.match);
      } catch {
        continue;
      }
      const decision = decideRetry(entry, view, false);
      if (decision.kind === 'discard') {
        await this.markDiscarded(entry.op);
        continue;
      }
      if (decision.kind === 'applied') {
        await this.markApplied(entry.op, decision.seq);
        continue;
      }
      if (decision.kind === 'resequence') {
        await this.patchOpen(entry.op, { state: 'pending', seq: null });
        continue;
      }
      await this.patchOpen(entry.op, { state: 'pending' });
    }
  }

  private noteServer(match: ServerMatch): void {
    this.serverResetRev = match.resetRev;
  }

  /** 重置線以下的項目一律 discarded，原因 reset。已丟棄的不重寫。 */
  private async discardReset(resetRev: number): Promise<void> {
    this.serverResetRev = resetRev;
    if (resetRev <= 0) return;
    const entries = await this.options.log.list(this.options.cid, this.options.mtId);
    for (const entry of entries) {
      if (this.dead) return;
      if (entry.state === 'discarded') continue;
      if (resetRev > (entry.baseResetRev ?? 0)) await this.markDiscarded(entry.op);
    }
  }

  private noteControl(control: ServerControl | null): void {
    const sid = this.options.localSid();
    if (!sid || !control || control.uid !== this.options.uid || control.sid !== sid) {
      this.needsTakeover = true;
      if (this.blockedAt == null) this.blockedAt = this.options.now();
      return;
    }
    this.needsTakeover = false;
  }

  private async pump(): Promise<void> {
    if (this.dead) return;
    await this.recover();
    for (let guard = 0; guard < 80; guard += 1) {
      if (this.dead) return;
      const entries = await this.options.log.list(this.options.cid, this.options.mtId);
      const next = pickNext(entries);
      if (next.kind === 'none' || next.kind === 'rejected' || next.kind === 'wait') return;
      const step = await this.sendOne(next.entry);
      if (step !== 'continue') return;
    }
  }

  private async sendOne(entry: LogEntry): Promise<Step> {
    if (this.dead) return 'stop';
    if (this.inflight.has(entry.op)) return 'wait';
    let server: { match: ServerMatch; control: ServerControl | null };
    try {
      server = await this.options.port.loadServer();
    } catch {
      return 'queued';
    }
    this.noteServer(server.match);
    await this.discardReset(server.match.resetRev);
    this.noteControl(server.control);
    let working = (await this.options.log.get(entry.op)) ?? entry;
    if (working.state === 'discarded') return 'continue';
    if (this.needsTakeover) {
      await this.rejectStaleTakenOver();
      return 'stop';
    }

    if (working.seq != null) {
      let view: DecideServer;
      try {
        view = await this.look(working, server.match);
      } catch {
        return 'queued';
      }
      const decision = decideRetry(working, view, this.inflight.has(working.op));
      if (decision.kind === 'applied') {
        await this.markApplied(working.op, decision.seq);
        return 'continue';
      }
      if (decision.kind === 'inflight' || decision.kind === 'wait') return 'wait';
      if (decision.kind === 'discard') {
        await this.markDiscarded(working.op);
        return 'continue';
      }
      if (decision.kind === 'resequence') {
        const cleared = await this.patchOpen(working.op, { seq: null, state: 'pending' });
        if (cleared) working = cleared;
        try {
          server = await this.options.port.loadServer();
        } catch {
          return 'queued';
        }
        this.noteServer(server.match);
        if (server.match.resetRev > (working.baseResetRev ?? 0)) {
          await this.markDiscarded(working.op);
          return 'continue';
        }
      }
    }

    const seq = working.seq ?? server.match.rev + 1;
    const all = await this.options.log.list(this.options.cid, this.options.mtId);
    const plan = this.planFor(working, seq, server.match, all);
    if (!plan) return 'wait';
    const sid = this.options.localSid();
    const intent = resolvedIntent(working, plan);
    const saved = await this.options.log.patch(working.op, {
      state: 'sending',
      seq,
      attempts: working.attempts + 1,
      sid,
      intent,
    });
    if (!saved || saved.state === 'discarded' || this.dead) {
      return saved?.state === 'discarded' ? 'continue' : 'stop';
    }

    const commitP = this.options.port.commit(plan);
    this.inflight.add(saved.op);
    try {
      await commitP;
      if (this.dead) return 'stop';
      await this.markApplied(saved.op, seq);
      return 'continue';
    } catch (err) {
      if (this.dead) return 'stop';
      const current = await this.options.log.get(saved.op);
      if (current?.state === 'applied') return 'continue';
      if (current?.state === 'discarded') return 'continue';
      let looked: DecideServer | null = null;
      try {
        const fresh = await this.options.port.loadServer();
        looked = await this.look({ ...saved, seq }, fresh.match);
        server = fresh;
      } catch {
        return 'queued';
      }
      const decision = decideRetry(
        { op: saved.op, seq, baseResetRev: saved.baseResetRev },
        looked,
        false,
      );
      if (decision.kind === 'discard') {
        await this.markDiscarded(saved.op);
        return 'continue';
      }
      if (decision.kind === 'applied') {
        await this.markApplied(saved.op, decision.seq);
        return 'continue';
      }
      if (isOfflineError(err)) return 'queued';
      const reason = classifyReject({
        entrySeq: seq,
        localSid: sid,
        uid: this.options.uid,
        match: server.match,
        control: server.control,
      });
      if (reason === 'conflict' && decision.kind === 'wait') {
        await this.patchOpen(saved.op, { state: 'pending', seq });
        return 'wait';
      }
      if (reason === 'conflict' && !saved.autoRetried && (decision.kind === 'resequence' || decision.kind === 'reuse')) {
        await this.patchOpen(saved.op, {
          state: 'pending',
          autoRetried: true,
          seq: decision.kind === 'resequence' ? null : seq,
        });
        return 'continue';
      }
      if (reason === 'rules') {
        console.error('[live-scoring] 規則拒絕', { op: saved.op, seq, rev: server.match.rev });
      }
      await this.patchOpen(saved.op, { state: 'rejected', rejectReason: reason, seq });
      if (reason === 'takenOver') await this.rejectStaleTakenOver();
      return 'stop';
    } finally {
      this.inflight.delete(saved.op);
    }
  }

  private planFor(entry: LogEntry, seq: number, match: ServerMatch, all: readonly LogEntry[]) {
    const known = mergedEvents(this.options.port.knownEvents(), all);
    let refSeq: number | undefined;
    let targetSeq: number | undefined;
    let target: ServerEvent | null = null;
    const intent = entry.intent;
    if (intent.kind === 'card' && intent.cardType === 'second_yellow') {
      refSeq = intent.refSeq;
      if (refSeq == null && intent.refOp) {
        const host = all.find((item) => item.op === intent.refOp);
        if (host?.seq == null) return null;
        refSeq = host.seq;
      }
      if (refSeq == null) return null;
    }
    if (intent.kind === 'void') {
      targetSeq = intent.targetSeq;
      if (targetSeq == null && intent.targetOp) {
        const host = all.find((item) => item.op === intent.targetOp);
        if (host?.seq == null) return null;
        targetSeq = host.seq;
      }
      if (targetSeq == null) return null;
      target = known.find((event) => event.seq === targetSeq) ?? null;
      if (!target) {
        const host = all.find((item) => item.seq === targetSeq || item.op === intent.targetOp);
        if (host) target = eventFromApplied({ ...host, seq: targetSeq, state: 'applied' });
      }
    }
    return buildBatch({
      entry,
      seq,
      match,
      sid: this.options.localSid(),
      refSeq,
      targetSeq,
      target,
      cardLinkMode: refSeq == null ? undefined : linkModeFor(refSeq, known, all),
    });
  }

  private async look(entry: DecideEntry, match: ServerMatch): Promise<DecideServer> {
    if (entry.seq == null) {
      return { rev: match.rev, resetRev: match.resetRev, eventAtSeq: null, matchedSeq: null };
    }
    const events = await this.options.port.loadTimelineFrom(entry.seq, match.resetRev);
    const at = events.find((event) => event.seq === entry.seq) ?? null;
    const matched = events.find((event) => event.op === entry.op) ?? null;
    return {
      rev: match.rev,
      resetRev: match.resetRev,
      eventAtSeq: at ? { op: at.op } : null,
      matchedSeq: matched ? matched.seq : null,
    };
  }

  /** 已是 discarded 就不動。重置後原 commit 成功，狀態維持 discarded。 */
  private async markApplied(op: string, seq: number): Promise<void> {
    if (this.dead) return;
    const current = await this.options.log.get(op);
    if (!current || current.state === 'discarded') return;
    if (this.serverResetRev > (current.baseResetRev ?? 0)) {
      await this.markDiscarded(op);
      return;
    }
    await this.options.log.patch(op, { state: 'applied', seq, rejectReason: null });
  }

  private async markDiscarded(op: string): Promise<void> {
    if (this.dead) return;
    const current = await this.options.log.get(op);
    if (!current || current.state === 'discarded') return;
    await this.options.log.patch(op, { state: 'discarded', rejectReason: 'reset' });
  }

  /** 改狀態前再看一次。discarded 或已過重置線就不覆寫。 */
  private async patchOpen(op: string, patch: LogPatch): Promise<LogEntry | null> {
    const current = await this.options.log.get(op);
    if (!current || current.state === 'discarded') return current;
    if (patch.state !== undefined && patch.state !== 'discarded' && this.serverResetRev > (current.baseResetRev ?? 0)) {
      await this.markDiscarded(op);
      return this.options.log.get(op);
    }
    return this.options.log.patch(op, patch);
  }

  private async rejectStaleTakenOver(): Promise<void> {
    this.needsTakeover = true;
    if (this.blockedAt == null) this.blockedAt = this.options.now();
    const blockedAt = this.blockedAt;
    const entries = await this.options.log.list(this.options.cid, this.options.mtId);
    for (const entry of entries) {
      if (entry.state !== 'pending' && entry.state !== 'sending') continue;
      if (this.inflight.has(entry.op)) continue;
      if (this.serverResetRev > (entry.baseResetRev ?? 0)) {
        await this.markDiscarded(entry.op);
        continue;
      }
      if (entry.createdAt >= blockedAt) continue;
      await this.patchOpen(entry.op, { state: 'rejected', rejectReason: 'takenOver' });
    }
  }
}
