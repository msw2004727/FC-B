// 賽事列表 v2 的站內卡片。只吃已經讀回來的文件，自己不發查詢。
// ASSUMPTION: 列表維持第 2 步的查詢，不讀摘要、積分榜、隊徽。
// 進行中的「今天 N 場・下一場」與已結束的「冠軍」要有場次或冠軍才寫得出來；
// 目前清單文件沒有這兩欄，呼叫端沒帶就留空，膠囊仍顯示階段。不另讀去補。
// ASSUMPTION: 卡片日期用首場到末場（比賽期間）。同一年的結束日省略年份。地點用第一個有名稱的場地。
// ASSUMPTION: 距開賽是台北日曆日差，不是滿 24 小時才算一天。
// ASSUMPTION: 沒有時間的「我的賽事」階段未知。預設「未結束」仍列出（未知不是已結束）。指定階段不含未知。
// ASSUMPTION: 只看我的關閉時是公開、cpMine、代表俱樂部主辦的聯集，以 cid 去重。打開時只留後兩者。
// ASSUMPTION: 排序用首場時間新到舊；沒有時間的排後面，再用 cid 固定順序。

import type { CompetitionCategory, CompetitionDoc } from './types';
import { categoryOf, competitionPhase, type CompetitionPhase } from './present';
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
  | { kind: 'champion'; name: string };

export interface InAppListCard {
  cid: string;
  name: string;
  category: CompetitionCategory;
  phase: CompetitionPhase | null;
  dates: string;
  line: InAppStatusLine | null;
  /** cpMine 或代表俱樂部主辦。 */
  mine: boolean;
  ended: boolean;
}

export interface MineListRow {
  cid: string;
  name: string;
  category: CompetitionCategory;
  /** 有名稱就不讀文件，這裡是 null。沒有名稱時才是 getCompetition 的結果。 */
  doc: CompetitionDoc | null;
}

export interface TodayMatches {
  count: number;
  /** HH:MM。沒有下一場就不畫進行中那一行。 */
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

/** `2027/01/09 – 01/10　示範運動公園`。沒有場地就只有日期。 */
export function formatInAppWhenWhere(
  doc: Pick<CompetitionDoc, 'firstMatchAt' | 'lastMatchAt' | 'venues'>,
): string {
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
  const venue = doc.venues.find((item) => item.name.trim())?.name.trim() ?? '';
  return venue ? `${when}　${venue}` : when;
}

export function statusLineFor(
  doc: Pick<CompetitionDoc, 'id' | 'regCloseAt' | 'firstMatchAt'>,
  phase: CompetitionPhase,
  now: number,
  today: TodayMatches | undefined,
  champion: string | undefined,
): InAppStatusLine | null {
  if (phase === 'recruit') {
    return { kind: 'deadline', date: formatTaipeiShort(doc.regCloseAt) };
  }
  if (phase === 'warm') {
    return { kind: 'warm', days: daysUntilFirstMatch(now, doc.firstMatchAt) };
  }
  if (phase === 'live') {
    const time = today?.time?.trim();
    if (today && time) return { kind: 'live', count: today.count, time };
    return null;
  }
  const name = champion?.trim();
  return name ? { kind: 'champion', name } : null;
}

function cardFromDoc(
  doc: CompetitionDoc,
  mine: boolean,
  now: number,
  today: TodayMatches | undefined,
  champion: string | undefined,
): InAppListCard {
  const phase = competitionPhase(doc, now);
  return {
    cid: doc.id,
    name: doc.name,
    category: categoryOf(doc),
    phase,
    dates: formatInAppWhenWhere(doc),
    line: statusLineFor(doc, phase, now, today, champion),
    mine,
    ended: phase === 'done',
  };
}

function compareCards(a: InAppListCard, b: InAppListCard, times: ReadonlyMap<string, number>): number {
  const ta = times.get(a.cid);
  const tb = times.get(b.cid);
  if (ta == null && tb == null) return a.cid < b.cid ? -1 : a.cid > b.cid ? 1 : 0;
  if (ta == null) return 1;
  if (tb == null) return -1;
  if (ta !== tb) return tb - ta;
  return a.cid < b.cid ? -1 : a.cid > b.cid ? 1 : 0;
}

export function assembleInAppCards(input: {
  publicDocs: readonly CompetitionDoc[];
  hosted: readonly CompetitionDoc[];
  mine: readonly MineListRow[];
  now: number;
  todayByCid?: ReadonlyMap<string, TodayMatches>;
  championByCid?: ReadonlyMap<string, string>;
}): InAppListCard[] {
  const mineIds = new Set(input.mine.map((row) => row.cid));
  const hostedIds = new Set(input.hosted.map((doc) => doc.id));
  const docs = new Map<string, CompetitionDoc>();

  function remember(doc: CompetitionDoc): void {
    if (!doc.name || docs.has(doc.id)) return;
    docs.set(doc.id, doc);
  }

  for (const doc of input.publicDocs) remember(doc);
  for (const doc of input.hosted) remember(doc);
  for (const row of input.mine) {
    if (row.doc) remember(row.doc);
  }

  const times = new Map<string, number>();
  const cards: InAppListCard[] = [];
  for (const doc of docs.values()) {
    times.set(doc.id, doc.firstMatchAt);
    cards.push(cardFromDoc(
      doc,
      mineIds.has(doc.id) || hostedIds.has(doc.id),
      input.now,
      input.todayByCid?.get(doc.id),
      input.championByCid?.get(doc.id),
    ));
  }

  for (const row of input.mine) {
    const name = row.name.trim();
    if (!name || docs.has(row.cid)) continue;
    cards.push({
      cid: row.cid,
      name,
      category: categoryOf(row),
      phase: null,
      dates: '',
      line: null,
      mine: true,
      ended: false,
    });
  }

  cards.sort((a, b) => compareCards(a, b, times));
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
