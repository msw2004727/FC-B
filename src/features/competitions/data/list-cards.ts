// 賽事列表 v2 的站內卡片。組卡本身不發查詢。
// 進行中的今天場次由呼叫端帶 todayByCid（頁面只對畫面上的進行中卡各讀一次當日摘要片）。
// 已結束不顯示冠軍。沒有場次資料就留空，膠囊仍顯示階段。
// ASSUMPTION: 同一場賽事公開清單與我的清單都有時，以公開文件為準
// （公開文件是最新根文件，我的索引名稱可能過期）。
// ASSUMPTION: 卡片日期用首場到末場（比賽期間）。同一年的結束日省略年份。地點用第一個有名稱的場地。
// ASSUMPTION: 距開賽是台北日曆日差，不是滿 24 小時才算一天。
// ASSUMPTION: 沒有時間的「我的賽事」階段未知。預設「未結束」仍列出（未知不是已結束）。指定階段不含未知。
// ASSUMPTION: 只看我的關閉時是公開、cpMine、代表俱樂部主辦的聯集，以 cid 去重。打開時只留後兩者。
// ASSUMPTION: 排序先放「真的在進行中」（進行中且沒有整場延期或取消），其餘照首場時間新到舊；
// 沒有時間的排後面，再用 cid 固定順序（站長 11-20 定案，取代原本只看首場新到舊）。
// 站長 11-22 起每一張都是記分板卡（原本 pickInAppBoard 只挑一張移到第一張，已移除）；順序照 compareCards 不變（進行中最上面）。

import type { CompetitionCategory, CompetitionDoc, SummaryEntry } from './types';
import { categoryOf, competitionPhase, type CompetitionPhase } from './present';
import { listImage, shownCover } from './cover';
import { formatTaipeiShort, taipeiParts } from '../format';

export type InAppTab = 'all' | CompetitionCategory;

/** 未結束是預設，不是階段名稱。全部表示不篩階段。 */
export type InAppStatusFilter = 'open' | 'recruit' | 'warm' | 'live' | 'done' | 'all';

export const IN_APP_STATUS_FILTERS: readonly InAppStatusFilter[] = [
  'open', 'recruit', 'warm', 'live', 'done', 'all',
];

export type InAppStatusLine =
  | { kind: 'deadline'; date: string }
  | { kind: 'warm'; days: number }
  | { kind: 'live'; count: number; time: string }
  | { kind: 'today'; count: number };

export interface InAppListCard {
  cid: string;
  name: string;
  category: CompetitionCategory;
  phase: CompetitionPhase | null;
  /** `2027/01/09 – 01/10`。只有名稱的舊「我的賽事」是空字串。 */
  date: string;
  /** 第一個有名稱的場地；沒有是空字串。 */
  venue: string;
  /** 首場時間，給排序與卡板判定。只有名稱的舊「我的賽事」是 null。 */
  firstMatchAt: number | null;
  line: InAppStatusLine | null;
  /** cpMine 或代表俱樂部主辦。 */
  mine: boolean;
  ended: boolean;
  /** 整場延期或取消時，列表膠囊改顯示這個，不再用階段。 */
  statusMark: 'postponed' | 'cancelled' | null;
  /**
   * 清單用圖（data/cover.ts#listImage：800×300 的 card，舊封面退回原圖）；卡板與一般卡同一張，
   * 賽事從一般卡變成卡板不會重新下載。沒有封面或下架是空字串，卡片版面照舊。
   */
  cover: string;
}

/**
 * 組卡只看根文件的這些欄位（本機清單快照 list-snapshot.ts 也只存這些，讀回後照同一條路組卡）。
 * 場地只看名稱（firstVenueName）。
 */
export type InAppListDoc = Pick<
  CompetitionDoc,
  'id' | 'name' | 'category' | 'status' | 'regOpenAt' | 'regCloseAt' | 'firstMatchAt' | 'lastMatchAt' | 'endedAt' | 'hidden' | 'cover'
> & { venues: readonly { name: string }[] };

