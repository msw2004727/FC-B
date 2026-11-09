import { describe, expect, it } from 'vitest';
import {
  attendanceKindForSession,
  courseErrorCode,
  getCardState,
  getViewerPlanState,
  isSessionOpenForSelf,
  isUnpaid,
  lessonView,
  normalizePlan,
  normalizeSession,
  normalizeSummary,
  ownedStudents,
  visiblePlans,
  type AttendanceRecord,
  type CourseStudent,
} from './course-model';

const NOW = Date.parse('2026-11-09T10:00:00+08:00');

function plan(overrides: Record<string, unknown> = {}) {
  return normalizePlan(String(overrides.id ?? 'p1'), {
    name: '週六兒童足球班',
    planType: 'weekly',
    weekdays: [6],
    timeSlot: '09:00-10:30',
    startDate: '2026-11-01',
    endDate: '2026-12-27',
    maxCapacity: 16,
    price: 3200,
    allowSignup: true,
    ...overrides,
  });
}

function student(id: string, extra: Partial<CourseStudent> = {}): CourseStudent {
  return { id, docId: id, name: id, selfUid: '', parentUid: 'u1', enrollStatus: 'active', groupIds: [], ...extra };
}

const NONE = { approvedIds: new Set<string>(), pendingIds: new Set<string>() };

describe('課程卡 6 種狀態', () => {
  it('可報名：固定週期與堂數制', () => {
    expect(getCardState(plan(), 12, NONE)).toBe('open');
    expect(getCardState(plan({ planType: 'session', totalSessions: 8 }), 6, NONE)).toBe('open');
  });
  it('名額已滿（effectiveApprovedCount ≥ maxCapacity）', () => {
    expect(getCardState(plan(), 16, NONE)).toBe('full');
    expect(getCardState(plan({ maxCapacity: 0 }), 99, NONE)).toBe('open');
  });
  it('已截止（allowSignup 不是 true）', () => {
    expect(getCardState(plan({ allowSignup: false }), 3, NONE)).toBe('closed');
    expect(getCardState(plan({ allowSignup: undefined }), 3, NONE)).toBe('closed');
  });
  it('審核中優先於已報名、截止、額滿', () => {
    const v = { approvedIds: new Set(['a']), pendingIds: new Set(['b']) };
    expect(getCardState(plan({ allowSignup: false }), 16, v)).toBe('pending');
  });
  it('已報名（聯集內）', () => {
    expect(getCardState(plan(), 16, { approvedIds: new Set(['a']), pendingIds: new Set() })).toBe('enrolled');
  });
  it('未登入（viewer=null）只看方案', () => {
    expect(getCardState(plan(), null, null)).toBe('open');
  });
});

describe('我的學員在方案中的狀態（聯集 helper）', () => {
  const kids = [student('a'), student('b', { groupIds: ['g1'] }), student('c', { groupIds: ['g1'], enrollStatus: 'pending' })];
  it('approved 報名 ∪ 分組 active；pending 另列；旗標設定後不算分組', () => {
    const p = plan({ groupId: 'g1' });
    const enrollments = [
      { id: 'e1', studentId: 'a', status: 'approved', paidAt: '' },
      { id: 'e2', studentId: 'c', status: 'pending', paidAt: '' },
    ];
    const s = getViewerPlanState(p, kids, enrollments, false);
    expect([...s.approvedIds].sort()).toEqual(['a', 'b']);
    expect([...s.pendingIds]).toEqual(['c']);
    const done = getViewerPlanState(p, kids, enrollments, true);
    expect([...done.approvedIds]).toEqual(['a']);
  });
  it('分組內但另有 pending 報名（K0 P09）照 A 算審核中', () => {
    const p = plan({ groupId: 'g1' });
    const s = getViewerPlanState(p, kids, [{ id: 'e', studentId: 'b', status: 'pending', paidAt: '' }], false);
    expect(s.approvedIds.has('b')).toBe(true);
    expect(getCardState(p, 3, s)).toBe('pending');
  });
  it('未繳費：分組舊制學員沒有報名文件算未繳；已繳 paidAt 不算；隨堂收費或免費不追蹤', () => {
    const p = plan({ groupId: 'g1' });
    const s = getViewerPlanState(p, kids, [{ id: 'e1', studentId: 'a', status: 'approved', paidAt: '2026-11-01' }], false);
    expect(isUnpaid(p, 'a', s)).toBe(false);
    expect(isUnpaid(p, 'b', s)).toBe(true);
    expect(isUnpaid(plan({ groupId: 'g1', perSessionBilling: true }), 'b', s)).toBe(false);
    expect(isUnpaid(plan({ groupId: 'g1', price: 0 }), 'b', s)).toBe(false);
  });
  it('我名下學員排除 inactive（照 A _getMyEduStudents）', () => {
    const list = [student('x', { selfUid: 'u1', parentUid: '' }), student('y', { enrollStatus: 'inactive' }), student('z', { parentUid: 'other' })];
    expect(ownedStudents(list, 'u1').map((s) => s.id)).toEqual(['x']);
    expect(ownedStudents(list, null)).toEqual([]);
  });
});

