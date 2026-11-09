// 課程畫面的顯示字串（日期、時段、價格、人數）。只組字，不讀資料。
import type { CourseT } from '../i18n';
import type { CoursePlan, CourseSession } from './course-model';

/** `YYYY-MM-DD` → `M/D`。 */
export function monthDay(date: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date.trim());
  return m ? `${Number(m[2])}/${Number(m[3])}` : date;
}

/** `YYYY-MM-DD` 的星期（0＝週日）；解析不出回 null。 */
export function weekdayOf(date: string): number | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

function dash(text: string): string {
  return text.replace(/\s*[-~～]\s*/g, '–');
}

function timeRange(start: string, end: string): string {
  return start && end ? `${start}–${end}` : start || end;
}

/** 方案時段：固定週期用 timeSlot，堂數制用第一堂的起訖。 */
export function planTimeText(plan: CoursePlan): string {
  if (plan.planType === 'weekly') return dash(plan.timeSlot);
  const first = plan.sessionSchedules[0];
  return first ? timeRange(first.startTime, first.endTime) : '';
}

export function weekdaysText(ct: CourseT, weekdays: readonly number[]): string {
  return weekdays.map((d) => ct(`wd.${d}`)).join(ct('fmt.daysSep'));
}

/** 卡片與詳情的時間列：「每週六 09:00–10:30」或「12/7 起 · 日 14:00–16:00」。 */
export function scheduleText(ct: CourseT, plan: CoursePlan): string {
  if (plan.planType === 'weekly') {
    if (!plan.weekdays.length) return planTimeText(plan);
    return ct('fmt.weekly', { days: weekdaysText(ct, plan.weekdays), time: planTimeText(plan) }).trim();
  }
  const first = plan.sessionSchedules[0];
  if (!first) return '';
  const wd = weekdayOf(first.date);
  return ct('fmt.from', {
    date: monthDay(first.date),
    wd: wd === null ? '' : ct(`wd.${wd}`),
    time: timeRange(first.startTime, first.endTime),
  }).trim();
}

/** 一堂課的時間：「11/15（六）09:00」。 */
export function sessionWhenText(ct: CourseT, session: Pick<CourseSession, 'date' | 'startTime'>): string {
  const wd = weekdayOf(session.date);
  return ct('fmt.date', {
    md: monthDay(session.date),
    wd: wd === null ? '' : ct(`wd.${wd}`),
    time: session.startTime,
  }).trim();
}

export function priceText(ct: CourseT, plan: CoursePlan): string {
  if (plan.price === null || plan.price <= 0) return '';
  const price = plan.price.toLocaleString('en-US');
  return ct(plan.perSessionBilling ? 'fmt.pricePer' : 'fmt.price', { price });
}

/** 人數：有伺服器人數用「12/16 人」；沒有（未登入）只顯示名額。 */
export function countText(ct: CourseT, count: number | null, max: number): string {
  if (count === null) return max > 0 ? ct('fmt.maxOnly', { max }) : '';
  return max > 0 ? ct('fmt.count', { count, max }) : ct('fmt.countOnly', { count });
}

export function planSessionCount(plan: CoursePlan): number {
  return plan.totalSessions ?? plan.sessionSchedules.length;
}

export function typeChipText(ct: CourseT, plan: CoursePlan): string {
  return plan.planType === 'weekly' ? ct('type.weekly') : ct('type.sessions', { count: planSessionCount(plan) });
}

/** 期間：「11/1–12/27 · 共 9 堂」；堂數未知時只給起訖。 */
export function periodText(ct: CourseT, plan: CoursePlan, count: number | null): string {
  if (!plan.startDate && !plan.endDate) return '';
  const params = { start: monthDay(plan.startDate), end: monthDay(plan.endDate) };
  return count && count > 0 ? ct('fmt.periodCount', { ...params, count }) : ct('fmt.period', params);
}

export function lessonNoText(ct: CourseT, session: CourseSession, index: number): string {
  return ct('fmt.lessonNo', { n: session.sessionNumber ?? index + 1 });
}
