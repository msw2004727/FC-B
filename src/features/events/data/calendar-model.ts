import type { LegacyEventDoc } from '../components/legacy/TimelineEventCard';
import { effectiveEventStatus } from './my-activities-model';
import { SPORTS, eventSportTag, getSportLabelByKey } from './sports';

export const DOM_RECYCLE_THRESHOLD = 5;
export const MAX_PAST_MONTHS = 3;
export const WEEK_DAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'] as const;

const MONTH_FORMATTER = new Intl.DateTimeFormat('zh-TW', {
  year: 'numeric',
  month: 'long',
});

interface SportDefinition {
  var: string;
  emoji: string;
  label: string;
  enabled: boolean;
}

export const SPORT_COLORS: Readonly<Record<string, SportDefinition>> = {
  football: { var: '--sport-football', emoji: '⚽', label: '足球', enabled: true },
  basketball: { var: '--sport-basketball', emoji: '🏀', label: '籃球', enabled: true },
  pickleball: { var: '--sport-pickleball', emoji: '🏓', label: '匹克球', enabled: true },
  dodgeball: { var: '--sport-dodgeball', emoji: '🤾', label: '美式躲避球', enabled: true },
  running: { var: '--sport-running', emoji: '🏃', label: '跑步', enabled: true },
  hiking: { var: '--sport-hiking', emoji: '🥾', label: '登山健行', enabled: true },
  badminton: { var: '--sport-badminton', emoji: '🏸', label: '羽球', enabled: true },
  swimming: { var: '--sport-swimming', emoji: '🏊', label: '游泳', enabled: true },
  volleyball: { var: '--sport-volleyball', emoji: '🏐', label: '排球', enabled: false },
  tennis: { var: '--sport-tennis', emoji: '🎾', label: '網球', enabled: false },
  table_tennis: { var: '--sport-table-tennis', emoji: '🏓', label: '桌球', enabled: false },
  escape_room: { var: '--sport-escape-room', emoji: '🧠', label: '密室逃脫', enabled: false },
  esports: { var: '--sport-esports', emoji: '🎮', label: '電玩電競', enabled: false },
  baseball_softball: { var: '--sport-baseball-softball', emoji: '⚾', label: '棒壘球', enabled: false },
  baseball: { var: '--sport-baseball', emoji: '⚾', label: '棒球', enabled: false },
  softball: { var: '--sport-softball', emoji: '🥎', label: '壘球', enabled: false },
  fitness: { var: '--sport-fitness', emoji: '💪', label: '健身', enabled: false },
  cycling: { var: '--sport-cycling', emoji: '🚴', label: '自行車', enabled: false },
  other: { var: '--sport-other', emoji: '🏃', label: '其他', enabled: true },
};

const SPORT_ORDER = new Map(SPORTS.map((sport, index) => [sport.key, index]));

/** 照 A getSportDef。 */
export function getSportDef(key: string): SportDefinition {
  const fallback: SportDefinition = {
    var: '--sport-other', emoji: '🏃', label: '其他', enabled: true,
  };
  const definition = SPORT_COLORS[key] ?? fallback;
  return {
    ...definition,
    emoji: SPORTS.find((sport) => sport.key === key)?.symbol ?? definition.emoji,
  };
}

