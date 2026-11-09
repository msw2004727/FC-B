// 我的課程（K1-4）：自己與孩子在這個俱樂部報名的課程，顯示出席數、下一堂與未繳費。
// 誰在課程裡＝roster-union 聯集（approved 報名 ∪ 分組 active）；出席與下一堂只看 sessions.studentIds（讀取契約）。
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { CourseT } from '../i18n';
import {
  attendanceKindForSession,
  isSessionPast,
  isUnpaid,
  sortSessions,
  type CoursePlan,
  type CourseSession,
  type CourseStudent,
} from '../data/course-model';
import type { CourseRepo, CourseTeam } from '../data/course-repo';
import { sessionWhenText } from '../data/course-format';
import { stateFor, type ViewerCourses } from '../data/viewer-courses';

export interface MyCourseEntry {
  plan: CoursePlan;
  student: CourseStudent;
  status: 'approved' | 'pending';
  unpaid: boolean;
}

export function buildMyCourseEntries(data: ViewerCourses): MyCourseEntry[] {
  const out: MyCourseEntry[] = [];
  for (const plan of data.plans) {
    const state = stateFor(data, plan.id);
    for (const student of data.myStudents) {
      if (state.pendingIds.has(student.id)) {
        out.push({ plan, student, status: 'pending', unpaid: false });
      } else if (state.approvedIds.has(student.id)) {
        out.push({ plan, student, status: 'approved', unpaid: isUnpaid(plan, student.id, state) });
      }
    }
  }
  return out;
}

const CLOSED = new Set(['cancelled', 'canceled', 'removed', 'rescheduled']);

export interface AttendanceSummary {
  attended: number;
  total: number;
  next: CourseSession | null;
}

/** 出席數＝已上過、名冊有這位學員的課堂中，有簽到的堂數；下一堂＝之後第一堂名冊有他的課。 */
export function summarizeAttendance(
  sessions: readonly CourseSession[],
  records: Parameters<typeof attendanceKindForSession>[0],
  studentId: string,
  nowMs: number,
): AttendanceSummary {
  let attended = 0;
  let total = 0;
  let next: CourseSession | null = null;
  for (const s of sortSessions(sessions)) {
    if (!s.studentIds.includes(studentId) || CLOSED.has(s.status)) continue;
    if (isSessionPast(s, nowMs) || s.status === 'done') {
      total += 1;
      if (attendanceKindForSession(records, s, studentId) === 'signin') attended += 1;
    } else if (!next && s.startMs !== null && s.startMs >= nowMs) {
      next = s;
    }
  }
  return { attended, total, next };
}

function MyCourseCard({
  ct,
  repo,
  team,
  entry,
  sessionsFor,
  now,
  onOpen,
}: {
  ct: CourseT;
  repo: CourseRepo;
  team: CourseTeam;
  entry: MyCourseEntry;
  sessionsFor: (planId: string) => Promise<CourseSession[]>;
  now: () => number;
  onOpen: () => void;
}): JSX.Element {
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const approved = entry.status === 'approved';

  useEffect(() => {
    if (!approved) return undefined;
    let alive = true;
    Promise.all([sessionsFor(entry.plan.id), repo.listMyAttendance(team, entry.plan.id, entry.student.id)])
      .then(([sessions, records]) => {
        if (alive) setSummary(summarizeAttendance(sessions, records, entry.student.id, now()));
      })
      .catch((error: unknown) => {
        console.warn('[course.myCourse]', error);
      });
    return () => {
      alive = false;
    };
  }, [approved, entry.plan.id, entry.student.id]);

  const pct = summary && summary.total > 0 ? Math.round((summary.attended / summary.total) * 100) : 0;
  return (
    <div class="ck-card ck-card-tap" data-my-course={`${entry.plan.id}:${entry.student.id}`} role="link" tabIndex={0} onClick={onOpen}>
      <div class="ck-card-h">
        <b>{entry.plan.name}</b>
        <span class="ck-chip ck-chip-info">{entry.student.name}</span>
        {entry.unpaid ? <span class="ck-chip ck-chip-red">{ct('chip.unpaid')}</span> : null}
        <span class={`ck-chip ${approved ? 'ck-chip-acc' : 'ck-chip-warn'}`}>
          {ct(approved ? 'chip.enrolled' : 'chip.pending')}
        </span>
      </div>
      <div class="ck-mine-club">{team.name}</div>
      {approved && summary ? (
        <>
          {summary.total > 0 ? (
            <div class="ck-bar">
              <i style={{ width: `${pct}%` }} />
            </div>
          ) : null}
          <div class="ck-mine-f">
            <span>{ct('mine.attend', { n: summary.attended, total: summary.total })}</span>
            {summary.next ? <span>{ct('mine.next', { when: sessionWhenText(ct, summary.next) })}</span> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function MyCourses({
  ct,
  repo,
  team,
  data,
  now,
  onOpenLessons,
  onOpenDetail,
}: {
  ct: CourseT;
  repo: CourseRepo;
  team: CourseTeam;
  data: ViewerCourses;
  now: () => number;
  onOpenLessons: (planId: string) => void;
  onOpenDetail: (planId: string) => void;
}): JSX.Element | null {
  const entries = buildMyCourseEntries(data);
  // 同一方案兩個孩子共用一次課堂讀取。
  const [cache] = useState(() => new Map<string, Promise<CourseSession[]>>());
  const sessionsFor = (planId: string): Promise<CourseSession[]> => {
    let p = cache.get(planId);
    if (!p) {
      p = repo.listSessions(team, planId);
      p.catch(() => cache.delete(planId));
      cache.set(planId, p);
    }
    return p;
  };
  if (!entries.length) return null;
  return (
    <section data-section="my-courses">
      <div class="ck-sec-h">{ct('head.mine')}</div>
      {entries.map((entry) => (
        <MyCourseCard
          key={`${entry.plan.id}:${entry.student.id}`}
          ct={ct}
          repo={repo}
          team={team}
          entry={entry}
          sessionsFor={sessionsFor}
          now={now}
          onOpen={() => (entry.status === 'approved' ? onOpenLessons(entry.plan.id) : onOpenDetail(entry.plan.id))}
        />
      ))}
    </section>
  );
}
