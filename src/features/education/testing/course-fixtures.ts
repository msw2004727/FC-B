// 測試與截圖共用的假資料（人名、俱樂部名皆為假名）。時間基準：台北 2026-11-09 10:00。
import type { FakeCourseData } from './fake-course-repo';

export const FIXTURE_NOW = Date.parse('2026-11-09T10:00:00+08:00');
export const PARENT_UID = 'u_parent';
export const COACH_UID = 'u_coach';

function others(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, studentId: `${prefix}${i}`, status: 'approved', paidAt: '' }));
}

function otherStudents(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `學員${i}`, parentUid: `x${i}`, enrollStatus: 'active' }));
}

export function courseFixture(): FakeCourseData {
  const weekly = { planType: 'weekly', active: true, visibleOnTeamPage: true, allowSignup: true };
  return {
    team: {
      id: 'tm_demo',
      _docId: 'tm_demo',
      name: '晨光足球學苑',
      teachingEnabled: true,
      captainUid: 'u_captain',
      coachUids: [COACH_UID],
    } as never,
    plans: {
      p1: { ...weekly, name: '週六兒童足球班', weekdays: [6], timeSlot: '09:00-10:30', startDate: '2026-11-01', endDate: '2026-12-27', location: '北屯運動中心', maxCapacity: 16, price: 3200, coachName: '陳示範', description: '6～12 歲，基本盤帶、傳接與小場對抗。請穿運動鞋、自備水壺。', sortOrder: 1 },
      p2: { planType: 'session', active: true, visibleOnTeamPage: true, allowSignup: true, name: '守門員特訓', totalSessions: 8, sessionSchedules: [{ date: '2026-12-06', startTime: '14:00', endTime: '16:00' }], startDate: '2026-12-06', endDate: '2027-01-25', location: '中興大學足球場', maxCapacity: 8, price: 4000, sortOrder: 2 },
      p3: { ...weekly, name: '週三體能班', weekdays: [3], timeSlot: '18:30-20:00', startDate: '2026-11-04', endDate: '2026-12-30', location: '北屯運動中心', maxCapacity: 16, price: 2800, sortOrder: 3 },
      p4: { ...weekly, allowSignup: false, name: '秋季幼兒班', weekdays: [0], timeSlot: '10:00-11:00', startDate: '2026-09-06', endDate: '2026-12-27', location: '文心森林公園', maxCapacity: 12, price: 2400, sortOrder: 4 },
      p5: { ...weekly, name: '週日親子班', weekdays: [0], timeSlot: '09:00-10:00', startDate: '2026-11-01', endDate: '2026-12-27', location: '文心森林公園', maxCapacity: 12, price: 2000, groupId: 'g1', sortOrder: 5 },
      p6: { planType: 'session', active: true, visibleOnTeamPage: true, allowSignup: true, name: '守門員進階', totalSessions: 4, sessionSchedules: [{ date: '2026-11-02', startTime: '14:00', endTime: '16:00' }], startDate: '2026-11-02', endDate: '2026-11-23', location: '中興大學足球場', maxCapacity: 8, price: 4000, sortOrder: 6 },
      ended: { ...weekly, name: '春季班', weekdays: [6], timeSlot: '09:00-10:00', startDate: '2026-03-01', endDate: '2026-05-30', maxCapacity: 10 },
    },
    sessions: {
      p1: [
        { id: 'p1s3', date: '2026-11-14', startTime: '09:00', endTime: '10:30', sessionNumber: 3, studentIds: [] },
        { id: 'p1s4', date: '2026-11-21', startTime: '09:00', endTime: '10:30', sessionNumber: 4, studentIds: [] },
        { id: 'p1s5', date: '2026-11-28', startTime: '09:00', endTime: '10:30', sessionNumber: 5, studentIds: [] },
        { id: 'p1s6', date: '2026-12-05', startTime: '09:00', endTime: '10:30', sessionNumber: 6, studentIds: [] },
      ],
      p5: [
        { id: 'p5s1', date: '2026-11-01', startTime: '09:00', endTime: '10:00', sessionNumber: 1, studentIds: ['stu_an'] },
        { id: 'p5s2', date: '2026-11-08', startTime: '09:00', endTime: '10:00', sessionNumber: 2, studentIds: ['stu_an'] },
        { id: 'p5s3', date: '2026-11-15', startTime: '09:00', endTime: '10:00', sessionNumber: 3, studentIds: ['stu_an'] },
        { id: 'p5s4', date: '2026-11-22', startTime: '09:00', endTime: '10:00', sessionNumber: 4, studentIds: ['stu_an'] },
        { id: 'p5s5', date: '2026-11-29', startTime: '09:00', endTime: '10:00', sessionNumber: 5, studentIds: ['stu_an'] },
      ],
      p6: [
        { id: 'p6s1', date: '2026-11-02', startTime: '14:00', endTime: '16:00', sessionNumber: 1, studentIds: ['stu_an', 'stu_qing'] },
        { id: 'p6s2', date: '2026-11-08', startTime: '14:00', endTime: '16:00', sessionNumber: 2, studentIds: ['stu_an', 'stu_qing'] },
        { id: 'p6s3', date: '2026-11-16', startTime: '14:00', endTime: '16:00', sessionNumber: 3, studentIds: ['stu_an', 'stu_qing'] },
        { id: 'p6s4', date: '2026-11-23', startTime: '14:00', endTime: '16:00', sessionNumber: 4, studentIds: ['stu_an'] },
      ],
    },
    students: [
      { id: 'stu_an', name: '陳小安', parentUid: PARENT_UID, enrollStatus: 'active', groupIds: ['g1'] },
      { id: 'stu_qing', name: '陳小晴', parentUid: PARENT_UID, enrollStatus: 'active', groupIds: [] },
      ...otherStudents('o', 16),
    ],
    enrollments: {
      p1: others('o', 12),
      p2: others('o', 6),
      p3: others('o', 16),
      p4: others('o', 9),
      p5: [...others('o', 6), { id: 'e_qing5', studentId: 'stu_qing', status: 'pending', paidAt: '' }],
      p6: [
        ...others('o', 4),
        { id: 'e_an6', studentId: 'stu_an', status: 'approved', paidAt: '2026-11-01' },
        { id: 'e_qing6', studentId: 'stu_qing', status: 'approved', paidAt: '' },
      ],
    },
    attendance: [
      { id: 'a1', teamId: 'tm_demo', coursePlanId: 'p5', studentId: 'stu_an', sessionId: 'p5s1', date: '2026-11-01', kind: 'signin', status: 'active' },
      { id: 'a2', teamId: 'tm_demo', coursePlanId: 'p5', studentId: 'stu_an', sessionId: 'p5s3', date: '2026-11-15', kind: 'registered', status: 'active' },
      { id: 'a3', teamId: 'tm_demo', coursePlanId: 'p5', studentId: 'stu_an', sessionId: 'p5s5', date: '2026-11-29', kind: 'leave', status: 'active' },
      { id: 'a4', teamId: 'tm_demo', coursePlanId: 'p6', studentId: 'stu_an', sessionId: 'p6s1', date: '2026-11-02', kind: 'signin', status: 'active' },
      { id: 'a5', teamId: 'tm_demo', coursePlanId: 'p6', studentId: 'stu_an', sessionId: 'p6s2', date: '2026-11-08', kind: 'leave', status: 'active' },
      { id: 'a6', teamId: 'tm_demo', coursePlanId: 'p6', studentId: 'stu_an', sessionId: 'p6s4', date: '2026-11-23', kind: 'leave', status: 'active' },
      { id: 'a7', teamId: 'tm_demo', coursePlanId: 'p6', studentId: 'stu_qing', sessionId: 'p6s1', date: '2026-11-02', kind: 'signin', status: 'active' },
    ],
  };
}

/** 全部方案都沒有的俱樂部（空狀態）。 */
export function emptyCourseFixture(): FakeCourseData {
  const data = courseFixture();
  return { ...data, plans: {}, sessions: {}, enrollments: {}, attendance: [] };
}