/** 照 A toDateKey。 */
export function toDateKey(value: string | undefined): string {
  if (!value) return '';
  const parts = (value.split(' ')[0] ?? '').split('/');
  if (parts.length < 3) return '';
  const [year, month, day] = parts.map((part) => parseInt(part, 10));
  if (year === undefined || month === undefined || day === undefined
    || !Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 照 A dateObjToKey。 */
export function dateObjToKey(date: Date): string {
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 照 A _calMonthKeyFromDate。 */
export function monthKeyFromDate(date: Date): string {
  return dateObjToKey(date).slice(0, 7);
}

/** 照 A _calAddMonthKey。 */
export function addMonthKey(key: string, delta: number): string {
  const [year = 0, month = 1] = key.split('-').map(Number);
  return monthKeyFromDate(new Date(year, month - 1 + delta, 1));
}

/** 照 A _calMonthLabelText。 */
export function monthLabel(key: string): string {
  const [year = 0, month = 1] = key.split('-').map(Number);
  return MONTH_FORMATTER.format(new Date(year, month - 1, 1));
}

/** 照 A _calendarGoPrev。 */
export function minimumMonthKey(now: Date): string {
  return monthKeyFromDate(new Date(now.getFullYear(), now.getMonth() - MAX_PAST_MONTHS, 1));
}

/** 照 A _getWindowedMonthKeys。 */
export function getWindowedMonthKeys(center: string, now: Date): string[] {
  const minimum = minimumMonthKey(now);
  return [-1, 0, 1].map((offset) => addMonthKey(center, offset))
    .filter((key) => key >= minimum);
}

/** 照 A getMonthGridShape。 */
export function getMonthGridShape(year: number, month: number) {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = firstWeekday + daysInMonth;
  return { firstWeekday, daysInMonth, totalCells, weekRows: Math.ceil(totalCells / 7) };
}

/** 照 A _buildMonthGridInnerHTML。 */
export function buildMonthCells(key: string, now: Date) {
  const [year = 0, month = 1] = key.split('-').map(Number);
  const shape = getMonthGridShape(year, month - 1);
  const today = dateObjToKey(now);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Array.from({ length: shape.weekRows * 7 }, (_, index) => {
    const offset = index - shape.firstWeekday;
    const date = new Date(year, month - 1, offset + 1);
    const dateKey = dateObjToKey(date);
    const outside = offset < 0 || offset >= shape.daysInMonth;
    return {
      dateKey,
      day: date.getDate(),
      outside,
      today: !outside && dateKey === today,
      past: date.getTime() < midnight,
      row: Math.floor(index / 7) + 1,
      col: index % 7 + 1,
    };
  });
}

/** 照 A _groupEventsByDateForMonth；上游先完成可見性與篩選。 */
export function groupEventsByDateForMonth(events: readonly LegacyEventDoc[], key: string) {
  const [year = 0, month = 1] = key.split('-').map(Number);
  const start = new Date(year, month - 1, 1).getTime();
  const end = new Date(year, month, 1).getTime();
  const groups = new Map<string, LegacyEventDoc[]>();
  for (const event of events) {
    const dateKey = toDateKey(event.date);
    if (!dateKey) continue;
    const [y = 0, m = 1, d = 1] = dateKey.split('-').map(Number);
    const time = new Date(y, m - 1, d).getTime();
    if (time < start || time >= end) continue;
    const group = groups.get(dateKey) ?? [];
    group.push(event);
    groups.set(dateKey, group);
  }
  return groups;
}

/** 照 A _sortEventsForCalendarCell。 */
export function sortCalendarEvents(events: readonly LegacyEventDoc[]): LegacyEventDoc[] {
  return [...events].sort((a, b) => {
    const pinned = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinned) return pinned;
    if (a.pinned && b.pinned) {
      const order = (Number(a.pinOrder) || 0) - (Number(b.pinOrder) || 0);
      if (order) return order;
    }
    return (a.date?.split(' ')[1] ?? '').localeCompare(b.date?.split(' ')[1] ?? '');
  });
}

export interface SportCount {
  sportKey: string;
  count: number;
}

/** 照 A _buildCalendarSportCounts。 */
export function buildSportCounts(events: readonly LegacyEventDoc[]): SportCount[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = eventSportTag(event) || 'football';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([sportKey, count]) => ({ sportKey, count }))
    .sort((a, b) => {
      const order = (SPORT_ORDER.get(a.sportKey) ?? Number.MAX_SAFE_INTEGER)
        - (SPORT_ORDER.get(b.sportKey) ?? Number.MAX_SAFE_INTEGER);
      return order || getSportLabelByKey(a.sportKey).localeCompare(getSportLabelByKey(b.sportKey), 'zh-TW');
    });
}

/** 照 A _formatCalendarSportCountSummary。 */
export function formatSportCountSummary(counts: readonly SportCount[]): string {
  return counts.map(({ sportKey, count }) => `${getSportLabelByKey(sportKey)} x${count}`).join('、');
}

/** 照 A _getEventSignupStateClassForCal。 */
export function signupStateClass(state: { signedUp: boolean; onWaitlist: boolean }): string {
  return state.signedUp ? (state.onWaitlist ? 'is-waitlisted' : 'is-signed-up') : '';
}

/** 照 A _buildEventCellHTML。 */
export function calendarEventPresentation(
  event: LegacyEventDoc,
  state: { signedUp: boolean; onWaitlist: boolean },
  nowMs: number,
) {
  const sport = getSportDef(eventSportTag(event) || 'other');
  const status = effectiveEventStatus(event, nowMs);
  const time = event.date?.split(' ')[1]?.split('~')[0] ?? '';
  const prefix = event.pinned ? '置頂活動：'
    : status === 'cancelled' ? '已取消活動：' : status === 'ended' ? '已結束活動：' : '';
  const stateClass = signupStateClass(state);
  return {
    sport, status, time,
    className: `evt-cal-event${event.pinned ? ' evt-cal-is-pinned' : ''}${stateClass ? ` ${stateClass}` : ''}`,
    label: `${prefix}${event.title ?? ''}，${sport.label}${time ? `，${time}` : ''}`,
  };
}
