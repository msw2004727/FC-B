import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, registerMock, startRecording, stopRecording } from '@/data/callables';
import { assertAllowedFields } from '@/data/write-guard';
import { buildPendingStudentPayload, courseRepo, PENDING_STUDENT_FIELDS, toCourseTeam } from './course-repo';
import { normalizeSession, normalizeStudent } from './course-model';

describe('course-repo：既有 Callable 的參數', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
    startRecording();
  });
  afterEach(() => {
    stopRecording();
    clearMocks();
    vi.unstubAllEnvs();
  });

  // 舊資料的 team.id 與文件 ID 可能不同：Callable 照 A 帶 team.id，Firestore 子集合用文件 ID。
  const team = toCourseTeam({ id: 'tm_public', _docId: 'doc1', name: '晨光足球學苑' } as never);
  const session = normalizeSession('s3', { date: '2026-11-15', startTime: '09:00', studentIds: ['stu_a'] });
  const student = normalizeStudent('stu_a', { name: '陳小安', parentUid: 'u1', enrollStatus: 'active' });

  it('team 識別：fsId 用文件 ID、apiId 用 team.id', () => {
    expect(team.fsId).toBe('doc1');
    expect(team.apiId).toBe('tm_public');
  });

  it('registerForEduCoursePlan／cancelCourseEnrollment 帶 teamId、planId、studentIds', async () => {
    registerMock('registerForEduCoursePlan', async () => ({ success: true }));
    registerMock('cancelCourseEnrollment', async () => ({}));
    await courseRepo.register(team, 'p1', ['stu_a']);
    await courseRepo.cancelPending(team, 'p1', ['stu_a', 'stu_b']);
    expect(stopRecording().map((c) => [c.name, c.request])).toEqual([
      ['registerForEduCoursePlan', { teamId: 'tm_public', planId: 'p1', studentIds: ['stu_a'] }],
      ['cancelCourseEnrollment', { teamId: 'tm_public', planId: 'p1', studentIds: ['stu_a', 'stu_b'] }],
    ]);
  });

  it('單堂報名／請假帶 sessionId、date、studentId（照 A FirebaseService 包裝）', async () => {
    registerMock('saveEduCourseSelfAttendance', async () => ({ success: true, kind: 'signin', signedIn: true }));
    registerMock('saveEduCourseSelfLeave', async () => ({ success: true }));
    const res = await courseRepo.saveSelfAttendance({ team, planId: 'p1', session, student, kind: 'registered' });
    expect(res.signedIn).toBe(true);
    await courseRepo.saveSelfLeave({ team, planId: 'p1', session, student, leave: false });
    expect(stopRecording().map((c) => [c.name, c.request])).toEqual([
      ['saveEduCourseSelfAttendance', { teamId: 'tm_public', planId: 'p1', sessionId: 's3', date: '2026-11-15', studentId: 'stu_a', studentName: '陳小安', kind: 'registered' }],
      ['saveEduCourseSelfLeave', { teamId: 'tm_public', planId: 'p1', sessionId: 's3', date: '2026-11-15', studentId: 'stu_a', studentName: '陳小安', leave: false }],
    ]);
  });

  it('listEduCourseEnrollmentSummaries 每批最多 50 個方案，合併 migrationCompleted', async () => {
    const calls: unknown[] = [];
    registerMock('listEduCourseEnrollmentSummaries', async (req) => {
      calls.push(req);
      const ids = (req.planIds ?? []) as string[];
      return {
        success: true,
        migrationCompleted: ids.includes('p50'),
        summaries: Object.fromEntries(ids.map((id) => [id, { effectiveApprovedCount: 1, viewerStatuses: {} }])),
      };
    });
    const ids = Array.from({ length: 51 }, (_, i) => `p${i}`);
    const res = await courseRepo.listSummaries(team, ids);
    expect(calls).toHaveLength(2);
    expect(res.migrationCompleted).toBe(true);
    expect(Object.keys(res.summaries)).toHaveLength(51);
    expect(res.summaries.p0?.effectiveApprovedCount).toBe(1);
  });
});

describe('新增 pending 學員（照 A edu-student-join；Rules：isAuth、name 字串、enrollStatus=pending）', () => {
  // A edu-student-join.js studentData 的欄位（加上 createEduStudent 補的 createdAt／updatedAt）。
  const A_FIELDS = ['id', 'name', 'birthday', 'gender', 'parentUid', 'selfUid', 'groupIds', 'groupNames', 'coachNotes', 'positionTags', 'enrollStatus', 'enrolledAt'];

  it('家長代報：parentUid＝自己、selfUid=null、pending、不自動分組', () => {
    const p = buildPendingStudentPayload({ id: 'stu_1', name: ' 陳小晴 ', uid: 'u1', relation: 'parent' });
    expect(Object.keys(p).sort()).toEqual([...A_FIELDS].sort());
    expect(p).toMatchObject({ id: 'stu_1', name: '陳小晴', parentUid: 'u1', selfUid: null, enrollStatus: 'pending', groupIds: [] });
    expect(() => assertAllowedFields('t', { ...p, createdAt: 1, updatedAt: 1 }, PENDING_STUDENT_FIELDS)).not.toThrow();
  });

  it('本人：selfUid＝自己、parentUid=null', () => {
    const p = buildPendingStudentPayload({ id: 'stu_2', name: '王示範', uid: 'u1', relation: 'self' });
    expect(p).toMatchObject({ selfUid: 'u1', parentUid: null, enrollStatus: 'pending' });
  });
});