describe('方案可見性', () => {
  it('停用、已結束不顯示；未公開只給幹部；置頂與 sortOrder 排序', () => {
    const list = [
      plan({ id: 'a', sortOrder: 2 }),
      plan({ id: 'b', active: false }),
      plan({ id: 'c', endDate: '2026-09-17' }),
      plan({ id: 'd', visibleOnTeamPage: false }),
      plan({ id: 'e', pinned: true, sortOrder: 9 }),
      plan({ id: 'f', sortOrder: 1 }),
    ];
    expect(visiblePlans(list, false, NOW).map((p) => p.id)).toEqual(['e', 'f', 'a']);
    expect(visiblePlans(list, true, NOW).map((p) => p.id)).toEqual(['e', 'd', 'f', 'a']);
  });
});

describe('出缺席與單堂操作', () => {
  const session = normalizeSession('s3', { date: '2026-11-15', startTime: '09:00', studentIds: ['a'], sessionNumber: 3 });
  const rec = (over: Partial<AttendanceRecord>): AttendanceRecord => ({
    id: 'r', studentId: 'a', sessionId: 's3', date: '2026-11-15', kind: 'registered', status: 'active', ...over,
  });
  it('同堂紀錄優先序：簽到 > 請假 > 已報名；removed 不算；無 sessionId 的舊紀錄依日期', () => {
    expect(attendanceKindForSession([rec({})], session, 'a')).toBe('registered');
    expect(attendanceKindForSession([rec({}), rec({ kind: 'leave' })], session, 'a')).toBe('leave');
    expect(attendanceKindForSession([rec({ kind: 'leave' }), rec({ kind: '' })], session, 'a')).toBe('signin');
    expect(attendanceKindForSession([rec({ kind: 'leave', status: 'removed' })], session, 'a')).toBeNull();
    expect(attendanceKindForSession([rec({ sessionId: '', kind: 'leave' })], session, 'a')).toBe('leave');
    expect(attendanceKindForSession([rec({ sessionId: 'other' })], session, 'a')).toBeNull();
    expect(attendanceKindForSession([rec({ studentId: 'b' })], session, 'a')).toBeNull();
  });
  it('固定週期：沒紀錄顯示未報名→報名；已報名→請假；請假→取消；簽到不給按鈕', () => {
    expect(lessonView('weekly', null, true)).toEqual({ display: 'unregistered', action: 'register' });
    expect(lessonView('weekly', 'registered', true)).toEqual({ display: 'registered', action: 'leave' });
    expect(lessonView('weekly', 'leave', true)).toEqual({ display: 'leave', action: 'cancelLeave' });
    expect(lessonView('weekly', 'signin', true)).toEqual({ display: 'signin', action: null });
    expect(lessonView('weekly', null, false)).toEqual({ display: 'unregistered', action: null });
  });
  it('堂數制：預設要來，未請假→請假；請假→取消', () => {
    expect(lessonView('session', null, true)).toEqual({ display: 'none', action: 'leave' });
    expect(lessonView('session', 'leave', true)).toEqual({ display: 'leave', action: 'cancelLeave' });
  });
  it('已調課、取消或開始超過 6 小時的課堂不開放操作', () => {
    expect(isSessionOpenForSelf(session, NOW)).toBe(true);
    expect(isSessionOpenForSelf(normalizeSession('x', { date: '2026-11-15', status: 'rescheduled' }), NOW)).toBe(false);
    expect(isSessionOpenForSelf(normalizeSession('y', { date: '2026-11-09', startTime: '03:00' }), NOW)).toBe(false);
    expect(isSessionOpenForSelf(normalizeSession('z', { date: '2026-11-09', startTime: '05:00' }), NOW)).toBe(true);
  });
});

describe('錯誤碼轉換', () => {
  it('業務碼取自 details.code 或 message；認不得回 UNKNOWN', () => {
    expect(courseErrorCode({ code: 'functions/resource-exhausted', message: 'COURSE_FULL', details: { code: 'COURSE_FULL' } })).toBe('COURSE_FULL');
    expect(courseErrorCode({ code: 'functions/failed-precondition', message: 'SIGNUP_CLOSED' })).toBe('SIGNUP_CLOSED');
    expect(courseErrorCode({ code: 'functions/already-exists', message: 'x', details: { code: 'ALREADY_ENROLLED' } })).toBe('ALREADY_ENROLLED');
    expect(courseErrorCode({ code: 'functions/permission-denied', message: 'STUDENT_NOT_IN_ROSTER' })).toBe('STUDENT_NOT_IN_ROSTER');
    expect(courseErrorCode({ code: 'functions/unauthenticated', message: 'Authentication required' })).toBe('UNAUTHENTICATED');
    expect(courseErrorCode(new Error('network'))).toBe('UNKNOWN');
    expect(courseErrorCode(null)).toBe('UNKNOWN');
  });
});

describe('伺服器摘要正規化', () => {
  it('effectiveApprovedCount、pendingReviewCount、viewerStatuses', () => {
    expect(normalizeSummary({ effectiveApprovedCount: 12, pendingReviewCount: 2, viewerStatuses: { a: 'approved' } })).toEqual({
      effectiveApprovedCount: 12,
      pendingReviewCount: 2,
      viewerStatuses: { a: 'approved' },
    });
    expect(normalizeSummary(null)).toBeNull();
  });
});
