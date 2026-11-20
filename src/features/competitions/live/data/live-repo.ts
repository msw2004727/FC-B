// 記分場次的讀取與寫入。跟 CompetitionsRepo 分開：這裡會監聽，而且只在畫面可見時聽。
// 作廢與第二黃引用不另讀 voids／cardLinks，由 timeline 推出。

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { RosterPublicDoc } from '../../data/types';
import { applyPlanLocal } from './batch';
import type {
  BatchPlan,
  ScoringPort,
  ServerControl,
  ServerEvent,
  ServerMatch,
  TimeMark,
  TimelineRead,
} from './types';

export interface LiveListener {
  onMatch: (match: ServerMatch | null) => void;
  onControl: (control: ServerControl | null) => void;
  onEvents: (events: ServerEvent[], mode: 'replace' | 'append') => void;
  onError: (err: unknown) => void;
}

export interface LiveOpened {
  match: ServerMatch | null;
  control: ServerControl | null;
  events: ServerEvent[];
  home: RosterPublicDoc[];
  away: RosterPublicDoc[];
  /** 自己的 staff.roles。沒有文件就是空陣列。 */
  staffRoles: string[];
  /** 指派的場次。舊的假後端可以不填，工作階段當成空陣列。 */
  matchIds?: string[];
  /** 指派到期。null 是沒有期限。 */
  expiresAt?: number | null;
  /** 組別文件上的 rules.timeout 原值。讀不到就是 null，由讀取函式套預設。 */
  timeoutRaw?: unknown;
  setVisible: (visible: boolean) => void;
  stop: () => void;
}

export interface ScoringBackend {
  port: ScoringPort;
  open(listener: LiveListener, visible: () => boolean): Promise<LiveOpened>;
}

const ROSTER_LIMIT = 60;
const PAGE = 100;

export function matchPath(cid: string, mtId: string): string {
  return `competitions/${cid}/matches/${mtId}`;
}

