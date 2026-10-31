import '@/styles/legacy/calendar.css';
import '@/styles/legacy/calendar-sport-counts.css';
import type { JSX } from 'preact';
import { useEffect, useMemo } from 'preact/hooks';
import type { LegacyEventDoc } from './TimelineEventCard';
import type { RegistrationDoc } from '../../data/types';
import { getViewerEventRegState } from '../../data/viewer-reg-state';
import { getSportLabelByKey } from '../../data/sports';
import {
  WEEK_DAY_NAMES,
  buildMonthCells,
  buildSportCounts,
  calendarEventPresentation,
  formatSportCountSummary,
  getSportDef,
  groupEventsByDateForMonth,
  monthLabel,
  sortCalendarEvents,
  toDateKey,
} from '../../data/calendar-model';
import { useCalendarNav } from './use-calendar-nav';

export interface ActivityCalendarProps {
  events: readonly LegacyEventDoc[];
  /** 照 A _getCalendarUserRegisteredDateKeys：計算「當天已有報名」用的可見活動（未套篩選）；省略時用 events。 */
  registeredSourceEvents?: readonly LegacyEventDoc[];
  viewerUid: string | null;
  viewerRegistrations: readonly RegistrationDoc[];
  onSelectEvent: (event: LegacyEventDoc) => void;
  onJumpToDate: (dateKey: string) => void;
}

/** 照 A _buildEventCellHTML；目前 A 日期格使用運動摘要。 */
export function CalendarEventCell({
  event, viewerUid, viewerRegistrations,
}: Pick<ActivityCalendarProps, 'viewerUid' | 'viewerRegistrations'> & {
  event: LegacyEventDoc;
}): JSX.Element {
  const state = getViewerEventRegState(event, viewerUid, viewerRegistrations);
  const presentation = calendarEventPresentation(event, state, Date.now());
  return (
    <div
      class={presentation.className}
      data-id={event.id}
      data-status={presentation.status}
      style={`--sport-color:var(${presentation.sport.var})`}
      role="button"
      tabIndex={0}
      aria-label={presentation.label}
      title={event.title ?? ''}
    >
      <span class="evt-cal-emoji" aria-hidden="true">{presentation.sport.emoji}</span>
      {presentation.time && <span class="evt-cal-time">{presentation.time}</span>}
      <span class="evt-cal-title">{event.title ?? ''}</span>
    </div>
  );
}