export interface MineListRow {
  cid: string;
  name: string;
  category: CompetitionCategory;
  /** 有名稱就不讀文件，這裡是 null。沒有名稱時才是 getCompetition 的結果。 */
  doc: CompetitionDoc | null;
}

export interface TodayMatches {
  /** 當日摘要片裡的場次數。 */
  count: number;
  /** 下一場台北 HH:MM。今天沒有下一場是 null，仍可只顯示場數。 */
  time: string | null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 台北日曆日序，用來算距開賽幾天。 */
export function taipeiDayIndex(ms: number): number {
  const p = taipeiParts(ms);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

export function daysUntilFirstMatch(now: number, firstMatchAt: number): number {
  return Math.max(0, taipeiDayIndex(firstMatchAt) - taipeiDayIndex(now));
}

/** `2027/01/09 – 01/10`。同一年省略結束年；同一天只寫一次。 */
export function formatInAppDates(doc: Pick<CompetitionDoc, 'firstMatchAt' | 'lastMatchAt'>): string {
  const start = taipeiParts(doc.firstMatchAt);
  const end = taipeiParts(doc.lastMatchAt);
  const startText = `${start.year}/${pad(start.month)}/${pad(start.day)}`;
  const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;
  let when = startText;
  if (!sameDay) {
    const endText = start.year === end.year
      ? `${pad(end.month)}/${pad(end.day)}`
      : `${end.year}/${pad(end.month)}/${pad(end.day)}`;
    when = `${startText} – ${endText}`;
  }
  return when;
}

/** 第一個有名稱的場地；沒有就是空字串。 */
export function firstVenueName(doc: { venues: readonly { name: string }[] }): string {
  return doc.venues.find((item) => item.name.trim())?.name.trim() ?? '';
}

/** 台北 HH:MM。 */
function taipeiClock(ms: number): string {
  const p = taipeiParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * 當日摘要片 → 今天場數與下一場。
 * N 是這一片裡還沒取消的場次數。空片、或整片都是已取消，回 null（卡片留空）。
 * 下一場只看 st === 'scheduled' 且時間 ≥ now 的最早一場，台北 HH:MM。改期不算。
 * 有場次但沒有下一場時 time 是 null，呼叫端只寫場數。
 */
export function todayFromShard(entries: readonly SummaryEntry[], now: number): TodayMatches | null {
  const active = entries.filter((entry) => entry.st !== 'cancelled');
  if (active.length === 0) return null;
  let nextAt: number | null = null;
  for (const entry of active) {
    if (entry.st !== 'scheduled' || entry.k == null || entry.k < now) continue;
    if (nextAt == null || entry.k < nextAt) nextAt = entry.k;
  }
  return { count: active.length, time: nextAt == null ? null : taipeiClock(nextAt) };
}

export function statusLineFor(
  doc: Pick<CompetitionDoc, 'id' | 'regCloseAt' | 'firstMatchAt'>,
  phase: CompetitionPhase,
  now: number,
  today: TodayMatches | undefined,
): InAppStatusLine | null {
  if (phase === 'recruit') {
    return { kind: 'deadline', date: formatTaipeiShort(doc.regCloseAt) };
  }
  if (phase === 'warm') {
    return { kind: 'warm', days: daysUntilFirstMatch(now, doc.firstMatchAt) };
  }
  if (phase === 'live') {
    if (!today || today.count <= 0) return null;
    const time = today.time?.trim() ?? '';
    if (time) return { kind: 'live', count: today.count, time };
    return { kind: 'today', count: today.count };
  }
  return null;
}

function cardFromDoc(
  doc: InAppListDoc,
  mine: boolean,
  now: number,
  today: TodayMatches | undefined,
): InAppListCard {
  const phase = competitionPhase(doc, now);
  return {
    cid: doc.id,
    name: doc.name,
    category: categoryOf(doc),
    phase,
    date: formatInAppDates(doc),
    venue: firstVenueName(doc),
    firstMatchAt: doc.firstMatchAt,
    line: statusLineFor(doc, phase, now, today),
    mine,
    ended: phase === 'done',
    statusMark: doc.status === 'postponed' || doc.status === 'cancelled' ? doc.status : null,
    cover: listImage(shownCover(doc, false)),
  };
}

/** 真的在進行中：階段是進行中，而且沒有整場延期或取消。 */
export function isTrulyLive(card: Pick<InAppListCard, 'phase' | 'statusMark'>): boolean {
  return card.phase === 'live' && card.statusMark === null;
}

function compareCards(a: InAppListCard, b: InAppListCard): number {
  const la = isTrulyLive(a);
  const lb = isTrulyLive(b);
  if (la !== lb) return la ? -1 : 1;
  const ta = a.firstMatchAt;
  const tb = b.firstMatchAt;
  if (ta == null && tb == null) return a.cid < b.cid ? -1 : a.cid > b.cid ? 1 : 0;
  if (ta == null) return 1;
  if (tb == null) return -1;
  if (ta !== tb) return tb - ta;
  return a.cid < b.cid ? -1 : a.cid > b.cid ? 1 : 0;
}

/** 組卡的來源：公開清單、代表俱樂部主辦、我的賽事（cpMine）。 */
export interface InAppListInput<D extends InAppListDoc = InAppListDoc> {
  publicDocs: readonly D[];
  hosted: readonly D[];
  mine: readonly (Omit<MineListRow, 'doc'> & { doc: D | null })[];
}

/**
 * 三份來源以 cid 去重（公開文件先放，同一場後面的主辦或我的文件不覆蓋），標出哪些是我的。
 * names 是沒有文件、只有名稱的「我的賽事」。組卡與本機清單快照共用這一份合併規則。
 */
export function mergeInAppDocs<D extends InAppListDoc>(input: InAppListInput<D>): {
  docs: { doc: D; mine: boolean }[];
  names: { cid: string; name: string; category: CompetitionCategory }[];
} {
  const mineIds = new Set(input.mine.map((row) => row.cid));
  const hostedIds = new Set(input.hosted.map((doc) => doc.id));
  const docs = new Map<string, D>();

  function remember(doc: D): void {
    if (!doc.name || docs.has(doc.id)) return;
    docs.set(doc.id, doc);
  }

  for (const doc of input.publicDocs) remember(doc);
  for (const doc of input.hosted) remember(doc);
  for (const row of input.mine) {
    if (row.doc) remember(row.doc);
  }

  const names: { cid: string; name: string; category: CompetitionCategory }[] = [];
  for (const row of input.mine) {
    const name = row.name.trim();
    if (!name || docs.has(row.cid)) continue;
    names.push({ cid: row.cid, name, category: categoryOf(row) });
  }
  return {
    docs: [...docs.values()].map((doc) => ({ doc, mine: mineIds.has(doc.id) || hostedIds.has(doc.id) })),
    names,
  };
}

export function assembleInAppCards(input: InAppListInput & {
  now: number;
  todayByCid?: ReadonlyMap<string, TodayMatches>;
}): InAppListCard[] {
  const merged = mergeInAppDocs(input);
  const cards: InAppListCard[] = [];
  for (const { doc, mine } of merged.docs) {
    cards.push(cardFromDoc(doc, mine, input.now, input.todayByCid?.get(doc.id)));
  }

  for (const row of merged.names) {
    cards.push({
      cid: row.cid,
      name: row.name,
      category: row.category,
      phase: null,
      date: '',
      venue: '',
      firstMatchAt: null,
      line: null,
      mine: true,
      ended: false,
      statusMark: null,
      cover: '',
    });
  }

  cards.sort(compareCards);
  return cards;
}

export function passesInAppStatus(card: Pick<InAppListCard, 'phase'>, filter: InAppStatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'open') return card.phase !== 'done';
  return card.phase === filter;
}

/** 分類、階段、只看我的都在記憶體裡篩，不重讀。 */
export function filterInAppCards(
  cards: readonly InAppListCard[],
  tab: InAppTab,
  status: InAppStatusFilter,
  onlyMine: boolean,
): InAppListCard[] {
  return cards.filter((card) => {
    if (onlyMine && !card.mine) return false;
    if (tab !== 'all' && card.category !== tab) return false;
    return passesInAppStatus(card, status);
  });
}