export function millisOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'toMillis' in value) {
    const fn = (value as { toMillis?: unknown }).toMillis;
    if (typeof fn === 'function') return (fn as () => number).call(value);
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sideOf(value: unknown): ServerMatch['home'] | null {
  const raw = record(value);
  if (!raw) return null;
  const teamId = str(raw.teamId);
  const name = typeof raw.name === 'string' ? raw.name : null;
  if (!teamId || name == null) return null;
  const logo = typeof raw.logo === 'string' && raw.logo.trim() ? raw.logo.trim() : null;
  return { teamId, name, logo };
}

export function parseMatch(id: string, data: DocumentData | undefined): ServerMatch | null {
  const raw = record(data);
  if (!raw) return null;
  const status = str(raw.status);
  const home = sideOf(raw.home);
  const away = sideOf(raw.away);
  if (!status || !home || !away) return null;
  const scoreRaw = record(raw.score) ?? {};
  const lockRaw = record(raw.lock) ?? {};
  const clockRaw = record(raw.clockBase) ?? {};
  return {
    id,
    status,
    rev: typeof raw.rev === 'number' ? raw.rev : 0,
    resetRev: typeof raw.resetRev === 'number' ? raw.resetRev : 0,
    score: {
      home: typeof scoreRaw.home === 'number' ? scoreRaw.home : 0,
      away: typeof scoreRaw.away === 'number' ? scoreRaw.away : 0,
    },
    lock: { locked: lockRaw.locked === true },
    clockBase: {
      startedAt: millisOf(clockRaw.startedAt),
      pausedSec: typeof clockRaw.pausedSec === 'number' ? clockRaw.pausedSec : 0,
      running: clockRaw.running === true,
      period: typeof clockRaw.period === 'string' ? clockRaw.period : 'pre',
    },
    finishedAt: millisOf(raw.finishedAt),
    home,
    away,
    divisionId: str(raw.divisionId) ?? '',
    penaltyScore: penaltyOf(raw.penaltyScore),
  };
}

function penaltyOf(value: unknown): { home: number; away: number } | null {
  const raw = record(value);
  if (!raw) return null;
  if (typeof raw.home !== 'number' || typeof raw.away !== 'number') return null;
  return { home: raw.home, away: raw.away };
}

export function parseControl(data: DocumentData | undefined): ServerControl | null {
  const raw = record(data);
  if (!raw) return null;
  const uid = str(raw.uid);
  const sid = str(raw.sid);
  if (!uid || !sid) return null;
  return { uid, sid, takenAt: millisOf(raw.takenAt) };
}

export function parseEvent(data: DocumentData | undefined): ServerEvent | null {
  const raw = record(data);
  if (!raw || typeof raw.seq !== 'number' || typeof raw.type !== 'string') return null;
  const event: ServerEvent = {
    seq: raw.seq,
    type: raw.type,
    op: typeof raw.op === 'string' ? raw.op : '',
    sid: typeof raw.sid === 'string' ? raw.sid : '',
    matchSecond: typeof raw.matchSecond === 'number' ? raw.matchSecond : 0,
    createdAt: millisOf(raw.createdAt) ?? 0,
  };
  if (raw.side === 'home' || raw.side === 'away') event.side = raw.side;
  if (typeof raw.plId === 'string') event.plId = raw.plId;
  if (typeof raw.goalKind === 'string') event.goalKind = raw.goalKind;
  if (typeof raw.cardType === 'string') event.cardType = raw.cardType;
  if (typeof raw.refSeq === 'number') event.refSeq = raw.refSeq;
  if (typeof raw.targetSeq === 'number') event.targetSeq = raw.targetSeq;
  if (typeof raw.inPlId === 'string') event.inPlId = raw.inPlId;
  if (typeof raw.outPlId === 'string') event.outPlId = raw.outPlId;
  if (typeof raw.scored === 'boolean') event.scored = raw.scored;
  return event;
}

export function parseRoster(id: string, data: DocumentData | undefined): RosterPublicDoc | null {
  const raw = record(data);
  if (!raw) return null;
  const enId = str(raw.enId);
  const displayName = typeof raw.displayName === 'string' ? raw.displayName : null;
  const number = typeof raw.number === 'number' ? raw.number : null;
  if (!enId || displayName == null || number == null) return null;
  const position = raw.position === 'GK' || raw.position === 'DF' || raw.position === 'MF' || raw.position === 'FW' || raw.position === 'custom'
    ? raw.position
    : null;
  return {
    id,
    enId,
    displayName,
    number,
    position,
    positionText: typeof raw.positionText === 'string' ? raw.positionText : null,
    isMinor: raw.isMinor === true,
  };
}

function encodeTime(mark: TimeMark): ReturnType<typeof serverTimestamp> | Timestamp {
  if (mark.kind === 'server') return serverTimestamp();
  return Timestamp.fromMillis(mark.ms);
}

function eventPayload(plan: BatchPlan): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(plan.event)) {
    if (value && typeof value === 'object' && 'kind' in value && ((value as TimeMark).kind === 'server' || (value as TimeMark).kind === 'millis')) {
      out[key] = encodeTime(value as TimeMark);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 只回伺服器已確認的事件。Firestore 的讀取（含 getDocsFromServer）一律疊上本機未送寫入，
 * 唯一分辨方式是逐筆 metadata.hasPendingWrites（第 4 步 A F1，取代原本全部照收：對帳會誤判 applied、事件列留假事件）。
 * 分頁 cursor 仍用整頁最後一筆（含未確認），避免漏頁。
 */
async function readTimeline(
  db: Firestore,
  cid: string,
  mtId: string,
  minSeq: number,
  resetRev: number,
): Promise<TimelineRead> {
  const floor = Math.max(minSeq, resetRev + 1);
  const col = collection(db, `${matchPath(cid, mtId)}/timeline`);
  const out: ServerEvent[] = [];
  let pending = false;
  let cursor: QueryDocumentSnapshot | null = null;
  for (let page = 0; page < 2 && out.length < 200; page += 1) {
    const q: Query<DocumentData> = cursor
      ? query(col, where('seq', '>=', floor), orderBy('seq'), startAfter(cursor), limit(PAGE))
      : query(col, where('seq', '>=', floor), orderBy('seq'), limit(PAGE));
    const snap = await getDocs(q);
    if (snap.empty) break;
    for (const item of snap.docs) {
      if (item.metadata.hasPendingWrites) {
        pending = true;
        continue;
      }
      const event = parseEvent(item.data());
      if (event && event.seq > resetRev) out.push(event);
    }
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (snap.size < PAGE) break;
  }
  return { events: out.slice(0, 200), pending };
}

async function readRoster(db: Firestore, cid: string, enId: string): Promise<RosterPublicDoc[]> {
  const snap = await getDocs(query(
    collection(db, `competitions/${cid}/roster`),
    where('enId', '==', enId),
    limit(ROSTER_LIMIT),
  ));
  const rows: RosterPublicDoc[] = [];
  for (const item of snap.docs) {
    const row = parseRoster(item.id, item.data());
    if (row) rows.push(row);
  }
  return rows;
}

export function createFirestoreBackend(db: Firestore, cid: string, mtId: string, uid: string): ScoringBackend {
  let cache: ServerEvent[] = [];
  let matchCache: ServerMatch | null = null;
  let maxSeq = 0;

  /**
   * 三處讀到的事件都走這裡：併入 cache，必要時再把 maxSeq 往前推。
   * advanceSeq 為 false 時只更新 cache（對帳讀取），避免監聽因此跳過還沒通知畫面的事件。
   */
  function appendKnown(added: readonly ServerEvent[], advanceSeq: boolean): void {
    const floor = matchCache?.resetRev ?? 0;
    const map = new Map<number, ServerEvent>();
    for (const event of cache) {
      if (event.seq > floor) map.set(event.seq, event);
    }
    for (const event of added) {
      if (event.seq > floor) map.set(event.seq, event);
    }
    cache = [...map.values()].sort((a, b) => a.seq - b.seq);
    if (!advanceSeq) return;
    let next = floor;
    for (const event of cache) if (event.seq > next) next = event.seq;
    maxSeq = next;
  }

  const port: ScoringPort = {
    knownEvents: () => cache,
    async loadServer() {
      const [matchSnap, controlSnap] = await Promise.all([
        getDoc(doc(db, matchPath(cid, mtId))),
        getDoc(doc(db, `${matchPath(cid, mtId)}/control/scorer`)),
      ]);
      const match = matchSnap.exists() ? parseMatch(matchSnap.id, matchSnap.data()) : null;
      if (!match) throw new Error('場次不存在');
      matchCache = match;
      const control = controlSnap.exists() ? parseControl(controlSnap.data()) : null;
      // control 記分端只在接手時寫，不參與送出決策；只看場次文件。
      return { match, control, pending: matchSnap.metadata.hasPendingWrites };
    },
    async loadTimelineFrom(minSeq, resetRev) {
      const read = await readTimeline(db, cid, mtId, minSeq, resetRev);
      appendKnown(read.events, false);
      return read;
    },
    async commit(plan) {
      const batch = writeBatch(db);
      const matchRef = doc(db, matchPath(cid, mtId));
      const patch: Record<string, unknown> = {
        rev: plan.match.rev,
        updatedAt: serverTimestamp(),
      };
      if (plan.match.score) patch.score = plan.match.score;
      if (plan.match.status) patch.status = plan.match.status;
      if (plan.match.lock) patch.lock = plan.match.lock;
      if ('finishedAt' in plan.match) {
        patch.finishedAt = plan.match.finishedAt == null ? null : encodeTime(plan.match.finishedAt);
      }
      if (plan.match.clockBase) {
        patch.clockBase = {
          startedAt: plan.match.clockBase.startedAt == null ? null : encodeTime(plan.match.clockBase.startedAt),
          pausedSec: plan.match.clockBase.pausedSec,
          running: plan.match.clockBase.running,
          period: plan.match.clockBase.period,
        };
      }
      if (plan.match.penaltyScore) patch.penaltyScore = plan.match.penaltyScore;
      batch.update(matchRef, patch as never);
      batch.set(doc(db, `${matchPath(cid, mtId)}/timeline/e${plan.seq}`), eventPayload(plan) as never);
      if (plan.voidDoc) {
        batch.set(doc(db, `${matchPath(cid, mtId)}/voids/${plan.voidDoc.targetSeq}`), {
          seq: plan.voidDoc.seq,
          createdAt: serverTimestamp(),
        });
      }
      if (plan.cardLink) {
        const ref = doc(db, `${matchPath(cid, mtId)}/cardLinks/${plan.cardLink.ySeq}`);
        const body = { seq: plan.cardLink.seq, createdAt: serverTimestamp() };
        if (plan.cardLink.mode === 'update') batch.update(ref, body as never);
        else batch.set(ref, body);
      }
      await batch.commit();
      if (matchCache) applyPlanLocal(matchCache, cache, plan, Date.now());
    },
    async takeover(sid: string) {
      await setDoc(doc(db, `${matchPath(cid, mtId)}/control/scorer`), {
        uid,
        sid,
        takenAt: serverTimestamp(),
      });
    },
  };

  return {
    port,
    async open(listener, visible) {
      const matchSnap = await getDoc(doc(db, matchPath(cid, mtId)));
      const match = matchSnap.exists() ? parseMatch(matchSnap.id, matchSnap.data()) : null;
      matchCache = match;
      const controlSnap = await getDoc(doc(db, `${matchPath(cid, mtId)}/control/scorer`));
      const control = controlSnap.exists() ? parseControl(controlSnap.data()) : null;
      const events = match ? (await readTimeline(db, cid, mtId, match.resetRev + 1, match.resetRev)).events : [];
      cache = [];
      appendKnown(events, true);
      const home = match ? await readRoster(db, cid, match.home.teamId) : [];
      const away = match ? await readRoster(db, cid, match.away.teamId) : [];
      const staffSnap = await getDoc(doc(db, `competitions/${cid}/staff/${uid}`));
      const staffData = staffSnap.exists() ? staffSnap.data() : null;
      const staffRaw = staffData ? staffData.roles : [];
      const staffRoles = Array.isArray(staffRaw) ? staffRaw.filter((role): role is string => typeof role === 'string') : [];
      const matchIds = staffData && Array.isArray(staffData.matchIds)
        ? staffData.matchIds.filter((item): item is string => typeof item === 'string')
        : [];
      const expiresAt = staffData ? millisOf(staffData.expiresAt) : null;
      let timeoutRaw: unknown = null;
      const divisionId = match?.divisionId ?? '';
      if (divisionId) {
        try {
          const divisionSnap = await getDoc(doc(db, `competitions/${cid}/divisions/${divisionId}`));
          const rules = divisionSnap.exists() ? record(divisionSnap.data().rules) : null;
          timeoutRaw = rules ? (rules.timeout ?? null) : null;
        } catch {
          timeoutRaw = null;
        }
      }
      // 開啟時讀到的是疊加本機未送寫入的版本（重整後持久化佇列）時 rev 不可信：等第一個已確認快照再讀事件。
      let lastRev = match && !matchSnap.metadata.hasPendingWrites ? match.rev : -1;
      let lastShape = '';
      let unsubs: Array<() => void> = [];
      let stopped = false;

      const clear = () => {
        for (const unsub of unsubs) unsub();
        unsubs = [];
      };

      const subscribe = () => {
        if (stopped || unsubs.length > 0) return;
        // includeMetadataChanges：寫入被確認時（hasPendingWrites true→false）資料可能完全相同，沒有這個選項就收不到回呼，
        // 已確認 rev 的事件會讀不到（第 4 步 A F3）。資料與 pending 都沒變的回呼（例如只有 fromCache 變）不轉給工作階段。
        unsubs.push(onSnapshot(doc(db, matchPath(cid, mtId)), { includeMetadataChanges: true }, (snap) => {
          const next = snap.exists() ? parseMatch(snap.id, snap.data()) : null;
          const pending = snap.metadata.hasPendingWrites;
          const shape = `${pending ? 1 : 0}|${JSON.stringify(next)}`;
          if (shape === lastShape) return;
          lastShape = shape;
          const prevReset = matchCache?.resetRev ?? -1;
          matchCache = next;
          // 畫面與「已涵蓋不重算」照舊吃本機快照。pending 由 true 變 false 也會走到這裡，工作階段因此 flush 重新決策（F3-5）。
          listener.onMatch(next);
          if (next && prevReset >= 0 && next.resetRev > prevReset) appendKnown([], true);
          // 讀事件只看已確認的 rev：本機快照的 rev 會讀到自己未送的 e{seq}，maxSeq 被推過去後，退回時假事件拿不掉、同 seq 的真事件也讀不到。
          if (pending) return;
          if (next && next.rev !== lastRev) {
            const from = maxSeq + 1;
            lastRev = next.rev;
            const resetRev = next.resetRev;
            void readTimeline(db, cid, mtId, from, resetRev).then((read) => {
              appendKnown(read.events, true);
              const visible = read.events.filter((event) => event.seq > resetRev);
              if (visible.length === 0) return;
              listener.onEvents(visible, 'append');
            }).catch((err) => listener.onError(err));
          }
        }, (err) => listener.onError(err)));
        unsubs.push(onSnapshot(doc(db, `${matchPath(cid, mtId)}/control/scorer`), (snap) => {
          listener.onControl(snap.exists() ? parseControl(snap.data()) : null);
        }, (err) => listener.onError(err)));
      };

      if (visible()) subscribe();
      return {
        match,
        control,
        events,
        home,
        away,
        staffRoles,
        matchIds,
        expiresAt,
        timeoutRaw,
        setVisible(next) {
          if (stopped) return;
          if (!next) {
            clear();
            return;
          }
          subscribe();
          if (!matchCache) return;
          const resetRev = matchCache.resetRev;
          const from = maxSeq + 1;
          void readTimeline(db, cid, mtId, from, resetRev).then((read) => {
            appendKnown(read.events, true);
            const visible = read.events.filter((event) => event.seq > resetRev);
            if (visible.length === 0) return;
            listener.onEvents(visible, 'append');
          }).catch((err) => listener.onError(err));
        },
        stop() {
          stopped = true;
          clear();
        },
      };
    },
  };
}