/** 照 A _renderActivityCalendar、_buildCalendarShell。 */
export default function ActivityCalendar(props: ActivityCalendarProps): JSX.Element {
  const { events, viewerUid, viewerRegistrations, onSelectEvent, onJumpToDate } = props;
  const nav = useCalendarNav();
  // 傳絕對瞬間；buildMonthCells 以台北日期決定 today／past，格子維持純日曆算術。
  const now = new Date();

  const registeredDates = useMemo(() => {
    const dates = new Set<string>();
    if (!viewerUid) return dates;
    for (const event of props.registeredSourceEvents ?? events) {
      if (!event.id || !getViewerEventRegState(event, viewerUid, viewerRegistrations).signedUp) continue;
      const key = toDateKey(event.date);
      if (key) dates.add(key);
    }
    return dates;
  }, [events, props.registeredSourceEvents, viewerUid, viewerRegistrations]);

  // 照 A _setActivityTab：網址直入也捲回頂端。
  useEffect(() => {
    try { window.scrollTo(0, 0); } catch { /* 環境未提供捲動。 */ }
  }, []);

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const jump = event.target.closest<HTMLElement>(
      '.evt-cal-sport-summary[data-jump-date], .evt-cal-more[data-jump-date]',
    );
    if (jump?.dataset.jumpDate) {
      onJumpToDate(jump.dataset.jumpDate);
      return;
    }
    const id = event.target.closest<HTMLElement>('.evt-cal-event[data-id]')?.dataset.id;
    const selected = id ? events.find((item) => item.id === id) : undefined;
    if (selected) onSelectEvent(selected);
  }

  return (
    <>
      <div class="evt-cal-head">
        <div class="evt-cal-nav" role="toolbar" aria-label="月曆月份導覽">
          <button
            type="button" class="evt-cal-nav-btn" id="evt-cal-prev"
            aria-label="上個月" disabled={nav.previousDisabled} onClick={() => nav.go(-1)}
          >‹</button>
          <span class="evt-cal-nav-label" id="evt-cal-label" aria-live="polite">{monthLabel(nav.current)}</span>
          <button
            type="button" class="evt-cal-nav-btn" id="evt-cal-next"
            aria-label="下個月" onClick={() => nav.go(1)}
          >›</button>
        </div>
        <div class="evt-cal-weekhead" role="presentation">
          {WEEK_DAY_NAMES.map((day, index) => (
            <div
              key={day}
              class={`evt-cal-weekhead-cell${index === 5 ? ' evt-cal-weekhead-sat' : index === 6 ? ' evt-cal-weekhead-sun' : ''}`}
              aria-hidden="true"
            >{day}</div>
          ))}
        </div>
      </div>
      <div
        class="evt-cal-container" id="evt-cal-scroll" role="grid" aria-label="活動月曆"
        ref={nav.scrollRef} onClick={onClick} onKeyDown={nav.onKeyDown}
      >
        {nav.months.map((month) => {
          const groups = groupEventsByDateForMonth(events, month);
          return (
            <section class="evt-cal-month" data-month={month} aria-label={monthLabel(month)} key={month}>
              <div class="evt-cal-grid" role="rowgroup">
                {buildMonthCells(month, now).map((cell) => {
                  const sorted = sortCalendarEvents(groups.get(cell.dateKey) ?? []);
                  const counts = buildSportCounts(sorted);
                  const summary = formatSportCountSummary(counts);
                  const registered = registeredDates.has(cell.dateKey);
                  const label = sorted.length
                    ? `${cell.day}日，${summary}，按 Enter 展開`
                    : `${cell.day}日，無活動`;
                  return (
                    <div
                      key={cell.dateKey} class="evt-cal-day" role="gridcell" tabIndex={0}
                      data-date={cell.dateKey}
                      data-event-count={sorted.length > 3 ? '4+' : String(sorted.length)}
                      data-has-pinned={sorted.some((item) => item.pinned) ? '1' : '0'}
                      data-today={cell.today ? '1' : '0'}
                      data-user-registered={registered ? '1' : '0'}
                      data-outside={cell.outside ? '1' : '0'}
                      data-past={cell.past ? '1' : '0'}
                      aria-rowindex={cell.row} aria-colindex={cell.col}
                      aria-label={`${label}${registered ? '，你當天已有報名' : ''}`}
                    >
                      <div class="evt-cal-day-head">
                        <span class="evt-cal-day-num">{cell.day}</span>
                        {registered && <span class="evt-cal-user-day-check" aria-hidden="true">✓</span>}
                      </div>
                      {counts.length ? (
                        <div
                          class="evt-cal-sport-summary" role="button" tabIndex={0}
                          data-jump-date={cell.dateKey} aria-label={`${summary}，跳到直瀑視圖`}
                        >
                          {counts.map(({ sportKey, count }) => (
                            <span
                              key={sportKey} class="evt-cal-sport-count-item"
                              style={`--sport-color:var(${getSportDef(sportKey).var})`}
                              title={`${getSportLabelByKey(sportKey)} x${count}`}
                            >
                              {/* ASSUMPTION: 未附 A getSportIconSvg，使用 A 的 emoji 備援。 */}
                              <span class="sport-emoji evt-cal-sport-icon" aria-hidden="true">
                                {getSportDef(sportKey).emoji}
                              </span>
                              <span class="evt-cal-sport-count-text">x{count}</span>
                            </span>
                          ))}
                        </div>
                      ) : <div class="evt-cal-empty-mark" aria-hidden="true">—</div>}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
