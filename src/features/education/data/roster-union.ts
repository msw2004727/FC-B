// 課程名冊聯集：「approved 報名 ∪（舊制未關閉時）方案分組裡 active 的學員」。
// 讀取契約（K0 報告 §4.1、顧問 §3.36）：B 只准有這一個 helper；方案人數另用伺服器的 effectiveApprovedCount。
// 逐行對照 FC functions/edu-course-enrollment-core.js#getApprovedStudentIdSet（oracle 對照測試在 roster-union.oracle.test.ts）。
// 分組只看學員的 groupIds 陣列，不看單數 groupId。

function asString(value: unknown, maxLength = 120): string {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function asId(value: unknown, maxLength = 100): string {
  return asString(value, maxLength);
}

export interface RosterUnionPlan {
  groupId?: unknown;
}

export interface RosterUnionEnrollment {
  studentId?: unknown;
  status?: unknown;
}

export interface RosterUnionStudent {
  id?: unknown;
  _docId?: unknown;
  enrollStatus?: unknown;
  groupIds?: unknown;
}

export interface RosterUnionInput {
  plan?: RosterUnionPlan | null;
  enrollments?: readonly RosterUnionEnrollment[];
  students?: readonly RosterUnionStudent[];
  migrationCompleted?: boolean;
}

export function getApprovedStudentIdSet({
  plan,
  enrollments = [],
  students = [],
  migrationCompleted = false,
}: RosterUnionInput): Set<string> {
  const ids = new Set<string>();
  for (const item of enrollments) {
    if (asString(item?.status, 32) !== 'approved') continue;
    const studentId = asId(item.studentId);
    if (studentId) ids.add(studentId);
  }

  const groupId = asId(plan?.groupId);
  if (!migrationCompleted && groupId) {
    for (const student of students) {
      const studentId = asId(student && (student.id || student._docId));
      const groupIds = Array.isArray(student?.groupIds)
        ? (student.groupIds as unknown[]).map((gid) => asId(gid))
        : [];
      if (studentId && asString(student?.enrollStatus, 32) === 'active' && groupIds.includes(groupId)) {
        ids.add(studentId);
      }
    }
  }

  return ids;
}
